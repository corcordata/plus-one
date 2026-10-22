// 一场陪看：把门铃、帧、字幕、叫醒串起来。壳和叫醒都是从外面递进来的，测试里可以假装。
import { Doorbell } from "./doorbell.js";
import { buildGlance } from "./glance.js";
import { FrameBuffer, shouldCapture } from "./frames.js";
import { parseSrt, shiftCues } from "./subtitles.js";
import { lateTag, HAND_ACTIONS } from "./replies.js";
import { cleanTitle } from "./titles.js";
import { timecode } from "./timecode.js";
import { sanitizeAppearance, appearanceSnapshot } from "./appearance.js";
import { SubFinder } from "./subfinder.js";
import { listen as geminiListen, computeOffset, DEFAULT_MODELS } from "./ears.js";

const PAUSE_CONFIRM_MS = 3000;   // 暂停停够 3 秒才算她按的——爬虫站的播放器缓冲时会自己暂停一下再播
const MAX_MISSES = 180;   // 5 秒一拍 × 180 ≈ 15 分钟找不到视频才收摊（她可能还在找片源）
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 同一部片：网址一样，或者同一个站、同一条路径（后面的 ?t= 之类不算）
function sameFilm(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname === y.pathname; } catch { return false; }
}
const sameRef = (a, b) => !!a && !!b && a.sessionId === b.sessionId && a.contextId === b.contextId;
const area = (s) => (s ? (Number(s.w) || 0) * (Number(s.h) || 0) : 0);
// 子框够不够大、算得上播放框：占顶层三成面积以上，或者宽过六成；顶层没报大小就按 200×150 起算（广告框一般 300×250 以下）
function bigEnough(child, top) {
  if (!area(child)) return true;   // 老芯不报大小：照旧当播放框
  if (!area(top)) return area(child) >= 200 * 150;
  return area(child) >= 0.3 * area(top) || child.w >= 0.6 * top.w;
}
function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > 32) map.delete(map.keys().next().value);
}

export class WatchSession {
  // subfinder / listen：传 null = 这个宿主没有（手机上）；不传 = 用电脑上的默认那份
  constructor({ shell, wake, config, films = null, now = () => Date.now(), log = () => {}, onSettings = () => {}, subfinder,
    listen = geminiListen, clipWaitMs = 3000 }) {
    this.shell = shell;
    this.films = films;   // 本机观影备份（FilmStore）；没有也能看，只是不记、不问接着看
    this.wake = wake;
    this.config = config;
    this.now = now;
    this.log = log;
    this.onSettings = onSettings;
    this.doorbell = new Doorbell({ intervalSec: config.interval_sec });
    this.frameMode = config.frame_mode === "pick" ? "pick" : "auto";
    this.state = null;
    this.rawCues = [];
    this.offset = 0;
    this.lastWakeAt = null;
    this.lastReplyAt = null;
    this.lastError = null;
    this.activeRef = null;   // 正在放片的那个框；别的框里的视频（广告、预告）发来的事件不算
    this.linkOk = null;      // 输入条左边那个点：true 绿（他看得见）/ false 橙（叫不醒他）
    this.pendingOpen = null; // 手机叫电脑打开的那部片：页面起来、视频认到之后跳到进度
    this.subfinder = subfinder === undefined ? new SubFinder({ lang: config.subtitle_lang || "eng" }) : subfinder;
    this.subCandidates = [];  // 上一次搜到的字幕候选，她点哪条就下哪条
    this.listen = listen;     // Gemini 耳朵（测试里换成假的）
    this.clipWaitMs = clipWaitMs;
    this.clipWaiters = new Map();
    this.clipSeq = 0;
    this.align = null;        // 装了字幕、开着耳朵：片子放一会儿后听一段、自动对轴
    this.pageHellos = new Map();   // 顶层页网址 → 它那份「一起逛」芯：视频在跨域框里的站顶层也会挂一份，要叫它撤
    this.videoHellos = new Map();  // 顶层页网址 → 这页里打过招呼的播放框（子框常比顶层先到）
    this.reclaimable = false;      // 壳断过线 / 正在放片的框没了：下一条来自同一页的消息重新认领
  }

  async pageOf(ref) {
    try { return (await this.shell.pageUrl?.(ref)) || ""; } catch { return ""; }
  }

