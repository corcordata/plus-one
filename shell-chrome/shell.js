// Chrome 壳：挂上她专属 Chrome 里的每个页面、每个跨域框（爬虫站的视频常在别家网站的框里），
// 把芯塞进每一个执行环境，把芯发出来的消息转给大管家，把大管家的话转回去。
// 同源的子框和页面同一个 target，靠 Runtime 的执行环境分；跨域的框是单独的 target，靠自动挂接。
import fs from "node:fs";
import { CdpConnection } from "./cdp.js";

const CORE_SRC = fs.readFileSync(new URL("../core/core.js", import.meta.url), "utf8");
const BINDING = "__wtSend";

export class ChromeShell {
  constructor({ chromeUrl, log = () => {} }) {
    this.chromeUrl = chromeUrl;
    this.log = log;
    this.cdp = null;
    this.targets = new Map();       // sessionId → { targetId, type, url, parent }
    this.attachedIds = new Set();   // 我们自己挂过的 page targetId（别人挂着不算）
    this.handlers = new Set();
    this.active = null;             // { sessionId, contextId }：正在放片的那个框
  }

  get closed() {
    return !this.cdp || this.cdp.closed;
  }

  onMessage(fn) {
    this.handlers.add(fn);
  }

  async connect() {
    this.cdp = await CdpConnection.connect(this.chromeUrl);
    this.cdp.on((m) => { this._onEvent(m).catch((e) => this.log(`cdp event: ${e.message}`)); });
    await this.cdp.send("Target.setDiscoverTargets", { discover: true });
  }

