// 健康灯：前端想在自己界面上画那盏灯，就来问这里。只听本机。
import http from "node:http";

export function startStatusServer({ port, host = "127.0.0.1", getStatus }) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.split("?")[0] === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(getStatus()));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, host);
  return server;
}
