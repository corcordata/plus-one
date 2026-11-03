#!/usr/bin/env node
// 把大管家的纯逻辑打成一个文件，给 iOS 的 JavaScriptCore 跑（「只写一份 JavaScript」）。
// 入口：ios/js/host.js（iOS 那头的适配：联网、截图、计时都交给 Swift），顺着 import 把
// butler/ 里用到的模块一个个包进来。碰到 node: 或者装的包就报错——那种模块在手机上跑不了，
// 得像 films / wake / shell 那样从外面递进去。
//
// 没用打包工具：这几个文件都是我们自己写的、格式规矩，几十行改写就够了，开源用户也不用多装东西。
// 同时把 core/core.js 原样拷进 Swift 包的资源里，iOS 那边注进网页的跟电脑上是同一份芯。
//
//   node tools/build-ios-bundle.js           生成
//   node tools/build-ios-bundle.js --check   只比对，不一样就退出码 1（测试里用）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "ios/js/host.js");
const RES = path.join(ROOT, "ios/Sources/PlusOne/Resources");
// 手机上换一份的模块：电脑版要 Node 的（解压、Buffer），手机版走 Swift 或者先不做
const ALIASES = {
  "butler/subfinder.js": "ios/js/subfinder.js",
};
const resolveAlias = (file) => (ALIASES[rel(file)] ? path.join(ROOT, ALIASES[rel(file)]) : file);

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?[ \t]*$/gm;
const ANY_IMPORT_RE = /^import\s[^;]*?from\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm;
const EXPORT_DECL_RE = /^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\};?[ \t]*$/gm;

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

// 一个模块改写成函数体：import 换成从 __req 取，export 去掉、末尾统一 return
export function transform(src, file) {
  for (const m of src.matchAll(ANY_IMPORT_RE)) {
    const spec = m[1] || m[2];
    if (!spec.startsWith(".")) throw new Error(`${rel(file)}: imports "${spec}" — only relative imports can run in JavaScriptCore`);
  }
  if (/^export\s+default\b/m.test(src)) throw new Error(`${rel(file)}: export default is not supported`);
  if (/^export\s*\*/m.test(src)) throw new Error(`${rel(file)}: export * is not supported`);
  if (/\bimport\s*\(/.test(src)) throw new Error(`${rel(file)}: dynamic import() is not supported`);
  if (/\bimport\.meta\b/.test(src)) throw new Error(`${rel(file)}: import.meta is not supported`);

  const deps = [];
  let out = src.replace(IMPORT_RE, (_, names, spec) => {
    const target = resolveAlias(path.resolve(path.dirname(file), spec));
    deps.push(target);
    const binds = names.split(",").map((s) => s.trim()).filter(Boolean)
      .map((s) => { const [a, b] = s.split(/\s+as\s+/); return b ? `${a.trim()}: ${b.trim()}` : a.trim(); });
    return `const { ${binds.join(", ")} } = __req(${JSON.stringify(rel(target))});`;
  });
  if (/^import\s/m.test(out)) throw new Error(`${rel(file)}: an import form the bundler does not understand`);

  const names = [];
  out = out.replace(EXPORT_DECL_RE, (_, kind, name) => { names.push(name); return `${kind} ${name}`; });
  out = out.replace(EXPORT_LIST_RE, (_, list) => {
    for (const s of list.split(",").map((x) => x.trim()).filter(Boolean)) {
      const [a, b] = s.split(/\s+as\s+/);
      names.push(b ? `${b.trim()}: ${a.trim()}` : a.trim());
    }
    return "";
  });
  if (/^export\s/m.test(out)) throw new Error(`${rel(file)}: an export form the bundler does not understand`);
  return { body: `${out}\nreturn { ${names.join(", ")} };`, deps, exports: names };
}

export function bundle(entry = ENTRY) {
  const order = [];
  const seen = new Map();
  const visit = (file, stack) => {
    if (seen.has(file)) return;
    if (stack.includes(file)) throw new Error(`import cycle: ${[...stack, file].map(rel).join(" → ")}`);
    if (!fs.existsSync(file)) throw new Error(`missing module ${rel(file)} (imported by ${rel(stack.at(-1) || entry)})`);
    const t = transform(fs.readFileSync(file, "utf8"), file);
    for (const d of t.deps) visit(d, [...stack, file]);
    seen.set(file, t);
    order.push(file);
  };
  visit(entry, []);
  const mods = order.map((f) => `__mods[${JSON.stringify(rel(f))}] = function (__req) {\n${seen.get(f).body}\n};`);
  return [
    "// 自动生成：node tools/build-ios-bundle.js。别手改——改 butler/ 或 ios/js/ 再重新生成。",
    "(function () {",
    "\"use strict\";",
    "const __mods = {};",
    "const __cache = {};",
    "function __req(id) {",
    "  if (__cache[id]) return __cache[id];",
    "  if (!__mods[id]) throw new Error(\"bundle: no module \" + id);",
    "  return (__cache[id] = __mods[id](__req));",
    "}",
    ...mods,
    `__req(${JSON.stringify(rel(entry))});`,
    "})();",
    "",
  ].join("\n");
}

export function outputs() {
  return {
    [path.join(RES, "butler.bundle.js")]: bundle(),
    [path.join(RES, "core.js")]: fs.readFileSync(path.join(ROOT, "core/core.js"), "utf8"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [file, text] of Object.entries(outputs())) {
    const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (old === text) continue;
    if (check) { console.error(`stale: ${rel(file)}`); stale += 1; continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`wrote ${rel(file)} (${Math.round(text.length / 1024)} KB)`);
  }
  if (check && stale) {
    console.error("run: node tools/build-ios-bundle.js");
    process.exit(1);
  }
}
