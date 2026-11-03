import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHeard, computeOffset, listen } from "../butler/ears.js";
import { WatchSession } from "../butler/session.js";

const CUES = [
  { start: 100, end: 102, text: "One copy. What are my twins gonna do with that?" },
  { start: 104, end: 106, text: "Share?" },
  { start: 110, end: 113, text: "I need the ten best photographers in town by tonight." },
  { start: 300, end: 302, text: "That's all." },
];

test("Gemini's reply: lines get absolute film times; junk around the JSON is tolerated", () => {
  const h = parseHeard('```json\n{"heard":"翻杂志的声音，她语气很冲","lines":[{"t":2.5,"text":"One copy."},{"t":"x","text":""}]}\n```', 98);
  assert.equal(h.heard, "翻杂志的声音，她语气很冲");
  assert.deepEqual(h.lines, [{ at: 100.5, text: "One copy." }]);
  assert.deepEqual(parseHeard("not json"), { heard: "", lines: [] });
  assert.deepEqual(parseHeard('[{"t":1,"text":"Hi."}]', 10).lines, [{ at: 11, text: "Hi." }]);   // 只回一串台词也认
});

test("auto-align: two heard lines agreeing → shift; one vague line or nothing matching → leave it to her", () => {
  const heard = [{ at: 102.4, text: "One copy, what are my twins gonna do with that" }, { at: 112.3, text: "I need the ten best photographers in town by tonight" }];
  assert.equal(computeOffset(heard, CUES), 2.4);
  assert.equal(computeOffset([{ at: 106, text: "Share?" }], CUES), null);            // 一个词太短，不信
  assert.equal(computeOffset([{ at: 50, text: "completely different words here" }], CUES), null);
  assert.equal(computeOffset([{ at: 101.5, text: "I need the ten best photographers in town by tonight" }], CUES), -8.5);   // 一句很长很像，也信
});

test("listen falls through to the next model when one is rate-limited", async () => {
  const tried = [];
  const fetchImpl = async (url) => {
    tried.push(url.split("/models/")[1].split(":")[0]);
    if (tried.length === 1) return { ok: false, status: 429 };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"heard":"音乐","lines":[]}' }] } }] }) };
  };
  const h = await listen({ b64: "AAAA", dur: 15, start_at: 10 }, { key: "k", models: ["a", "b"], fetchImpl });
  assert.deepEqual(tried, ["a", "b"]);
  assert.equal(h.heard, "音乐");
  assert.equal(await listen({ b64: "AAAA" }, { key: "" }), null);   // 没 key 就没有耳朵
});

function rig({ heard }) {
  let t = 0;
  const delivered = [], woke = [];
  const video = { time: 120, paused: false };
  const s = new WatchSession({
    shell: {
      setActive() {},
      // 芯收到 ears_get 就交一段声音回来
      async deliver(m) { delivered.push(m); if (m.type === "ears_get") queueMicrotask(() => s.handleCoreMessage({ msg: { type: "ears_clip", id: m.id, clips: [{ start_at: 100, dur: 15, b64: "AAA", mime: "audio/webm" }] } })); },
      async probe() { return { ok: true, time: video.time, duration: 6000, paused: video.paused, fingerprint: null }; },
      async capture() { return null; },
    },
    wake: { async send(g) { woke.push(g); return { mode: "inline", reply: { say: [], actions: [], nextLookIn: null } }; } },
    config: { interval_sec: 60, frame_mode: "auto", wake_url: "x", gemini_key: "k" },
    now: () => t, listen: async () => heard, subfinder: { search: async () => [], download: async () => [] },
  });
  return { s, delivered, woke, video, advance: (ms) => (t += ms) };
}

test("ears: a timed look carries what he heard; with no subtitles the heard dialogue stands in", async () => {
  const r = rig({ heard: { heard: "音乐转紧张", lines: [{ at: 101, text: "One copy." }] } });
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t" }, ref: {} });
  assert.equal(r.delivered[0].ears_available, true);
  r.advance(61000);
  await r.s.tick();
  assert.equal(r.woke[0].heard, "音乐转紧张");
  assert.deepEqual(r.woke[0].subtitles, [{ at: "1:41", text: "One copy." }]);
  // 她说话叫醒他：不等耳朵
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "这人", at: 120 } });
  assert.equal(r.woke[1].heard, "");
});

test("ears: subtitles loaded → after ~20s of playing, it listens and lines them up", async () => {
  const r = rig({ heard: { heard: "", lines: [{ at: 102.4, text: "One copy, what are my twins gonna do with that" }, { at: 112.3, text: "I need the ten best photographers in town by tonight" }] } });
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t" }, ref: {} });
  const srt = CUES.map((c, i) => `${i + 1}\n00:0${Math.floor(c.start / 60)}:${String(c.start % 60).padStart(2, "0")},000 --> 00:0${Math.floor(c.end / 60)}:${String(c.end % 60).padStart(2, "0")},000\n${c.text}\n`).join("\n");
  await r.s.handleCoreMessage({ msg: { type: "subtitles_import", name: "a.srt", text: srt } });
  r.advance(10000); await r.s.tick();
  assert.equal(r.s.offset, 0);              // 还没到 20 秒
  r.advance(15000); await r.s.tick();
  assert.equal(r.s.offset, 2.4);
  assert.match(r.delivered.filter((m) => m.type === "subtitle_now").at(-1).text, /^自动对好了 \+2\.4s/);
  assert.equal(r.s.align, null);
});
