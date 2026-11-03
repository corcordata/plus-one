import { test } from "node:test";
import assert from "node:assert/strict";
import { Doorbell } from "../butler/doorbell.js";

const S = 1000;

test("ticks on the slider interval, not while paused", () => {
  const d = new Doorbell({ intervalSec: 180 });
  d.start(0);
  assert.equal(d.check(179 * S, true), null);
  assert.equal(d.check(181 * S, false), null);
  assert.deepEqual(d.check(181 * S, true), ["tick"]);
});

test("rings while waiting are queued and merged, then fired after his reply", () => {
  const d = new Doorbell({ intervalSec: 180 });
  d.start(0);
  assert.deepEqual(d.ring("user_message", 10 * S), ["user_message"]);
  assert.equal(d.ring("paused", 12 * S), null);
  assert.equal(d.ring("user_message", 13 * S), null);
  assert.deepEqual(d.replied(30 * S), ["paused", "user_message"]);
  assert.equal(d.replied(40 * S), null);
});

test("he can schedule the next look", () => {
  const d = new Doorbell({ intervalSec: 180 });
  d.start(0);
  d.ring("tick", 1 * S);
  assert.equal(d.replied(5 * S, 600), null);
  assert.equal(d.check(500 * S, true), null);
  assert.deepEqual(d.check(606 * S, true), ["scheduled"]);
});

test("a later plain reply does not cancel what he scheduled", () => {
  const d = new Doorbell({ intervalSec: 180 });
  d.start(0);
  d.ring("tick", 1 * S);
  d.replied(5 * S, 600);           // 他先约了十分钟
  d.replied(6 * S);                // 同一轮又来一条普通回复
  assert.equal(d.check(200 * S, true), null);
  assert.deepEqual(d.check(606 * S, true), ["scheduled"]);
});

test("waiting gives up after the reply timeout, queued reasons are not lost", () => {
  const d = new Doorbell({ intervalSec: 180, replyTimeoutSec: 120 });
  d.start(0);
  d.ring("tick", 0);
  assert.equal(d.ring("paused", 10 * S), null);
  assert.deepEqual(d.ring("user_message", 200 * S), ["paused", "user_message"]);
});

test("setInterval restarts the countdown", () => {
  const d = new Doorbell({ intervalSec: 180 });
  d.start(0);
  d.setInterval(60, 100 * S);
  assert.equal(d.check(150 * S, true), null);
  assert.deepEqual(d.check(161 * S, true), ["tick"]);
});
