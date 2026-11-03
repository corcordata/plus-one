import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle } from "../butler/titles.js";

test("strips streaming-site tails", () => {
  assert.equal(cleanTitle("穿普拉达的女王-免费在线观看-爱看机器人-ikanbot.com"), "穿普拉达的女王");
  assert.equal(cleanTitle("Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film - YouTube"), "Big Buck Bunny 60fps 4K");
  assert.equal(cleanTitle("星际穿越_高清在线播放_xx影视"), "星际穿越");
  assert.equal(cleanTitle("About Time"), "About Time");
  assert.equal(cleanTitle("Spider-Man: Into the Spider-Verse - YouTube"), "Spider-Man: Into the Spider-Verse");
  assert.equal(cleanTitle("  "), "");
});

test("keeps the original when every part looks like a tail", () => {
  assert.equal(cleanTitle("YouTube"), "YouTube");
});
