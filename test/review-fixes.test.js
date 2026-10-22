// 10-21 夜 review 修的几处：第二场不覆盖第一场、叫醒失败不丢她的话、顶层「一起逛」碰上播放框就撤、
// 「接着看」的命令只落在对的那种框上、壳断线重连后把正在看的场子认回来
import { test } from "node:test";
import assert from "node:assert/strict";
import { WatchSession } from "../butler/session.js";

function rig({ pageUrl } = {}) {
  let t = 0;
  const delivered = [], deliveredTo = [], woke = [];
  const video = { time: 100, paused: false };
  const shell = {
    active: null,
    setActive(ref) { this.active = ref || null; },
    async deliver(m) { delivered.push({ to: this.active, m }); },
    async deliverTo(ref, m) { deliveredTo.push({ ref, m }); },
    async probe() { return { ok: true, time: video.time, duration: 3600, paused: video.paused, fingerprint: null }; },
    async capture() { return "JPEG"; },
    async openTab() { return true; },
    ...(pageUrl ? { pageUrl } : {}),
  };
  let fail = false;
  const wake = {
    async send(g) {
      if (fail) throw new Error("502");
      woke.push(g);
      return { mode: "inline", reply: { say: [], actions: [], nextLookIn: null, silent: true } };
    },
    async poll() { return []; },
  };
  const s = new WatchSession({ shell, wake, config: { interval_sec: 180, frame_mode: "auto", wake_url: "x" }, now: () => t });
  return { s, shell, delivered, deliveredTo, woke, video, setNow: (v) => (t = v), setFail: (v) => (fail = v) };
}

const A = { sessionId: "A", contextId: 1 }, B = { sessionId: "B", contextId: 2 }, TOP = { sessionId: "A", contextId: 0 };
const PAGE = "https://site.example/play/1";
const samePage = async () => PAGE;

test("a second 一起看 ends the first session instead of silently overwriting it", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "一", url: "https://a.example/1" }, ref: A });
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "二", url: "https://a.example/2" }, ref: B });
  const off = r.delivered.find((d) => d.m.type === "status" && d.m.active === false);
  assert.deepEqual(off.to, A);   // 旧框收到「不在一起看了」
  assert.equal(r.s.status().title, "二");
  assert.deepEqual(r.shell.active, B);
});

test("a browse session that gets replaced still sends its wrap", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "漫画", url: "https://c.example/1" }, ref: A });
  r.setNow(90000); await r.s.tick();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "片", url: "https://a.example/1" }, ref: B });
  assert.equal(r.woke.filter((g) => g.reason === "browse_wrap").length, 1);
  assert.equal(r.s.status().mode, "video");
});

test("a failed wake keeps her line and the frames for the next ring", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t" }, ref: A });
  r.setNow(5000); await r.s.tick();   // 截了一张
  r.setFail(true);
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "这句别丢", at: 100 }, ref: A });
  assert.equal(r.woke.length, 0);
  assert.deepEqual(r.delivered.at(-1).m, { type: "link", ok: false });
  r.setFail(false);
  r.setNow(200000); r.video.time = 200; await r.s.tick();   // 到点再叫：上次没送到的一起带上
  assert.equal(r.woke.length, 1);
  assert.deepEqual(r.woke[0].user_said.map((u) => u.text), ["这句别丢"]);
  assert.ok(r.woke[0].frames.length >= 1);
  assert.deepEqual(r.delivered.at(-1).m, { type: "link", ok: true });
});

test("the top frame's 一起逛 stands down when a big video frame on the same page says hello, in either order; an ad frame does not", async () => {
  // 子框先到
  let r = rig({ pageUrl: samePage });
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://cdn.example/e/1", vw: 900, vh: 500 }, ref: A });
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: false, page: true, url: PAGE, vw: 1200, vh: 800 }, ref: TOP });
  assert.deepEqual(r.deliveredTo.at(-1), { ref: TOP, m: { type: "standby" } });
  // 顶层先到
  r = rig({ pageUrl: samePage });
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: false, page: true, url: PAGE, vw: 1200, vh: 800 }, ref: TOP });
  assert.equal(r.deliveredTo.length, 0);
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://cdn.example/e/1", vw: 900, vh: 500 }, ref: A });
  assert.deepEqual(r.deliveredTo.at(-1), { ref: TOP, m: { type: "standby" } });
  // 小广告框不算
  r = rig({ pageUrl: samePage });
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: false, page: true, url: PAGE, vw: 1200, vh: 800 }, ref: TOP });
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://ads.example/v", vw: 300, vh: 250 }, ref: B });
  assert.ok(!r.deliveredTo.some((d) => d.m.type === "standby"));
  // 正在一起逛的那页冒出一个视频框：照旧逛，不撤
  r = rig({ pageUrl: samePage });
  await r.s.handleCoreMessage({ msg: { type: "start_request", mode: "page", title: "逛", url: PAGE }, ref: TOP });
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: false, page: true, url: PAGE, vw: 1200, vh: 800 }, ref: TOP });
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://cdn.example/e/9", vw: 900, vh: 500 }, ref: A });
  assert.ok(!r.deliveredTo.some((d) => d.m.type === "standby"));
});

