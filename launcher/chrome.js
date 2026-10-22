// 专属 Chrome：不在就拉起来（看门狗的一半；另一半是系统把大管家本身看住，见 install.js）。
// 踩过的坑都写死在这里：
// - Mac 上她平时的 Chrome 开着时，`open -a` 只会把那个叫到前面、参数全丢，专属的永远起不来 → 要 -n
// - 别抢焦点：她可能正在干别的 → Mac 用 -g
// - 一分钟内只拉一次：Chrome 起来要几秒，别一轮没连上就再开一只
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export const LAUNCH_COOLDOWN_MS = 60_000;

export function chromePort(chromeUrl) {
  try { return Number(new URL(chromeUrl).port) || 9223; } catch { return 9223; }
}

export function defaultProfileDir() {
  return path.join(os.homedir(), ".plus-one", "chrome-profile");
}

// Windows 上 Chrome 可能装在三个地方之一
export function windowsChromeCandidates(env = process.env) {
  const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
  return roots.map((r) => path.win32.join(r, "Google", "Chrome", "Application", "chrome.exe"));
}

// 每个系统怎么开一只专属 Chrome：返回 { cmd, args } 或 null（找不到 Chrome）
export function chromeCommand({ platform = process.platform, port = 9223, profileDir = defaultProfileDir(),
  exists = fs.existsSync, env = process.env } = {}) {
  const flags = [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check"];
  if (platform === "darwin") return { cmd: "open", args: ["-g", "-n", "-a", "Google Chrome", "--args", ...flags] };
  if (platform === "win32") {
    const exe = windowsChromeCandidates(env).find((p) => exists(p));
    return exe ? { cmd: exe, args: flags } : null;
  }
  const exe = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => exists(p));
  return exe ? { cmd: exe, args: flags } : null;
}

export async function chromeAlive(chromeUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(new URL("/json/version", chromeUrl), { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// 看门：活着就不管；不在、开着「帮我拉 Chrome」、离上次拉过了一分钟 → 拉一只
export class ChromeKeeper {
  constructor({ config, log = () => {}, now = () => Date.now(), alive = chromeAlive, run = defaultRun, platform = process.platform } = {}) {
    this.config = config;
    this.log = log;
    this.now = now;
    this.alive = alive;
    this.run = run;
    this.platform = platform;
    this.lastLaunch = -Infinity;
  }

  async ensure() {
    if (await this.alive(this.config.chrome_url)) return "alive";
    if (!this.config.manage_chrome) return "not-managed";
    if (this.now() - this.lastLaunch < LAUNCH_COOLDOWN_MS) return "cooling";
    const c = chromeCommand({ platform: this.platform, port: chromePort(this.config.chrome_url),
      profileDir: this.config.chrome_profile || defaultProfileDir() });
    if (!c) { this.log("找不到 Chrome——装了 Google Chrome 吗？"); return "no-chrome"; }
    this.lastLaunch = this.now();
    this.log(`专属 Chrome 不在，拉一只（端口 ${chromePort(this.config.chrome_url)}）`);
    this.run(c.cmd, c.args);
    return "launched";
  }
}

function defaultRun(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
