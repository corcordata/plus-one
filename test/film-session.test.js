import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WatchSession } from "../butler/session.js";
import { FilmStore } from "../butler/films.js";

function rig() {
  let t = Date.parse("2026-10-20T10:00:00Z");
  const delivered = [], deliveredTo = [], woke = [];
  const video = { time: 100, paused: false };
  const shell = {
    setActive() {},
    async deliver(m) { delivered.push(m); },
    async deliverTo(ref, m) { deliveredTo.push({ ref, m }); },
    async probe() { return { ok: true, time: video.time, duration: 7000, paused: video.paused, fingerprint: null }; },
    async capture() { return `JPEG@${video.time}`; },
  };
  const wake = {
    async send(g) { woke.push(g); return { mode: "inline", reply: { say: [], actions: [], nextLookIn: null, silent: true } }; },
    async poll() { return []; },
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-fs-"));
  const films = new FilmStore(dir);
  const s = new WatchSession({ shell, wake, films, config: { interval_sec: 60, frame_mode: "auto", wake_url: "x" }, now: () => t });
  return { s, delivered, deliveredTo, woke, video, films, dir, advance: (ms) => (t += ms) };
}

const URL1 = "https://ikanbot.example/play/42";

test("start cleans the page title and remembers the url", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "穿普拉达的女王-免费在线观看-爱看机器人-ikanbot.com", url: URL1 }, ref: {} });
  assert.equal(r.s.status().title, "穿普拉达的女王");
  assert.equal(r.delivered[0].title, "穿普拉达的女王");
});

test("wrap up: package goes to the front end, local backup is written, session ends", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "穿普拉达的女王-免费在线观看", url: URL1 }, ref: {} });
  // 三次到点，攒三张递出去过的图
  for (const tm of [161, 222, 283]) { r.advance(61000); r.video.time = tm; await r.s.tick(); }
  assert.equal(r.woke.length, 3);
  r.video.time = 1599; await r.s.tick();
  await r.s.handleCoreMessage({ msg: { type: "wrap_up", finished: false, title: "穿普拉达的女王", occasion: "第一次用陪看",
    her_review: "", picked: [{ who: "him", text: "That's all.", at: 482 }, { who: "her", text: "好期待", at: 1225 }] } });
  const pkg = r.woke.at(-1);
  assert.equal(pkg.reason, "wrap_up");
  assert.equal(pkg.finished, false);
  assert.equal(pkg.url, URL1);
  assert.equal(pkg.position, "26:39");
  assert.equal(pkg.duration_sec, 7000);   // 片长跟着包走，卡上画进度条
  assert.equal(pkg.date, "2026-10-20");
  assert.deepEqual(pkg.picked, [{ who: "him", at: "8:02", text: "That's all." }, { who: "her", at: "20:25", text: "好期待" }]);
  assert.ok(pkg.frames.length >= 1 && pkg.frames.length <= 3 && pkg.frames.every((f) => f.image));
  assert.equal(r.s.status().active, false);
  assert.deepEqual(r.delivered.at(-1), { type: "status", active: false });
  const rec = r.films.findByUrl(URL1);
  assert.equal(rec.status, "watching");
  assert.equal(rec.position_sec, 1599);
  assert.equal(rec.sessions[0].occasion, "第一次用陪看");
});

test("opening the same url again offers to resume; resuming tags the first look", async () => {
  const r = rig();
  r.films.recordWrap({ title: "穿普拉达的女王", url: URL1, finished: false, positionSec: 1599, date: "2026-10-20" });
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: URL1, title: "x" }, ref: { sessionId: "S", contextId: 3 } });
  assert.deepEqual(r.deliveredTo[0], { ref: { sessionId: "S", contextId: 3 },
    m: { type: "resume_offer", at_sec: 1599, at: "26:39", title: "穿普拉达的女王" } });
  // 片子看完了的不再问
  r.films.recordWrap({ title: "穿普拉达的女王", url: URL1, finished: true, positionSec: 6000, date: "2026-10-21" });
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: URL1, title: "x" }, ref: {} });
  assert.equal(r.deliveredTo.length, 1);

  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "穿普拉达的女王", url: URL1, resumed_from: 1599 }, ref: {} });
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "接着看", at: 1601 } });
  assert.equal(r.woke[0].resumed_from, "26:39");
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "再说一句", at: 1610 } });
  assert.equal("resumed_from" in r.woke[1], false);
});

