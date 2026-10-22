// 真 Chrome 集成测试：外层页 localhost，视频在 127.0.0.1 的跨域框里——跟爬虫站一个结构。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { ChromeShell } from "../shell-chrome/shell.js";

const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FIX = new URL("./fixtures/", import.meta.url);
const CLIP = new URL("clip.webm", FIX);
const skip = !fs.existsSync(CHROME) && "no Chrome";

let chrome, profile, chromeUrl, outerPort, innerPort;
const servers = [];

function serve(rewrite) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const name = req.url.split("?")[0].slice(1) || "page.html";
      const file = new URL(name, FIX);
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      const type = name.endsWith(".html") ? "text/html; charset=utf-8" : "video/webm";
      res.writeHead(200, { "Content-Type": type });
      if (name.endsWith(".html")) res.end(rewrite(fs.readFileSync(file, "utf8")));
      else fs.createReadStream(file).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => { servers.push(s); resolve(s.address().port); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(200);
  }
}

before(async () => {
  if (skip) return;
  if (!fs.existsSync(CLIP)) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25",
      "-t", "20", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-b:v", "200k", CLIP.pathname]);
  }
  innerPort = await serve((h) => h);
  outerPort = await serve((h) => h.replace("__INNER_PORT__", String(innerPort)));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "wt-chrome-"));
  chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check", "about:blank"],
  { stdio: "ignore" });
  const portFile = path.join(profile, "DevToolsActivePort");
  const port = await until(() => fs.existsSync(portFile) && fs.readFileSync(portFile, "utf8").split("\n")[0]);
  chromeUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  for (const s of servers) s.close();
  // Chrome 退出时还在往档案里写东西，等它真退了再删，不然会撞上 ENOTEMPTY
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited;
  }
  if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("finds the video inside a cross-origin iframe, probes, captures, shows danmaku, pauses", { skip }, async () => {
  const shell = new ChromeShell({ chromeUrl });
  const hellos = [], msgs = [];
  shell.onMessage((m) => { msgs.push(m.msg); if (m.msg.type === "hello") hellos.push(m); });
  await shell.connect();
  await fetch(`${chromeUrl}/json/new?http://localhost:${outerPort}/page.html`, { method: "PUT" });

  const hello = await until(() => hellos.find((h) => h.msg.url.includes("inner.html")));
  shell.setActive(hello.ref);
  // 视频在跨域的框里：卡上要记的是外面那一页的地址
  assert.match(await shell.pageUrl(hello.ref), /localhost:\d+\/page\.html/);

  const p = await until(async () => { const r = await shell.probe(); return r.ok && r.time > 0.5 && r; });
  assert.equal(p.paused, false);
  assert.equal(Array.isArray(p.fingerprint), true);   // 同源视频，指纹算得出来

  const jpeg = await shell.capture();
  assert.ok(jpeg && jpeg.length > 1000);
  // 截图时藏字只能调透明度：visibility:hidden 会让她正在打字的输入框丢焦点
  const vis = await shell.evaluateIn(hello.ref,
    "(() => { window.__wt.hideUi(true); const v = getComputedStyle(document.querySelector('wt-host')).visibility; window.__wt.hideUi(false); return v; })()");
  assert.equal(vis, "visible");

  await shell.deliver({ type: "status", active: true, title: "t" });
  await shell.deliver({ type: "say", text: "这人好装", late: null });
  await shell.deliver({ type: "say", text: "一".repeat(30), late: null });
  // 一次来两句：聊天记录里马上两条，弹幕先飘一条，第二条隔 1.6 秒再飘（同时飘好几条看不过来，她 10-21）
  const st0 = await shell.evaluateIn(hello.ref, "window.__wt.debugState()");
  assert.equal(st0.danmaku, 1);
  await new Promise((r) => setTimeout(r, 1800));
  const st = await shell.evaluateIn(hello.ref, "window.__wt.debugState()");
  assert.equal(st.danmaku, 2);   // 长的也飘成弹幕，不再有左下角小气泡
  assert.equal(st.log, 2);       // 抽屉里各留一份
  assert.equal(st.history, 2);

  // 输入条左边的点：大管家说叫不醒他，就变橙
  assert.equal(await shell.evaluateIn(hello.ref, "window.__wt.test.dot()"), "green");
  await shell.deliver({ type: "link", ok: false });
  assert.equal(await shell.evaluateIn(hello.ref, "window.__wt.test.dot()"), "orange");

  // 抽屉的样子：选米白底、点「票根」预设，会发给大管家存起来
  await shell.evaluateIn(hello.ref, "(window.__wt.test.openDrawer(true), window.__wt.test.clickBg(3), window.__wt.test.clickPreset(1))");
  const saved = await until(() => msgs.find((m) => m.type === "appearance_save"), 3000);
  assert.equal(saved.appearance.bg, "cream");
  assert.equal(saved.appearance.style.material, "solid");
  assert.equal(await shell.evaluateIn(hello.ref, "window.__wt.test.drawerBg()"), "rgb(233, 228, 220)");
  assert.equal(saved.appearance.mode, "light");   // 选米白就是浅色
  await shell.evaluateIn(hello.ref, "window.__wt.test.clickMode()");   // 右上角切回深色：米白跟着换成纯黑
  assert.equal(await shell.evaluateIn(hello.ref, "window.__wt.test.look().bg"), "black");
  await shell.deliver({ type: "appearance", appearance: { bg: "glass", style: null } });   // 新页面拿到存的样子
  assert.equal(await shell.evaluateIn(hello.ref, "window.__wt.test.look().bg"), "glass");
  await shell.evaluateIn(hello.ref, "window.__wt.test.openDrawer(false)");

  // 观影卡：接着看的提示、跳到绝对位置、收卡面板发出的 wrap_up
  await shell.deliverTo(hello.ref, { type: "resume_offer", at_sec: 3, at: "0:03", title: "t" });
  assert.equal(await shell.evaluateIn(hello.ref, "window.__wt.test.resumeShown()"), true);
  // 那张条自己跳过去（不用她点），不开场；开场是她按「一起看」，这时带上 resumed_from
  const jumped = await until(async () => { const r = await shell.probe(); return r.time >= 2.5 && r.time < 9 && r; });
  assert.ok(jumped);
  assert.ok(!msgs.some((m) => m.type === "start_request"));
  await shell.evaluateIn(hello.ref, "window.__wt.test.clickStart()");
  const startMsg = await until(() => msgs.find((m) => m.type === "start_request"));
  assert.equal(startMsg.resumed_from, 3);
  assert.ok(startMsg.url.includes("inner.html"));
  await shell.deliver({ type: "control", action: "seek_to", at: 12 });
  const sought = await until(async () => { const r = await shell.probe(); return r.time >= 11.5 && r.time < 16 && r; });
  assert.ok(sought);
  // 说晚了的弹幕带「⏪ 0:02」小签，点一下跳回那一帧
  await shell.deliver({ type: "say", text: "刚才那个镜头", late: "0:02", late_sec: 2 });
  await shell.evaluateIn(hello.ref, "window.__wt.test.clickLateTag()");
  const back = await until(async () => { const r = await shell.probe(); return r.time < 6 && r; });
  assert.ok(back);

  // 收卡票根：勾句子、点星星换主图
  await shell.evaluateIn(hello.ref, "(window.__wt.test.openWrap(), window.__wt.test.pickAll())");
  assert.equal(await shell.evaluateIn(hello.ref, "window.__wt.test.pickCountText()"), "这一场 3 句 · 选了 3 句");
  assert.ok(await until(() => msgs.find((m) => m.type === "wrap_open")));
  await shell.deliver({ type: "wrap_frames", frames: [{ id: "f1", at: "0:01", image: "" }, { id: "f2", at: "0:09", image: "" }] });
  assert.equal(await shell.evaluateIn(hello.ref, "window.__wt.test.shotCount()"), 2);
  await shell.evaluateIn(hello.ref, "(window.__wt.test.starShot(1), window.__wt.test.submitWrap(true))");
  const wrap = await until(() => msgs.find((m) => m.type === "wrap_up"));
  assert.equal(wrap.finished, true);
  assert.equal(wrap.cover, "f2");
  assert.equal(wrap.picked.length, 3);
  assert.equal(wrap.picked[0].who, "him");
  assert.equal(wrap.picked[2].at, 2);   // 说晚了的那句记的是他说的那一刻

  // 找字幕：候选列出来，点一条把 id 交回大管家
  await shell.evaluateIn(hello.ref, "window.__wt.test.findSubs('The Devil Wears Prada')");
  assert.ok(await until(() => msgs.find((m) => m.type === "subtitles_search" && m.query === "The Devil Wears Prada")));
  await shell.deliver({ type: "subtitle_candidates", query: "x", items: [{ id: "77", name: "BluRay.1080p", year: 2006, hi: true, downloads: 535322 }] });
  const items = await shell.evaluateIn(hello.ref, "window.__wt.test.subItems()");
  assert.equal(items.length, 1);
  assert.match(items[0], /BluRay\.1080p/);
  assert.match(items[0], /SDH/);
  assert.match(items[0], /53\.5 万次下载/);
  await shell.evaluateIn(hello.ref, "window.__wt.test.pickSub(0)");
  assert.ok(await until(() => msgs.find((m) => m.type === "subtitles_pick" && m.id === "77")));

  await shell.deliver({ type: "control", action: "pause" });
  const paused = await until(async () => (await shell.probe()).paused);
  assert.equal(paused, true);
  shell.close();
});

