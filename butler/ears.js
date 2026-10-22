// Gemini 耳朵：芯一直录着视频最近的声音（一段 15 秒），大管家要的时候拿一段交给 Gemini——
// ① 一句「听到了什么」（音乐、音效、语气，不复述台词）跟着门铃递给他；
// ② 听出来的对白原话 + 在这段里的秒数，拿去跟字幕比，自动对轴。
// 只有填了 gemini_key 才有（填 key 就是同意把声音送去 Google；免费版的数据可能被拿去训练，README 写明）。

// 轻量的放前面：听写一段对白它 2 秒内回、够准；它忙的时候再换大的（10-21 实测大的常 503、要等十几秒）
export const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];
const ENDPOINT = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

export const PROMPT = `这是一部电影 / 剧正在播放的一段声音（约 {dur} 秒）。只回 JSON：
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

export async function listen(clip, { key, models = DEFAULT_MODELS, fetchImpl = fetch, timeoutMs = 12000 } = {}) {
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
export function parseHeard(text, startAt = 0) {
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
export function computeOffset(heard, cues, { window = 600 } = {}) {
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
