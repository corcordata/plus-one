import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGlance, pickFrames } from "../butler/glance.js";

const cues = [
  { start: 50, end: 51, text: "old" },
  { start: 95, end: 96, text: "recent" },
  { start: 130, end: 131, text: "future" },
];
const frames = [
  { id: "f1", at: 91, dist: 3, jpeg: "A" },
  { id: "f2", at: 97, dist: Infinity, jpeg: "B" },
  { id: "f3", at: 99, dist: 20, jpeg: "C" },
];

test("auto mode attaches images to the 2 most changed frames, lists the rest", () => {
  const got = pickFrames(frames, "auto");
  assert.deepEqual(got, [
    { id: "f1", at: "1:31" },
    { id: "f2", at: "1:37", image: "B" },
    { id: "f3", at: "1:39", image: "C" },
  ]);
});

test("pick mode sends timecodes only", () => {
  assert.equal(pickFrames(frames, "pick").some((f) => "image" in f), false);
});

test("glance carries only subtitles up to now", () => {
  const g = buildGlance({
    session: "s1", reasons: ["user_message", "tick"], title: "片子",
    video: { time: 100, paused: false }, cues, sinceSec: 60, frames, userSaid: [{ at: 98.2, text: "这人好装" }],
  });
  assert.equal(g.reason, "user_message");
  assert.deepEqual(g.reasons, ["user_message", "tick"]);
  assert.equal(g.position, "1:40");
  assert.equal(g.position_sec, 100);
  assert.equal(g.playing, true);
  assert.deepEqual(g.subtitles, [{ at: "1:35", text: "recent" }]);
  assert.deepEqual(g.user_said, [{ at: "1:38", text: "这人好装" }]);
  assert.equal(g.heard, "");
});

test("after a rewind, looks back a minute instead of returning nothing", () => {
  const g = buildGlance({
    session: "s1", reasons: ["tick"], title: "t", video: { time: 100, paused: true },
    cues, sinceSec: 300, frames: [], userSaid: [],
  });
  assert.deepEqual(g.subtitles.map((s) => s.text), ["old", "recent"]);   // 回看 (40, 100]
  assert.equal(g.playing, false);
});
