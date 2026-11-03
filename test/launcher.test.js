import { test } from "node:test";
import assert from "node:assert/strict";
import { chromeCommand, chromePort, ChromeKeeper, LAUNCH_COOLDOWN_MS, windowsChromeCandidates } from "../launcher/chrome.js";
import { launchdPlist, schtasksArgs, configTemplate, LABEL, stableNode } from "../launcher/install.js";
import { nextDelay } from "../launcher/supervise.js";

test("dedicated Chrome command per system: Mac opens a new instance without stealing focus", () => {
  const mac = chromeCommand({ platform: "darwin", port: 9223, profileDir: "/p" });
  assert.equal(mac.cmd, "open");
  assert.deepEqual(mac.args.slice(0, 5), ["-g", "-n", "-a", "Google Chrome", "--args"]);
  assert.ok(mac.args.includes("--remote-debugging-port=9223"));
  assert.ok(mac.args.includes("--user-data-dir=/p"));
  const env = { PROGRAMFILES: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" };
  const want = windowsChromeCandidates(env)[1];
  const win = chromeCommand({ platform: "win32", port: 9300, profileDir: "C:\\p", env, exists: (p) => p === want });
  assert.equal(win.cmd, want);
  assert.ok(win.args.includes("--remote-debugging-port=9300"));
  assert.equal(chromeCommand({ platform: "win32", env, exists: () => false }), null);
  assert.equal(chromePort("http://127.0.0.1:9333"), 9333);
});

test("the keeper only launches when asked to manage Chrome, and at most once a minute", async () => {
  let t = 0, up = false;
  const runs = [];
  const k = new ChromeKeeper({ config: { chrome_url: "http://127.0.0.1:9223", manage_chrome: false }, now: () => t,
    alive: async () => up, run: (cmd, args) => runs.push([cmd, args]), platform: "darwin" });
  assert.equal(await k.ensure(), "not-managed");   // 她自己有看门脚本的，大管家不插手
  k.config.manage_chrome = true;
  assert.equal(await k.ensure(), "launched");
  t += 15_000;
  assert.equal(await k.ensure(), "cooling");        // Chrome 起来要几秒，别再开一只
  t += LAUNCH_COOLDOWN_MS;
  assert.equal(await k.ensure(), "launched");
  up = true;
  assert.equal(await k.ensure(), "alive");
  assert.equal(runs.length, 2);
});

test("installer: launchd keeps the butler alive; Windows runs the supervisor at logon", () => {
  const plist = launchdPlist({ node: "/opt/node", root: "/x/plus-one", log: "/h/.plus-one/butler.log" });
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<string>\/x\/plus-one\/butler\/main\.js<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /PLUS_ONE_LOG/);
  const args = schtasksArgs({ node: "C:\\node\\node.exe", root: "C:\\plus-one", log: "C:\\u\\.plus-one\\butler.log" });
  assert.deepEqual(args.slice(0, 7), ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN"]);
  assert.match(args.at(-1), /supervise\.js/);
  assert.equal(configTemplate().manage_chrome, true);
});

test("supervisor backs off when the butler keeps crashing, resets after a good run", () => {
  assert.equal(nextDelay(1000, 500), 2000);
  assert.equal(nextDelay(32_000, 500), 60_000);
  assert.equal(nextDelay(60_000, 500), 60_000);
  assert.equal(nextDelay(60_000, 6 * 60_000), 1000);
});

test("autostart uses the node path that survives a Homebrew upgrade", () => {
  const cellar = "/opt/homebrew/Cellar/node/26.4.0/bin/node";
  const real = (p) => (p === "/opt/homebrew/bin/node" ? cellar : p);
  assert.equal(stableNode(cellar, (p) => p === "/opt/homebrew/bin/node", real), "/opt/homebrew/bin/node");
  assert.equal(stableNode("/weird/node", () => false, real), "/weird/node");
});
