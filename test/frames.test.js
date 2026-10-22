import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintDistance, isFlat, shouldCapture, FrameBuffer } from "../butler/frames.js";

const grey = (v) => Array(64).fill(v);

test("distance", () => {
  assert.equal(fingerprintDistance(grey(10), grey(30)), 20);
  assert.equal(fingerprintDistance(null, grey(3)), Infinity);
});

test("flat fingerprints (black canvas from hardware decode) count as unusable", () => {
  assert.equal(isFlat(grey(0)), true);
  const varied = grey(0); varied[5] = 40;
  assert.equal(isFlat(varied), false);
});

test("captures when the picture changed", () => {
  const a = grey(10); a[0] = 50;
  const b = grey(40); b[0] = 90;
  assert.equal(shouldCapture({ fingerprint: b, lastFingerprint: a, time: 20, lastShotTime: 5 }).capture, true);
  assert.equal(shouldCapture({ fingerprint: a, lastFingerprint: a, time: 20, lastShotTime: 5 }).capture, false);
  // 画面变了，但离上一张不到 10 秒：不截
  assert.equal(shouldCapture({ fingerprint: b, lastFingerprint: a, time: 10, lastShotTime: 5 }).capture, false);
});

test("captures anyway after a minute without a shot", () => {
  const a = grey(10); a[0] = 50;
  assert.equal(shouldCapture({ fingerprint: a, lastFingerprint: a, time: 70, lastShotTime: 5 }).capture, true);
});

test("unusable fingerprint falls back to every 20 seconds", () => {
  assert.equal(shouldCapture({ fingerprint: null, lastFingerprint: null, time: 10, lastShotTime: undefined }).capture, true);
  assert.equal(shouldCapture({ fingerprint: null, lastFingerprint: null, time: 15, lastShotTime: 10 }).capture, false);
  assert.equal(shouldCapture({ fingerprint: grey(0), lastFingerprint: null, time: 31, lastShotTime: 10 }).capture, true);
});

test("FrameBuffer keeps the newest max frames and drains", () => {
  const buf = new FrameBuffer(2);
  buf.add({ at: 1, dist: 3, jpeg: "a" });
  buf.add({ at: 2, dist: 4, jpeg: "b" });
  const id3 = buf.add({ at: 3, dist: 5, jpeg: "c" });
  assert.equal(id3, "f3");
  assert.deepEqual(buf.drain().map((f) => f.jpeg), ["b", "c"]);
  assert.deepEqual(buf.drain(), []);
});
