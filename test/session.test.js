import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchSession } from "../butler/session.js";

function rig({ wakeMode = "inline", reply = { say: "嗯" } } = {}) {
  let t = 0;
  const delivered = [], woke = [];
  const video = { time: 100, paused: false };
  const shell = {
    active: null,
    setActive(ref) { this.active = ref; },
    async deliver(m) { delivered.push(m); },
    async probe() { return { ok: true, time: video.time, duration: 3600, paused: video.paused, fingerprint: null }; },
    async capture() { return "JPEG"; },
  };
  let outbox = [];
  const wake = {
    async send(g) { woke.push(g); return wakeMode === "poll" ? { mode: "poll" } : { mode: "inline", reply: { say: [].concat(reply.say || []), actions: reply.actions || [], nextLookIn: null, silent: false } }; },
    async poll(session, after) { return outbox.filter((o) => o.id > after); },
  };
  const s = new WatchSession({ shell, wake, config: { interval_sec: 180, frame_mode: "auto", wake_url: "x" }, now: () => t });
  return { s, shell, delivered, woke, video, setNow: (v) => (t = v), setOutbox: (o) => (outbox = o) };
}
const SRT = "1\n00:01:30,000 --> 00:01:31,000\nnow line\n\n2\n00:02:30,000 --> 00:02:31,000\nfuture line\n";

test("start → her message wakes him immediately, his line comes back as danmaku", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "片子" }, ref: { sessionId: "S", contextId: 1 } });
  assert.deepEqual(r.shell.active, { sessionId: "S", contextId: 1 });
  assert.equal(r.delivered[0].type, "status");
  await r.s.handleCoreMessage({ msg: { type: "subtitles_import", name: "a.srt", text: SRT } });
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "这人好装", at: 100 } });
  assert.equal(r.woke.length, 1);
  assert.equal(r.woke[0].reason, "user_message");
  assert.deepEqual(r.woke[0].user_said, [{ at: "1:40", text: "这人好装" }]);
  assert.deepEqual(r.woke[0].subtitles.map((x) => x.text), ["now line"]);   // future line 不给
  assert.deepEqual(r.delivered.at(-1), { type: "say", text: "嗯", late: null });
});

test("a pause wakes him only if it lasts 3 seconds; his own pause and buffering blips do not", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t" }, ref: {} });
  await r.s.handleCoreMessage({ msg: { type: "video", event: "pause", time: 100, paused: true, by_ai: true } });
  r.video.paused = true; r.setNow(5000); await r.s.tick();
  assert.equal(r.woke.length, 0);
  // 缓冲：停一下马上又播
  r.video.paused = false;
  await r.s.handleCoreMessage({ msg: { type: "video", event: "pause", time: 101, paused: true } });
  await r.s.handleCoreMessage({ msg: { type: "video", event: "play", time: 101, paused: false } });
  r.setNow(10000); await r.s.tick();
  assert.equal(r.woke.length, 0);
  // 她真按了暂停
  await r.s.handleCoreMessage({ msg: { type: "video", event: "pause", time: 102, paused: true } });
  r.video.paused = true;
  r.setNow(11000); await r.s.tick();
  assert.equal(r.woke.length, 0);
  r.setNow(13500); await r.s.tick();
  assert.equal(r.woke.length, 1);
  assert.equal(r.woke[0].reason, "paused");
});

test("tick captures frames and wakes on the slider interval", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t" }, ref: {} });
  r.setNow(5000); await r.s.tick();
  assert.equal(r.woke.length, 0);
  r.setNow(181000); r.video.time = 181; await r.s.tick();
  assert.equal(r.woke.length, 1);
  assert.equal(r.woke[0].reason, "tick");
  assert.ok(r.woke[0].frames.length >= 1);
  assert.equal(r.woke[0].frames.filter((f) => f.image).length <= 2, true);
});

test("poll mode: replies applied once; a reply to her line is never marked late, a slow tick reply is", async () => {
  const r = rig({ wakeMode: "poll" });
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t" }, ref: {} });
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "hi", at: 100 } });
  r.video.time = 140; await r.s.tick();   // 片子往前走了 40 秒
  r.setOutbox([{ id: 7, reply: { say: ["回你"], actions: [{ type: "pause" }], nextLookIn: null, silent: false } }]);
  await r.s.pollOnce();
  await r.s.pollOnce();
  assert.deepEqual(r.delivered.filter((m) => m.type === "say"), [{ type: "say", text: "回你", late: null }]);
  assert.deepEqual(r.delivered.filter((m) => m.type === "control"), [{ type: "control", action: "pause", by: undefined }]);

  r.setNow(400000); r.video.time = 200; await r.s.tick();   // 到点
  assert.equal(r.woke.at(-1).reason, "tick");
  r.video.time = 240; await r.s.tick();
  r.setOutbox([{ id: 9, reply: { say: ["刚才那幕"], actions: [], nextLookIn: null, silent: false } }]);
  await r.s.pollOnce();
  assert.deepEqual(r.delivered.filter((m) => m.type === "say").at(-1), { type: "say", text: "刚才那幕", late: "3:20", late_sec: 200 });
});

test("her line wakes him with at most one image", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t" }, ref: {} });
  for (let i = 0; i < 4; i += 1) { r.video.time = 100 + i * 30; r.setNow(1000 + i * 1000); await r.s.tick(); }
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "看", at: 190 } });
  assert.equal(r.woke[0].frames.length >= 2, true);
  assert.equal(r.woke[0].frames.filter((f) => f.image).length, 1);
});

test("settings change the interval and are reported", async () => {
  const r = rig();
  let saved;
  r.s.onSettings = (x) => (saved = x);
  await r.s.handleCoreMessage({ msg: { type: "settings", interval_sec: 60, frame_mode: "pick" } });
  assert.deepEqual(saved, { interval_sec: 60, frame_mode: "pick" });
  assert.equal(r.s.status().interval_sec, 60);
});
