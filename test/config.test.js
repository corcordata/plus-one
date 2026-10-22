import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig, DEFAULTS } from "../butler/config.js";

test("defaults, clamps and derived replies_url", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-cfg-"));
  const file = path.join(dir, "config.json");
  assert.deepEqual(loadConfig(file), { ...DEFAULTS });
  fs.writeFileSync(file, JSON.stringify({ wake_url: "https://x.example/watch/wake", interval_sec: 5, frame_mode: "weird", probe_sec: 99 }));
  const c = loadConfig(file);
  assert.equal(c.replies_url, "https://x.example/watch/replies");
  assert.equal(c.interval_sec, 30);
  assert.equal(c.frame_mode, "auto");
  assert.equal(c.probe_sec, 30);
  saveConfig({ interval_sec: 60 }, file);
  assert.equal(loadConfig(file).interval_sec, 60);
  assert.equal(loadConfig(file).wake_url, "https://x.example/watch/wake");
  fs.rmSync(dir, { recursive: true, force: true });
});