test("「接着看」from a card waits for the frame that really has the video; the top frame's hello leaves the command alone", async () => {
  const r = rig({ pageUrl: samePage });
  await r.s.handleCommand({ action: "open", url: PAGE, at_sec: 1599, title: "片", at: new Date(0).toISOString() }, 120);
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: false, page: true, url: PAGE, vw: 1200, vh: 800 }, ref: TOP });
  // 顶层页一到就先把「接着上次 x:xx 看」那张条给它（一进页面就看得见），跳过去的命令还留着等视频
  assert.deepEqual(r.deliveredTo.map((d) => [d.ref, d.m.type]), [[TOP, "resume_offer"]]);
  assert.equal(r.deliveredTo[0].m.at, "26:39");
  assert.ok(r.s.pendingOpen);
  // 顶层页再打一次招呼不重复给
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: false, page: true, url: PAGE, vw: 1200, vh: 800 }, ref: TOP });
  assert.equal(r.deliveredTo.length, 1);
  await r.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://cdn.example/e/1", vw: 900, vh: 500 }, ref: A });
  assert.deepEqual(r.deliveredTo.map((d) => [d.ref, d.m.type]),
    [[TOP, "resume_offer"], [TOP, "standby"], [A, "control"], [A, "resume_offer"]]);
  assert.deepEqual(r.deliveredTo[2].m, { type: "control", action: "seek_to", at: 1599 });
  assert.equal(r.s.pendingOpen, null);
  // 翻页的命令反过来：只等顶层页
  const q = rig({ pageUrl: samePage });
  await q.s.handleCommand({ action: "open", url: PAGE, scroll_pct: 40, title: "漫画", at: new Date(0).toISOString() }, 120);
  await q.s.handleCoreMessage({ msg: { type: "hello", hasVideo: true, url: "https://ads.example/v", vw: 300, vh: 250 }, ref: B });
  assert.ok(q.s.pendingOpen);
  await q.s.handleCoreMessage({ msg: { type: "hello", hasVideo: false, page: true, url: PAGE, vw: 1200, vh: 800 }, ref: TOP });
  assert.deepEqual(q.deliveredTo.at(-1), { ref: TOP, m: { type: "control", action: "scroll_to", pct: 40 } });
});

test("after the shell reconnects, the next message from the same page reclaims the frame; other pages are ignored", async () => {
  const r = rig({ pageUrl: async (ref) => (ref.sessionId === "Z" ? "https://other.example/" : PAGE) });
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t", url: "https://cdn.example/e/1" }, ref: A });
  r.s.shellReconnected();
  assert.equal(r.shell.active, null);
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "x", at: 1 }, ref: { sessionId: "Z", contextId: 9 } });
  assert.equal(r.woke.length, 0);
  assert.equal(r.shell.active, null);
  const N = { sessionId: "N", contextId: 3 };
  await r.s.handleCoreMessage({ msg: { type: "video", event: "play", time: 120, paused: false }, ref: N });
  assert.deepEqual(r.shell.active, N);
  assert.equal(r.delivered.at(-1).m.type, "status");
  assert.equal(r.delivered.at(-1).m.active, true);
  await r.s.handleCoreMessage({ msg: { type: "user_said", text: "回来了", at: 121 }, ref: N });
  assert.equal(r.woke.length, 1);
});

test("while the ticket is being handed over, ticks stay quiet", async () => {
  const r = rig();
  await r.s.handleCoreMessage({ msg: { type: "start_request", title: "t", url: "https://a.example/1" }, ref: A });
  let release;
  const slow = new Promise((res) => { release = res; });
  const send = r.s.wake.send;
  r.s.wake.send = async (g) => { if (g.reason === "wrap_up") await slow; return send(g); };
  const wrapping = r.s.handleCoreMessage({ msg: { type: "wrap_up", finished: true, title: "t", picked: [] }, ref: A });
  r.setNow(400000); r.video.time = 400; await r.s.tick();   // 本该到点叫他一眼
  release();
  await wrapping;
  assert.deepEqual(r.woke.map((g) => g.reason), ["wrap_up"]);
});
