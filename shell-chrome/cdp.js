// 一条到 Chrome 的 DevTools 长连接（flatten 模式：子页面、跨域框都走同一根线，靠 sessionId 分）。
// 不引依赖——Node 22 自带 fetch 和 WebSocket。
export class CdpConnection {
  static async connect(httpUrl) {
    const res = await fetch(`${httpUrl.replace(/\/+$/, "")}/json/version`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`chrome ${res.status}`);
    const { webSocketDebuggerUrl } = await res.json();
    const c = new CdpConnection(webSocketDebuggerUrl);
    await c.open();
    return c;
  }

  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error("ws connect timed out")), 10000);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("ws error")); }, { once: true });
      ws.addEventListener("message", (e) => this._onMessage(e.data));
      ws.addEventListener("close", () => {
        this.closed = true;
        for (const w of this.pending.values()) w.reject(new Error("cdp closed"));
        this.pending.clear();
        for (const l of this.listeners) l({ method: "__closed", params: {} });
      });
    });
  }

  _onMessage(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.id && this.pending.has(m.id)) {
      const w = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message || "cdp error"));
      else w.resolve(m.result);
      return;
    }
    for (const l of this.listeners) l(m);
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error("cdp closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
      const t = setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, 15000);
      t.unref?.();
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    try { this.ws.close(); } catch { /* 关不掉就算了 */ }
  }
}
