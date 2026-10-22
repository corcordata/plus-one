// 大管家的设置：~/.plus-one/config.json。钥匙只存在这台电脑上。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULTS = {
  chrome_url: "http://127.0.0.1:9223",
  wake_url: "",
  replies_url: "",
  key: "",
  interval_sec: 180,
  frame_mode: "auto",
  probe_sec: 5,
  status_port: 8790,
  manage_chrome: false, // true = 专属 Chrome 不在时大管家自己拉一只（launcher/install.js 装的默认开）
  chrome_profile: "",   // 专属 Chrome 的档案夹；空 = ~/.plus-one/chrome-profile
  subtitle_lang: "eng", // 找字幕用哪种语言（opensubtitles 的三字母代码：eng / chi / jpn …）
  gemini_key: "",       // 填了才有耳朵：声音一段段送 Google 听（免费版数据可能被拿去训练，自己决定）
  ears: true,           // 有 key 时默认开；抽屉里能关
  gemini_models: [],    // 空 = ears.js 里的默认那几个，一个限流就换下一个
  hands: false,         // 「一起逛」时让他动手（滑、点、走棋）；默认关，抽屉里开
  handle: false,        // 手机上输入条藏起来后留个把手（一点画面就暂停的站用）；默认关，抽屉里开
  sync_chat: false,     // 她和他看片时说的话要不要也进前端的聊天记录（前端自己决定显不显示）
  appearance: null,     // 抽屉的样子，见 appearance.js；null = 开源自带的默认（液态玻璃）
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function configPath() {
  return process.env.PLUS_ONE_CONFIG || path.join(os.homedir(), ".plus-one", "config.json");
}

function readRaw(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

export function loadConfig(file = configPath()) {
  const c = { ...DEFAULTS, ...readRaw(file) };
  c.interval_sec = clamp(Number(c.interval_sec) || DEFAULTS.interval_sec, 30, 900);
  c.probe_sec = clamp(Number(c.probe_sec) || DEFAULTS.probe_sec, 2, 30);
  c.frame_mode = c.frame_mode === "pick" ? "pick" : "auto";
  c.sync_chat = c.sync_chat === true;
  c.manage_chrome = c.manage_chrome === true;
  c.hands = c.hands === true;
  c.handle = c.handle === true;
  if (!c.replies_url && c.wake_url) c.replies_url = c.wake_url.replace(/\/wake\/?$/, "/replies");
  if (!c.commands_url && c.wake_url) c.commands_url = c.wake_url.replace(/\/wake\/?$/, "/commands");
  return c;
}

export function saveConfig(patch, file = configPath()) {
  const next = { ...readRaw(file), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
}
