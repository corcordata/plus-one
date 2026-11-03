#!/usr/bin/env node
// 一行装好：node launcher/install.js [install|uninstall|status] [--dry-run]
// - 第一次装：写 ~/.plus-one/config.json 模板（manage_chrome: true = 大管家帮你看住专属 Chrome）
// - Mac：~/Library/LaunchAgents/app.plus-one.butler.plist（开机自启、挂了自己爬起来）
// - Windows：任务计划「plus-one」，登录时跑 launcher/supervise.js（它再看住大管家）
// - 日志：~/.plus-one/butler.log（大管家自己控制在 2MB 以内）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { configPath, DEFAULTS } from "../butler/config.js";

export const LABEL = "app.plus-one.butler";
export const TASK = "plus-one";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 写进自启设置的 node 要用不会变的那个路径：Homebrew 的 process.execPath 是带版本号的
// （/opt/homebrew/Cellar/node/26.4.0/bin/node），一升级就没了
export function stableNode(execPath = process.execPath, exists = fs.existsSync, real = fs.realpathSync) {
  const candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
  let mine = execPath;
  try { mine = real(execPath); } catch { /* 用原样 */ }
  for (const c of candidates) {
    try { if (exists(c) && real(c) === mine) return c; } catch { /* 下一个 */ }
  }
  return execPath;
}

export function logPath(home = os.homedir()) {
  return path.join(home, ".plus-one", "butler.log");
}

export function launchdPlist({ node = stableNode(), root = ROOT, log = logPath() } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(node)}</string>
        <string>${xml(path.join(root, "butler", "main.js"))}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict><key>PLUS_ONE_LOG</key><string>${xml(log)}</string></dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>StandardOutPath</key><string>${xml(log)}</string>
    <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

// Windows：登录时启动；cmd /c 把输出接到日志里
export function schtasksArgs({ node = process.execPath, root = ROOT, log = logPath() } = {}) {
  const run = `cmd /c ""${node}" "${path.win32.join(root, "launcher", "supervise.js")}" >> "${log}" 2>&1"`;
  return ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", TASK, "/TR", run];
}

export function configTemplate() {
  return { ...DEFAULTS, manage_chrome: true, appearance: undefined };
}

function plistFile(home = os.homedir()) {
  return path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
}

function sh(cmd, args, dry) {
  if (dry) { console.log(`  会运行：${cmd} ${args.join(" ")}`); return ""; }
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return String(e.stderr || e.message); }
}

function write(file, content, dry, mode) {
  if (dry) { console.log(`  会写：${file}\n${content.split("\n").map((l) => "    " + l).join("\n")}`); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
}

export function install({ dry = false, platform = process.platform } = {}) {
  const cfg = configPath();
  if (!fs.existsSync(cfg)) {
    write(cfg, JSON.stringify(configTemplate(), null, 2) + "\n", dry, 0o600);
    console.log(`写好了设置模板 ${cfg}——把 wake_url / key 填上（见 docs/wake-interface.md）。`);
  } else {
    console.log(`设置已经有了：${cfg}（没动它）`);
  }
  if (platform === "darwin") {
    const uid = process.getuid?.() ?? 501;
    sh("launchctl", ["bootout", `gui/${uid}/${LABEL}`], dry);
    write(plistFile(), launchdPlist(), dry);
    sh("launchctl", ["bootstrap", `gui/${uid}`, plistFile()], dry);
    console.log("装好了：开机自启，挂了自己爬起来。看状态：node launcher/install.js status");
  } else if (platform === "win32") {
    sh("schtasks", schtasksArgs(), dry);
    sh("schtasks", ["/Run", "/TN", TASK], dry);
    console.log("装好了：登录时自启（任务计划「plus-one」）。看状态：node launcher/install.js status");
  } else {
    console.log("这个系统还没有自启脚本：先手动跑 node launcher/supervise.js（它会看住大管家、帮你拉 Chrome）。");
  }
}

export function uninstall({ dry = false, platform = process.platform } = {}) {
  if (platform === "darwin") {
    sh("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${LABEL}`], dry);
    if (!dry) fs.rmSync(plistFile(), { force: true });
  } else if (platform === "win32") {
    sh("schtasks", ["/End", "/TN", TASK], dry);
    sh("schtasks", ["/Delete", "/F", "/TN", TASK], dry);
  }
  console.log("卸掉了自启（设置和观影备份都还在 ~/.plus-one/）。");
}

export async function status() {
  let port = DEFAULTS.status_port;
  try { port = JSON.parse(fs.readFileSync(configPath(), "utf8")).status_port || port; } catch { /* 用默认的 */ }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    const h = await res.json();
    console.log(`大管家：在　Chrome：${h.chrome ? "连上了" : "没连上"}　叫醒地址：${h.wake_url_set ? "填了" : "还没填"}　正在一起看：${h.active ? h.title : "没有"}`);
    if (h.last_error) console.log(`最近的错：${h.last_error}`);
  } catch {
    console.log("大管家不在（或者还没起来）。装了自启的话等十几秒再看；日志在 " + logPath());
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2] || "install";
  const dry = process.argv.includes("--dry-run");
  if (cmd === "install") install({ dry });
  else if (cmd === "uninstall") uninstall({ dry });
  else if (cmd === "status") await status();
  else console.log("用法：node launcher/install.js [install|uninstall|status] [--dry-run]");
}
