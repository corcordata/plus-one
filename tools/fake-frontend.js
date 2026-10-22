#!/usr/bin/env node
// 假前端：不接真 AI，也能把整条路走通。收到门铃就回一句（直接回那种），
// 带 --poll 就先回 202、两秒后把话放进 /replies（先应后回那种）。
// 用法：node tools/fake-frontend.js [--poll] [--port 8799]
//   然后 config.json 里 wake_url 填 http://127.0.0.1:8799/wake
import http from "node:http";

const poll = process.argv.includes("--poll");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 8799;
const outbox = [];
let seq = 0;

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === "POST" && url.pathname === "/wake") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const g = JSON.parse(body || "{}");
      const said = g.user_said?.at(-1)?.text;
      const line = said ? `你说「${said}」，我看到了` : `${g.position} · ${g.reasons?.join("+")} · ${g.frames?.length || 0} 帧`;
      console.log(`[wake] ${g.reason} ${g.position} subs=${g.subtitles?.length} frames=${g.frames?.length}`);
      if (!poll) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ say: line }));
        return;
      }
      setTimeout(() => outbox.push({ id: ++seq, session: g.session, say: [line] }), 2000);
      res.writeHead(202);
      res.end("{}");
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/replies") {
    const after = Number(url.searchParams.get("after")) || 0;
    const session = url.searchParams.get("session");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ replies: outbox.filter((o) => o.session === session && o.id > after) }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, "127.0.0.1", () => console.log(`fake frontend on http://127.0.0.1:${port} (${poll ? "poll" : "inline"})`));
