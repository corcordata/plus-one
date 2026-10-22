// iOS 那头的大管家入口：跑的是跟电脑上同一个 WatchSession（butler/session.js），
// 只是「壳」换成 App——联网、截图、存东西都交给 Swift 代办。
//
// Swift 那边给 JavaScriptCore 装一个同步函数 __host(kind, json) → string|null，
// 要等的事（联网、探视频、截图）带一个 id，Swift 办完调 PlusOne.resolve(id, error, json)。
// 计时也在 Swift：每 probe_sec 秒调一次 PlusOne.tick()，每秒调一次 PlusOne.pollOnce()。
import { WatchSession } from "../../butler/session.js";
import { sendWake, pollReplies } from "../../butler/wake-client.js";

const g = globalThis;
const call = (kind, payload) => {
  const out = g.__host(kind, payload === undefined ? "" : JSON.stringify(payload));
  return out === null || out === undefined || out === "" ? null : JSON.parse(out);
};
const log = (s) => call("log", String(s));

// ── 等 Swift 办完的事 ──────────────────────────────────
let seq = 0;
const pending = new Map();
function ask(kind, payload = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    call(kind, { id, ...payload });
  });
}

// ── JavaScriptCore 里没有的几样 ─────────────────────────
// URL：大管家只用到 origin / pathname / searchParams.set / 转成字符串
class MiniParams {
  constructor(q) {
    this.list = q ? q.split("&").filter(Boolean).map((kv) => {
      const i = kv.indexOf("=");
      return i < 0 ? [decodeURIComponent(kv), ""] : [decodeURIComponent(kv.slice(0, i)), decodeURIComponent(kv.slice(i + 1))];
    }) : [];
  }
  get(k) { const hit = this.list.find((x) => x[0] === k); return hit ? hit[1] : null; }
  set(k, v) { this.list = this.list.filter((x) => x[0] !== k); this.list.push([k, String(v)]); }
  toString() { return this.list.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }
}
export class MiniURL {
  constructor(href) {
    const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(String(href));
    if (!m) throw new TypeError(`Invalid URL: ${href}`);
    this.protocol = m[1].toLowerCase();
    this.host = m[2].toLowerCase();
    this.pathname = m[3] || "/";
    this.searchParams = new MiniParams((m[4] || "").slice(1));
    this.hash = m[5] || "";
  }
  get origin() { return `${this.protocol}//${this.host}`; }
  get search() { const q = this.searchParams.toString(); return q ? `?${q}` : ""; }
  get href() { return `${this.origin}${this.pathname}${this.search}${this.hash}`; }
  toString() { return this.href; }
  toJSON() { return this.href; }
}
if (typeof g.URL !== "function") g.URL = MiniURL;
if (typeof g.AbortSignal === "undefined") g.AbortSignal = {};
if (typeof g.AbortSignal.timeout !== "function") g.AbortSignal.timeout = (ms) => ({ timeoutMs: ms });

// fetch：只做大管家要的那点——发 JSON、收 JSON
function hostFetch(url, opts = {}) {
  return ask("fetch", {
    url: String(url), method: opts.method || "GET", headers: opts.headers || {},
    body: typeof opts.body === "string" ? opts.body : null,
    timeoutMs: Number(opts.signal?.timeoutMs) || 30000,
  }).then((r) => ({
    status: r.status, ok: r.status >= 200 && r.status < 300,
    text: async () => r.body || "",
    json: async () => JSON.parse(r.body || "null"),
  }));
}

// 大管家里没注入 fetchImpl 的地方（比如耳朵 ears.js）默认用全局 fetch：也交给 Swift
if (typeof g.fetch !== "function") g.fetch = hostFetch;

