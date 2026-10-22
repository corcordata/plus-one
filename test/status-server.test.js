import { test } from "node:test";
import assert from "node:assert/strict";
import { startStatusServer } from "../butler/status-server.js";

test("/health returns the status JSON, anything else 404", async () => {
  const s = startStatusServer({ port: 0, getStatus: () => ({ chrome: true, active: false }) });
  await new Promise((r) => s.once("listening", r));
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { chrome: true, active: false });
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  } finally { s.close(); }
});
