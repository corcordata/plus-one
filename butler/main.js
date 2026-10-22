#!/usr/bin/env node
// 大管家入口：连上专属 Chrome、守着一场陪看、按门铃、取他的回复、开健康灯。
// Chrome 断了每 15 秒重连一次；Chrome 不在不影响健康灯（灯会显示 chrome: false）。
import { loadConfig, saveConfig } from "./config.js";
import { WatchSession } from "./session.js";
import { sendWake, pollReplies, pollCommands } from "./wake-client.js";
import { startStatusServer } from "./status-server.js";
import { ChromeShell } from "../shell-chrome/shell.js";
import { FilmStore } from "./films.js";
import { ChromeKeeper } from "../launcher/chrome.js";
import fs from "node:fs";

const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const config = loadConfig();
let shell = null;

const shellProxy = {
  setActive: (ref) => shell?.setActive(ref),
  deliver: async (m) => (shell ? shell.deliver(m) : false),
  deliverTo: async (ref, m) => (shell ? shell.deliverTo(ref, m) : false),
  probe: async () => (shell ? shell.probe() : { ok: false, why: "chrome offline" }),
  capture: async () => (shell ? shell.capture() : null),
  pageUrl: async (ref) => (shell ? shell.pageUrl(ref) : ""),
  openTab: async (url) => (shell ? shell.openTab(url) : false),
  click: async (x, y) => (shell ? shell.click(x, y) : false),
};

const wake = {
  send: (g) => sendWake({ wakeUrl: config.wake_url, key: config.key }, g),
  poll: (s, after) => pollReplies({ repliesUrl: config.replies_url, key: config.key }, s, after),
};

const session = new WatchSession({
  shell: shellProxy, wake, config, log, films: new FilmStore(),
  onSettings: (patch) => { Object.assign(config, patch); saveConfig(patch); },
});

const keeper = new ChromeKeeper({ config, log });

// 日志别无限涨：超过 2MB 只留最后 200 行（launchd / 任务计划是追加写的，就地截短安全）
function trimLog() {
  const file = process.env.PLUS_ONE_LOG;
  if (!file) return;
  try {
    if (fs.statSync(file).size <= 2 * 1024 * 1024) return;
    const tail = fs.readFileSync(file, "utf8").split("\n").slice(-200).join("\n");
    fs.writeFileSync(file, tail);
  } catch { /* 没日志文件就算了 */ }
}
trimLog();
setInterval(trimLog, 10 * 60 * 1000);

async function ensureShell() {
  if (shell && !shell.closed) return;
  await keeper.ensure().catch((e) => log(`chrome keeper: ${e.message}`));
  try {
    const s = new ChromeShell({ chromeUrl: config.chrome_url, log });
    s.onMessage((m) => session.handleCoreMessage(m).catch((e) => log(`core message: ${e.message}`)));
    await s.connect();
    shell = s;
    session.shellReconnected();   // 旧连接上的框号全作废；正在看的那页再来一条消息就认回来
    log(`connected to Chrome at ${config.chrome_url}`);
  } catch (e) {
    shell = null;
    log(`Chrome not reachable: ${e.message}`);
  }
}

if (!config.wake_url) log("还没填 wake_url——弹幕不会有人回。先跑 tools/fake-frontend.js 试试？");
await ensureShell();
setInterval(ensureShell, 15000);
setInterval(() => session.tick().catch((e) => log(`tick: ${e.message}`)), config.probe_sec * 1000);
setInterval(() => session.pollOnce().catch((e) => log(`poll: ${e.message}`)), 1000);
// 手机那边叫电脑做的事：没在陪看也要听（3 秒问一次中继）
let commandCursor = 0;
let lastCommandError = "";
setInterval(async () => {
  if (!config.commands_url) return;
  try {
    const { commands, freshSec } = await pollCommands({ commandsUrl: config.commands_url, key: config.key }, commandCursor);
    for (const c of commands) {
      commandCursor = Math.max(commandCursor, c.id);
      await session.handleCommand(c, freshSec);
    }
    lastCommandError = "";
  } catch (e) {
    // 中继还没这个口子（老版本 404）或者断网：同一个错只记一次，别每 3 秒刷一行
    if (e.message !== lastCommandError) log(`commands: ${e.message}`);
    lastCommandError = e.message;
  }
}, 3000);
startStatusServer({ port: config.status_port, getStatus: () => ({ chrome: !!shell && !shell.closed, ...session.status() }) });
log(`health on http://127.0.0.1:${config.status_port}/health`);
