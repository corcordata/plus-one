// 自动生成：node tools/build-ios-bundle.js。别手改——改 butler/ 或 ios/js/ 再重新生成。
(function () {
"use strict";
const __mods = {};
const __cache = {};
function __req(id) {
  if (__cache[id]) return __cache[id];
  if (!__mods[id]) throw new Error("bundle: no module " + id);
  return (__cache[id] = __mods[id](__req));
}
__mods["butler/doorbell.js"] = function (__req) {
// 门铃：什么时候叫醒他。
// 上一次他还没回，新的原因只攒着、不重复叫——不然他会被连环叫醒，钱也烧得快。
// 他回了再把攒着的一起按一次。他自己约的下次（next_look_in）优先于滑块。
class Doorbell {
  constructor({ intervalSec = 180, replyTimeoutSec = 120 } = {}) {
    this.intervalSec = intervalSec;
    this.replyTimeoutSec = replyTimeoutSec;
    this.pendingSince = null;
    this.queued = [];
    this.nextTickAt = null;
    this.scheduled = false;
  }

  start(nowMs) {
    this.nextTickAt = nowMs + this.intervalSec * 1000;
    this.scheduled = false;
  }

  setInterval(sec, nowMs) {
    this.intervalSec = sec;
    this.nextTickAt = nowMs + sec * 1000;
    this.scheduled = false;
  }

  ring(reason, nowMs) {
    this._expire(nowMs);
    if (this.pendingSince !== null) {
      if (!this.queued.includes(reason)) this.queued.push(reason);
      return null;
    }
    const reasons = [...this.queued.filter((r) => r !== reason), reason];
    this.queued = [];
    this.pendingSince = nowMs;
    return reasons;
  }

  check(nowMs, playing) {
    if (!playing || this.nextTickAt === null || nowMs < this.nextTickAt) return null;
    const reason = this.scheduled ? "scheduled" : "tick";
    this.scheduled = false;
    this.nextTickAt = nowMs + this.intervalSec * 1000;
    return this.ring(reason, nowMs);
  }

  replied(nowMs, nextLookIn = null) {
    const wasPending = this.pendingSince !== null;
    this.pendingSince = null;
    if (typeof nextLookIn === "number") {
      this.nextTickAt = nowMs + nextLookIn * 1000;
      this.scheduled = true;
    } else if (wasPending) {
      this.nextTickAt = nowMs + this.intervalSec * 1000;
      this.scheduled = false;
    }
    if (!this.queued.length) return null;
    const reasons = this.queued;
    this.queued = [];
    this.pendingSince = nowMs;
    return reasons;
  }

  _expire(nowMs) {
    if (this.pendingSince !== null && nowMs - this.pendingSince > this.replyTimeoutSec * 1000) {
      this.pendingSince = null;
    }
  }
}

return { Doorbell };
};
__mods["butler/subtitles.js"] = function (__req) {
// 字幕：解析 .srt、整体挪轴、只取「到此刻为止」的台词。
// 防偷看就守在 cuesBetween 这一个口子上：开始时间在 now 之后的台词，谁来要都不给。
const TC = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;
const TAG = /<[^>]+>|\{\\[^}]*\}/g;

function toSec(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

function parseSrt(text) {
  const cues = [];
  for (const block of String(text || "").replace(/^﻿/, "").split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const at = lines.findIndex((l) => TC.test(l));
    if (at < 0) continue;
    const m = lines[at].match(TC);
    const body = lines.slice(at + 1).join(" ").replace(TAG, "").replace(/\s+/g, " ").trim();
    if (!body) continue;
    cues.push({ start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function shiftCues(cues, offsetSec) {
  const d = Number(offsetSec) || 0;
  return cues.map((c) => ({ ...c, start: c.start + d, end: c.end + d }));
}

/** 在 (fromSec, nowSec] 之间开始的台词，最多 limit 句（留最近的）。 */
function cuesBetween(cues, fromSec, nowSec, limit = 40) {
  return cues.filter((c) => c.start > fromSec && c.start <= nowSec).slice(-limit);
}

return { parseSrt, shiftCues, cuesBetween };
};
__mods["butler/timecode.js"] = function (__req) {
// 秒 → 片内时间码 1:23:45 / 3:07，跟她播放器上的数字对得上。
function timecode(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

return { timecode };
};
__mods["butler/glance.js"] = function (__req) {
// 打包「这一眼」：门铃响的时候递给他的那一包。
const { cuesBetween } = __req("butler/subtitles.js");
const { timecode } = __req("butler/timecode.js");

const rank = (d) => (Number.isFinite(d) ? d : 1e9);   // 算不出指纹的帧当作「变化最大」

function pickFrames(frames, mode, maxImages = 2) {
  if (mode === "pick") return frames.map((f) => ({ id: f.id, at: timecode(f.at) }));
  const ranked = [...frames].sort((a, b) => rank(b.dist) - rank(a.dist) || b.at - a.at);
  const chosen = new Set(ranked.slice(0, maxImages).map((f) => f.id));
  return frames.map((f) => (chosen.has(f.id)
    ? { id: f.id, at: timecode(f.at), image: f.jpeg }
    : { id: f.id, at: timecode(f.at) }));
}

function buildGlance({ session, reasons, title, video, cues, sinceSec, frames, userSaid, heard = "", mode = "auto", maxImages = 2 }) {
  const now = Number(video.time) || 0;
  // 她往回拖过：上一眼的位置在现在之后，就回看一分钟，不至于一句台词都没有
  const from = sinceSec > now ? Math.max(0, now - 60) : sinceSec;
  return {
    session,
    reason: reasons[0],
    reasons,
    title,
    position: timecode(now),
    position_sec: Math.round(now * 10) / 10,
    playing: !video.paused,
    subtitles: cuesBetween(cues, from, now).map((c) => ({ at: timecode(c.start), text: c.text })),
    frames: pickFrames(frames, mode, maxImages),
    heard,
    user_said: userSaid.map((u) => ({ at: timecode(u.at), text: u.text })),
  };
}

return { pickFrames, buildGlance };
};
__mods["butler/frames.js"] = function (__req) {
// 帧：画面变了才留一张。
// 「画面变了才留一帧」的思路取自 eveacla11/see-my-video（原项目对视频文件跑 ffmpeg 场景检测）；
// 这里改成在网页里给流媒体画面算 8×8 灰度指纹（芯里算），这边只比。
const FP_THRESHOLD = 14;   // 平均灰度差超过它算「换画面了」
const STALE_SEC = 60;      // 片子走了一分钟还没截过，不管指纹怎么说都补一张
const FALLBACK_SEC = 20;   // 指纹算不出来（跨域 / 硬解全黑）时，按片内 20 秒一张
const MIN_GAP_SEC = 10;    // 换画面再频繁，两张之间也至少隔 10 秒——每截一张她那边弹幕会藏一下

function fingerprintDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// 硬解的视频画进 canvas 是全黑——全平的指纹当作算不出来，不然「画面没变」一张都不截
function isFlat(fp) {
  return Array.isArray(fp) && fp.length > 0 && Math.max(...fp) - Math.min(...fp) < 2;
}

function shouldCapture({ fingerprint, lastFingerprint, time, lastShotTime }) {
  const usable = Array.isArray(fingerprint) && !isFlat(fingerprint) ? fingerprint : null;
  const sinceShot = typeof lastShotTime === "number" ? Math.abs(time - lastShotTime) : Infinity;
  if (!usable) return { capture: sinceShot >= FALLBACK_SEC, usable: null, dist: Infinity };
  const dist = fingerprintDistance(lastFingerprint, usable);
  if (sinceShot < MIN_GAP_SEC) return { capture: false, usable, dist };
  return { capture: dist >= FP_THRESHOLD || sinceShot >= STALE_SEC, usable, dist };
}

class FrameBuffer {
  constructor(max = 12) {
    this.max = max;
    this.items = [];
    this.seq = 0;
  }

  add({ at, dist, jpeg }) {
    const id = `f${++this.seq}`;
    this.items.push({ id, at, dist, jpeg });
    if (this.items.length > this.max) this.items.shift();
    return id;
  }

  drain() {
    const all = this.items;
    this.items = [];
    return all;
  }

  // 没送出去的放回最前面，下次一起带上（还是最多留 max 张）
  restore(items) {
    this.items = [...items, ...this.items].slice(-this.max);
  }
}

return { FP_THRESHOLD, STALE_SEC, FALLBACK_SEC, MIN_GAP_SEC, fingerprintDistance, isFlat, shouldCapture, FrameBuffer };
};
__mods["butler/replies.js"] = function (__req) {
// 他的回复：不管前端是哪家，归一成同一个样子再交给芯。
const { timecode } = __req("butler/timecode.js");

const ACTIONS = new Set(["pause", "resume", "seek", "scroll", "click", "move"]);
// 「一起逛」时他能动的手：往下滑、点截图上的一点、在 lichess 上走一步。要她在抽屉里开「让他动手」才算数
const HAND_ACTIONS = new Set(["scroll", "click", "move"]);
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const frac = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 1000) / 1000 : null; };
const LATE_SEC = 30;   // 他每回一句本来就要二三十秒，低于这个不算迟到

function parseActionString(s) {
  const t = String(s).trim();
  let m = t.match(/^scroll\s*[:= ]?\s*(-?page|-?\d+(?:\.\d+)?)$/i);
  if (m) return { type: "scroll", by: /page/i.test(m[1]) ? m[1].toLowerCase() : Number(m[1]) };
  m = t.match(/^click\s*[:= ]?\s*(\d*\.?\d+)[ ,]+(\d*\.?\d+)$/i);
  if (m) return { type: "click", x: Number(m[1]), y: Number(m[2]) };
  m = t.match(/^move\s*[:= ]?\s*([a-h][1-8][a-h][1-8][qrbn]?)$/i);
  if (m) return { type: "move", uci: m[1].toLowerCase() };
  m = t.match(/^(pause|resume|seek)(?:\s*[:= ]\s*(-?\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  return m[1] === "seek" ? { type: "seek", by: Number(m[2]) } : { type: m[1] };
}

// 一个手部动作洗干净；不对的返回 null
function handAction(o) {
  if (o.type === "scroll") {
    if (o.by === "page" || o.by === "-page") return { type: "scroll", by: o.by };
    const by = Number(o.by);
    return Number.isFinite(by) && by !== 0 ? { type: "scroll", by: Math.max(-5000, Math.min(5000, Math.round(by))) } : null;
  }
  if (o.type === "click") {
    const x = frac(o.x), y = frac(o.y);
    return x === null || y === null ? null : { type: "click", x, y };
  }
  const uci = String(o.uci || "").toLowerCase();
  return UCI.test(uci) ? { type: "move", uci } : null;
}

function normalizeReply(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const sayRaw = Array.isArray(r.say) ? r.say : typeof r.say === "string" ? [r.say] : [];
  const say = sayRaw.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 5).map((s) => s.slice(0, 300));
  const actions = [];
  for (const a of Array.isArray(r.actions) ? r.actions : []) {
    const obj = typeof a === "string" ? parseActionString(a) : a;
    if (!obj || !ACTIONS.has(obj.type)) continue;
    if (HAND_ACTIONS.has(obj.type)) { const h = handAction(obj); if (h) actions.push(h); continue; }
    if (obj.type !== "seek") { actions.push({ type: obj.type }); continue; }
    const by = Number(obj.by);
    if (!Number.isFinite(by) || by === 0) continue;
    actions.push({ type: "seek", by: Math.max(-600, Math.min(600, by)) });
  }
  const n = Number(r.next_look_in);
  const nextLookIn = r.next_look_in != null && Number.isFinite(n) ? Math.max(20, Math.min(1800, Math.round(n))) : null;
  return { say, actions, nextLookIn, silent: say.length === 0 && actions.length === 0 };
}

// 他回得慢：回来时片子已经比那一眼往前走了一截，这句就别飘了，标上「说刚才」
function lateTag(glancePosSec, nowPosSec) {
  return nowPosSec - glancePosSec > LATE_SEC ? timecode(glancePosSec) : null;
}

return { HAND_ACTIONS, LATE_SEC, normalizeReply, lateTag };
};
__mods["butler/titles.js"] = function (__req) {
// 片名：网页标题常带着「-免费在线观看-爱看机器人-ikanbot.com」这类尾巴，抠掉。
// 她在收卡面板里还能改，这里只求八九不离十。
// 光秃秃的「-」只在挨着中文时才算分隔——不然 Spider-Man 会被切成 Spider
const SEP = /\s+[-–—|]\s+|[_|–—]|(?<=[\u4e00-\u9fff])-|-(?=[\u4e00-\u9fff])/;
const TAIL = /(免费|在线|观看|高清|影视|影院|电影网|视频|播放|爱看机器人|youtube|bilibili|哔哩哔哩|netflix|\.(com|cc|tv|net|org|me|io|vip|top)\b)/i;

function cleanTitle(pageTitle) {
  const raw = String(pageTitle || "").trim();
  if (!raw) return "";
  const parts = raw.split(SEP).map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !TAIL.test(p));
  return kept[0] || raw;
}

return { cleanTitle };
};
__mods["butler/appearance.js"] = function (__req) {
// 抽屉的样子（背景、气泡、四格预设）：芯在各个网站的框里跑，各家网站的 localStorage 互不相通，
// 所以存在大管家这边（config.json 的 appearance），芯改了发过来，开新页面时再递回去。
// 字段跟宿主 App 聊天里的气泡样式一一对应。

const MATERIALS = new Set(["solid", "translucent", "glass", "gradient"]);
const BGS = new Set(["glass", "black", "cream"]);
const MAX_PHOTOS = 4;
const MAX_PHOTO_CHARS = 600_000;   // 芯那边先缩到 1000px 的 JPEG，一张一两百 KB

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const hex = (v) => (typeof v === "string" && /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null);

function sanitizeStyle(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    material: MATERIALS.has(raw.material) ? raw.material : "glass",
    colorMu: hex(raw.colorMu), colorMine: hex(raw.colorMine),
    textMu: hex(raw.textMu), textMine: hex(raw.textMine),
    transparency: clamp(raw.transparency, 0, 0.95, 0.18),
    blur: clamp(raw.blur, 0, 1, 0.4),
    brightness: clamp(raw.brightness, -0.3, 0.3, 0),
    edgeLight: clamp(raw.edgeLight, 0, 1, 0.6),
    highlight: raw.highlight !== false,
    cornerRadius: clamp(raw.cornerRadius, 4, 24, 16),
    spacing: clamp(raw.spacing, 2, 24, 10),
    length: clamp(raw.length, 0, 60, 30),
    tail: raw.tail !== false,
  };
}

function sanitizeAppearance(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const photos = (Array.isArray(r.photos) ? r.photos : [])
    .filter((p) => typeof p === "string" && p.startsWith("data:image/") && p.length <= MAX_PHOTO_CHARS)
    .slice(0, MAX_PHOTOS);
  let bg = typeof r.bg === "string" ? r.bg : "glass";
  const m = /^photo:(\d+)$/.exec(bg);
  if (m ? Number(m[1]) >= photos.length : !BGS.has(bg)) bg = "glass";
  const presets = [0, 1, 2].map((i) => {
    const p = Array.isArray(r.presets) ? r.presets[i] : null;
    const style = p && sanitizeStyle(p.style);
    return style ? { name: String(p.name || "").trim().slice(0, 12) || "未命名", style } : null;
  });
  // 深色 / 浅色：抽屉右上角那个图标切；没存过的老设置按背景猜
  const mode = r.mode === "light" || r.mode === "dark" ? r.mode : bg === "cream" ? "light" : "dark";
  return { bg, mode, style: sanitizeStyle(r.style), presets, photos };
}

// 收卡时存进这一场的快照：只要画气泡用得上的，不带照片（卡上垫的是这一场自己的主图）
function appearanceSnapshot(a) {
  const s = sanitizeAppearance(a);
  return { bg: s.bg.startsWith("photo:") ? "photo" : s.bg, mode: s.mode, style: s.style };
}

return { sanitizeStyle, sanitizeAppearance, appearanceSnapshot };
};
__mods["ios/js/subfinder.js"] = function (__req) {
// 手机版的「找字幕」：电脑上那份要 Node 解压下载回来的 .gz，这里先不接，
// 他叫找字幕时老实说一声，让她从抽屉里导入 .srt。接口跟 butler/subfinder.js 的 SubFinder 一样。
class SubFinder {
  async search() { throw new Error("找字幕在手机上还不能用，从抽屉里导入 .srt 吧"); }
  async download() { throw new Error("找字幕在手机上还不能用，从抽屉里导入 .srt 吧"); }
}

return { SubFinder };
};
__mods["butler/ears.js"] = function (__req) {
// Gemini 耳朵：芯一直录着视频最近的声音（一段 15 秒），大管家要的时候拿一段交给 Gemini——
// ① 一句「听到了什么」（音乐、音效、语气，不复述台词）跟着门铃递给他；
// ② 听出来的对白原话 + 在这段里的秒数，拿去跟字幕比，自动对轴。
// 只有填了 gemini_key 才有（填 key 就是同意把声音送去 Google；免费版的数据可能被拿去训练，README 写明）。

// 轻量的放前面：听写一段对白它 2 秒内回、够准；它忙的时候再换大的（10-21 实测大的常 503、要等十几秒）
const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];
const ENDPOINT = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const PROMPT = `这是一部电影 / 剧正在播放的一段声音（约 {dur} 秒）。只回 JSON：
{"heard": "一句中文，说这段听到了什么——音乐、音效、环境、说话的语气；不要复述台词，没什么可说就空字符串",
 "lines": [{"t": 这句对白在这段里开始的秒数（数字）, "text": "对白原文，原语言，一字不改"}]}
听不清的句子不要猜，不写。`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    heard: { type: "STRING" },
    lines: { type: "ARRAY", items: { type: "OBJECT", properties: { t: { type: "NUMBER" }, text: { type: "STRING" } }, required: ["t", "text"] } },
  },
  required: ["heard", "lines"],
};

async function listen(clip, { key, models = DEFAULT_MODELS, fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  if (!key || !clip?.b64) return null;
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: clip.mime || "audio/webm", data: clip.b64 } },
      { text: PROMPT.replace("{dur}", String(Math.round(clip.dur || 15))) },
    ] }],
    // 结构写死：不写的话轻量模型有时只回一串台词，不带外面那层（10-21 实测）
    generationConfig: { responseMimeType: "application/json", temperature: 0.2, responseSchema: SCHEMA },
  };
  let lastErr = null;
  for (const m of models) {
    try {
      const res = await fetchImpl(`${ENDPOINT(m)}?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) { lastErr = new Error(`gemini ${m} ${res.status}`); continue; }   // 限流 / 下线了，换下一个
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      return parseHeard(text, clip.start_at || 0);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("gemini: no model");
}

// Gemini 回的 JSON → { heard, lines:[{at: 片内秒数, text}] }；回得不规整也尽量捡
function parseHeard(text, startAt = 0) {
  let j = null;
  try { j = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return { heard: "", lines: [] }; }
  // 只回了一串台词（没有外面那层）也认
  const raw = Array.isArray(j) ? j : Array.isArray(j?.lines) ? j.lines : [];
  const lines = raw
    .map((l) => ({ at: Math.round((startAt + (Number(l?.t) || 0)) * 10) / 10, text: String(l?.text || "").trim() }))
    .filter((l) => l.text);
  return { heard: String(j?.heard || "").trim().slice(0, 300), lines };
}

const words = (s) => new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean));
function similarity(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / Math.max(x.size, y.size);
}

// 听出来的几句对白 vs 字幕：每句找最像的那条（前后十分钟内），算「字幕要挪多少」；
// 至少两句的挪法一致（差不到 1.5 秒）才算数——一句的话要很像、够长才信。对不上回 null，让她手动挪。
function computeOffset(heard, cues, { window = 600 } = {}) {
  const deltas = [];
  for (const h of heard || []) {
    let best = null;
    for (const c of cues || []) {
      if (Math.abs(c.start - h.at) > window) continue;
      const sim = similarity(h.text, c.text);
      if (!best || sim > best.sim) best = { sim, delta: h.at - c.start, len: words(h.text).size };
    }
    if (best && best.sim >= 0.5) deltas.push(best);
  }
  if (!deltas.length) return null;
  const sorted = deltas.map((d) => d.delta).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const agree = deltas.filter((d) => Math.abs(d.delta - median) <= 1.5);
  if (agree.length >= 2 || (agree.length === 1 && agree[0].sim >= 0.8 && agree[0].len >= 4)) {
    return Math.round((agree.reduce((s, d) => s + d.delta, 0) / agree.length) * 10) / 10;
  }
  return null;
}

return { DEFAULT_MODELS, PROMPT, listen, parseHeard, computeOffset };
};
__mods["butler/session.js"] = function (__req) {
// 一场陪看：把门铃、帧、字幕、叫醒串起来。壳和叫醒都是从外面递进来的，测试里可以假装。
const { Doorbell } = __req("butler/doorbell.js");
const { buildGlance } = __req("butler/glance.js");
const { FrameBuffer, shouldCapture } = __req("butler/frames.js");
const { parseSrt, shiftCues } = __req("butler/subtitles.js");
const { lateTag, HAND_ACTIONS } = __req("butler/replies.js");
const { cleanTitle } = __req("butler/titles.js");
const { timecode } = __req("butler/timecode.js");
const { sanitizeAppearance, appearanceSnapshot } = __req("butler/appearance.js");
const { SubFinder } = __req("ios/js/subfinder.js");
const { listen: geminiListen, computeOffset, DEFAULT_MODELS } = __req("butler/ears.js");

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

class WatchSession {
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

return { WatchSession };
};
__mods["butler/wake-client.js"] = function (__req) {
// 叫醒接口的客户端。全程只有这边往外发请求——前端那头不用开隧道。
const { normalizeReply } = __req("butler/replies.js");

const auth = (key) => (key ? { Authorization: `Bearer ${key}` } : {});

async function sendWake({ wakeUrl, key, timeoutMs = 90000, fetchImpl = fetch }, glance) {
  const res = await fetchImpl(wakeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(key) },
    body: JSON.stringify(glance),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 202) return { mode: "poll" };
  if (!res.ok) throw new Error(`wake ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return { mode: "inline", reply: normalizeReply(body) };
}

// 手机叫电脑（手机那头的卡上「在电脑上接着看」）：没在陪看时也来取。只有这边往外问，不用开口子
async function pollCommands({ commandsUrl, key, fetchImpl = fetch }, after) {
  const u = new URL(commandsUrl);
  u.searchParams.set("after", String(after));
  const res = await fetchImpl(u, { headers: auth(key), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`commands ${res.status}`);
  const body = await res.json();
  return {
    commands: (body.commands || []).map((c) => ({ ...c, id: Number(c.id) || 0 })).filter((c) => c.id > after),
    freshSec: Number(body.fresh_sec) || 120,
  };
}

async function pollReplies({ repliesUrl, key, fetchImpl = fetch }, session, after) {
  const u = new URL(repliesUrl);
  u.searchParams.set("session", session);
  u.searchParams.set("after", String(after));
  const res = await fetchImpl(u, { headers: auth(key), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`replies ${res.status}`);
  const body = await res.json();
  return (body.replies || [])
    .map((r) => ({ id: Number(r.id) || 0, reply: normalizeReply(r) }))
    .filter((r) => r.id > after);
}

return { sendWake, pollCommands, pollReplies };
};
__mods["ios/js/host.js"] = function (__req) {
// iOS 那头的大管家入口：跑的是跟电脑上同一个 WatchSession（butler/session.js），
// 只是「壳」换成 App——联网、截图、存东西都交给 Swift 代办。
//
// Swift 那边给 JavaScriptCore 装一个同步函数 __host(kind, json) → string|null，
// 要等的事（联网、探视频、截图）带一个 id，Swift 办完调 PlusOne.resolve(id, error, json)。
// 计时也在 Swift：每 probe_sec 秒调一次 PlusOne.tick()，每秒调一次 PlusOne.pollOnce()。
const { WatchSession } = __req("butler/session.js");
const { sendWake, pollReplies } = __req("butler/wake-client.js");

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
class MiniURL {
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
class HostFilmStore {
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

return { MiniURL, HostFilmStore };
};
__req("ios/js/host.js");
})();
