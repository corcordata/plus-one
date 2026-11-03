import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchSession } from "../butler/session.js";

function rig({ hands = false, actions = [] } = {}) {
  let t = 0;
  const delivered = [], woke = [], clicks = [], shots = [];
  let scrollY = 0;
  const shell = {
    setActive() {},
    async deliver(m) { delivered.push(m); },
    async probe() { return { ok: true, page: true, time: t / 1000, paused: false, fingerprint: null, scroll: { y: scrollY, max: 3200, vh: 800 } }; },
    async capture() { shots.push(scrollY); return `JPEG@${scrollY}`; },
    async click(x, y) { clicks.push([x, y]); return true; },
  };
  const wake = { async send(g) { woke.push(g); return { mode: "inline", reply: { say: [], actions, nextLookIn: null } }; } };
  const s = new WatchSession({ shell, wake, config: { interval_sec: 60, frame_mode: "auto", wake_url: "x", hands, gemini_key: "k" },
    now: () => t, listen: async () => { throw new Error("no ears on pages"); }, subfinder: null });
  return { s, delivered, woke, clicks, shots, advance: (ms) => (t += ms), scrollTo: (y) => (scrollY = y) };
}

test("browse together: a page session screenshots on scroll, and the look carries url / elapsed / scroll, not film things", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "第 12 话 - 某漫画站", url: "https://comic.example/12" }, ref: {} });
  const st = r.delivered[0];
  assert.equal(st.mode, "page");
  assert.equal(st.ears_available, false);       // 页面没有片子的声音
  assert.equal(r.s.status().title, "第 12 话 - 某漫画站");   // 页面标题不按片名抠
  r.advance(5000); await r.s.tick();            // 第一张
  r.scrollTo(100); r.advance(5000); await r.s.tick();   // 只滑了一点点：不截
  r.scrollTo(900); r.advance(5000); await r.s.tick();   // 滑了一屏多：截
  assert.deepEqual(r.shots, [0, 900]);
  r.advance(50000); await r.s.tick();           // 一分钟到了，看一眼
  const g = r.woke[0];
  assert.equal(g.mode, "page");
  assert.equal(g.url, "https://comic.example/12");
  assert.equal(g.elapsed, "1:05");
  assert.deepEqual(g.scroll, { y: 900, max: 3200, vh: 800 });
  assert.deepEqual(g.subtitles, []);
  assert.equal(g.hands, false);
  assert.equal(g.heard, "");
  assert.ok(g.frames.some((f) => f.image));
});

test("his hands only work when she switched them on; clicks go through Chrome, scroll / move through the core", async () => {
  const acts = [{ type: "scroll", by: "page" }, { type: "click", x: 0.5, y: 0.25 }, { type: "move", uci: "e2e4" }, { type: "pause" }];
  const off = rig({ actions: acts });
  await off.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "x" }, ref: {} });
  await off.s.handleCoreMessage({ msg: { type: "user_said", text: "往下", at: 0 } });
  assert.deepEqual(off.delivered.filter((m) => m.type === "control"), [{ type: "control", action: "pause", by: undefined }]);
  assert.deepEqual(off.clicks, []);

  const on = rig({ hands: true, actions: acts });
  await on.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "x" }, ref: {} });
  await on.s.handleCoreMessage({ msg: { type: "user_said", text: "往下", at: 0 } });
  assert.deepEqual(on.clicks, [[0.5, 0.25]]);
  assert.deepEqual(on.delivered.filter((m) => m.type === "control").map((m) => [m.action, m.by ?? m.uci ?? null]),
    [["scroll", "page"], ["move", "e2e4"], ["pause", null]]);
  // 她在抽屉里关掉：马上不算
  await on.s.handleCoreMessage({ msg: { type: "settings", interval_sec: 60, frame_mode: "auto", hands: false } });
  assert.equal(on.s.status().hands, false);
});

test("a failed lichess move is told to him on the next look", async () => {
  const r = rig({ hands: true });
  await r.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "lichess" }, ref: {} });
  await r.s.handleCoreMessage({ msg: { type: "hand_failed", action: "move", why: "lichess 没连上：刷新一下棋盘那页再试" } });
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "该你了", at: 0 } });
  assert.deepEqual(r.woke[0].hand_notes, ["lichess 没连上：刷新一下棋盘那页再试"]);
  assert.equal(r.woke[0].hands, true);
});

test("browse together: ending a page session over a minute hands the front end a browse wrap; under a minute leaves nothing", async () => {
  const r = rig({ actions: [] });
  await r.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "第 12 话 - 某漫画站", url: "https://comic.example/12" }, ref: {} });
  r.advance(5000); await r.s.tick();
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "这格好好笑", at: 5 }, ref: {} });
  r.scrollTo(1600); r.advance(70000); await r.s.tick();
  await r.s.handleCoreMessage({ msg: { type: "stop_request" }, ref: {} });
  const w = r.woke.find((g) => g.reason === "browse_wrap");
  assert.ok(w, "browse wrap sent");
  assert.equal(w.mode, "page");
  assert.equal(w.url, "https://comic.example/12");
  assert.equal(w.scroll_pct, 50);
  assert.ok(w.elapsed_sec >= 75);
  assert.equal(w.frames.length, 1);
  assert.equal(w.frames[0].image, "JPEG@1600");
  assert.deepEqual(w.lines.map((l) => [l.who, l.text]), [["her", "这格好好笑"]]);
  assert.match(w.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.s.state, null);

  const q = rig();
  await q.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "x", url: "https://a.example/" }, ref: {} });
  q.advance(20000); await q.s.tick();
  await q.s.end();
  assert.equal(q.woke.filter((g) => g.reason === "browse_wrap").length, 0);
});