  // 手机那头的卡上「在电脑上接着看」：中继排的命令。打开那页，等它的视频跟芯打招呼时跳过去
  async handleCommand(cmd, freshSec = 120) {
    if (cmd?.action !== "open" || !/^https?:\/\//.test(String(cmd.url || ""))) return;
    const at = Date.parse(cmd.at);
    if (Number.isFinite(at) && this.now() - at > freshSec * 1000) return;   // 大管家刚回来，旧命令不翻
    const atSec = Math.max(0, Number(cmd.at_sec) || 0);
    // 一起逛的卡「接着读」：带的是滑到这一页的百分之几，不是片内时间
    const pct = Number(cmd.scroll_pct);
    const scrollPct = Number.isFinite(pct) && pct > 0 ? Math.min(100, pct) : null;
    this.pendingOpen = { url: cmd.url, atSec, scrollPct, title: String(cmd.title || ""), until: this.now() + 10 * 60 * 1000 };
    await this.shell.openTab(cmd.url);
    this.log(`opened from phone: ${cmd.title || cmd.url} @ ${timecode(atSec)}`);
  }

  async landPendingOpen(msg, ref) {
    const p = this.pendingOpen;
    if (!p || this.now() > p.until) { this.pendingOpen = null; return false; }
    // 命令和招呼要配对：翻页的命令等顶层页（page）、视频的命令等真有视频的框——
    // 不然顶层那份「一起逛」先打招呼就把命令吃了，「跳过去」落在一个没视频的框里（10-21 夜）
    if (p.scrollPct !== null ? !msg.page : !msg.hasVideo) {
      // 视频的那张「接着上次 x:xx 看」小条不等视频：顶层页一打招呼就先给它（她 10-22：一进页面就该看见，
      // 不是视频载完才出）。跳过去的命令还是等真有视频的框，pendingOpen 留着
      if (p.scrollPct === null && msg.page && !p.offered) {
        const page = await this.pageOf(ref);
        if (sameFilm(page, p.url) || sameFilm(msg.url, p.url)) {
          p.offered = true;
          await this.shell.deliverTo(ref, { type: "resume_offer", at_sec: p.atSec, at: timecode(p.atSec), title: p.title });
        }
      }
      return false;
    }
    const page = await this.pageOf(ref);
    if (!sameFilm(page, p.url) && !sameFilm(msg.url, p.url)) return false;
    this.pendingOpen = null;
    if (p.scrollPct !== null) {
      // 漫画 / 网页：滑回上次停的地方就行，不弹「接着看」（那是给视频的）
      await this.shell.deliverTo(ref, { type: "control", action: "scroll_to", pct: p.scrollPct });
      return true;
    }
    if (p.atSec > 0) await this.shell.deliverTo(ref, { type: "control", action: "seek_to", at: p.atSec });
    await this.shell.deliverTo(ref, { type: "resume_offer", at_sec: p.atSec, at: timecode(p.atSec), title: p.title });
    return true;
  }

  // 视频在跨域框里的站：顶层页自己没视频，载完 1.5 秒也会挂一份「一起逛」——两份不能同时在。
  // 占顶层三成以上的播放框一打招呼，就叫顶层那份撤掉；小的（广告框）不算。子框常比顶层先到，两个顺序都认（10-21 夜）
  async settleTopFrame(msg, ref) {
    if (!ref || !(msg.page || msg.hasVideo)) return false;
    const page = (await this.pageOf(ref)) || String(msg.url || "");
    if (!page) return false;
    const now = this.now();
    const fresh = (e) => !!e && now - e.at < 30000;
    const size = { w: Number(msg.vw) || 0, h: Number(msg.vh) || 0 };
    if (msg.page) {
      if (this.state?.mode === "page") return false;   // 正在一起逛：换页由 followPage 接
      const v = this.videoHellos.get(page);
      if (fresh(v) && bigEnough(v.size, size)) { await this.standDown(ref); return true; }
      remember(this.pageHellos, page, { ref, size, at: now });
      return false;
    }
    remember(this.videoHellos, page, { ref, size, at: now });
    const t = this.pageHellos.get(page);
    const topIsWatching = !!this.state && sameRef(this.activeRef, t?.ref);
    if (fresh(t) && !sameRef(t.ref, ref) && bigEnough(size, t.size) && !topIsWatching) {
      this.pageHellos.delete(page);
      await this.standDown(t.ref);
    }
    return false;
  }

  async standDown(ref) {
    try { await this.shell.deliverTo?.(ref, { type: "standby" }); } catch { /* 那个框已经没了 */ }
    this.log("top frame stood down: the video is in a frame on that page");
  }

  // 壳断线重连 / 正在放片的框没了之后：下一条来自同一页的消息，这个框就是它了——补一份状态让芯知道还在一起看
  async reclaim(msg, ref) {
    const s = this.state;
    if (msg.type === "hello" && !(s.mode === "page" ? msg.page : msg.hasVideo)) return;
    const page = await this.pageOf(ref);
    const mine = sameFilm(page, s.pageUrl || s.url) || sameFilm(page, s.url) || sameFilm(msg.url, s.url);
    if (!mine) return;
    this.reclaimable = false;
    this.activeRef = ref;
    this.shell.setActive(ref);
    await this.shell.deliver(this.statusMessage()).catch(() => {});
    this.log(`frame reclaimed: ${s.title}`);
  }

  // 电脑端 CDP 断了又连上：旧的框号全作废，等正在看的那页再来一条消息时重新认领
  shellReconnected() {
    this.pageHellos.clear();
    this.videoHellos.clear();
    this.shell.setActive(null);
    this.activeFrameLost();
  }

  activeFrameLost() {
    this.activeRef = null;
    if (this.state) this.reclaimable = true;
  }

  // 收卡时递出去的那几张：开头、中间、最后
  wrapFrames() {
    const a = this.state?.album || [];
    const idx = a.length <= 3 ? a.map((_, i) => i) : [0, Math.floor((a.length - 1) / 2), a.length - 1];
    return idx.map((i) => a[i]);
  }

  earsAvailable() { return !!this.config.gemini_key && typeof this.listen === "function"; }
  earsActive() { return this.earsAvailable() && this.config.ears !== false; }
  geminiOpts() {
    const models = Array.isArray(this.config.gemini_models) && this.config.gemini_models.length ? this.config.gemini_models : DEFAULT_MODELS;
    return { key: this.config.gemini_key, models };
  }

  // 问芯要最近录好的声音（最多两段，每段约 15 秒）；芯不在 / 没录到就是空的
  requestClips() {
    if (!this.state || !this.earsActive()) return Promise.resolve([]);
    const id = ++this.clipSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.clipWaiters.delete(id); resolve([]); }, this.clipWaitMs);
      this.clipWaiters.set(id, (clips) => { clearTimeout(timer); this.clipWaiters.delete(id); resolve(clips); });
      this.shell.deliver({ type: "ears_get", id }).catch(() => {});
    });
  }

  async hear() {
    const clips = await this.requestClips();
    const clip = clips.at(-1);
    if (!clip) return null;
    return this.listen(clip, this.geminiOpts());
  }

  startAlign() {
    this.align = this.earsActive() && this.rawCues.length ? { tries: 0, after: this.now() + 20000 } : null;
  }

  // 自动对轴：听一段 → 跟字幕比 → 挪；对不上隔 40 秒再试，三次都不行就交给她手动
  async tryAlign() {
    const a = this.align;
    if (!a) return;
    a.after = this.now() + 40000;
    let heard = null;
    try { heard = await this.hear(); } catch (e) { this.log(`ears align: ${e.message}`); }
    if (!this.align) return;
    if (!heard) { a.after = this.now() + 15000; return; }   // 还没录到，过一会儿再来
    const off = computeOffset(heard.lines, this.rawCues);
    if (off !== null) {
      this.offset = off;
      this.align = null;
      await this.shell.deliver({ type: "subtitle_now", text: `自动对好了 ${this.lineNow()}` });
      return;
    }
    a.tries += 1;
    if (a.tries >= 3) {
      this.align = null;
      await this.shell.deliver({ type: "subtitle_now", text: "没听出能对上的台词，可以用下面的按钮手动挪" });
    }
  }

  async setLink(ok) {
    if (this.linkOk === ok) return;
    this.linkOk = ok;
    if (this.state) await this.shell.deliver({ type: "link", ok }).catch(() => {});
  }

  isActive(ref) {
    const a = this.activeRef;
    if (!a) return !ref || !this.reclaimable;   // 壳断过线：没认领到新框之前，别的框的话先不算
    return !ref || sameRef(ref, a);
  }

  get cues() {
    return this.offset ? shiftCues(this.rawCues, this.offset) : this.rawCues;
  }

  status() {
    return {
      active: !!this.state,
      title: this.state?.title ?? null,
      session: this.state?.id ?? null,
      last_wake_at: this.lastWakeAt,
      last_reply_at: this.lastReplyAt,
      last_error: this.lastError,
      wake_url_set: !!this.config.wake_url,
      subtitles: this.rawCues.length,
      interval_sec: this.doorbell.intervalSec,
      frame_mode: this.frameMode,
      sync_chat: !!this.config.sync_chat,
      ears_available: this.earsAvailable(),
      ears: this.earsActive(),
      mode: this.state?.mode ?? null,
      hands: !!this.config.hands,
    };
  }

  async handleCoreMessage({ msg, ref }) {
    if (this.reclaimable && this.state && ref && (msg.type === "video" || msg.type === "user_said" || msg.type === "hello")) await this.reclaim(msg, ref);
    const s = this.state;
    switch (msg.type) {
      case "start_request":
        // 上一场还开着（另一个标签页、换集后再按一次）：先收尾，别悄悄覆盖——一起逛的自动记录就靠这一下（10-21 夜）
        if (s) await this.end();
        this.reclaimable = false;
        this.activeRef = ref || null;
        this.shell.setActive(ref);
        await this.begin(msg.mode === "page" ? String(msg.title || "").trim() : cleanTitle(msg.title), {
          url: msg.url, resumedFrom: msg.resumed_from, mode: msg.mode === "page" ? "page" : "video",
          // 卡上记外面那一页的网址：视频常在别家网站的框里，单开那个框的地址不一定放得出来
          pageUrl: await this.shell.pageUrl?.(ref).catch(() => "") || "" });
        break;
      case "hello":
        if (await this.settleTopFrame(msg, ref)) break;
        if (await this.landPendingOpen(msg, ref)) break;
        if (s && s.mode === "page" && msg.page && ref && !this.isActive(ref)) { await this.followPage(msg, ref); break; }
        await this.offerResume(msg, ref);
        // 存过样子才递：没存过芯自己就是默认那套
        if (this.config.appearance) {
          await this.shell.deliverTo(ref, { type: "appearance", appearance: sanitizeAppearance(this.config.appearance) });
        }
        break;
      case "appearance_save": {
        const appearance = sanitizeAppearance(msg.appearance);
        this.config.appearance = appearance;
        this.onSettings({ appearance });
        break;
      }
      case "hand_failed":
        this.log(`hand ${msg.action}: ${msg.why}`);
        if (s) (s.handNotes ||= []).push(String(msg.why || "").slice(0, 120));   // 下一眼告诉他，别以为走成了
        break;
      case "ears_clip":
        this.clipWaiters.get(msg.id)?.(Array.isArray(msg.clips) ? msg.clips : []);
        break;
      case "wrap_open":
        if (s) await this.shell.deliver({ type: "wrap_frames", frames: this.wrapFrames().map((f) => ({ id: f.id, at: f.at, image: f.image })) });
        break;
      case "wrap_up":
        if (s) await this.wrapUp(msg);
        break;
      // 一起逛结束的票根：收进一起逛（只留她勾的那几句）/ 什么都不留
      case "browse_end":
        if (s && s.mode === "page") {
          if (msg.keep) {
            s.picked = (Array.isArray(msg.picked) ? msg.picked : []).slice(0, 300).map((p) => ({
              who: p.who === "him" ? "him" : "her", at: Number(p.at) || 0, text: String(p.text || "").slice(0, 300) }));
            if (String(msg.title || "").trim()) s.title = String(msg.title).trim().slice(0, 80);
            s.keepAnyway = true;   // 她点了收进来：不到一分钟也记
            // 票根上挑的截图：留哪几张、哪张当主图（老芯不发 keep_frames 就照旧只带最后一张）
            if (Array.isArray(msg.keep_frames)) s.keepFrames = msg.keep_frames.map(String);
            if (msg.cover) s.coverPick = String(msg.cover);
          } else {
            s.wrapped = true;      // 什么都不留
          }
        }
        await this.end();
        break;
      case "stop_request":
        await this.end();
        break;
      case "user_said":
        if (!s || !this.isActive(ref)) break;
        s.userSaid.push({ at: Number(msg.at) || s.video.time, text: String(msg.text || "").slice(0, 200) });
        s.lines.push({ who: "her", at: s.video.time, text: String(msg.text || "").slice(0, 200) });
        await this.ring("user_message");
        break;
      case "video":
        if (!s || !this.isActive(ref)) break;
        s.video = { time: Number(msg.time) || 0, paused: !!msg.paused };
        if (msg.by_ai) break;   // 他自己按的暂停，不用再叫醒他
        if (msg.event === "pause") s.pausedSince = this.now();
        else if (msg.event === "play") s.pausedSince = null;
        else if (msg.event === "ended") await this.ring("ended");
        break;
      case "subtitles_import":
        this.rawCues = parseSrt(msg.text);
        this.offset = 0;
        this.startAlign();
        await this.shell.deliver({ type: "subtitle_now", text: `导入了 ${this.rawCues.length} 句（${msg.name || "字幕"}）` });
        break;
      case "subtitles_search": {
        // 抽屉里「找字幕」：默认拿片名搜，她可以改成英文名再搜
        const query = String(msg.query || "").trim() || s?.title || "";
        if (!this.subfinder) {
          await this.shell.deliver({ type: "subtitle_candidates", query, items: [], error: "找字幕在这里用不了" });
          break;
        }
        await this.shell.deliver({ type: "subtitle_candidates", query, searching: true, items: [] });
        try {
          this.subCandidates = await this.subfinder.search(query);
          await this.shell.deliver({ type: "subtitle_candidates", query,
            items: this.subCandidates.map(({ link, encoding, ...c }) => c) });
        } catch (e) {
          this.log(`subtitles search: ${e.message}`);
          await this.shell.deliver({ type: "subtitle_candidates", query, items: [], error: "字幕站没连上，过会儿再试" });
        }
        break;
      }
      case "subtitles_pick": {
        const cand = this.subCandidates.find((c) => c.id === String(msg.id));
        if (!cand || !this.subfinder) break;
        try {
          const cues = await this.subfinder.download(cand);
          if (!cues.length) throw new Error("空的");
          this.rawCues = cues;
          this.offset = 0;
          this.startAlign();
          await this.shell.deliver({ type: "subtitle_now", text: `装上了 ${cues.length} 句（${cand.name}）· 不对轴就用下面的按钮挪` });
        } catch (e) {
          this.log(`subtitles download: ${e.message}`);
          await this.shell.deliver({ type: "subtitle_now", text: "这条下不下来，换一条试试" });
        }
        break;
      }
      case "subtitle_offset":
        this.offset = Math.round((this.offset + (Number(msg.delta) || 0)) * 10) / 10;
        this.align = null;   // 她自己在挪了，别跟她抢
        await this.shell.deliver({ type: "subtitle_now", text: this.lineNow() });
        break;
      case "settings": {
        const interval = clamp(Number(msg.interval_sec) || this.doorbell.intervalSec, 30, 900);
        this.frameMode = msg.frame_mode === "pick" ? "pick" : "auto";
        this.doorbell.setInterval(interval, this.now());
        const patch = { interval_sec: interval, frame_mode: this.frameMode };
        if (typeof msg.sync_chat === "boolean") { patch.sync_chat = msg.sync_chat; this.config.sync_chat = msg.sync_chat; }
        if (typeof msg.ears === "boolean") { patch.ears = msg.ears; this.config.ears = msg.ears; }
        if (typeof msg.hands === "boolean") { patch.hands = msg.hands; this.config.hands = msg.hands; }
        if (typeof msg.handle === "boolean") { patch.handle = msg.handle; this.config.handle = msg.handle; }
        this.onSettings(patch);
        break;
      }
      default:
        break;
    }
  }

  // 给她对轴用的「这一秒的台词」——这是给她看的，不是给他的
  lineNow() {
    const t = this.state?.video.time ?? 0;
    const cue = this.cues.find((c) => c.start <= t && t <= c.end);
    const sign = this.offset >= 0 ? "+" : "";
    return `${sign}${this.offset}s · ${cue ? cue.text : "（这一秒没有台词）"}`;
  }

  async begin(title, { url = "", resumedFrom = null, pageUrl = "", mode = "video" } = {}) {
    const t = this.now();
    this.lastError = null;   // 上一场收卡时断过网不算这一场的：开场的点先给绿
    this.state = {
      id: new Date(t).toISOString().replace(/[:.]/g, "-").slice(0, 19),
      title: String(title || "").slice(0, 80) || "没报片名",
      video: { time: 0, paused: true },
      sinceSec: 0,
      lastGlancePos: 0,
      userSaid: [],
      frames: new FrameBuffer(),
      lastFingerprint: null,
      lastShotTime: undefined,
      misses: 0,
      polling: false,
      replyCursor: 0,
      pausedSince: null,
      lastReasons: [],
      url: String(url || ""),
      pageUrl: String(pageUrl || ""),
      mode,                 // "video" 一起看 / "page" 一起逛（没有视频的页面）
      scroll: null,
      lastShotScroll: null,
      resumedFrom: Number.isFinite(Number(resumedFrom)) && resumedFrom !== null ? Number(resumedFrom) : null,
      album: [],   // 递出去过的带图帧，收卡时从里面挑
      lines: [],   // 这一场她说的、他回的（一起逛结束时带走最后几句，进「一起逛」的卡）
      lastJpeg: null,
    };
    this.doorbell = new Doorbell({ intervalSec: this.doorbell.intervalSec });
    this.doorbell.start(t);
    const p = await this.shell.probe().catch(() => null);
    if (p?.ok) {
      this.state.video = { time: p.time, paused: p.paused };
      if (p.duration > 0 && Number.isFinite(p.duration)) this.state.duration = p.duration;
      this.state.sinceSec = Math.max(0, p.time - 60);
    }
    this.linkOk = !!this.config.wake_url && !this.lastError;
    await this.shell.deliver(this.statusMessage());
    this.log(`session ${this.state.id} started: ${this.state.title}`);
  }

  // 再打开同一个网址：本机备份里「看到一半」，就问她要不要接着看
  async offerResume(msg, ref) {
    if (this.state || !this.films || !msg.url || !msg.hasVideo) return;
    const rec = this.films.findByUrl(msg.url);
    if (!rec || rec.status !== "watching" || !(rec.position_sec > 60)) return;
    await this.shell.deliverTo(ref, { type: "resume_offer", at_sec: rec.position_sec, at: timecode(rec.position_sec), title: rec.title });
  }

  // 一场结束：「改天再看」或「看完了」。这一包交给前端去建观影卡，本机也留一份。
  async wrapUp(msg) {
    const s = this.state;
    s.ending = true;   // 收卡那几十秒别再截图、再叫他一眼
    const pos = s.video.time;
    const t = this.now();
    const date = new Date(t).toLocaleDateString("sv-SE");   // 本机日期 YYYY-MM-DD
    const title = cleanTitle(msg.title) || s.title;
    const picked = (Array.isArray(msg.picked) ? msg.picked : []).slice(0, 40).map((p) => ({
      who: p.who === "him" ? "him" : "her", at: timecode(Number(p.at) || 0), text: String(p.text || "").slice(0, 300),
    }));
    // 从递出去过的图里均匀挑三张以内；她点了星星的那张排第一 = 卡的主图
    // 她在票根上点掉的截图不带（keep_frames 是留下的那几张的号；老芯不发这个就全带）
    const keep = Array.isArray(msg.keep_frames) ? new Set(msg.keep_frames) : null;
    const frames = this.wrapFrames().filter((f) => !keep || keep.has(f.id));
    const ci = frames.findIndex((f) => f.id === msg.cover);
    if (ci > 0) frames.unshift(...frames.splice(ci, 1));
    const pkg = {
      session: s.id, reason: "wrap_up", reasons: ["wrap_up"], title, url: s.pageUrl || s.url, finished: !!msg.finished,
      ...(s.pageUrl && s.pageUrl !== s.url ? { frame_url: s.url } : {}),
      position: timecode(pos), position_sec: Math.round(pos * 10) / 10, playing: false, date,
      // 片长：卡上「看到一半」的进度条用；不知道就不带
      ...(s.duration ? { duration_sec: Math.round(s.duration) } : {}),
      occasion: String(msg.occasion || "").slice(0, 80), her_review: String(msg.her_review || "").slice(0, 2000),
      // cover 只在她点过星星时带：带了中继就换主图，没带就让卡上原来的留着
      picked, frames, cover: ci >= 0 ? frames[0].id : null, subtitles: [], user_said: [], heard: "",
      // 这一场结束时抽屉的气泡样子：卡上「那天说的」照这个画，不跟着以后的设置变
      appearance: appearanceSnapshot(this.config.appearance),
      ...(this.config.sync_chat ? { sync_chat: true } : {}),
    };
    try {
      this.films?.recordWrap({ title, url: s.url, pageUrl: s.pageUrl, finished: pkg.finished, positionSec: pos, occasion: pkg.occasion,
        herReview: pkg.her_review, picked, date });
    } catch (e) {
      this.log(`film backup: ${e.message}`);
    }
    try {
      await this.wake.send(pkg);
      this.lastWakeAt = new Date(t).toISOString();
    } catch (e) {
      this.lastError = `wrap: ${e.message}`;
      this.log(this.lastError);
    }
    await this.end();
  }

  // 正在一起看 / 一起逛时递给芯的那条状态（开场、换页后的新芯都要一份）
  statusMessage() {
    const mode = this.state.mode;
    return { type: "status", active: true, title: this.state.title,
      interval_sec: this.doorbell.intervalSec, frame_mode: this.frameMode,
      sync_chat: !!this.config.sync_chat, link: this.linkOk, mode, hands: !!this.config.hands, handle: !!this.config.handle,
      ears_available: mode === "video" && this.earsAvailable(), ears: mode === "video" && this.earsActive() };
  }

  // 一起逛的时候翻到别的页（漫画点「下一话」、棋局开新的一盘）：整页换了，芯是新的一份。
  // 接着算同一次：认新页为正在逛的那页，时间接着往上加，标题变了就在说的话里插一条分隔（「第 13 话」）
  async followPage(msg, ref) {
    const s = this.state;
    s.timeBase = s.video.time;   // 新页的芯从 0 数起，加在之前逛过的时间后面
    this.activeRef = ref;
    this.shell.setActive(ref);
    s.url = String(msg.url || s.url);
    s.pageUrl = await this.shell.pageUrl?.(ref).catch(() => "") || s.url;
    const title = String(msg.title || "").trim();
    if (title && title !== s.title) {
      s.title = title.slice(0, 80);
      s.lines.push({ who: "mark", at: s.video.time, text: s.title });
    }
    s.lastShotScroll = null;   // 新的一页，先截一张
    await this.shell.deliver(this.statusMessage());
    if (this.config.appearance) {
      await this.shell.deliverTo(ref, { type: "appearance", appearance: sanitizeAppearance(this.config.appearance) });
    }
    this.log(`page followed: ${s.title}`);
  }

  // 一起逛结束（她点结束、关掉页面、App 收起来）：没有票根，自动把这一场交给前端记一笔——
  // 逛了多久、停在哪、最后一张截图、最后几句。不到一分钟的（点进去马上走了）不记
  async browseWrap() {
    const s = this.state;
    if (!s || s.mode !== "page" || s.wrapped || !(s.keepAnyway || s.video.time >= 60)) return;
    s.wrapped = true;
    const sc = s.scroll;
    const pct = sc && sc.max > 0 ? Math.round((100 * sc.y) / sc.max) : null;
    const t = this.now();
    const pkg = {
      session: s.id, reason: "browse_wrap", reasons: ["browse_wrap"], mode: "page",
      title: s.title, url: s.pageUrl || s.url, date: new Date(t).toLocaleDateString("sv-SE"),
      elapsed_sec: Math.round(s.video.time), position: timecode(s.video.time), scroll: sc, scroll_pct: pct,
      // 她在票根上挑过就只留挑的；没走票根（直接关掉、App 收起来）就全留
      lines: (s.picked ?? s.lines).slice(-300).map((l) => ({ ...l, at: timecode(l.at) })),
      frames: this.browseFrames(),
      // 她在票根上点了星星：中继拿第一张当主图并且记住是她挑的，以后再逛不自动换
      ...(s.coverPick && s.keepFrames ? { cover_pick: true } : {}),
      subtitles: [], user_said: [], heard: "",
    };
    try {
      await this.wake.send(pkg);
    } catch (e) {
      this.log(`browse wrap: ${e.message}`);
    }
  }

  /// 一起逛收卡带的图：走过票根就是她留下的那几张（星星那张排第一）；没走票根就只带最后一张
  browseFrames() {
    const s = this.state;
    if (s.keepFrames) {
      const keep = new Set(s.keepFrames);
      const frames = this.wrapFrames().filter((f) => keep.has(String(f.id)));
      const ci = frames.findIndex((f) => String(f.id) === s.coverPick);
      if (ci > 0) frames.unshift(...frames.splice(ci, 1));
      return frames.map((f) => ({ id: f.id, at: f.at, image: f.image }));
    }
    return s.lastJpeg ? [{ id: "last", at: timecode(s.video.time), image: s.lastJpeg }] : [];
  }

  async end() {
    if (!this.state) return;
    this.reclaimable = false;
    await this.browseWrap().catch(() => {});
    this.log(`session ${this.state.id} ended`);
    this.state = null;
    await this.shell.deliver({ type: "status", active: false }).catch(() => {});
  }

  async tick() {
    const s = this.state;
    if (!s || s.ending) return;
    let p;
    try {
      p = await this.shell.probe();
    } catch (e) {
      p = { ok: false, why: e.message };
    }
    if (!p?.ok) {
      s.misses += 1;
      if (s.misses >= MAX_MISSES) await this.end();
      return;
    }
    s.misses = 0;
    // 一起逛：芯报的是「这一页开了多久」，换过页就加上之前那几页的
    s.video = { time: s.mode === "page" ? (s.timeBase || 0) + p.time : p.time, paused: p.paused };
    if (p.duration > 0 && Number.isFinite(p.duration)) s.duration = p.duration;   // 直播 / 抖音是 Infinity，不记
    if (s.pausedSince !== null) {
      if (!p.paused) s.pausedSince = null;
      else if (this.now() - s.pausedSince >= PAUSE_CONFIRM_MS) {
        s.pausedSince = null;
        await this.ring("paused");
        if (!this.state) return;
      }
    }
    if (s.mode === "page") {
      s.scroll = p.scroll || null;
      const since = typeof s.lastShotTime === "number" ? p.time - s.lastShotTime : Infinity;
      const moved = s.scroll && s.lastShotScroll !== null && Math.abs(s.scroll.y - s.lastShotScroll) > (s.scroll.vh || 800) * 0.3;
      if (since >= 20 || (moved && since >= 3) || s.lastShotScroll === null) {
        const jpeg = await this.shell.capture().catch(() => null);
        if (jpeg) {
          s.frames.add({ at: p.time, dist: Infinity, jpeg });
          s.lastJpeg = jpeg;
          s.lastShotTime = p.time;
          s.lastShotScroll = s.scroll ? s.scroll.y : 0;
        }
      }
    } else if (!p.paused) {
      const d = shouldCapture({ fingerprint: p.fingerprint, lastFingerprint: s.lastFingerprint,
        time: p.time, lastShotTime: s.lastShotTime });
      if (d.capture) {
        const jpeg = await this.shell.capture().catch(() => null);
        if (jpeg) {
          s.frames.add({ at: p.time, dist: d.dist, jpeg });
          s.lastShotTime = p.time;
          if (d.usable) s.lastFingerprint = d.usable;
        }
      }
    }
    if (this.align && !p.paused && this.now() >= this.align.after) await this.tryAlign();
    if (!this.state) return;
    const reasons = this.doorbell.check(this.now(), !p.paused);
    if (reasons) await this.fire(reasons);
  }

  async ring(reason) {
    const reasons = this.doorbell.ring(reason, this.now());
    if (reasons) await this.fire(reasons);
  }

  async fire(reasons) {
    const s = this.state;
    if (!s) return;
    const drained = s.frames.drain(), said = s.userSaid.splice(0), sinceBefore = s.sinceSec;
    const glance = buildGlance({
      session: s.id, reasons, title: s.title, video: s.video, cues: this.cues,
      sinceSec: s.sinceSec, frames: drained, userSaid: said, mode: this.frameMode,
      // 她说话叫醒他时只递一张图：每多看一张他就多花几秒，先回她要紧
      maxImages: reasons.includes("user_message") ? 1 : 2,
    });
    s.lastReasons = reasons;
    if (this.config.sync_chat) glance.sync_chat = true;
    // 耳朵：她说话叫醒他时不等（先回她要紧），别的时候听一段再递
    if (s.mode === "page") {
      glance.mode = "page";
      glance.url = s.pageUrl || s.url;
      glance.elapsed = glance.position;
      glance.scroll = s.scroll;
      glance.hands = !!this.config.hands;   // 他这一眼就知道自己能不能动手
      glance.subtitles = [];
      if (s.handNotes?.length) glance.hand_notes = s.handNotes.splice(0);
    } else if (this.earsActive() && !reasons.includes("user_message")) {
      try {
        const h = await this.hear();
        if (h?.heard) glance.heard = h.heard;
        // 没字幕的时候，听出来的对白就当字幕递给他（只有已经播过的）
        if (h?.lines?.length && !this.rawCues.length) glance.subtitles = h.lines.map((l) => ({ at: timecode(l.at), text: l.text }));
      } catch (e) {
        this.log(`ears: ${e.message}`);
      }
      if (!this.state) return;
    }   // 前端：这一包里她说的、他回的也进聊天记录
    if (s.resumedFrom !== null) {
      glance.resumed_from = timecode(s.resumedFrom);   // 接着看的第一眼：前端可以把这部片的卡一起递给他
      s.resumedFrom = null;
    }
    for (const f of glance.frames) if (f.image) s.album.push(f);
    if (s.album.length > 6) s.album.splice(0, s.album.length - 6);
    s.sinceSec = s.video.time;
    s.lastGlancePos = s.video.time;
    this.lastWakeAt = new Date(this.now()).toISOString();
    let res;
    try {
      res = await this.wake.send(glance);
      this.lastError = null;
      await this.setLink(true);
    } catch (e) {
      this.lastError = `wake: ${e.message}`;
      this.log(this.lastError);
      await this.setLink(false);
      // 这一包没送到：她的话、帧、字幕窗口都放回去，下次门铃一起带上——别让她那句消失得无声无息（10-21 夜）
      s.userSaid.unshift(...said);
      s.frames.restore(drained);
      s.sinceSec = sinceBefore;
      await this.released(null);
      return;
    }
    if (res.mode === "poll") {
      s.polling = true;
      return;
    }
    await this.apply(res.reply);
  }

  async apply(reply) {
    const s = this.state;
    if (!s) return;
    this.lastReplyAt = new Date(this.now()).toISOString();
    // 回她话的那几句是在聊天，不跟画面挂钩，不标「说刚才」
    // 一起逛的「时间」只是逛了多久，不存在说晚了
    const late = s.mode === "page" || s.lastReasons.includes("user_message") ? null : lateTag(s.lastGlancePos, s.video.time);
    // 说晚了的带上那一眼的秒数：芯在弹幕前挂「⏪ 8:02」小签，点一下跳回去
    const lateSec = late ? { late_sec: Math.round(s.lastGlancePos * 10) / 10 } : {};
    for (const text of reply.say) {
      s.lines.push({ who: "him", at: s.video.time, text: String(text).slice(0, 300) });
      await this.shell.deliver({ type: "say", text, late, ...lateSec });
    }
    for (const a of reply.actions) {
      if (HAND_ACTIONS.has(a.type)) {
        if (!this.config.hands) { this.log(`hands off: dropped ${a.type}`); continue; }
        // 电脑上点击走 Chrome 的真点击；没有那条路（手机）就交给芯
        if (a.type === "click" && typeof this.shell.click === "function" && await this.shell.click(a.x, a.y).catch(() => false)) continue;
        await this.shell.deliver({ type: "control", action: a.type, by: a.by, x: a.x, y: a.y, uci: a.uci });
        continue;
      }
      await this.shell.deliver({ type: "control", action: a.type, by: a.by });
    }
    await this.released(reply.nextLookIn);
  }

  async released(nextLookIn) {
    const again = this.doorbell.replied(this.now(), nextLookIn);
    if (again) await this.fire(again);
  }

  async pollOnce() {
    const s = this.state;
    if (!s || !s.polling) return;
    const items = await this.wake.poll(s.id, s.replyCursor);
    for (const it of items) {
      if (it.id <= s.replyCursor) continue;
      s.replyCursor = it.id;
      await this.apply(it.reply);
    }
  }
}