test("wrap ticket: shows the three frames, her starred one becomes the cover, drawer style is snapshotted", async () => {
  const r = rig();
  r.s.config.appearance = { bg: "cream", style: { material: "solid", colorMu: "e6c27a", cornerRadius: 4 }, photos: ["data:image/jpeg;base64,AAA"] };
  r.s.config.sync_chat = true;
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "穿普拉达的女王", url: URL1 }, ref: {} });
  for (const tm of [161, 222, 283]) { r.advance(61000); r.video.time = tm; await r.s.tick(); }
  assert.ok(r.woke.every((g) => g.sync_chat === true));
  await r.s.handleCoreMessage({ msg: { type: "wrap_open" } });
  const shown = r.delivered.at(-1);
  assert.equal(shown.type, "wrap_frames");
  assert.equal(shown.frames.length, 3);
  assert.ok(shown.frames.every((f) => f.id && f.at && f.image));
  const star = shown.frames[2].id;
  await r.s.handleCoreMessage({ msg: { type: "wrap_up", finished: true, title: "穿普拉达的女王", picked: [], cover: star } });
  const pkg = r.woke.at(-1);
  assert.equal(pkg.cover, star);
  assert.equal(pkg.frames[0].id, star);
  assert.equal(pkg.frames.length, 3);
  assert.equal(pkg.sync_chat, true);
  assert.equal(pkg.appearance.bg, "cream");
  assert.equal(pkg.appearance.style.colorMu, "E6C27A");
  assert.equal("photos" in pkg.appearance, false);
});

test("drawer look is saved through the butler and handed to new pages; link dot turns orange when waking fails", async () => {
  const r = rig();
  const saved = [];
  r.s.onSettings = (p) => saved.push(p);
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://x.example/1" }, ref: { sessionId: "A", contextId: 1 } });
  assert.equal(r.deliveredTo.length, 0);   // 没存过就不递，芯用自带的默认
  await r.s.handleCoreMessage({ msg: { type: "appearance_save", appearance: { bg: "photo:5", presets: [{ name: "票根", style: { material: "solid" } }], style: null } } });
  assert.equal(saved[0].appearance.bg, "glass");   // 没有第 5 张照片，退回默认
  assert.equal(saved[0].appearance.presets[0].name, "票根");
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://x.example/1" }, ref: { sessionId: "A", contextId: 1 } });
  assert.equal(r.deliveredTo.at(-1).m.type, "appearance");
  await r.s.handleCoreMessage({ msg: { type: "settings", interval_sec: 120, frame_mode: "auto", sync_chat: true } });
  assert.equal(saved.at(-1).sync_chat, true);

  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t", url: URL1 }, ref: {} });
  assert.equal(r.delivered.at(-1).link, true);
  assert.equal(r.delivered.at(-1).sync_chat, true);
  r.s.wake.send = async () => { throw new Error("502"); };
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "在吗", at: 100 } });
  assert.deepEqual(r.delivered.filter((m) => m.type === "link"), [{ type: "link", ok: false }]);
});

test("open on the Mac from the phone: opens the tab, jumps to where she stopped when the video says hello", async () => {
  const r = rig();
  const opened = [];
  r.s.shell.openTab = async (u) => { opened.push(u); return true; };
  r.s.shell.pageUrl = async (ref) => (ref.sessionId === "P" ? "https://ikanbot.example/play/42?from=card" : "https://player.example/embed/9");
  const now = new Date(Date.parse("2026-10-20T10:00:00Z")).toISOString();
  // 两分钟以前点的不翻出来
  await r.s.handleCommand({ action: "open", url: URL1, at_sec: 1599, at: "2026-10-20T09:50:00Z" }, 120);
  assert.deepEqual(opened, []);
  await r.s.handleCommand({ action: "open", url: URL1, at_sec: 1599, title: "穿普拉达的女王", at: now }, 120);
  assert.deepEqual(opened, [URL1]);
  // 别的页面的视频打招呼：不算
  await r.s.handleCommand({ action: "open", url: URL1, at_sec: 1599, title: "穿普拉达的女王", at: now }, 120);
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://other.example/v" }, ref: { sessionId: "Q", contextId: 1 } });
  assert.equal(r.deliveredTo.length, 0);
  // 那一页里的视频框打招呼（框的地址不一样，外面那页同站同路径）：跳过去 + 问接着看
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://player.example/embed/9" }, ref: { sessionId: "P", contextId: 2 } });
  assert.deepEqual(r.deliveredTo.map((d) => d.m.type), ["control", "resume_offer"]);
  assert.deepEqual(r.deliveredTo[0].m, { type: "control", action: "seek_to", at: 1599 });
  assert.equal(r.deliveredTo[1].m.at, "26:39");
  assert.equal(r.s.pendingOpen, null);
});

test("the card remembers the outer page's address, not just the video frame's", async () => {
  const r = rig();
  r.s.shell.pageUrl = async () => URL1;
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "穿普拉达的女王", url: "https://player.example/embed/9" }, ref: { sessionId: "P", contextId: 2 } });
  await r.s.handleCoreMessage({ msg: { type: "wrap_up", finished: false, title: "穿普拉达的女王", picked: [] } });
  const pkg = r.woke.at(-1);
  assert.equal(pkg.url, URL1);
  assert.equal(pkg.frame_url, "https://player.example/embed/9");
  assert.ok(r.films.findByUrl("https://player.example/embed/9"));   // 回到那个框也认得出来，照样问接着看
  assert.ok(r.films.findByUrl(URL1));
});
