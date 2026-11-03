import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../core/core.js", import.meta.url), "utf8");

test("core runs harmlessly without a DOM and exposes its pure helpers", () => {
  const sandbox = {};
  vm.runInNewContext(src, sandbox);
  const lib = sandbox.__wtCoreLib;
  // 他的话一律飘：长句飘得慢一点，但不会慢到拖过半分钟
  assert.equal(lib.flySpeed(5), lib.flySpeed(20));
  assert.ok(lib.flySpeed(80) < lib.flySpeed(20));
  assert.equal(lib.flySpeed(300), lib.flySpeed(1000));
  assert.ok(lib.FLY_MAX_MS <= 30000);
  // 手机窄画面：短弹幕也要飘七八秒，看得清；Mac 宽屏速度不变
  assert.ok(lib.flyDuration(400, 220, 10) >= 7000);
  assert.equal(lib.flyDuration(1280, 220, 10), (1280 + 220) / lib.flySpeed(10));
  assert.ok(lib.flyDuration(400, 2000, 120) <= lib.FLY_MAX_MS);
  // 视频比屏幕高：弹幕层只铺露出来的那块，输入条不会掉到屏幕外
  const tall = lib.visibleRect({ left: 0, top: -100, right: 390, bottom: 1100, width: 390, height: 1200 }, 390, 844);
  assert.equal(JSON.stringify(tall), JSON.stringify({ left: 0, top: 0, width: 390, height: 844 }));
  const inside = lib.visibleRect({ left: 20, top: 40, right: 660, bottom: 400, width: 640, height: 360 }, 1280, 760);
  assert.equal(JSON.stringify(inside), JSON.stringify({ left: 20, top: 40, width: 640, height: 360 }));
  assert.equal(lib.tc(482), "8:02");
  assert.equal(lib.pickCount(23, 2), "这一场 23 句 · 选了 2 句");
});

test("drawer bubbles: default glass is the canvas look; custom styles follow the host app's knobs", () => {
  const sandbox = {};
  vm.runInNewContext(src, sandbox);
  const { bubbleLook, SEED, normStyle, normLook, defaultLook, sameStyle } = sandbox.__wtCoreLib;
  const her = bubbleLook(null, true), him = bubbleLook(null, false);
  assert.equal(her.background, "rgba(255,255,255,.92)");
  assert.equal(him.color, "#ffe7b5");
  assert.equal(him.borderRadius, "16px 16px 16px 4px");   // 尾巴在他那侧
  // 浅色模式：没自己改过字色的，一律深字
  assert.equal(bubbleLook(null, false, true).color, "#1c1c1e");

  const glass = bubbleLook({ ...SEED }, false);
  assert.match(glass.backdropFilter, /blur\(10px\)/);
  assert.match(glass.background, /border-box$/);           // 边框光
  assert.equal(glass.border, "1px solid transparent");
  assert.equal(glass.color, "#ffffff");                     // 深色模式没指定字色 = 浅字，不替她猜
  assert.equal(bubbleLook({ ...SEED }, false, true).color, "#1c1c1e");
  const solid = bubbleLook({ ...SEED, material: "solid", tail: false, cornerRadius: 8, length: 60 }, true);
  assert.equal(solid.borderRadius, "8px 8px 8px 8px");
  assert.equal(solid.maxWidth, "calc(100% - 0px)");
  assert.equal(solid.color, "#111111");                     // 她指定的字色优先
  assert.equal(normStyle({ cornerRadius: 1, material: "neon" }).cornerRadius, 4);
  assert.equal(normStyle({ material: "neon" }).material, "glass");

  const d = defaultLook();
  assert.equal(d.style, null);
  assert.equal(d.presets[0].name, "票根");                  // 开源自带一套
  assert.equal(normLook({ bg: "photo:0", photos: [] }).bg, "glass");
  assert.equal(normLook({ bg: "cream" }).mode, "light");
  assert.equal(normLook({ bg: "glass", mode: "light" }).mode, "light");
  assert.ok(sameStyle(normStyle(d.presets[0].style), d.presets[0].style));
});

test("running twice is a no-op", () => {
  const sandbox = {};
  vm.runInNewContext(src, sandbox);
  const first = sandbox.__wtCoreLib;
  vm.runInNewContext(src, sandbox);
  assert.equal(sandbox.__wtCoreLib, first);
});

test("shotPoint maps a screenshot fraction through the zoomed visual viewport", () => {
  const sandbox = {};
  vm.runInNewContext(src, sandbox);
  const lib = sandbox.__wtCoreLib;
  const J = (o) => JSON.stringify(o);   // 沙盒里的对象跟这边不是同一套 Object，按内容比
  // 没放大：按整个窗口
  assert.equal(J(lib.shotPoint(0.5, 0.3, null, 400, 800)), J({ x: 200, y: 240 }));
  // iOS 点输入框放大了：截图只拍到眼前那一块（从 120,300 起、宽 200 高 400）
  assert.equal(J(lib.shotPoint(0.5, 0.25, { offsetLeft: 120, offsetTop: 300, width: 200, height: 400 }, 400, 800)), J({ x: 220, y: 400 }));
  // 越界的夹回 0~1
  assert.equal(J(lib.shotPoint(1.5, -1, null, 400, 800)), J({ x: 400, y: 0 }));
});
