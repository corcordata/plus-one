// 他的回复：不管前端是哪家，归一成同一个样子再交给芯。
import { timecode } from "./timecode.js";

const ACTIONS = new Set(["pause", "resume", "seek", "scroll", "click", "move"]);
// 「一起逛」时他能动的手：往下滑、点截图上的一点、在 lichess 上走一步。要她在抽屉里开「让他动手」才算数
export const HAND_ACTIONS = new Set(["scroll", "click", "move"]);
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const frac = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 1000) / 1000 : null; };
export const LATE_SEC = 30;   // 他每回一句本来就要二三十秒，低于这个不算迟到

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

export function normalizeReply(raw) {
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
export function lateTag(glancePosSec, nowPosSec) {
  return nowPosSec - glancePosSec > LATE_SEC ? timecode(glancePosSec) : null;
}
