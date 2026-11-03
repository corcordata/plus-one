// 字幕：解析 .srt、整体挪轴、只取「到此刻为止」的台词。
// 防偷看就守在 cuesBetween 这一个口子上：开始时间在 now 之后的台词，谁来要都不给。
const TC = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;
const TAG = /<[^>]+>|\{\\[^}]*\}/g;

function toSec(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

export function parseSrt(text) {
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

export function shiftCues(cues, offsetSec) {
  const d = Number(offsetSec) || 0;
  return cues.map((c) => ({ ...c, start: c.start + d, end: c.end + d }));
}

/** 在 (fromSec, nowSec] 之间开始的台词，最多 limit 句（留最近的）。 */
export function cuesBetween(cues, fromSec, nowSec, limit = 40) {
  return cues.filter((c) => c.start > fromSec && c.start <= nowSec).slice(-limit);
}
