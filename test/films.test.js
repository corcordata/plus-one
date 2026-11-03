import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FilmStore } from "../butler/films.js";

test("records a wrap, merges by url or title, finds by url", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-films-"));
  const store = new FilmStore(dir);
  const a = store.recordWrap({ title: "穿普拉达的女王", url: "https://x.example/1", finished: false, positionSec: 1599,
    occasion: "第一次用陪看", herReview: "", picked: [{ who: "him", at: "8:02", text: "That's all." }], date: "2026-10-20" });
  assert.equal(a.status, "watching");
  assert.equal(a.position_sec, 1599);
  assert.equal(store.findByUrl("https://x.example/1").title, "穿普拉达的女王");
  assert.equal(store.findByUrl("https://x.example/2"), null);
  // 同一片名、换了个网址：并进同一张，加一场
  const b = store.recordWrap({ title: "穿普拉达的女王", url: "https://x.example/2", finished: true, positionSec: 6000,
    occasion: "", herReview: "好看", picked: [], date: "2026-10-21" });
  assert.equal(b.status, "finished");
  assert.deepEqual(b.urls, ["https://x.example/1", "https://x.example/2"]);
  assert.equal(b.sessions.length, 2);
  assert.equal(fs.readdirSync(dir).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