  async _onEvent(m) {
    const p = m.params || {};
    switch (m.method) {
      case "Target.targetCreated": {
        const t = p.targetInfo;
        if (t.type !== "page" || t.url.startsWith("devtools://") || this.attachedIds.has(t.targetId)) break;
        this.attachedIds.add(t.targetId);
        await this.cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true })
          .catch(() => this.attachedIds.delete(t.targetId));
        break;
      }
      case "Target.targetDestroyed":
        this.attachedIds.delete(p.targetId);
        break;
      case "Target.attachedToTarget": {
        const { sessionId, targetInfo } = p;
        this.targets.set(sessionId, { targetId: targetInfo.targetId, type: targetInfo.type,
          url: targetInfo.url, parent: m.sessionId || null });
        await this._setup(sessionId);
        break;
      }
      case "Target.detachedFromTarget":
        this.targets.delete(p.sessionId);
        if (this.active?.sessionId === p.sessionId) this.active = null;
        break;
      case "Runtime.executionContextCreated": {
        const ctx = p.context;
        if (!m.sessionId || !ctx.auxData?.isDefault) break;
        await this.cdp.send("Runtime.evaluate", { expression: CORE_SRC, contextId: ctx.id }, m.sessionId).catch(() => {});
        break;
      }
      case "Runtime.executionContextDestroyed":
        if (this.active?.sessionId === m.sessionId && this.active.contextId === p.executionContextId) this.active = null;
        break;
      case "Runtime.executionContextsCleared":
        if (this.active?.sessionId === m.sessionId) this.active = null;
        break;
      case "Runtime.bindingCalled": {
        if (p.name !== BINDING) break;
        let msg;
        try { msg = JSON.parse(p.payload); } catch { break; }
        const ref = { sessionId: m.sessionId, contextId: p.executionContextId };
        for (const h of this.handlers) await h({ msg, ref });
        break;
      }
      case "__closed":
        this.active = null;
        break;
      default:
        break;
    }
  }

  async _setup(sid) {
    const send = (method, params = {}) => this.cdp.send(method, params, sid).catch(() => {});
    await send("Runtime.addBinding", { name: BINDING });
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: CORE_SRC });
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await send("Runtime.enable");   // 已有的执行环境会补发 executionContextCreated，在那里注芯
  }

  setActive(ref) {
    this.active = ref;
  }

  async evaluateIn(ref, expression) {
    const r = await this.cdp.send("Runtime.evaluate",
      { expression, contextId: ref.contextId, returnByValue: true, awaitPromise: true }, ref.sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "evaluate threw");
    return r.result?.value;
  }

  // 发给指定的框：还没开始一起看时（比如问「接着看吗」）没有 active 框
  async deliverTo(ref, msg) {
    if (!ref || this.closed) return false;
    await this.evaluateIn(ref, `window.__wt && window.__wt.receive(${JSON.stringify(JSON.stringify(msg))})`);
    return true;
  }

  async deliver(msg) {
    if (!this.active || this.closed) return false;
    await this.evaluateIn(this.active, `window.__wt && window.__wt.receive(${JSON.stringify(JSON.stringify(msg))})`);
    return true;
  }

  async probe() {
    if (!this.active || this.closed) return { ok: false, why: "no active frame" };
    const r = await this.evaluateIn(this.active, "window.__wt ? window.__wt.probe() : ({ ok: false, why: 'no core' })");
    return r || { ok: false, why: "empty probe" };
  }

  // 这个框所在的那一页现在的网址（跨域的视频框读不到外面那页的地址，从 Chrome 这边问）
  async pageUrl(ref) {
    if (!ref || this.closed) return "";
    const root = this._rootSession(ref.sessionId);
    const t = root && this.targets.get(root);
    if (!t) return "";
    const info = await this.cdp.send("Target.getTargetInfo", { targetId: t.targetId }).catch(() => null);
    return info?.targetInfo?.url || t.url || "";
  }

  // 「一起逛」时他点一下：在这一页上做一次真的鼠标点击（x、y 是他看到的截图上的比例，0~1）。
  // 用 Chrome 的输入通道，网站分不出来跟她自己点的有什么不同
  async click(x, y) {
    if (!this.active || this.closed) return false;
    const root = this._rootSession(this.active.sessionId);
    if (!root) return false;
    const m = await this.cdp.send("Page.getLayoutMetrics", {}, root);
    const vp = m.cssLayoutViewport || m.layoutViewport;
    const px = Math.round(Number(x) * vp.clientWidth), py = Math.round(Number(y) * vp.clientHeight);
    const ev = (type, extra = {}) => this.cdp.send("Input.dispatchMouseEvent", { type, x: px, y: py, ...extra }, root);
    await ev("mouseMoved");
    await ev("mousePressed", { button: "left", clickCount: 1 });
    await ev("mouseReleased", { button: "left", clickCount: 1 });
    return true;
  }

  // 手机叫电脑接着看：开一个新标签页、放到最前面
  async openTab(url) {
    if (this.closed) return false;
    const { targetId } = await this.cdp.send("Target.createTarget", { url });
    await this.cdp.send("Target.activateTarget", { targetId }).catch(() => {});
    return true;
  }

  // 截整个标签页（跨域框截不了自己，只能从它的顶层页面截）。截之前把弹幕藏起来，别让他看到自己的字
  async capture() {
    if (!this.active || this.closed) return null;
    const root = this._rootSession(this.active.sessionId);
    if (!root) return null;
    await this.evaluateIn(this.active, "window.__wt && window.__wt.hideUi(true)").catch(() => {});
    try {
      // 别用 clip + scale 缩图：那会让 Chrome 临时按缩小的尺寸重画整页，她那边整个页面一闪一闪（10-20 实测）
      const shot = await this.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 50 }, root);
      return shot?.data || null;
    } finally {
      await this.evaluateIn(this.active, "window.__wt && window.__wt.hideUi(false)").catch(() => {});
    }
  }

  _rootSession(sid) {
    let cur = sid;
    for (let i = 0; i < 10 && cur; i += 1) {
      const t = this.targets.get(cur);
      if (!t) return null;
      if (t.type === "page") return cur;
      cur = t.parent;
    }
    return null;
  }

  close() {
    this.cdp?.close();
  }
}
