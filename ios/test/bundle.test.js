// 手机版大管家那一包：在一个光秃秃的 JS 环境里跑（没有 URL / fetch / 定时器，跟 JavaScriptCore 一样），
// 假装 Swift 那头，走一遍：开场 → 她说话 → 按门铃 → 202 → 取回复 → 弹幕递回芯 → 收卡。
//   node --test ios/test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { bundle, transform } from "../../tools/build-ios-bundle.js";

const BUNDLE = new URL("../Sources/PlusOne/Resources/butler.bundle.js", import.meta.url);
const CORE = new URL("../Sources/PlusOne/Resources/core.js", import.meta.url);

test("the checked-in bundle and core copy match the sources", () => {
  assert.equal(fs.readFileSync(BUNDLE, "utf8"), bundle(), "run: node tools/build-ios-bundle.js");
  assert.equal(fs.readFileSync(CORE, "utf8"), fs.readFileSync(new URL("../../core/core.js", import.meta.url), "utf8"),
    "run: node tools/build-ios-bundle.js");
});

test("transform rejects modules that cannot run in JavaScriptCore", () => {
  assert.throws(() => transform('import fs from "node:fs";\n', "/x/a.js"), /node:fs/);
  assert.throws(() => transform('import { a } from "left-pad";\n', "/x/a.js"), /left-pad/);
  assert.throws(() => transform("export default 1;\n", "/x/a.js"), /default/);
  const t = transform('import { a, b as c } from "./b.js";\nexport const X = 1;\nexport async function f() {}\nconst y = 2;\nexport { y };\n', "/x/a.js");
  assert.match(t.body, /const \{ a, b: c \} = __req\(/);
  assert.match(t.body, /return \{ X, f, y \};/);
});

// 假的 Swift：记下 JS 叫它做的每件事，要等的事先挂着，测试里手动 resolve
function fakeHost() {
  const calls = [];
  const store = {};
  const waiting = [];
  const ctx = vm.createContext({});
  ctx.__host = (kind, json) => {
    const p = json ? JSON.parse(json) : null;
    calls.push({ kind, p });
    if (kind === "storeGet") return store[p] === undefined ? null : JSON.stringify(store[p]);
    if (kind === "storeSet") { store[p.key] = p.value; return null; }
    if (kind === "deliver") return "true";
    if (kind === "pageUrl") return JSON.stringify("https://films.example/watch/42");
    if (kind === "openTab") return "true";
    if (["fetch", "probe", "capture"].includes(kind)) waiting.push({ kind, p });
    return null;
  };
  vm.runInContext(fs.readFileSync(BUNDLE, "utf8"), ctx);
  const flush = () => new Promise((r) => setImmediate(r));
  const answer = async (kind, value, error = null) => {
    const i = waiting.findIndex((w) => w.kind === kind);
    assert.ok(i >= 0, `nothing waiting for ${kind}; calls: ${calls.map((c) => c.kind).join(",")}`);
    const [w] = waiting.splice(i, 1);
    vm.runInContext(`PlusOne.resolve(${w.p.id}, ${JSON.stringify(error)}, ${JSON.stringify(value === null ? null : JSON.stringify(value))})`, ctx);
    await flush();
    return w.p;
  };
  const js = (src) => vm.runInContext(src, ctx);
  const send = async (frame, msg) => { js(`PlusOne.message(${JSON.stringify(frame)}, ${JSON.stringify(JSON.stringify(msg))})`); await flush(); };
  return { ctx, calls, store, waiting, answer, js, send, flush,
    delivered: () => calls.filter((c) => c.kind === "deliver").map((c) => c.p) };
}

const CONFIG = { wake_url: "https://relay.example/watch/wake", key: "k", interval_sec: 180, frame_mode: "auto", probe_sec: 5 };

test("a watch session runs end to end on the host bridge", async () => {
  const h = fakeHost();
  assert.equal(h.js("typeof URL"), "function");   // MiniURL 补上了
  assert.equal(h.js("typeof fetch"), "function");   // 耳朵默认用全局 fetch，也走 Swift
  assert.equal(h.js(`PlusOne.start(${JSON.stringify(JSON.stringify(CONFIG))})`), true);

  await h.send("fA", { type: "hello", hasVideo: true, url: "https://cdn.example/embed/1", title: "x" });
  await h.send("fA", { type: "start_request", title: "Interstellar (2014) - Watch Free", url: "https://cdn.example/embed/1" });
  assert.deepEqual(h.calls.find((c) => c.kind === "setActive").p, { frame: "fA" });
  const probe = await h.answer("probe", { ok: true, time: 600, duration: 9000, paused: false, fingerprint: null });
  assert.equal(probe.frame, "fA");
  const status = h.delivered().find((d) => d.msg.type === "status");
  assert.equal(status.frame, "fA");
  assert.equal(status.msg.active, true);

  // 她说了一句 → 马上按门铃 → 联网走 Swift
  await h.send("fA", { type: "user_said", text: "这段好看", at: 601 });
  const req = await h.answer("fetch", { status: 202, body: "{\"ok\":true,\"mode\":\"poll\"}" });
  assert.equal(req.url, CONFIG.wake_url);
  assert.equal(req.method, "POST");
  assert.equal(req.headers.Authorization, "Bearer k");
  assert.equal(req.timeoutMs, 90000);
  const glance = JSON.parse(req.body);
  assert.deepEqual(glance.reasons, ["user_message"]);
  assert.equal(glance.title, "Interstellar (2014)");   // cleanTitle 去掉了站名尾巴
  assert.equal(glance.user_said[0].text, "这段好看");

  // 取回复：网址是 MiniURL 拼的
  h.js("PlusOne.pollOnce()");
  await h.flush();
  const poll = await h.answer("fetch", { status: 200, body: JSON.stringify({ replies: [{ id: 3, say: ["我也觉得"], actions: ["pause"] }] }) });
  assert.equal(poll.url, "https://relay.example/watch/replies?session=" + encodeURIComponent(glance.session) + "&after=0");
  await h.flush();
  const said = h.delivered().filter((d) => d.msg.type === "say");
  assert.equal(said.at(-1).msg.text, "我也觉得");
  assert.equal(said.at(-1).frame, "fA");
  assert.ok(h.delivered().some((d) => d.msg.type === "control" && d.msg.action === "pause"));

  // 别的框（广告）发来的暂停不算
  await h.send("fAd", { type: "user_said", text: "广告", at: 1 });
  assert.equal(h.waiting.filter((w) => w.kind === "fetch").length, 0);

  // 收卡：本机备份记一份（App 自己的存储），叫醒包是 wrap_up
  await h.send("fA", { type: "wrap_up", finished: false, title: "", occasion: "周三", her_review: "", picked: [] });
  const wrap = await h.answer("fetch", { status: 202, body: "{}" });
  const pkg = JSON.parse(wrap.body);
  assert.equal(pkg.reason, "wrap_up");
  assert.equal(pkg.url, "https://films.example/watch/42");   // 外面那一页的网址
  assert.match(pkg.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(h.store.films[0].status, "watching");
  assert.ok(h.store.films[0].urls.includes("https://cdn.example/embed/1"));
  assert.equal(h.delivered().at(-1).msg.active, false);

  // 再打开同一个网址：问接着看吗
  await h.send("fB", { type: "hello", hasVideo: true, url: "https://cdn.example/embed/1", title: "x" });
  const offer = h.delivered().at(-1);
  assert.equal(offer.frame, "fB");
  assert.equal(offer.msg.type, "resume_offer");
  assert.equal(offer.msg.at_sec, 600);
});

test("opening from a film card seeks once the video says hello", async () => {
  const h = fakeHost();
  h.js(`PlusOne.start(${JSON.stringify(JSON.stringify(CONFIG))})`);
  h.js(`PlusOne.open(${JSON.stringify(JSON.stringify({ url: "https://films.example/watch/42", at_sec: 1599, title: "La La Land" }))})`);
  await h.flush();
  assert.deepEqual(h.calls.find((c) => c.kind === "openTab").p, { url: "https://films.example/watch/42" });
  await h.send("fV", { type: "hello", hasVideo: true, url: "https://cdn.example/embed/9", title: "" });
  const seek = h.delivered().find((d) => d.msg.type === "control");
  assert.deepEqual(seek, { frame: "fV", msg: { type: "control", action: "seek_to", at: 1599 } });
  assert.equal(h.delivered().find((d) => d.msg.type === "resume_offer").msg.at, "26:39");
});

test("a failed wake turns the dot orange", async () => {
  const h = fakeHost();
  h.js(`PlusOne.start(${JSON.stringify(JSON.stringify(CONFIG))})`);
  await h.send("fA", { type: "start_request", title: "t", url: "https://a.example/v" });
  await h.answer("probe", { ok: true, time: 0, duration: 100, paused: false });
  await h.send("fA", { type: "user_said", text: "hi", at: 1 });
  await h.answer("fetch", null, "offline");
  assert.deepEqual(h.delivered().at(-1).msg, { type: "link", ok: false });
});

test("settings changed in the drawer go back to the app", async () => {
  const h = fakeHost();
  h.js(`PlusOne.start(${JSON.stringify(JSON.stringify(CONFIG))})`);
  await h.send("fA", { type: "settings", interval_sec: 60, frame_mode: "pick", sync_chat: true });
  const saved = h.calls.find((c) => c.kind === "saveSettings").p;
  assert.deepEqual(saved, { interval_sec: 60, frame_mode: "pick", sync_chat: true });
});

test("subtitle search and ears say they are not on the phone yet", async () => {
  const h = fakeHost();
  h.js(`PlusOne.start(${JSON.stringify(JSON.stringify(CONFIG))})`);
  await h.send("fA", { type: "start_request", title: "t", url: "https://a.example/v" });
  await h.answer("probe", { ok: true, time: 0, duration: 100, paused: false });
  assert.equal(h.delivered().find((d) => d.msg.type === "status").msg.ears_available, false);
  await h.send("fA", { type: "subtitles_search", query: "Interstellar" });
  const c = h.delivered().find((d) => d.msg.type === "subtitle_candidates");
  assert.deepEqual(c.msg.items, []);
  assert.match(c.msg.error, /用不了/);
});