test("finds a playing video even when the page clears every timer (like Douyin), prefers the playing one", { skip }, async () => {
  const shell = new ChromeShell({ chromeUrl });
  const hellos = [];
  shell.onMessage((m) => { if (m.msg.type === "hello") hellos.push(m); });
  await shell.connect();
  await fetch(`${chromeUrl}/json/new?http://127.0.0.1:${innerPort}/cleared.html`, { method: "PUT" });
  const hello = await until(() => hellos.find((h) => h.msg.url.includes("cleared.html")));
  shell.setActive(hello.ref);
  // 先认到的可能是那个预加载、暂停着的；1.5 秒后另一个开播（定时器早被清光了），得靠视频事件换过去
  const playing = await until(() => shell.evaluateIn(hello.ref, "(() => { const p = window.__wt.probe(); return p.ok && !p.paused; })()"), 8000);
  assert.equal(playing, true);
  shell.close();
});

test("ignores a bigger video that is playing off-screen (Douyin preloads the next one)", { skip }, async () => {
  const shell = new ChromeShell({ chromeUrl });
  const hellos = [];
  shell.onMessage((m) => { if (m.msg.type === "hello") hellos.push(m); });
  await shell.connect();
  await fetch(`${chromeUrl}/json/new?http://127.0.0.1:${innerPort}/offscreen.html`, { method: "PUT" });
  const hello = await until(() => hellos.find((h) => h.msg.url.includes("offscreen.html")));
  const left = await until(() => shell.evaluateIn(hello.ref,
    "(() => { const h = document.querySelector('wt-host'); return h && parseFloat(h.style.left) === 20 ? 20 : 0; })()"), 5000);
  assert.equal(left, 20);   // 弹幕层贴在屏幕里那条（left:20px）上，不是屏幕外那条
  shell.close();
});


