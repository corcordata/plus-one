#!/usr/bin/env node
// Windows 的看门狗另一半：任务计划只负责开机时把它拉起来，它再看住大管家——挂了就重开，
// 越挂越慢重开（1 秒起，最多 1 分钟），稳定跑过 5 分钟就清零。Mac 不用它，launchd 的 KeepAlive 就是这个。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "butler", "main.js");

export function nextDelay(prev, ranForMs) {
  if (ranForMs > 5 * 60_000) return 1000;
  return Math.min(60_000, Math.max(1000, prev * 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let delay = 1000;
  const run = () => {
    const started = Date.now();
    const child = spawn(process.execPath, [MAIN], { stdio: "inherit" });
    child.on("exit", (code) => {
      delay = nextDelay(delay, Date.now() - started);
      console.log(`[supervise] 大管家退出了（${code}），${Math.round(delay / 1000)} 秒后重开`);
      setTimeout(run, delay);
    });
  };
  run();
}
