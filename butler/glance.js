// 打包「这一眼」：门铃响的时候递给他的那一包。
import { cuesBetween } from "./subtitles.js";
import { timecode } from "./timecode.js";

const rank = (d) => (Number.isFinite(d) ? d : 1e9);   // 算不出指纹的帧当作「变化最大」

export function pickFrames(frames, mode, maxImages = 2) {
  if (mode === "pick") return frames.map((f) => ({ id: f.id, at: timecode(f.at) }));
  const ranked = [...frames].sort((a, b) => rank(b.dist) - rank(a.dist) || b.at - a.at);
  const chosen = new Set(ranked.slice(0, maxImages).map((f) => f.id));
  return frames.map((f) => (chosen.has(f.id)
    ? { id: f.id, at: timecode(f.at), image: f.jpeg }
    : { id: f.id, at: timecode(f.at) }));
}

export function buildGlance({ session, reasons, title, video, cues, sinceSec, frames, userSaid, heard = "", mode = "auto", maxImages = 2 }) {
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