test("opens a tab when the phone asks the Mac to carry on", { skip }, async () => {
  const shell = new ChromeShell({ chromeUrl });
  const hellos = [];
  shell.onMessage((m) => { if (m.msg.type === "hello") hellos.push(m); });
  await shell.connect();
  assert.equal(await shell.openTab(`http://127.0.0.1:${innerPort}/inner.html?from=phone`), true);
  const hello = await until(() => hellos.find((h) => h.msg.url.includes("from=phone")));
  assert.ok(hello);
  shell.close();
});

test("ears: the core keeps recent sound from the video (even muted) and hands it over", { skip }, async () => {
  const shell = new ChromeShell({ chromeUrl });
  const hellos = [], msgs = [];
  shell.onMessage((m) => { msgs.push(m.msg); if (m.msg.type === "hello") hellos.push(m); });
  await shell.connect();
  await fetch(`${chromeUrl}/json/new?http://127.0.0.1:${innerPort}/audio.html`, { method: "PUT" });
  const hello = await until(() => hellos.find((h) => h.msg.url.includes("audio.html")));
  shell.setActive(hello.ref);
  await shell.deliver({ type: "status", active: true, title: "t", ears_available: true, ears: true, ears_clip_sec: 5 });
  const st = await until(async () => { const x = await shell.evaluateIn(hello.ref, "window.__wt.test.earsState()"); return x.clips.length && x; }, 20000);
  assert.equal(st.row, true);
  assert.ok(st.clips[0].bytes > 5000 && st.clips[0].dur >= 4);
  await shell.deliver({ type: "ears_get", id: 9 });
  const got = await until(() => msgs.find((m) => m.type === "ears_clip" && m.id === 9));
  assert.ok(got.clips[0].b64.length > 5000);
  assert.equal(got.clips[0].mime, "audio/webm");
  shell.close();
});

test("browse together on a page with no video: 一起逛, hands off by default, then scroll and a real click", { skip }, async () => {
  const shell = new ChromeShell({ chromeUrl });
  const hellos = [], msgs = [];
  shell.onMessage((m) => { msgs.push(m.msg); if (m.msg.type === "hello") hellos.push(m); });
  await shell.connect();
  await fetch(`${chromeUrl}/json/new?http://127.0.0.1:${innerPort}/plain.html`, { method: "PUT" });
  const hello = await until(() => hellos.find((h) => h.msg.url.includes("plain.html") && h.msg.page));
  shell.setActive(hello.ref);
  assert.equal(await shell.evaluateIn(hello.ref, "window.__wt.test.pageMode()"), true);
  const p = await shell.probe();
  assert.equal(p.page, true);
  assert.equal(p.scroll.y, 0);
  await shell.deliver({ type: "status", active: true, title: "一页漫画", mode: "page", hands: false });
  await shell.deliver({ type: "control", action: "scroll", by: "page" });
  await sleep(600);
  assert.equal((await shell.probe()).scroll.y, 0);                 // 没开「让他动手」：不动
  await shell.evaluateIn(hello.ref, "window.__wt.test.setHands(true)");
  assert.ok(await until(() => msgs.find((m) => m.type === "settings" && m.hands === true)));
  await shell.deliver({ type: "control", action: "scroll", by: "page" });
  assert.ok(await until(async () => (await shell.probe()).scroll.y > 200));
  await shell.evaluateIn(hello.ref, "window.scrollTo(0, 0)");
  await sleep(300);
  // Chrome 的真点击：按钮在 (100..220, 100..160)，点它中间
  const vp = await shell.evaluateIn(hello.ref, "[innerWidth, innerHeight]");
  assert.equal(await shell.click(160 / vp[0], 130 / vp[1]), true);
  assert.equal(await until(() => shell.evaluateIn(hello.ref, "window.__clicked")), 1);
  shell.close();
});
