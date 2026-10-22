import { test } from "node:test";
import assert from "node:assert/strict";
import { timecode } from "../butler/timecode.js";
import { parseSrt, shiftCues, cuesBetween } from "../butler/subtitles.js";

const SRT = `1
00:00:01,000 --> 00:00:02,500
<i>Hello</i>

2
00:01:40,000 --> 00:01:42,000
You shouldn't be here.

3
01:02:03,400 --> 01:02:05,000
{\\an8}Later line
`;

test("timecode", () => {
  assert.equal(timecode(0), "0:00");
  assert.equal(timecode(65.9), "1:05");
  assert.equal(timecode(3723), "1:02:03");
});

test("parseSrt strips tags and sorts", () => {
  const cues = parseSrt("﻿" + SRT);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { start: 1, end: 2.5, text: "Hello" });
  assert.equal(cues[2].text, "Later line");
  assert.equal(cues[2].start, 3723.4);
});

test("cuesBetween never returns a line that starts after now (no peeking)", () => {
  const cues = parseSrt(SRT);
  assert.deepEqual(cuesBetween(cues, 0, 99.9).map((c) => c.text), ["Hello"]);
  assert.deepEqual(cuesBetween(cues, 0, 100).map((c) => c.text), ["Hello", "You shouldn't be here."]);
  assert.deepEqual(cuesBetween(cues, 1, 100).map((c) => c.text), ["You shouldn't be here."]);
});

test("cuesBetween keeps only the last `limit` lines", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ start: i, end: i + 0.5, text: `l${i}` }));
  const got = cuesBetween(many, -1, 100, 40);
  assert.equal(got.length, 40);
  assert.equal(got[0].text, "l10");
});

test("shiftCues moves every line", () => {
  const shifted = shiftCues(parseSrt(SRT), 2);
  assert.equal(shifted[0].start, 3);
  assert.equal(shifted[0].end, 4.5);
});