test("browse together: 接着读 from a card scrolls back to where she stopped, without the film resume pill", async () => {
  const r = rig();
  const opened = [];
  r.s.shell.openTab = async (u) => { opened.push(u); return true; };
  r.s.shell.deliverTo = async (ref, m) => { r.delivered.push(m); return true; };
  await r.s.handleCommand({ action: "open", url: "https://comic.example/12", scroll_pct: 63, title: "某漫画" });
  assert.deepEqual(opened, ["https://comic.example/12"]);
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: false, page: true, url: "https://comic.example/12", title: "x" }, ref: {} });
  assert.deepEqual(r.delivered.at(-1), { type: "control", action: "scroll_to", pct: 63 });
  assert.ok(!r.delivered.some((m) => m.type === "resume_offer"));
});

test("browse together: 下一话 loads a new page; the session follows it, time adds up, and a chapter marker goes into the lines", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "某漫画 第12话", url: "https://comic.example/12" }, ref: { sessionId: "A", contextId: 1 } });
  r.advance(90000); await r.s.tick();          // 第 12 话看了一分半
  assert.ok(r.s.state.video.time >= 90);
  // 点了下一话：新页、新芯（它从 0 数），先打招呼
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: false, page: true, url: "https://comic.example/13", title: "某漫画 第13话" }, ref: { sessionId: "B", contextId: 2 } });
  assert.equal(r.delivered.at(-1).type, "status");
  assert.equal(r.delivered.at(-1).active, true);
  const pageStart = Date.now();
  r.s.shell.probe = async () => ({ ok: true, page: true, time: 30, paused: false, fingerprint: null, scroll: { y: 0, max: 3000, vh: 800 } });
  await r.s.tick();
  assert.ok(r.s.state.video.time >= 120, `time adds up: ${r.s.state.video.time}`);
  // 新页上她说的话算数（以前会被当成别的框丢掉）
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "这话更好看", at: 31 }, ref: { sessionId: "B", contextId: 2 } });
  await r.s.end();
  const w = r.woke.find((g) => g.reason === "browse_wrap");
  assert.equal(w.url, "https://comic.example/13");
  assert.equal(w.title, "某漫画 第13话");
  assert.deepEqual(w.lines.map((l) => [l.who, l.text]), [["mark", "某漫画 第13话"], ["her", "这话更好看"]]);
  assert.ok(pageStart);
});

test("browse together: the ticket keeps only the lines she ticked; 什么都不留 records nothing", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "某漫画 第3话", url: "https://comic.example/3" }, ref: {} });
  r.advance(20000); await r.s.tick();   // 才二十秒：她点了收进来照样记
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "一", at: 1 }, ref: {} });
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "二", at: 2 }, ref: {} });
  await r.s.handleCoreMessage({ msg: { type: "browse_end", keep: true, title: "某漫画（改了名）", picked: [{ who: "her", text: "二", at: 2 }] }, ref: {} });
  const w = r.woke.find((g) => g.reason === "browse_wrap");
  assert.equal(w.title, "某漫画（改了名）");
  assert.deepEqual(w.lines.map((l) => l.text), ["二"]);
  assert.equal(r.s.state, null);

  const q = rig();
  await q.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "x", url: "https://a.example/" }, ref: {} });
  q.advance(120000); await q.s.tick();
  await q.s.handleCoreMessage({ msg: { type: "browse_end", keep: false }, ref: {} });
  assert.equal(q.woke.filter((g) => g.reason === "browse_wrap").length, 0);
  assert.equal(q.s.state, null);
});

test("browse end: the screenshots she keeps on the ticket go with the card, starred one first", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "某漫画 第3话", url: "https://comic.example/3" }, ref: {} });
  r.s.state.album = [{ id: "a", at: "1:00", image: "A" }, { id: "b", at: "2:00", image: "B" }, { id: "c", at: "3:00", image: "C" }];
  await r.s.handleCoreMessage({ msg: { type: "browse_end", keep: true, title: "某漫画 第3话", picked: [], keep_frames: ["a", "c"], cover: "c" }, ref: {} });
  const w = r.woke.find((g) => g.reason === "browse_wrap");
  assert.deepEqual(w.frames.map((f) => f.id), ["c", "a"]);
  assert.equal(w.cover_pick, true);

  // 没点星星：照她留的顺序，不标 cover_pick
  const q = rig();
  await q.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "x", url: "https://a.example/" }, ref: {} });
  q.s.state.album = [{ id: "a", at: "1:00", image: "A" }, { id: "b", at: "2:00", image: "B" }];
  await q.s.handleCoreMessage({ msg: { type: "browse_end", keep: true, title: "x", picked: [], keep_frames: ["b"] }, ref: {} });
  const v = q.woke.find((g) => g.reason === "browse_wrap");
  assert.deepEqual(v.frames.map((f) => f.id), ["b"]);
  assert.equal(v.cover_pick, undefined);
});

test("wrap-up: screenshots she taps away on the ticket are not sent with the card", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "Film", url: "https://films.example/1" }, ref: {} });
  r.s.state.album = [{ id: "a", at: "1:00", image: "A" }, { id: "b", at: "2:00", image: "B" }, { id: "c", at: "3:00", image: "C" }];
  await r.s.handleCoreMessage({ msg: { type: "wrap_up", finished: false, title: "Film", picked: [], keep_frames: ["a", "c"], cover: "c" }, ref: {} });
  const w = r.woke.find((g) => g.reason === "wrap_up");
  assert.deepEqual(w.frames.map((f) => f.id), ["c", "a"]);   // b 不留；c 是主图排第一
  assert.equal(w.cover, "c");
});
