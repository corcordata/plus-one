import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeAppearance, sanitizeStyle } from "../butler/appearance.js";

test("bubble style is clamped to the same ranges as the host app's settings page", () => {
  const s = sanitizeStyle({ material: "plastic", cornerRadius: 99, spacing: 0, length: 70, transparency: 2, colorMu: "#fff", textMine: "a1b2c3" });
  assert.equal(s.material, "glass");
  assert.equal(s.cornerRadius, 24);
  assert.equal(s.spacing, 2);
  assert.equal(s.length, 60);
  assert.equal(s.transparency, 0.95);
  assert.equal(s.colorMu, null);
  assert.equal(s.textMine, "A1B2C3");
  assert.equal(sanitizeStyle(null), null);
});

test("appearance keeps at most four photos, three preset slots, and a valid background", () => {
  const big = "data:image/jpeg;base64," + "A".repeat(700000);
  const a = sanitizeAppearance({ bg: "photo:1", photos: ["data:image/jpeg;base64,A", big, "https://evil", "data:image/png;base64,B"], presets: [null, { style: {} }] });
  assert.equal(a.photos.length, 2);
  assert.equal(a.bg, "photo:1");
  assert.equal(a.presets.length, 3);
  assert.equal(a.presets[1].name, "未命名");
  assert.equal(sanitizeAppearance({ bg: "neon" }).bg, "glass");
});
