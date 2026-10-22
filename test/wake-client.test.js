import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { sendWake, pollReplies, pollCommands } from "../butler/wake-client.js";

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve({ s, base: `http://127.0.0.1:${s.address().port}` }));
  });
}
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

test("inline reply", async () => {
  let seen;
  const { s, base } = await server(async (req, res) => {
    seen = { auth: req.headers.authorization, body: JSON.parse(await readBody(req)) };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ say: "看到了", actions: ["pause"] }));
  });
  try {
    const out = await sendWake({ wakeUrl: `${base}/wake`, key: "k1" }, { session: "s", reason: "tick" });
    assert.equal(seen.auth, "Bearer k1");
    assert.equal(seen.body.reason, "tick");
    assert.equal(out.mode, "inline");
    assert.deepEqual(out.reply.say, ["看到了"]);
    assert.deepEqual(out.reply.actions, [{ type: "pause" }]);
  } finally { s.close(); }
});

test("202 means poll, and polling returns only newer replies", async () => {
  const { s, base } = await server(async (req, res) => {
    if (req.method === "POST") { await readBody(req); res.writeHead(202); res.end("{}"); return; }
    const u = new URL(req.url, base);
    assert.equal(u.searchParams.get("session"), "s9");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ replies: [{ id: 3, say: ["旧的"] }, { id: 5, say: ["新的"], next_look_in: 600 }] }));
  });
  try {
    assert.deepEqual(await sendWake({ wakeUrl: `${base}/wake`, key: "" }, {}), { mode: "poll" });
    const got = await pollReplies({ repliesUrl: `${base}/replies`, key: "" }, "s9", 3);
    assert.equal(got.length, 1);
    assert.equal(got[0].id, 5);
    assert.deepEqual(got[0].reply.say, ["新的"]);
    assert.equal(got[0].reply.nextLookIn, 600);
  } finally { s.close(); }
});

test("non-2xx throws", async () => {
  const { s, base } = await server((req, res) => { res.writeHead(401); res.end(); });
  try {
    await assert.rejects(sendWake({ wakeUrl: `${base}/wake`, key: "x" }, {}), /wake 401/);
  } finally { s.close(); }
});

test("phone commands: polled with the key, only newer ones come back", async () => {
  let seen;
  const { s, base } = await server(async (req, res) => {
    seen = { auth: req.headers.authorization, url: req.url };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ commands: [{ id: 4, action: "open", url: "https://x/1" }, { id: 7, action: "open", url: "https://x/2" }], fresh_sec: 90 }));
  });
  try {
    const out = await pollCommands({ commandsUrl: `${base}/watch/commands`, key: "k1" }, 5);
    assert.equal(seen.auth, "Bearer k1");
    assert.match(seen.url, /after=5/);
    assert.deepEqual(out.commands.map((c) => c.id), [7]);
    assert.equal(out.freshSec, 90);
  } finally { s.close(); }
});