// ── 本机备份：电脑上是 ~/.plus-one/films/*.json，这里是 App 自己存的一份 ──
export class HostFilmStore {
  all() { return call("storeGet", "films") || []; }
  findByUrl(url) {
    if (!url) return null;
    return this.all().find((r) => (r.urls || []).includes(url)) || null;
  }
  recordWrap({ title, url, pageUrl = "", finished, positionSec, occasion = "", herReview = "", picked = [], date }) {
    const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    const all = this.all();
    let rec = all.find((r) => (url && (r.urls || []).includes(url)) || same(r.title, title));
    if (!rec) { rec = { title, urls: [], sessions: [] }; all.push(rec); }
    for (const u of [url, pageUrl]) if (u && !rec.urls.includes(u)) rec.urls.push(u);
    rec.status = finished ? "finished" : "watching";
    rec.position_sec = Math.round(Number(positionSec) || 0);
    rec.sessions = [...(rec.sessions || []), { date, occasion, her_review: herReview, picked }].slice(-20);
    rec.updated_at = new Date().toISOString();
    call("storeSet", { key: "films", value: all.slice(-200) });
    return rec;
  }
}

// ── 壳：App 里的那个网页。框用 Swift 那头发的 frame 号认 ──
// session.js 拿 ref 的 sessionId + contextId 比是不是同一个框；这里两个都放 frame 号
const refOf = (frame) => (frame ? { sessionId: frame, contextId: frame } : null);
const frameOf = (ref) => (ref ? ref.contextId : null);

const shell = {
  active: null,
  setActive(ref) { this.active = ref || null; call("setActive", { frame: frameOf(ref) }); },
  async deliver(msg) { return this.active ? call("deliver", { frame: frameOf(this.active), msg }) === true : false; },
  async deliverTo(ref, msg) { return ref ? call("deliver", { frame: frameOf(ref), msg }) === true : false; },
  async probe() {
    if (!this.active) return { ok: false, why: "no active frame" };
    return (await ask("probe", { frame: frameOf(this.active) })) || { ok: false, why: "empty probe" };
  },
  async capture() { return this.active ? ask("capture", { frame: frameOf(this.active) }) : null; },
  async pageUrl() { return call("pageUrl") || ""; },
  async openTab(url) { return call("openTab", { url }) === true; },
};

let session = null;
let config = null;

g.PlusOne = {
  // Swift 先递设置进来：wake_url、key、interval_sec、frame_mode、probe_sec、sync_chat、appearance
  start(json) {
    config = { interval_sec: 180, frame_mode: "auto", probe_sec: 5, sync_chat: false, appearance: null, ...JSON.parse(json) };
    if (!config.replies_url && config.wake_url) config.replies_url = config.wake_url.replace(/\/wake\/?$/, "/replies");
    const wake = {
      send: (glance) => sendWake({ wakeUrl: config.wake_url, key: config.key, fetchImpl: hostFetch }, glance),
      poll: (s, after) => pollReplies({ repliesUrl: config.replies_url, key: config.key, fetchImpl: hostFetch }, s, after),
    };
    session = new WatchSession({
      shell, wake, config, log, films: new HostFilmStore(),
      // 手机上还没有：找字幕（要解压 .gz）、耳朵（WKWebView 录不了视频的声音）。传 null 抽屉里就不显示 / 老实说用不了
      subfinder: null, listen: null,
      onSettings: (patch) => { Object.assign(config, patch); call("saveSettings", patch); },
    });
    return true;
  },
  // 芯从某个框发出来的一条消息
  message(frame, json) {
    let msg;
    try { msg = JSON.parse(json); } catch { return; }
    session?.handleCoreMessage({ msg, ref: refOf(frame) }).catch((e) => log(`core message: ${e.message}`));
  },
  // 前端观影卡上「接着看」：跟电脑上手机发来的命令是同一条路
  open(json) {
    const c = JSON.parse(json);
    session?.handleCommand({ action: "open", url: c.url, at_sec: c.at_sec, scroll_pct: c.scroll_pct, title: c.title, at: new Date().toISOString() })
      .catch((e) => log(`open: ${e.message}`));
  },
  tick() { session?.tick().catch((e) => log(`tick: ${e.message}`)); },
  pollOnce() { session?.pollOnce().catch((e) => log(`poll: ${e.message}`)); },
  // 那一页没了（关掉 / 换网址）：正在放片的框跟着没了
  frameGone(frame) { if (frameOf(shell.active) === frame) { shell.active = null; session?.activeFrameLost(); } },
  stop() { return session ? session.end() : Promise.resolve(); },
  status() { return JSON.stringify(session ? session.status() : { active: false }); },
  resolve(id, error, json) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(json === null || json === undefined || json === "" ? null : JSON.parse(json));
  },
};
