// 陪看 · 芯：塞进网页每一层框里的那段脚本。
// 只管视频和画面上的东西（弹幕、输入条、抽屉、收卡票根），不认识任何 AI——
// 跟外面那层壳说话只用一种小消息：往外 post(JSON)，往里 window.__wt.receive(JSON)。
// 同一份脚本给 Chrome 壳、以后的 iOS 零件和桌面播放器用。
(() => {
  if (globalThis.__wtCoreLib) return;

  // ── 不碰页面的小工具（测试里直接调）────────────────────────
  // 弹幕速度（像素/毫秒）：二十个字以内一个速度，越长飘得越慢，长句也读得完
  function flySpeed(chars) {
    return 0.2 - Math.min(0.08, Math.max(0, chars - 20) * 0.001);
  }
  const FLY_MAX_MS = 26000;
  // 一条弹幕飘多久：窄画面（手机约 400px）按比例放慢，不然两秒多就飞过去了看不清；1000px 以上（Mac）照旧
  function flyDuration(w, tw, chars) {
    const speed = flySpeed(chars) * Math.max(0.35, Math.min(1, w / 1000));
    return Math.min(FLY_MAX_MS, (w + tw) / speed);
  }

  // 气泡的样子：字段跟宿主 App 聊天里的气泡样式一一对应。
  // style 为 null = 默认「液态玻璃」：照画布画（她白、他暖金），跟宿主 App 深色默认走老画法一个意思；
  // 有人动了滑块才从 SEED 起步。
  const SEED = Object.freeze({
    material: "glass", colorMu: "FFD98A", colorMine: "FFFFFF", textMu: null, textMine: "111111",
    transparency: 0.18, blur: 0.4, brightness: 0, edgeLight: 0.6, highlight: true,
    cornerRadius: 16, spacing: 10, length: 30, tail: true,
  });
  // 开源自带的第二套：票根（纯色、方角、不带尾巴）
  const BUILTIN_PRESETS = Object.freeze([
    { name: "票根", style: { ...SEED, material: "solid", colorMu: "E6C27A", colorMine: "F2EDE4", textMu: "3A2A10",
      textMine: "2A2622", transparency: 0, cornerRadius: 4, spacing: 8, tail: false } },
    null, null,
  ]);
  const MATERIALS = ["solid", "translucent", "glass", "gradient"];

  const clampN = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const hexOk = (v) => (typeof v === "string" && /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null);
  function normStyle(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      material: MATERIALS.includes(raw.material) ? raw.material : "glass",
      colorMu: hexOk(raw.colorMu), colorMine: hexOk(raw.colorMine), textMu: hexOk(raw.textMu), textMine: hexOk(raw.textMine),
      transparency: clampN(raw.transparency, 0, 0.95, SEED.transparency), blur: clampN(raw.blur, 0, 1, SEED.blur),
      brightness: clampN(raw.brightness, -0.3, 0.3, 0), edgeLight: clampN(raw.edgeLight, 0, 1, SEED.edgeLight),
      highlight: raw.highlight !== false, cornerRadius: clampN(raw.cornerRadius, 4, 24, 16),
      spacing: clampN(raw.spacing, 2, 24, 10), length: clampN(raw.length, 0, 60, 30), tail: raw.tail !== false,
    };
  }
  function defaultLook() {
    return { bg: "glass", mode: "dark", style: null, presets: BUILTIN_PRESETS.map((p) => (p ? { name: p.name, style: { ...p.style } } : null)), photos: [] };
  }
  function normLook(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const photos = (Array.isArray(r.photos) ? r.photos : []).filter((p) => typeof p === "string" && p.startsWith("data:image/")).slice(0, 4);
    let bg = typeof r.bg === "string" ? r.bg : "glass";
    const m = /^photo:(\d+)$/.exec(bg);
    if (m ? Number(m[1]) >= photos.length : !["glass", "black", "cream"].includes(bg)) bg = "glass";
    const presets = [0, 1, 2].map((i) => {
      const p = Array.isArray(r.presets) ? r.presets[i] : null;
      const style = p && normStyle(p.style);
      return style ? { name: String(p.name || "").slice(0, 12) || "未命名", style } : null;
    });
    const mode = r.mode === "light" || r.mode === "dark" ? r.mode : bg === "cream" ? "light" : "dark";
    return { bg, mode, style: normStyle(r.style), presets, photos };
  }
  const sameStyle = (a, b) => !!a && !!b && Object.keys(SEED).every((k) => a[k] === b[k]);

  const rgb = (h) => { const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (h, a) => `rgba(${rgb(h).join(",")},${Math.round(a * 1000) / 1000})`;
  const toward = (h, t) => rgb(h).map((c) => Math.round(c + (255 - c) * t)).map((c) => c.toString(16).padStart(2, "0")).join("");
  const flat = (c) => `linear-gradient(${c},${c})`;

  // 一个气泡的 CSS（camelCase，直接 Object.assign 到 el.style）。light = 抽屉切到浅色模式。
  // 字色她在设置里自己改；没改的时候跟着深浅走：浅色深字、深色浅字（不替她猜）
  function bubbleLook(style, mine, light = false) {
    if (!style) {
      const corner = mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px";
      if (mine) return { background: "rgba(255,255,255,.92)", border: light ? "1px solid rgba(0,0,0,.08)" : "0", color: "#111",
        borderRadius: corner, maxWidth: "80%", backdropFilter: "none" };
      return light
        ? { background: "rgba(184,134,43,.16)", border: "1px solid rgba(184,134,43,.35)", color: "#1c1c1e", borderRadius: corner, maxWidth: "86%", backdropFilter: "none" }
        : { background: "rgba(255,217,138,.18)", border: "1px solid rgba(255,217,138,.32)", color: "#ffe7b5", borderRadius: corner, maxWidth: "86%", backdropFilter: "none" };
    }
    const base = (mine ? style.colorMine : style.colorMu) || (mine ? "FFFFFF" : "FFD98A");
    const alpha = Math.max(0.05, 1 - style.transparency);
    const r = style.cornerRadius;
    const small = style.tail ? Math.min(4, r) : r;
    const out = {
      borderRadius: mine ? `${r}px ${r}px ${small}px ${r}px` : `${r}px ${r}px ${r}px ${small}px`,
      maxWidth: `calc(100% - ${60 - style.length}px)`, border: "0", backdropFilter: "none",
    };
    if (style.material === "solid") out.background = rgba(base, alpha);
    else if (style.material === "translucent") out.background = rgba(base, alpha * 0.75);
    else if (style.material === "gradient") out.background = `linear-gradient(135deg,${rgba(base, alpha)},${rgba(toward(base, 0.45), alpha * 0.8)})`;
    else {
      // 玻璃：模糊、底色、亮度（正蒙白负蒙黑）、内侧高光、边框光——层次跟宿主 App 一样
      const layers = [];
      if (style.highlight) layers.push("linear-gradient(to bottom,rgba(255,255,255,.32) 0%,rgba(255,255,255,0) 55%)");
      if (style.brightness > 0) layers.push(flat(`rgba(255,255,255,${style.brightness})`));
      if (style.brightness < 0) layers.push(flat(`rgba(0,0,0,${-style.brightness})`));
      layers.push(flat(rgba(base, alpha)));
      const e = style.edgeLight;
      const fill = layers.map((l) => `${l} padding-box`).join(",");
      out.background = e > 0
        ? `${fill},linear-gradient(135deg,rgba(255,255,255,${0.95 * e}) 0%,rgba(255,255,255,${0.25 * e}) 40%,rgba(255,255,255,${0.15 * e}) 72%,rgba(255,255,255,${0.55 * e}) 100%) border-box`
        : fill;
      out.border = e > 0 ? "1px solid transparent" : "0";
      out.backdropFilter = `blur(${Math.round(style.blur * 24)}px) saturate(160%)`;
    }
    const text = mine ? style.textMine : style.textMu;
    out.color = text ? `#${text}` : light ? "#1c1c1e" : "#ffffff";
    return out;
  }

  const tc = (sec) => {
    const t = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
  };
  // 弹幕层只铺视频露在屏幕里的那块：手机上有的页面把视频撑得比屏幕还高，照抄整块的话输入条掉到屏幕下面
  function visibleRect(r, vw, vh) {
    const left = Math.max(r.left, 0), top = Math.max(r.top, 0);
    const right = Math.min(r.right, vw), bottom = Math.min(r.bottom, vh);
    return right > left && bottom > top
      ? { left, top, width: right - left, height: bottom - top }
      : { left: r.left, top: r.top, width: r.width, height: r.height };   // 整个在屏幕外：照原样，反正看不见
  }
  const pickCount = (total, picked, unit = "这一场") => `${unit} ${total} 句 · 选了 ${picked} 句`;

  // 他在截图上指的位置（0~1）→ 页面里的坐标。手机上页面常被放大（点输入框时 iOS 会自己放大），
  // 截图拍的是放大后眼前那一块，所以按 visualViewport 算；没有它（老浏览器）就按整个窗口
  function shotPoint(fx, fy, vv, iw, ih) {
    const x = Math.max(0, Math.min(1, Number(fx) || 0)), y = Math.max(0, Math.min(1, Number(fy) || 0));
    if (vv && vv.width > 0 && vv.height > 0) return { x: (vv.offsetLeft || 0) + x * vv.width, y: (vv.offsetTop || 0) + y * vv.height };
    return { x: x * iw, y: y * ih };
  }

  globalThis.__wtCoreLib = { flySpeed, flyDuration, visibleRect, shotPoint, FLY_MAX_MS, SEED, BUILTIN_PRESETS, normStyle, normLook, defaultLook, sameStyle, bubbleLook, tc, pickCount };
  if (typeof document === "undefined" || window.__wt) return;

  const post = (msg) => {
    const s = JSON.stringify(msg);
    try {
      if (typeof window.__wtSend === "function") window.__wtSend(s);
      else window.webkit?.messageHandlers?.wt?.postMessage(s);
    } catch { /* 壳不在就算了 */ }
  };

  // 手机 App 里打字用壳的原生输入条：网页里的输入框一弹键盘，WebKit 就把整页顶上去、视觉视口缩一截，
  // 有的站的播放器被这么一折腾就坏了（字幕没了、进度条点不出来，10-21 真机）。壳在芯之前放一个
  // window.__wtNative.compose 标记：芯就不画自己的输入框，只留一个长得像输入框的钮，点一下叫壳把输入条拿出来；
  // 打好的字从 __wt.say 递回来，走的还是 sendLine 那一套
  const nativeCompose = !!(window.__wtNative && window.__wtNative.compose);
  // 手机上抽屉和票根也不画在视频框里（竖屏那框只有两百来像素高，塞不下）：壳用 SwiftUI 画成底部页，
  // 芯只管数据——__wt.native.state() 给它读，__wt.native.act() 让它动；发给大管家的消息跟网页版一模一样。电脑上没这标记，照旧
  const nativeSheets = !!(window.__wtNative && window.__wtNative.sheets);
  // 只有竖屏才交给壳（横屏那框够高，抽屉照旧在右边、票根在中间——她 10-22 定的）。壳在每一层框里写 window.__wtLandscape
  const useSheets = () => nativeSheets && !window.__wtLandscape;
  let sheetMode = false;   // 这一次票根是不是壳画的（开的时候定，关的时候用）

  // ── lichess：开局前把它自己的那条长连接攥住，他走棋就从这条发（7 月桌面下棋就是这么走的）──
  // 只在 lichess.org 上包；断线重连会开新的，所以一直记最新那条
  let lichessSocket = null;
  if (/(^|\.)lichess\.org$/.test(location.hostname) && typeof window.WebSocket === "function" && !window.WebSocket.__wtWrapped) {
    const Orig = window.WebSocket;
    const Wrapped = function (...args) {
      const ws = new Orig(...args);
      if (String(args[0] || "").includes("socket")) lichessSocket = ws;
      return ws;
    };
    Wrapped.prototype = Orig.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Wrapped[k] = Orig[k];
    Wrapped.__wtWrapped = true;
    window.WebSocket = Wrapped;
  }

  // ── 视频 ───────────────────────────────────────────────
  let video = null;
  let aiControlUntil = 0;   // 他刚按过暂停/倒回的三秒内，视频事件标成 by_ai，别再叫醒他

  // 露在屏幕里的面积：抖音一个页面里摆着上一条、下一条（在屏幕外预加载），只认眼前这条
  function visibleArea(v) {
    const r = v.getBoundingClientRect();
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function findVideo() {
    const vs = [...document.querySelectorAll("video")]
      .filter((v) => v.readyState >= 1 && v.videoWidth > 0 && visibleArea(v) > 0);
    // 正在播的优先，再比露出来多少
    return vs.sort((a, b) => (a.paused - b.paused) || (visibleArea(b) - visibleArea(a)))[0] || null;
  }

  function onVideoEvent(e) {
    if (e.type === "seeked" && typeof earsDirty === "function") earsDirty();
    post({ type: "video", event: e.type, time: video.currentTime, paused: video.paused,
      by_ai: Date.now() < aiControlUntil });
  }

  const EVENTS = ["play", "pause", "seeked", "ended"];
  function adopt(v) {
    if (video === v) return;
    // 「一起逛」还没开始时这页冒出了视频：换回一起看；已经在逛了就照旧逛
    if (pageMode && !active) { pageMode = false; if (ui) updateModeUi(); }
    if (video) for (const t of EVENTS) video.removeEventListener(t, onVideoEvent);
    if (fitted.length) unfit();   // 压过的是上一条视频的壳子
    video = v;
    for (const t of EVENTS) video.addEventListener(t, onVideoEvent);
    mountUi();
    post({ type: "hello", hasVideo: true, url: location.href, title: document.title, vw: innerWidth, vh: innerHeight });
  }
  // 找视频别只靠定时器：抖音这类网站会把页面上的定时器一口气全清掉，芯就再也不找了（10-20 实测）。
  // 视频事件不冒泡，但在 document 上按捕获阶段听得到——任何视频一开播 / 换了一条，马上接手。
  const recheck = () => { const v = findVideo(); if (v) adopt(v); };
  for (const t of ["playing", "loadeddata", "play"]) {
    document.addEventListener(t, (e) => { if (e.target instanceof HTMLVideoElement) recheck(); }, true);
  }
  setInterval(recheck, 1000);   // 后备

  // 「一起逛」：没有视频，按页面算——过了多久、滑到哪了；截图交给壳（截整页），指纹算不出来
  function pageProbe() {
    const se = document.scrollingElement || document.documentElement;
    return { ok: true, page: true, time: Math.round((Date.now() - (startedAt || Date.now())) / 100) / 10, duration: 0,
      paused: false, ended: false, fingerprint: null,
      scroll: { y: Math.round(scrollY), max: Math.max(0, Math.round(se.scrollHeight - innerHeight)), vh: innerHeight } };
  }

  function probe() {
    if (pageMode) return pageProbe();
    if (!video) return { ok: false, why: "no video" };
    const out = { ok: true, time: video.currentTime, duration: video.duration || 0,
      paused: video.paused, ended: video.ended };
    try {
      const c = document.createElement("canvas");
      c.width = 8; c.height = 8;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(video, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      const fp = [];
      for (let i = 0; i < d.length; i += 4) fp.push(Math.round((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 4));
      out.fingerprint = fp;
    } catch {
      out.fingerprint = null;   // 跨域视频画不进 canvas；进度照样准
    }
    return out;
  }

  // 往下滑：整个窗口滑不动的话（漫画站常把内容放在一个能滚的盒子里），滑屏幕中间那个能滚的盒子
  function scrollTarget() {
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > innerHeight + 2) return null;
    let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (el && el !== document.body) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 2) return el;
      el = el.parentElement;
    }
    return null;
  }
  function handControl(c) {
    if (!handsOn) return;   // 她没开「让他动手」：他的手一律不算
    if (c.action === "scroll") {
      const vh = window.visualViewport?.height || innerHeight;
      const by = c.by === "page" ? vh * 0.85 : c.by === "-page" ? -vh * 0.85 : Number(c.by) || 0;
      const el = scrollTarget();
      (el || window).scrollBy({ top: by, behavior: "smooth" });
    } else if (c.action === "click") {
      // 电脑上大管家用 Chrome 的真点击；没有那条路的壳（手机）走这里
      const { x, y } = shotPoint(c.x, c.y, window.visualViewport, innerWidth, innerHeight);
      const el = document.elementFromPoint(x, y);
      if (!el) return;
      const opt = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        el.dispatchEvent(t.startsWith("pointer") ? new PointerEvent(t, opt) : new MouseEvent(t, opt));
      }
    } else if (c.action === "move") {
      if (lichessSocket && lichessSocket.readyState === 1) lichessSocket.send(JSON.stringify({ t: "move", d: { u: c.uci, b: 1 } }));
      else post({ type: "hand_failed", action: "move", why: "lichess 没连上：刷新一下棋盘那页再试" });
    }
  }

  // 「接着读」：滑回上次停的百分之几。漫画图常是慢慢加载的，页面还没那么长就过一会儿再试（最多 8 秒）
  function scrollToPct(pct, tries = 0) {
    const se = document.scrollingElement || document.documentElement;
    const max = se.scrollHeight - innerHeight;
    const top = Math.max(0, Math.min(100, Number(pct) || 0)) / 100 * max;
    if (max > 0) window.scrollTo({ top });
    if (tries < 16 && (max <= 0 || Math.abs((se.scrollTop || scrollY) - top) > innerHeight * 0.5)) setTimeout(() => scrollToPct(pct, tries + 1), 500);
  }

  function control(c) {
    if (c.action === "scroll_to") { scrollToPct(c.pct); return; }   // 她自己的「接着读」，不算他的手
    if (c.action === "scroll" || c.action === "click" || c.action === "move") { handControl(c); return; }
    if (!video) return;
    aiControlUntil = Date.now() + 3000;
    if (c.action === "pause") video.pause();
    else if (c.action === "resume") video.play().catch(() => {});
    else if (c.action === "seek") video.currentTime = Math.max(0, video.currentTime + Number(c.by || 0));
    else if (c.action === "seek_to") video.currentTime = Math.max(0, Number(c.at) || 0);
  }

  // 有的网站直接让 <video> 全屏——<video> 里塞不进别的东西，弹幕就没了。改成让它的父元素全屏。
  for (const name of ["requestFullscreen", "webkitRequestFullscreen"]) {
    const orig = HTMLVideoElement.prototype[name];
    if (typeof orig !== "function") continue;
    HTMLVideoElement.prototype[name] = function (...args) {
      const parent = this.parentElement;
      return parent && typeof parent[name] === "function" ? parent[name](...args) : orig.apply(this, args);
    };
  }

  // ── 画面上的东西 ───────────────────────────────────────
  // 样子照设计画布（plus-one 画布：一起看的时候 / 拉开抽屉 / 抽屉里的设置 / 结束这一场）
  const FONT = `-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif`;
  const GLASS = "backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%)";
  const CSS = `
    *{box-sizing:border-box}
    .stage{position:absolute;inset:0;container-type:size;pointer-events:none;font-family:${FONT};color:#fff;-webkit-font-smoothing:antialiased}
    button{font-family:${FONT};cursor:pointer}
    svg{display:block}
    .lanes{position:absolute;left:0;right:0;top:0;height:45%;overflow:hidden}
    .fly{position:absolute;left:0;display:flex;align-items:center;gap:10px;white-space:nowrap;font:600 22px/1.3 ${FONT};color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.55),0 0 2px rgba(0,0,0,.5);will-change:transform}
    .fly.him{color:#ffd98a}
    .tag{pointer-events:auto;display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 12px;border-radius:16px;background:rgba(255,217,138,.22);border:1px solid rgba(255,217,138,.5);color:#ffd98a;font:600 13px ${FONT};text-shadow:none;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
    .tag:hover{background:rgba(255,217,138,.34)}

    .bar{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px;border-radius:28px;background:rgba(255,255,255,.14);${GLASS};border:1px solid rgba(255,255,255,.26);box-shadow:0 10px 40px rgba(0,0,0,.3);pointer-events:none;opacity:0;transition:opacity .25s,left .3s}
    .bar.show{opacity:1;pointer-events:auto}
    .bar.away{opacity:0!important;pointer-events:none}
    .bar.aside{left:calc((100cqw - var(--dw) - 16px) / 2)}
    .bar.aside .dot,.bar.aside .more{display:none}
    .dot{display:flex;align-items:center;justify-content:center;width:28px;height:40px}
    .dot span{width:9px;height:9px;border-radius:5px;background:#34c759;box-shadow:0 0 0 4px rgba(52,199,89,.22);transition:background .3s,box-shadow .3s}
    .dot.bad span{background:#ff9f0a;box-shadow:0 0 0 4px rgba(255,159,10,.25)}
    .say{width:min(420px,calc(100cqw - 200px));height:40px;padding:0 16px;border:0;border-radius:20px;background:rgba(0,0,0,.25);color:#fff;font:16px ${FONT};outline:none}
    .say::placeholder{color:rgba(255,255,255,.6)}
    .say.fake{text-align:left;color:rgba(255,255,255,.6);-webkit-appearance:none;appearance:none;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bar.composing{opacity:0!important;pointer-events:none}
    .bar.aside .say{width:min(360px,calc(100cqw - var(--dw) - 110px))}
    /* 手机这种窄画面：输入条整体小一号，别挡太多画面（她 10-21） */
    @container (max-width: 600px) {
      .bar{bottom:12px;gap:6px;padding:5px;border-radius:22px}
      .say{height:32px;padding:0 12px;font-size:16px;width:calc(100cqw - 150px)}
      .round{width:32px;height:32px;border-radius:16px}
      .dot{width:20px;height:32px}
    }
    /* 手机看视频：输入条落在字幕上面一点（她 10-21：再低一点，贴着字幕上沿） */
    @media (pointer: coarse) {
      .bar.video{bottom:34px}
    }
    /* 手机横屏把播放框压到屏高之后，网站自己的控制条就贴在底边了（ikanbot 那条 30px）：条抬起来别压着它 */
    .bar.fit{bottom:48px}
    /* 手机竖屏：视频框矮，条不进框里，贴在视频下沿外面那一条（框多留 54px）；底下是网站白底，条要深一点才看得见 */
    .bar.below{bottom:6px;background:rgba(28,28,30,.72);border-color:rgba(255,255,255,.18)}
    /* 把手（抽屉里可开可关，默认关）：条藏起来后留一道小横杠 + 绿点，碰把手才展开——给一点画面就暂停的站用（她 10-22 提的） */
    .handle{position:absolute;left:50%;bottom:46px;transform:translateX(-50%);display:none;align-items:center;justify-content:center;gap:6px;width:96px;height:28px;padding:0;border:0;background:transparent;pointer-events:auto}
    .handle.on{display:flex}
    .handle .hd{width:7px;height:7px;border-radius:4px;background:#34c759;box-shadow:0 0 0 3px rgba(52,199,89,.22)}
    .handle.bad .hd{background:#ff9f0a;box-shadow:0 0 0 3px rgba(255,159,10,.25)}
    .handle .hb{width:44px;height:5px;border-radius:3px;background:rgba(255,255,255,.55)}
    .handle.below{bottom:12px}
    .handle.below .hb{background:rgba(28,28,30,.55)}
    @container (max-height: 300px) {
      .resume{left:10px;top:10px;gap:8px;height:32px;padding:0 6px 0 12px;border-radius:16px}
      .resume .t1{display:none}
      .resume .t2{font-size:12px}
      .resume .go{height:24px;padding:0 10px;font-size:12px}
      .resume .no{width:24px;height:24px}
    }
    /* 手机横屏：左上角是 App 的关掉钮，「上次看到」往右让开 */
    @container (min-height: 300px) {
      .stage.native .resume{left:88px;top:10px}
    }
    .foldhead{width:100%;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
    .foldhead .arr{transition:transform .2s;opacity:.6}
    .group.folded .foldhead .arr{transform:rotate(-90deg)}
    .group.folded > :not(.foldhead){display:none!important}
    .round{width:40px;height:40px;border:0;border-radius:20px;display:flex;align-items:center;justify-content:center;flex:none}
    .send{background:#fff;color:#111}
    .more{background:rgba(255,255,255,.16);color:#fff}
    .start{height:40px;padding:0 20px;border:0;border-radius:20px;background:#fff;color:#111;font:600 15px ${FONT}}

    .resume{position:absolute;left:28px;top:28px;display:flex;align-items:center;gap:14px;padding:10px 12px 10px 18px;border-radius:22px;background:rgba(255,255,255,.16);backdrop-filter:blur(28px) saturate(160%);-webkit-backdrop-filter:blur(28px) saturate(160%);border:1px solid rgba(255,255,255,.28);box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:auto}
    .resume .t1{font-size:12px;color:rgba(255,255,255,.7)}
    .resume .t2{font-size:15px;font-weight:600}
    .resume .go{height:34px;padding:0 16px;border:0;border-radius:17px;background:#fff;color:#111;font:600 14px ${FONT}}
    .resume .no{width:34px;height:34px;border:0;border-radius:17px;background:rgba(255,255,255,.18);color:#fff;display:flex;align-items:center;justify-content:center}

    .drawer{--ink:#fff;--ink2:rgba(255,255,255,.6);--cell:rgba(255,255,255,.05);--group:rgba(255,255,255,.08);--card:rgba(255,255,255,.07);--chip:rgba(255,255,255,.14);--chipInk:rgba(255,255,255,.75);--sel:#fff;
      position:absolute;top:16px;right:16px;bottom:16px;width:var(--dw);display:flex;flex-direction:column;border-radius:26px;background:rgba(28,28,30,.55);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(255,255,255,.18);box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden;color:var(--ink);pointer-events:auto;
      transform:translateX(calc(100% + 24px));opacity:0;visibility:hidden;transition:transform .32s cubic-bezier(.2,.8,.2,1),opacity .2s,visibility 0s .32s}
    .drawer.open{transform:none;opacity:1;visibility:visible;transition:transform .32s cubic-bezier(.2,.8,.2,1),opacity .2s}
    .drawer.bg-black{background:#1c1c1e;backdrop-filter:none;-webkit-backdrop-filter:none}
    .drawer.light{--ink:#1c1c1e;--ink2:rgba(0,0,0,.55);--cell:rgba(0,0,0,.035);--group:rgba(0,0,0,.06);--card:rgba(0,0,0,.05);--chip:rgba(0,0,0,.08);--chipInk:rgba(0,0,0,.7);--sel:#1c1c1e;
      background:rgba(246,244,240,.62);border-color:rgba(255,255,255,.5)}
    .drawer.bg-cream{background:#e9e4dc;border-color:rgba(0,0,0,.08);backdrop-filter:none;-webkit-backdrop-filter:none}
    .drawer.bg-photo{background:#1c1c1e;backdrop-filter:none;-webkit-backdrop-filter:none}
    .photo{position:absolute;inset:-30px;background-size:cover;background-position:center;filter:blur(22px) saturate(120%);display:none}
    .drawer.bg-photo .photo{display:block}
    .veil2{position:absolute;inset:0;background:rgba(20,20,22,.5);display:none}
    .drawer.bg-photo .veil2{display:block}
    .drawer.light .veil2{background:rgba(246,244,240,.55)}
    .page{position:relative;flex:1;min-height:0;display:none;flex-direction:column}
    .page.on{display:flex}
    .head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:18px 18px 10px 20px}
    .head.left{justify-content:flex-start;padding:16px 18px 10px}
    .dtitle{font-size:17px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dsub{font-size:12px;color:var(--ink2)}
    .icon{width:36px;height:36px;border:0;border-radius:18px;background:var(--chip);color:var(--ink);display:flex;align-items:center;justify-content:center;flex:none}
    .log{flex:1;min-height:80px;overflow:auto;display:flex;flex-direction:column;padding:8px 16px 16px}
    .item{display:flex;flex-direction:column;gap:4px;max-width:100%}
    .item.her{align-items:flex-end}
    .item.him{align-items:flex-start}
    .bub{padding:8px 12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word}
    .jump{border:0;padding:0;background:none;font:12px ${FONT};color:rgba(255,217,138,.85)}
    .light .jump{color:#8a6420}
    .jump:hover{text-decoration:underline}
    .group{display:flex;flex-direction:column;gap:1px;margin:0 12px;border-radius:16px;overflow-x:hidden;overflow-y:auto;background:var(--group);flex:0 1 auto;min-height:0}
    .group > *{flex:none}
    .cell{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:var(--cell);font-size:14px}
    .cell.col{flex-direction:column;align-items:stretch;gap:6px}
    .cell .row{display:flex;justify-content:space-between}
    .val{color:var(--ink2)}
    .linkbtn{border:0;padding:6px 0;background:none;color:rgba(255,255,255,.88);text-decoration:underline;text-decoration-color:rgba(255,255,255,.4);text-underline-offset:3px;font:14px ${FONT}}
    .light .linkbtn{color:rgba(0,0,0,.75);text-decoration-color:rgba(0,0,0,.3)}
    .sw{position:relative;width:44px;height:26px;flex:none}
    .sw input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer}
    .sw span{position:absolute;inset:0;border-radius:13px;background:rgba(120,120,128,.32);transition:background .2s;pointer-events:none}
    .sw span::after{content:"";position:absolute;left:2px;top:2px;width:22px;height:22px;border-radius:11px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}
    .sw input:checked+span{background:#34c759}
    .sw input:checked+span::after{transform:translateX(18px)}
    input[type=range]{width:100%;margin:0;accent-color:#ffd98a}
    .sub{display:none;gap:4px;flex-wrap:wrap;align-items:center}
    .sub.on{display:flex}
    .sub button{height:32px;padding:0 10px;border:0;border-radius:16px;background:var(--chip);color:var(--ink);font:12px ${FONT}}
    .subnow{flex:1 1 100%;font-size:12px;color:var(--ink2)}
    .finder{display:none;flex-direction:column;gap:6px}
    .finder.on{display:flex}
    .fq{display:flex;gap:6px}
    .fq input{flex:1;min-width:0;height:32px;padding:0 10px;border:1px solid rgba(127,127,127,.35);border-radius:10px;background:rgba(0,0,0,.18);color:inherit;font:13px ${FONT};outline:none}
    .light .fq input{background:#fff}
    .fq button{height:36px;padding:0 14px;border:0;border-radius:12px;background:#fff;color:#111;font:600 13px ${FONT}}
    .fstat{font-size:12px;color:var(--ink2)}
    .flist{display:flex;flex-direction:column;gap:4px;max-height:200px;overflow:auto}
    .fitem{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 10px;border:0;border-radius:10px;background:var(--chip);color:var(--ink);text-align:left;font:13px ${FONT}}
    .fitem .fn{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fitem .fm{font-size:11px;color:var(--ink2)}
    .foot{padding:12px}
    .endbtn{width:100%;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.92);color:#111;font:600 15px ${FONT}}
    .light .endbtn{background:#1c1c1e;color:#fff}

    .scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:18px;padding:6px 14px 20px}
    .sec{display:flex;flex-direction:column;gap:8px}
    .sech{display:flex;justify-content:space-between;padding:0 4px;font-size:13px;color:var(--ink2)}
    .bgs{display:flex;gap:10px;overflow-x:auto;padding:2px 4px 6px;scrollbar-width:none}
    .bgs::-webkit-scrollbar{display:none}
    .bgt{flex:none;width:68px;height:96px;border-radius:14px;border:1px solid rgba(255,255,255,.18);display:flex;align-items:flex-end;padding:6px;font:11px ${FONT};color:#fff;background-size:cover;background-position:center;text-align:left}
    .bgt.imp{border:1.5px dashed rgba(127,127,127,.5);background:var(--card);color:var(--ink2);flex-direction:column;align-items:center;justify-content:center;gap:6px;font-size:12px}
    .bgt.glass{background:linear-gradient(135deg,rgba(107,79,58,.9),rgba(61,85,102,.9))}
    .bgt.black{background:#1c1c1e}
    .bgt.cream{background:#e9e4dc;color:#3a3a3c;border-color:rgba(0,0,0,.08)}
    .bgt.photo{text-shadow:0 1px 2px rgba(0,0,0,.6)}
    .bgt.sel{border:2px solid var(--sel)}
    .presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    .pt{height:74px;border-radius:14px;border:1px solid rgba(127,127,127,.25);background:var(--card);color:var(--ink);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font:12px ${FONT};padding:0 4px;overflow:hidden}
    .pt.sel{border:2px solid var(--sel)}
    .pt.empty{border:1.5px dashed rgba(127,127,127,.4);background:transparent;color:var(--ink2)}
    .pt .mini{display:flex;gap:3px}
    .pt .mini span{display:block;height:12px}
    .pt .nm{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .card{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:18px;background:var(--card)}
    .cardh{font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--ink2)}
    .mats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
    .mats button{height:30px;border:0;border-radius:15px;background:var(--chip);color:var(--chipInk);font:12px ${FONT}}
    .mats button.sel{background:#fff;color:#111;font-weight:600}
    .line{display:flex;align-items:center;justify-content:space-between;font-size:14px}
    .pair{display:flex;gap:14px;align-items:center;font-size:11px;color:var(--ink2)}
    .pair label{display:flex;gap:5px;align-items:center}
    .pair input{width:24px;height:24px;padding:0;border:2px solid rgba(255,255,255,.85);border-radius:12px;background:none;cursor:pointer;-webkit-appearance:none;appearance:none;overflow:hidden}
    .light .pair input{border-color:rgba(0,0,0,.2)}
    .pair input::-webkit-color-swatch-wrapper{padding:0}
    .pair input::-webkit-color-swatch{border:0;border-radius:12px}
    .sl{display:flex;flex-direction:column;gap:4px;font-size:14px}
    .chk{width:20px;height:20px;margin:0;accent-color:#34c759}
    .hint{font-size:12px;line-height:1.5;color:var(--ink2)}
    .sheet{position:absolute;left:12px;right:12px;bottom:12px;display:none;flex-direction:column;gap:8px;padding:14px;border-radius:18px;background:rgba(44,44,48,.96);border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 40px rgba(0,0,0,.4);color:#fff;z-index:2}
    .light .sheet{background:#f6f3ee;color:#1c1c1e;border-color:rgba(0,0,0,.08)}
    .sheet.on{display:flex}
    .sheet .st{font-size:13px;color:var(--ink2)}
    .sheet input{height:38px;padding:0 12px;border:1px solid rgba(127,127,127,.35);border-radius:10px;background:rgba(0,0,0,.2);color:inherit;font:15px ${FONT};outline:none}
    .light .sheet input{background:#fff}
    .sheet .acts{display:flex;flex-direction:column;gap:6px}
    .sheet .acts button{height:40px;border:0;border-radius:12px;background:var(--chip);color:inherit;font:15px ${FONT}}
    .sheet .acts button.pri{background:#fff;color:#111;font-weight:600}
    .sheet .acts button.danger{color:#ff453a}

    .dim{position:absolute;inset:0;background:rgba(0,0,0,.28);display:none;pointer-events:auto;align-items:center;justify-content:center;padding:16px}
    .dim.on{display:flex}
    .ticket{width:min(520px,100%);max-height:100%;overflow:auto;display:flex;flex-direction:column;gap:18px;padding:26px;border-radius:30px;background:rgba(36,36,40,.6);backdrop-filter:blur(44px) saturate(180%);-webkit-backdrop-filter:blur(44px) saturate(180%);border:1px solid rgba(255,255,255,.2);box-shadow:0 30px 80px rgba(0,0,0,.45)}
    .tmeta{font-size:12px;letter-spacing:.08em;color:rgba(255,255,255,.55)}
    .ttitle{width:100%;height:40px;padding:0;border:0;background:transparent;color:#fff;font:700 26px ${FONT};outline:none}
    .th{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:rgba(255,255,255,.6)}
    .pall{height:32px;padding:0 12px;border-radius:16px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff;font:600 12px ${FONT};cursor:pointer}
    .picks{height:196px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border-radius:16px;background:rgba(255,255,255,.06)}
    .pk{display:flex;align-items:flex-start;gap:12px;padding:11px 14px;background:rgba(255,255,255,.05);cursor:pointer}
    .pk input{width:22px;height:22px;margin:0;flex:none;accent-color:#ffd98a}
    .pk .pm{font-size:12px;color:rgba(255,255,255,.55)}
    .pk.him .pm{color:rgba(255,217,138,.85)}
    .pk .px{font-size:14px;line-height:1.4}
    .pempty{padding:14px;font-size:13px;color:rgba(255,255,255,.5)}
    .two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .fld{display:flex;flex-direction:column;gap:6px;font-size:13px;color:rgba(255,255,255,.6)}
    .fld input,.fld textarea{padding:0 12px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(0,0,0,.22);color:#fff;font:15px ${FONT};outline:none}
    .fld input{height:40px}
    .fld textarea{height:64px;padding:10px 12px;line-height:1.45;resize:none}
    .fld input::placeholder,.fld textarea::placeholder{color:rgba(255,255,255,.4)}
    .shots{display:flex;gap:6px;height:40px}
    .shot{position:relative;flex:1;min-width:0;height:40px;border-radius:10px;background:#3a3632 center/cover no-repeat}
    .ticket.tall .shots{height:96px}
    .ticket.tall .shot{flex:0 0 68px;height:96px}
    .shots{height:56px}
    .shot{height:56px}
    .shot.cover{box-shadow:0 0 0 2px #fff}
    .shot.drop{opacity:.3}
    .shot.drop::after{content:"不留";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 11px ${FONT};color:#fff}
    .star{position:absolute;right:4px;top:4px;width:28px;height:28px;padding:0;border:0;border-radius:14px;background:rgba(0,0,0,.35);color:rgba(255,255,255,.85);display:flex;align-items:center;justify-content:center}
    .shot.cover .star{background:#fff;color:#b8862b}
    .noshot{flex:1;display:flex;align-items:center;font-size:12px;color:rgba(255,255,255,.45)}
    .tbtns{display:flex;flex-direction:column;gap:8px}
    .tbtns .pri{height:46px;border:0;border-radius:14px;background:#fff;color:#111;font:600 15px ${FONT}}
    .tbtns .two button{height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.14);color:#fff;font:600 15px ${FONT}}
    .tbtns .two button.soft{color:rgba(255,255,255,.8);font-weight:400}
    .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}`;

  // 小图标：一律细线 SVG
  const ICON = {
    x: ["0 0 12 12", "M2 2l8 8M10 2l-8 8", 1.8],
    send: ["0 0 16 16", "M8 13V3M3.5 7.5L8 3l4.5 4.5", 2],
    menu: ["0 0 16 16", "M3 4.5h10M3 8h10M3 11.5h10", 1.8],
    // 设置用「滑块」图标：画布上那个齿轮跟太阳（浅色模式）长得太像，挨在一起分不清
    gear: ["0 0 16 16", "M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3", 1.5],
    back: ["0 0 9 15", "M7.5 1.5L1.5 7.5l6 6", 2.2],
    plus: ["0 0 16 16", "M8 3v10M3 8h10", 1.8],
    rewind: ["0 0 12 12", "M5 3L2 6l3 3M2 6h6a2.5 2.5 0 010 5H7", 1.6],
    moon: ["0 0 16 16", "M13.5 9.6A5.7 5.7 0 0 1 6.4 2.5a5.7 5.7 0 1 0 7.1 7.1z", 1.5],
    sun: ["0 0 16 16", "M10.6 8a2.6 2.6 0 1 1-5.2 0a2.6 2.6 0 1 1 5.2 0M8 1.2v1.6M8 13.2v1.6M14.8 8h-1.6M2.8 8H1.2M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1M12.8 12.8l-1.1-1.1M4.3 4.3L3.2 3.2", 1.5],
    star: ["0 0 12 12", "M6 1l1.5 3.2 3.5.4-2.6 2.4.7 3.5L6 8.8 2.9 10.5l.7-3.5L1 4.6l3.5-.4z", 1.2],
  };
  function icon(name, size = 14, filled = false) {
    const [vb, d, sw] = ICON[name];
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    const [, , w, hgt] = vb.split(" ").map(Number);
    svg.setAttribute("viewBox", vb);
    svg.setAttribute("width", String(size * (w / Math.max(w, hgt))));
    svg.setAttribute("height", String(size * (hgt / Math.max(w, hgt))));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", filled ? "currentColor" : "none");
    svg.setAttribute("stroke", filled ? "none" : "currentColor");
    svg.setAttribute("stroke-width", String(sw));
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
    return svg;
  }

  // 不用 innerHTML：YouTube 这类网站开着 Trusted Types，往页面里塞 HTML 字符串会直接抛错，
  // 整个界面搭不起来。一个元素一个元素地建。
  function h(tag, attrs = {}, kids = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "text") el.textContent = v;
      else if (k === "style") el.style.cssText = v;   // 走 CSSOM：严格 CSP 的网站不让 setAttribute("style")
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid != null) el.append(kid);
    return el;
  }

  // 长按（预设格、照片格）：按住 0.45 秒；长按过的那一下不再算点击
  function longPress(el, fn) {
    let timer = 0, fired = false;
    const cancel = () => clearTimeout(timer);
    el.addEventListener("pointerdown", () => { fired = false; timer = setTimeout(() => { fired = true; fn(); }, 450); });
    for (const t of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(t, cancel);
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); cancel(); fired = true; fn(); });
    el.addEventListener("click", (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  }

  // 样式用构造样式表挂进 shadow root：严格 style-src 的站会把 <style> 整个挡掉，整套界面就成了裸元素（10-21 夜复现）；
  // 构造样式表不归 CSP 管。老浏览器没有它再退回 <style>
  function attachStyles(rootNode, css) {
    try {
      if ("adoptedStyleSheets" in rootNode && typeof CSSStyleSheet === "function") {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        rootNode.adoptedStyleSheets = [sheet];
        return;
      }
    } catch { /* 退回 <style> */ }
    rootNode.append(h("style", { text: css }));
  }

  let host = null, root = null, ui = null, hidden = false, barTimer = 0;
  const history = [];
  const laneFree = [0, 0, 0, 0];
  let look = defaultLook();
  let active = false, startedAt = 0, filmTitle = "", linkOk = true;
  let pageMode = false;   // 「一起逛」：没有视频的页面，铺满整个屏幕
  let handsOn = false;    // 抽屉里「让他动手」，默认关
  let handleOn = false;   // 抽屉里「条藏起来后留个把手」，默认关（只有触屏有这一行）
  const logItems = [];   // { el, who }：改了气泡设置要重画

  function mountUi() {
    if (host) return;
    host = document.createElement("wt-host");
    host.style.cssText = "display:block;position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;width:0;height:0;";
    root = host.attachShadow({ mode: "closed" });
    ui = {};
    const keep = (name, el) => { ui[name] = el; return el; };
    const stage = keep("stage", h("div", { class: nativeCompose ? "stage native" : "stage" }));
    stage.style.setProperty("--dw", "min(340px, calc(100cqw - 32px))");

    // 底部输入条：一个点 + 输入框 + 发送 + 抽屉
    const bar = keep("bar", h("div", { class: "bar" }, [
      keep("start", h("button", { class: "start", text: "一起看" })),
      keep("dot", h("div", { class: "dot", role: "img", "aria-label": "他看得见" }, [h("span")])),
      h("label", { style: "display:flex" }, [h("span", { class: "sr", text: "跟他说" }),
        keep("say", nativeCompose
          ? h("button", { class: "say fake", type: "button", text: "跟他说…" })
          : h("input", { class: "say", placeholder: "跟他说…", maxlength: "200" }))]),
      keep("send", h("button", { class: "round send", "aria-label": "发送" }, [icon("send", 16)])),
      keep("more", h("button", { class: "round more", "aria-label": "聊天记录和设置" }, [icon("menu", 16)])),
    ]));

    // 抽屉 · 聊天记录
    const main = h("div", { class: "page main on" }, [
      h("div", { class: "head" }, [
        h("div", { style: "display:flex;flex-direction:column;gap:2px;min-width:0" }, [
          keep("dtitle", h("div", { class: "dtitle", text: "" })),
          keep("dsub", h("div", { class: "dsub", text: "" })),
        ]),
        h("div", { style: "display:flex;gap:8px" }, [
          keep("modeBtn", h("button", { class: "icon", "aria-label": "切换浅色 / 深色" })),
          keep("gear", h("button", { class: "icon", "aria-label": "设置" }, [icon("gear", 15)])),
          keep("close", h("button", { class: "icon", "aria-label": "关上" }, [icon("x", 11)])),
        ]),
      ]),
      keep("log", h("div", { class: "log" })),
      keep("group", h("div", { class: "group" }, [
        keep("foldHead", h("button", { class: "cell foldhead", type: "button", "aria-label": "设置" }, [
          h("span", { text: "设置" }), h("span", { class: "arr", text: "⌄" })])),
        h("div", { class: "cell col" }, [
          h("div", { class: "row" }, [h("span", { text: "他多久看一眼" }), keep("ival", h("span", { class: "val", text: "3 分钟" }))]),
          keep("slider", h("input", { type: "range", min: "30", max: "900", step: "30", value: "180", "aria-label": "他多久看一眼" })),
        ]),
        h("label", { class: "cell" }, [h("span", { text: "同步进聊天记录" }),
          h("span", { class: "sw" }, [keep("sync", h("input", { type: "checkbox", "aria-label": "同步进聊天记录" })), h("span")])]),
        keep("earsRow", h("label", { class: "cell", style: "display:none" }, [h("span", { text: "他听得到声音（Gemini）" }),
          h("span", { class: "sw" }, [keep("earsSw", h("input", { type: "checkbox", "aria-label": "他听得到声音" })), h("span")])])),
        h("label", { class: "cell" }, [h("span", { text: "让他自己挑帧" }),
          h("span", { class: "sw" }, [keep("pick", h("input", { type: "checkbox", "aria-label": "让他自己挑帧" })), h("span")])]),
        keep("handsRow", h("label", { class: "cell", style: "display:none" }, [
          h("span", { style: "display:flex;flex-direction:column;gap:2px" }, [h("span", { text: "让他动手" }),
            h("span", { class: "val", style: "font-size:11px", text: "往下滑、点东西、走棋；在你登着的网站上，他点的就是你点的" })]),
          h("span", { class: "sw" }, [keep("handsSw", h("input", { type: "checkbox", "aria-label": "让他动手" })), h("span")])])),
        keep("handleRow", h("label", { class: "cell", style: coarse() ? "" : "display:none" }, [
          h("span", { style: "display:flex;flex-direction:column;gap:2px" }, [h("span", { text: "条藏起来后留个把手" }),
            h("span", { class: "val", style: "font-size:11px", text: "一点画面就暂停的站打开它：碰把手才展开，不用去点画面" })]),
          h("span", { class: "sw" }, [keep("handleSw", h("input", { type: "checkbox", "aria-label": "条藏起来后留个把手" })), h("span")])])),
        keep("subCell", h("div", { class: "cell col" }, [
          h("div", { class: "row" }, [h("span", { text: "字幕" }), h("span", { style: "display:flex;gap:14px" }, [
            keep("findBtn", h("button", { class: "linkbtn", text: "找字幕" })),
            keep("srtBtn", h("button", { class: "linkbtn", text: "导入 .srt" })),
          ])]),
          // 找字幕：默认拿片名搜，中文名搜不到就改成英文名；点一条装上
          keep("finder", h("div", { class: "finder" }, [
            h("div", { class: "fq" }, [
              keep("fquery", h("input", { "aria-label": "搜字幕的片名", placeholder: "英文片名搜得最准" })),
              keep("fgo", h("button", { text: "搜" })),
            ]),
            keep("fstat", h("div", { class: "fstat", text: "" })),
            keep("flist", h("div", { class: "flist" })),
          ])),
          keep("srt", h("input", { type: "file", accept: ".srt,text/plain", style: "display:none" })),
          keep("sub", h("div", { class: "sub" }, [
            h("button", { "data-d": "-5", text: "−5s" }), h("button", { "data-d": "-0.5", text: "−0.5s" }),
            h("button", { "data-d": "0.5", text: "+0.5s" }), h("button", { "data-d": "5", text: "+5s" }),
            keep("subnow", h("span", { class: "subnow", text: "" })),
          ])),
        ])),
      ])),
      h("div", { class: "foot" }, [keep("end", h("button", { class: "endbtn", text: "结束这一场" }))]),
    ]);

    // 抽屉 · 设置（背景、预设、BUBBLE / GLASS / SHAPE——照搬宿主 App 的「我的气泡」）
    const settings = h("div", { class: "page settings" }, [
      h("div", { class: "head left" }, [
        keep("back", h("button", { class: "icon", "aria-label": "返回聊天记录" }, [icon("back", 13)])),
        h("div", { class: "dtitle", text: "设置" }),
      ]),
      h("div", { class: "scroll" }, [
        h("div", { class: "sec" }, [h("div", { class: "sech" }, [h("span", { text: "背景" }), h("span", { text: "左右滑" })]),
          keep("bgs", h("div", { class: "bgs" })),
          keep("bgFile", h("input", { type: "file", accept: "image/*", style: "display:none" }))]),
        h("div", { class: "sec" }, [h("div", { class: "sech" }, [h("span", { text: "预设" }), h("span", { text: "长按改名 / 覆盖" })]),
          keep("presets", h("div", { class: "presets" }))]),
        keep("bubbleCard", h("div", { class: "card" }, [h("div", { class: "cardh", text: "BUBBLE" })])),
        keep("glassCard", h("div", { class: "card" }, [h("div", { class: "cardh", text: "GLASS" })])),
        keep("shapeCard", h("div", { class: "card" }, [h("div", { class: "cardh", text: "SHAPE" })])),
      ]),
    ]);

    const drawer = keep("drawer", h("div", { class: "drawer" }, [
      keep("photo", h("div", { class: "photo" })), h("div", { class: "veil2" }),
      keep("pageMain", main), keep("pageSettings", settings),
      keep("sheet", h("div", { class: "sheet" })),
    ]));

    // 收卡票根
    const dim = keep("dim", h("div", { class: "dim" }, [
      keep("ticket", h("div", { class: "ticket", role: "dialog", "aria-label": "结束这一场" }, [
        h("div", { style: "display:flex;flex-direction:column;gap:4px" }, [
          keep("tmeta", h("div", { class: "tmeta", text: "" })),
          h("label", { style: "display:flex;flex-direction:column" }, [h("span", { class: "sr", text: "片名" }),
            keep("wtitle", h("input", { class: "ttitle", maxlength: "80" }))]),
        ]),
        h("div", { style: "display:flex;flex-direction:column;gap:8px" }, [
          h("div", { class: "th" }, [h("span", { text: "想留哪几句" }), h("span", { style: "display:flex;align-items:center;gap:10px" }, [
            keep("pcount", h("span", { text: "" })), keep("pall", h("button", { class: "pall", type: "button", text: "全选" }))])]),
          keep("picks", h("div", { class: "picks" })),
        ]),
        keep("wextra", h("div", { class: "two" }, [
          keep("occFld", h("label", { class: "fld" }, [h("span", { text: "今天是什么日子" }),
            keep("occasion", h("input", { maxlength: "80", placeholder: "可以不写" }))])),
          h("div", { class: "fld" }, [
            h("span", { style: "display:flex;justify-content:space-between" }, [h("span", { text: "截图" }), h("span", { style: "font-size:12px", text: "点星星设主图 · 点图不留" })]),
            keep("shots", h("div", { class: "shots" })),
          ]),
        ])),
        keep("wreview", h("label", { class: "fld" }, [h("span", { text: "我的观后感" }),
          keep("review", h("textarea", { maxlength: "2000", placeholder: "可以不写" }))])),
        h("div", { class: "tbtns" }, [
          keep("done", h("button", { class: "pri", text: "看完了，收进观影卡" })),
          h("div", { class: "two", style: "gap:8px" }, [
            keep("later", h("button", { text: "改天再看" })),
            keep("discard", h("button", { class: "soft", text: "什么都不留" })),
          ]),
        ]),
      ])),
    ]));

    const handle = keep("handle", h("button", { class: "handle", type: "button", "aria-label": "展开输入条" }, [h("span", { class: "hd" }), h("span", { class: "hb" })]));
    stage.append(keep("lanes", h("div", { class: "lanes" })), bar, handle, drawer, dim);
    attachStyles(root, CSS);
    root.append(stage);
    buildSettings();
    wire();
    updateModeUi();
    setActive(false);
    applyLook();
    reparent();
    place();
    poke();   // 一进来先亮 3 秒，知道这页能一起看
  }

  // 全屏时把自己挪进全屏的那块里，不然会被盖住
  function reparent() {
    if (!host) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    (fs || document.documentElement).appendChild(host);
  }
  document.addEventListener("fullscreenchange", reparent);
  document.addEventListener("webkitfullscreenchange", reparent);

  // 手机横屏：有的站把播放框按宽度算 16:9（ikanbot），横屏时框比屏幕还高，控制条整条压在屏幕外只剩一条线
  //（10-22 在模拟器里量的：框 422 高、屏 402，进度条 y=392）。把框压到屏幕那么高——视频自己 object-fit 左右留黑边，
  // 控制条就回来了。只在手机壳里、横屏、视频框从顶上开始又比屏高时动手；竖屏 / 换了视频就还原。电脑上不动
  let fitted = [];
  function unfit() {
    for (const { el, props } of fitted) for (const k of props) el.style.removeProperty(k);
    fitted = [];
    if (ui) ui.bar.classList.remove("fit");
  }
  function fitTall() {
    if (!nativeCompose || !video || pageMode || innerWidth <= innerHeight) { if (fitted.length) unfit(); return; }
    if (fitted.length) return;   // 压过了就不再量：压完框正好等于屏高，再量会以为不用压
    const r = video.getBoundingClientRect();
    if (!(r.top <= 1 && r.height > innerHeight + 2 && r.width <= innerWidth + 1)) return;
    const h = `${innerHeight}px`, props = ["height", "max-height", "padding-top", "padding-bottom"];
    // 从视频往上，凡是跟视频一样高的那一串（播放器、16:9 的壳子）都压到屏高；更高的外层不碰
    for (let el = video; el && el !== document.body; el = el.parentElement) {
      const er = el.getBoundingClientRect();
      if (Math.abs(er.height - r.height) > 3 || er.top > r.top + 3) continue;
      el.style.setProperty("height", h, "important");
      el.style.setProperty("max-height", h, "important");
      el.style.setProperty("padding-top", "0px", "important");
      el.style.setProperty("padding-bottom", "0px", "important");
      fitted.push({ el, props });
    }
    if (fitted.length && ui) ui.bar.classList.add("fit");
  }

  let frameCount = 0, belowNow = false;
  const BELOW_STRIP = 54;
  function place() {
    // 抖音会把定时器全清掉，requestAnimationFrame 清不掉：在这里每 30 帧（约半秒）复查一次是哪条视频
    if (++frameCount % 30 === 0) { recheck(); earsTick(); fitTall(); }
    if (host && pageMode) {
      host.style.left = "0px"; host.style.top = "0px";
      host.style.width = `${innerWidth}px`; host.style.height = `${innerHeight}px`;
    } else if (host && video) {
      const r = visibleRect(video.getBoundingClientRect(), innerWidth, innerHeight);
      // 手机竖屏：视频框矮（不到 300px）时输入条不进框里，贴在视频下沿外面——框往下多留一条放它（她 10-22 定的）。
      // 播放框正好跟视频一样高、下面没地方的站，条还是留在视频里，不然就看不见了
      const below = nativeCompose && r.height < 300 && r.width > r.height && innerHeight - (r.top + r.height) >= BELOW_STRIP;
      host.style.left = `${r.left}px`;
      host.style.top = `${r.top}px`;
      host.style.width = `${r.width}px`;
      host.style.height = `${r.height + (below ? BELOW_STRIP : 0)}px`;
      if (ui && below !== belowNow) { belowNow = below; ui.bar.classList.toggle("below", below); ui.handle.classList.toggle("below", below); }
    }
    requestAnimationFrame(place);
  }

  const drawerOpen = () => ui.drawer.classList.contains("open");
  const ticketOpen = () => ui.dim.classList.contains("on");
  // 3 秒没碰就藏起来，碰画面再出来；抽屉里开了把手就缩成把手、碰把手才出来（她 10-22：做成设置，默认关）
  const coarse = () => !!window.matchMedia?.("(pointer: coarse)").matches;
  const handleWanted = () => handleOn && coarse();
  function poke() {
    if (!ui) return;
    ui.bar.classList.add("show");
    ui.handle.classList.remove("on");
    clearTimeout(barTimer);
    barTimer = setTimeout(() => {
      // 真输入框有焦点就不藏；手机上的假输入框是个按钮，点过就一直带着焦点，不能拿它当「在打字」（她 10-22：开了把手条也不收）
      if (!ui || (!nativeCompose && root.activeElement === ui.say) || drawerOpen()) return;
      ui.bar.classList.remove("show");
      if (handleWanted() && !ui.bar.classList.contains("away") && !ui.bar.classList.contains("composing")) ui.handle.classList.add("on");
    }, 3000);
  }
  // 开着把手时碰画面不唤条（手指按下那一瞬条冒出来会接住这一下的 click）；没开就照旧
  document.addEventListener("pointermove", () => { if (!handleWanted()) poke(); }, true);
  document.addEventListener("pointerdown", () => { if (!handleWanted()) poke(); }, true);

  const fmtIval = (s) => (s < 60 ? `${s} 秒` : `${Math.round(s / 6) / 10} 分钟`);

  // 她说了一句：飘成弹幕、留进抽屉、递给大管家。字从网页输入框来（sendLine），或从壳的原生输入条来（__wt.say）
  function sayLine(raw) {
    const text = String(raw == null ? "" : raw).trim().slice(0, 200);
    if (!text || !ui) return false;
    show(text, "her", null, null);
    post({ type: "user_said", text, at: nowAt() });
    return true;
  }
  function sendLine() {
    if (!sayLine(ui.say.value)) return;
    ui.say.value = "";
    // 手机上发完把键盘收掉：键盘一直在，网页被顶着，进度条在屏幕外面点不到
    if (window.matchMedia?.("(pointer: coarse)").matches) ui.say.blur();
  }
  // 壳的原生输入条拿出来 / 收回去：这边自己那条让开 / 回来，别两条叠着
  function setComposing(on) {
    if (!ui) return;
    ui.bar.classList.toggle("composing", !!on);
    if (on) ui.handle.classList.remove("on");
    else poke();
  }
  const askCompose = () => { post({ type: "compose", link: linkOk, page: pageMode }); ui.say.blur(); };

  const sendSettings = () => post({ type: "settings", interval_sec: Number(ui.slider.value),
    frame_mode: ui.pick.checked ? "pick" : "auto", sync_chat: ui.sync.checked, ears: ui.earsSw.checked, hands: ui.handsSw.checked, handle: ui.handleSw.checked });

  function wire() {
    // 打字的时候别让网站的快捷键（空格暂停、f 全屏）抢走按键
    for (const el of [ui.say, ui.drawer, ui.dim]) {
      for (const t of ["keydown", "keyup", "keypress"]) el.addEventListener(t, (e) => e.stopPropagation());
    }
    if (nativeCompose) {
      ui.say.addEventListener("click", askCompose);
      ui.send.addEventListener("click", askCompose);
    } else {
      ui.say.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) sendLine(); });
      ui.send.addEventListener("click", sendLine);
    }
    for (const t of ["pointerdown", "click"]) ui.handle.addEventListener(t, (e) => { e.stopPropagation(); if (t === "click") poke(); });
    ui.handleSw.addEventListener("change", () => { handleOn = ui.handleSw.checked; sendSettings(); if (!handleOn) ui.handle.classList.remove("on"); });
    ui.start.addEventListener("click", start);
    ui.more.addEventListener("click", () => openDrawer(!drawerOpen()));
    ui.close.addEventListener("click", () => openDrawer(false));
    ui.gear.addEventListener("click", () => showPage("settings"));
    ui.modeBtn.addEventListener("click", toggleMode);
    ui.back.addEventListener("click", () => showPage("main"));
    // 一起逛没有观影卡：结束就是结束
    ui.end.addEventListener("click", () => openWrap());
    ui.slider.addEventListener("input", () => { ui.ival.textContent = fmtIval(Number(ui.slider.value)); });
    ui.slider.addEventListener("change", sendSettings);
    ui.pick.addEventListener("change", sendSettings);
    ui.sync.addEventListener("change", sendSettings);
    ui.earsSw.addEventListener("change", () => { earsOn = active && ui.earsSw.checked; sendSettings(); });
    ui.handsSw.addEventListener("change", () => { handsOn = ui.handsSw.checked; sendSettings(); });
    ui.srtBtn.addEventListener("click", () => ui.srt.click());
    const searchSubs = () => post({ type: "subtitles_search", query: ui.fquery.value.trim() });
    ui.findBtn.addEventListener("click", () => {
      const on = !ui.finder.classList.contains("on");
      ui.finder.classList.toggle("on", on);
      if (on && !ui.fquery.value) { ui.fquery.value = filmTitle || document.title || ""; searchSubs(); }
    });
    ui.fgo.addEventListener("click", searchSubs);
    ui.fquery.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) searchSubs(); });
    ui.srt.addEventListener("change", async () => {
      const f = ui.srt.files && ui.srt.files[0];
      if (!f) return;
      post({ type: "subtitles_import", name: f.name, text: await f.text() });
      ui.srt.value = "";
    });
    ui.sub.addEventListener("click", (e) => {
      const d = Number(e.target?.dataset?.d);
      if (d) post({ type: "subtitle_offset", delta: d });
    });
    // 票根
    ui.dim.addEventListener("click", (e) => { if (e.target === ui.dim) closeWrap(); });
    ui.picks.addEventListener("change", countPicks);
    ui.pall.addEventListener("click", toggleAllPicks);
    ui.foldHead.addEventListener("click", () => ui.group.classList.toggle("folded"));
    ui.later.addEventListener("click", () => submitWrap(false));
    ui.done.addEventListener("click", () => submitWrap(true));
    // 刷抖音这种：直接结束，不建卡、不叫他写
    ui.discard.addEventListener("click", () => { post(pageMode ? { type: "browse_end", keep: false } : { type: "stop_request" }); closeWrap(); });
    ui.bgFile.addEventListener("change", importPhoto);
  }

  // 一起看 / 一起逛：按钮字、字幕和耳朵那几行、「让他动手」那行跟着换
  function updateModeUi() {
    ui.start.textContent = pageMode ? "一起逛" : "一起看";
    ui.bar.classList.toggle("video", !pageMode);
    ui.subCell.style.display = pageMode ? "none" : "";
    ui.handsRow.style.display = pageMode ? "" : "none";
    if (pageMode) ui.earsRow.style.display = "none";
  }

  function start() {
    // 只有她点过「跳过去」、视频真在那附近，才算接着看；直接按「一起看」就是从头看，别跟他说成接着看的
    const near = resumeAt != null && video && Math.abs(video.currentTime - resumeAt) < 60;
    post({ type: "start_request", mode: pageMode ? "page" : "video", title: document.title || location.hostname, url: location.href,
      ...(near ? { resumed_from: resumeAt } : {}) });
    resumeAt = null;
  }

  // ── 抽屉 ─────────────────────────────────────────────
  // 抽屉打开时输入条挪到左边那块的正中，不然「≡」会被抽屉盖住、关不掉
  function openDrawer(open) {
    if (useSheets()) { if (open) post({ type: "sheet", kind: "drawer" }); return; }
    // 窄画面（手机）打开抽屉时设置那几行先收起来
    if (open) {
      const narrow = Math.min(host?.clientWidth || innerWidth, host?.clientHeight || innerHeight) < 600 || Math.min(innerWidth, innerHeight) < 600;
      ui.foldHead.style.display = narrow ? "" : "none";
      ui.group.classList.toggle("folded", narrow);
    }
    ui.drawer.classList.toggle("open", open);
    ui.bar.classList.toggle("aside", open);
    if (open) { refreshHead(); ui.log.scrollTop = ui.log.scrollHeight; poke(); } else { showPage("main"); hideSheet(); }
  }
  function showPage(which) {
    ui.pageMain.classList.toggle("on", which === "main");
    ui.pageSettings.classList.toggle("on", which === "settings");
    hideSheet();
  }
  function refreshHead() {
    ui.dtitle.textContent = filmTitle || document.title || "一起看";
    const min = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 60000)) : 0;
    ui.dsub.textContent = active ? `${pageMode ? "一起逛" : "一起看"}了 ${min} 分钟` : "";
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !ui) return;
    if (ticketOpen()) closeWrap();
    else if (ui.sheet.classList.contains("on")) hideSheet();
    else if (ui.pageSettings.classList.contains("on")) showPage("main");
    else if (drawerOpen()) openDrawer(false);
  }, true);

  // 说话那一刻记的时间：看片是片内时间；一起逛没有片子，记逛了多久
  function nowAt() {
    if (video && !pageMode) return video.currentTime;
    return startedAt ? (Date.now() - startedAt) / 1000 : 0;
  }

  function setActive(a) {
    if (a && !active) startedAt = Date.now();
    active = a;
    ui.start.style.display = a ? "none" : "";
    for (const el of [ui.dot, ui.say.parentElement, ui.send, ui.more]) el.style.display = a ? "" : "none";
    if (!a) { openDrawer(false); closeWrap(); earsOn = false; earsTick(); }
  }

  function setLink(ok) {
    linkOk = ok;
    ui.dot.classList.toggle("bad", !ok);
    ui.handle.classList.toggle("bad", !ok);
    ui.dot.setAttribute("aria-label", ok ? "他看得见" : "连接异常");
  }

  // ── 他和她说的话：一律飘成弹幕，抽屉里留一份 ─────────────
  // 一句隔 1.6 秒飘（同时飘好几条看不过来，她 10-21）；道都忙着就等最早空出来的那条，别叠在前一句的尾巴上；
  // 截图藏字的那一下也等一等，不丢句（以前这时候来的话只进抽屉、不飘）
  let nextFlyAt = 0, flyTimer = 0;
  const flyQueue = [];
  function show(text, who, late, lateSec) {
    const at = lateSec != null ? lateSec : nowAt();
    history.push({ who, text, late, at });
    addLog(text, who, late ? { label: late, at } : null);
    flyQueue.push({ text, who, jump: late ? { label: late, at } : null });
    pumpFlies();
    if (nativeSheets) post({ type: "sheet_line" });
  }
  // 放得下几条道：第 n 道占 8+36n 到 8+36n+29px。竖屏手机的视频框只有两百来像素高，
  // 硬塞四道的话后两道在 overflow:hidden 外面，他每三四句就有一句看不见（10-21 夜）
  function laneCount() {
    const hgt = ui ? ui.lanes.clientHeight : 0;
    return Math.max(1, Math.min(laneFree.length, Math.floor((hgt - 1) / 36)));
  }
  function pumpFlies() {
    clearTimeout(flyTimer);
    flyTimer = 0;
    if (!flyQueue.length || !ui) return;
    const now = Date.now();
    const lanes = laneCount();
    let lane = 0;
    for (let i = 1; i < lanes; i += 1) if (laneFree[i] < laneFree[lane]) lane = i;
    const when = Math.max(now, nextFlyAt, laneFree[lane], hidden ? now + 150 : 0);
    if (when > now) { flyTimer = setTimeout(pumpFlies, when - now); return; }
    const item = flyQueue.shift();
    nextFlyAt = now + 1600;
    fly(item.text, item.who, item.jump, lane);
    if (flyQueue.length) flyTimer = setTimeout(pumpFlies, 1600);
  }

  function addLog(text, who, jump) {
    const item = h("div", { class: `item ${who}` });
    const bub = h("div", { class: "bub", text });
    item.append(bub);
    if (jump) item.append(h("button", { class: "jump", text: `${jump.label} · 跳回这里`, on: { click: () => seekBack(jump.at) } }));
    ui.log.append(item);
    logItems.push({ el: bub, who });
    paintBubble(bub, who);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function seekBack(at) {
    if (video) video.currentTime = Math.max(0, Number(at) || 0);
  }

  function fly(text, who, jump, lane = 0) {
    const el = h("div", { class: `fly ${who}` });
    if (jump) {
      el.append(h("button", { class: "tag", "aria-label": `跳回 ${jump.label}`, on: { click: () => seekBack(jump.at) } },
        [icon("rewind", 11), jump.label]));
    }
    el.append(h("span", { text }));
    el.style.top = `${8 + lane * 36}px`;
    ui.lanes.appendChild(el);
    const w = host.clientWidth || 600;
    const tw = el.offsetWidth;
    const dur = flyDuration(w, tw, Array.from(text).length);
    laneFree[lane] = Date.now() + (tw + 40) / ((w + tw) / dur);   // 尾巴离开右边 40px，这条道就能放下一条
    el.animate([{ transform: `translateX(${w}px)` }, { transform: `translateX(${-tw}px)` }],
      { duration: dur, easing: "linear" }).onfinish = () => el.remove();
  }

  // ── 抽屉的样子 ─────────────────────────────────────────
  const curStyle = () => look.style || SEED;
  const isLight = () => look.mode === "light";
  // 纯黑一定是深色、米白一定是浅色；画面玻璃和照片两种都行
  function setBg(key) {
    look.bg = key;
    if (key === "black") look.mode = "dark";
    if (key === "cream") look.mode = "light";
    applyLook(); saveLook();
  }
  function toggleMode() {
    look.mode = isLight() ? "dark" : "light";
    if (look.bg === "black" && isLight()) look.bg = "cream";
    else if (look.bg === "cream" && !isLight()) look.bg = "black";
    applyLook(); saveLook();
  }
  function paintBubble(el, who) {
    Object.assign(el.style, bubbleLook(look.style, who === "her", isLight()));
  }

  let saveTimer = 0;
  function saveLook() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => post({ type: "appearance_save", appearance: look }), 400);
  }
  function editStyle(patch) {
    look.style = { ...curStyle(), ...patch };
    applyLook();
    saveLook();
  }

  function applyLook() {
    const d = ui.drawer;
    for (const c of ["bg-glass", "bg-black", "bg-cream", "bg-photo"]) d.classList.remove(c);
    const m = /^photo:(\d+)$/.exec(look.bg);
    d.classList.add(m ? "bg-photo" : `bg-${look.bg}`);
    d.classList.toggle("light", isLight());
    ui.modeBtn.textContent = "";
    ui.modeBtn.append(icon(isLight() ? "sun" : "moon", 15));
    ui.photo.style.backgroundImage = m ? `url("${look.photos[Number(m[1])]}")` : "none";
    for (const it of logItems) paintBubble(it.el, it.who);
    ui.log.style.gap = `${curStyle().spacing}px`;
    renderBgs();
    renderPresets();
    refreshControls();
  }

  function renderBgs() {
    const row = ui.bgs;
    row.textContent = "";
    row.append(h("button", { class: "bgt imp", "aria-label": "导入背景", on: { click: () => ui.bgFile.click() } }, [icon("plus", 16), "导入"]));
    const tile = (key, cls, label) => {
      const b = h("button", { class: `bgt ${cls}${look.bg === key ? " sel" : ""}`, text: label,
        on: { click: () => setBg(key) } });
      row.append(b);
      return b;
    };
    tile("glass", "glass", "画面玻璃");
    tile("black", "black", "纯黑");
    tile("cream", "cream", "米白");
    look.photos.forEach((src, i) => {
      const b = tile(`photo:${i}`, "photo", "");
      b.style.backgroundImage = `url("${src}")`;
      b.setAttribute("aria-label", `照片 ${i + 1}`);
      longPress(b, () => showSheet({ title: "这张照片", actions: [{ label: "删掉", danger: true, fn: () => {
        look.photos.splice(i, 1);
        const cur = /^photo:(\d+)$/.exec(look.bg);
        if (cur) { const n = Number(cur[1]); look.bg = n === i ? "glass" : n > i ? `photo:${n - 1}` : look.bg; }
        applyLook(); saveLook();
      } }] }));
    });
  }

  // 导入的照片先缩到 1000px 以内的 JPEG：存在大管家那边，开新页面时还要递过来
  async function importPhoto() {
    const f = ui.bgFile.files && ui.bgFile.files[0];
    ui.bgFile.value = "";
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      let url = c.toDataURL("image/jpeg", 0.8);
      if (url.length > 580000) url = c.toDataURL("image/jpeg", 0.6);
      if (look.photos.length >= 4) look.photos.shift();
      look.photos.push(url);
      look.bg = `photo:${look.photos.length - 1}`;
      applyLook();
      saveLook();
    } catch { /* 读不了的图就算了 */ }
  }

  function renderPresets() {
    const grid = ui.presets;
    grid.textContent = "";
    const mini = (style) => {
      const a = h("span"), b = h("span");
      Object.assign(a.style, bubbleLook(style, false, isLight()), { width: "18px", maxWidth: "none", borderRadius: "6px" });
      Object.assign(b.style, bubbleLook(style, true, isLight()), { width: "14px", maxWidth: "none", borderRadius: "6px" });
      return h("span", { class: "mini" }, [a, b]);
    };
    grid.append(h("button", { class: `pt${look.style ? "" : " sel"}`, on: { click: () => { look.style = null; applyLook(); saveLook(); } } },
      [mini(null), h("span", { class: "nm", text: "液态玻璃" })]));
    look.presets.forEach((p, i) => {
      if (!p) {
        grid.append(h("button", { class: "pt empty", text: "存当前", on: { click: () => nameSlot(i, "") } }));
        return;
      }
      const b = h("button", { class: `pt${sameStyle(look.style, p.style) ? " sel" : ""}`,
        on: { click: () => { look.style = { ...p.style }; applyLook(); saveLook(); } } }, [mini(p.style), h("span", { class: "nm", text: p.name })]);
      longPress(b, () => showSheet({ title: `「${p.name}」`, actions: [
        { label: "改名", fn: () => nameSlot(i, p.name) },
        { label: "用现在的样子覆盖", fn: () => { look.presets[i] = { name: p.name, style: { ...curStyle() } }; applyLook(); saveLook(); } },
        { label: "清空这一格", danger: true, fn: () => { look.presets[i] = null; applyLook(); saveLook(); } },
      ] }));
      grid.append(b);
    });
  }

  function nameSlot(i, current) {
    showSheet({ title: current ? "改个名字" : "给现在的样子起个名字", input: current || "我的样子", actions: [
      { label: "存", pri: true, fn: (name) => {
        const n = String(name || "").trim().slice(0, 12) || "未命名";
        look.presets[i] = current ? { ...look.presets[i], name: n } : { name: n, style: { ...curStyle() } };
        applyLook(); saveLook();
      } },
    ] });
  }

  function showSheet({ title, input = null, actions }) {
    const s = ui.sheet;
    s.textContent = "";
    s.append(h("div", { class: "st", text: title }));
    const field = input != null ? h("input", { maxlength: "12", value: input, "aria-label": "名字" }) : null;
    if (field) s.append(field);
    const acts = h("div", { class: "acts" });
    for (const a of actions) {
      acts.append(h("button", { class: a.pri ? "pri" : a.danger ? "danger" : null, text: a.label,
        on: { click: () => { hideSheet(); a.fn(field ? field.value : undefined); } } }));
    }
    acts.append(h("button", { text: "取消", on: { click: hideSheet } }));
    s.append(acts);
    s.classList.add("on");
    if (field) { field.focus(); field.select(); field.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) acts.firstChild.click(); }); }
  }
  function hideSheet() { ui.sheet.classList.remove("on"); }

  // 设置页的控件：建一次，之后 refreshControls 把数值同步上去
  const controls = [];
  function buildSettings() {
    const slider = (card, label, key, min, max, step, fmt) => {
      const val = h("span", { class: "val" });
      const input = h("input", { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": label,
        on: { input: (e) => editStyle({ [key]: Number(e.target.value) }) } });
      card.append(h("label", { class: "sl" }, [h("span", { style: "display:flex;justify-content:space-between" }, [h("span", { text: label }), val]), input]));
      controls.push(() => { const v = curStyle()[key]; input.value = String(v); val.textContent = fmt(v); });
    };
    const toggle = (card, label, key) => {
      const input = h("input", { type: "checkbox", class: "chk", on: { change: (e) => editStyle({ [key]: e.target.checked }) } });
      card.append(h("label", { class: "line" }, [h("span", { text: label }), input]));
      controls.push(() => { input.checked = !!curStyle()[key]; });
    };
    const color = (label, key, mine, ink) => {
      const input = h("input", { type: "color", "aria-label": label, on: { input: (e) => editStyle({ [key]: e.target.value.slice(1).toUpperCase() }) } });
      controls.push(() => {
        // 默认「液态玻璃」时色块显示画面上真的看到的颜色（他暖金字），不是 SEED 估出来的
        if (!look.style) { input.value = `#${(key === "textMu" && isLight() ? "1C1C1E" : LEGACY_SWATCH[key]).toLowerCase()}`; return; }
        const st = curStyle();
        const v = st[key] || (ink ? rgbHex(bubbleLook(st, mine, isLight()).color) : mine ? "FFFFFF" : "FFD98A");
        input.value = `#${v.toLowerCase()}`;
      });
      return input;
    };
    const pct = (v) => `${Math.round(v * 100)}%`;

    const b = ui.bubbleCard;
    const mats = h("div", { class: "mats" });
    const LABEL = { solid: "纯色", translucent: "半透明", glass: "玻璃", gradient: "渐变" };
    for (const m of MATERIALS) {
      const btn = h("button", { text: LABEL[m], on: { click: () => editStyle({ material: m }) } });
      mats.append(btn);
      controls.push(() => btn.classList.toggle("sel", curStyle().material === m));
    }
    b.append(mats);
    b.append(h("div", { class: "line" }, [h("span", { text: "主颜色" }), h("span", { class: "pair" }, [
      h("label", {}, ["他", color("他的主颜色", "colorMu", false, false)]), h("label", {}, ["我", color("我的主颜色", "colorMine", true, false)])])]));
    b.append(h("div", { class: "line" }, [h("span", { text: "文字颜色" }), h("span", { class: "pair" }, [
      h("label", {}, ["他", color("他的文字颜色", "textMu", false, true)]), h("label", {}, ["我", color("我的文字颜色", "textMine", true, true)])])]));
    slider(b, "透明度", "transparency", 0, 0.95, 0.01, pct);

    const g = ui.glassCard;
    slider(g, "模糊", "blur", 0, 1, 0.01, pct);
    slider(g, "亮度", "brightness", -0.3, 0.3, 0.01, (v) => `${Math.round((1 + v) * 100)}%`);
    slider(g, "边框光", "edgeLight", 0, 1, 0.01, pct);
    toggle(g, "内侧高光", "highlight");
    g.append(h("div", { class: "hint", text: "模糊低、边框光高 → 液态玻璃；模糊高、边框光低 → 毛玻璃。" }));

    const s = ui.shapeCard;
    const int = (v) => String(Math.round(v));
    slider(s, "圆角", "cornerRadius", 4, 24, 1, int);
    slider(s, "间距", "spacing", 2, 24, 1, int);
    slider(s, "长度", "length", 0, 60, 1, int);
    toggle(s, "气泡尾巴", "tail");
  }
  const LEGACY_SWATCH = { colorMu: "FFD98A", colorMine: "FFFFFF", textMu: "FFE7B5", textMine: "111111" };
  const rgbHex = (css) => {
    const m = /^#([0-9a-f]{6})$/i.exec(css);
    return m ? m[1].toUpperCase() : "FFFFFF";
  };
  function refreshControls() { for (const fn of controls) fn(); }

  // ── 结束这一场：画面暗下，中间一张玻璃票根 ─────────────────
  let shotList = [], coverId = null, coverTouched = false;
  const droppedShots = new Set();   // 她点掉不留的截图   // 没点过星星：卡上原来的主图不动（新卡用第一张）
  function metaLine() {
    const now = new Date();
    return pageMode
      ? `这一次 · ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 逛了 ${tc(startedAt ? (Date.now() - startedAt) / 1000 : 0)}`
      : `这一场 · ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${tc(video ? video.currentTime : 0)}`;
  }
  function openWrap() {
    openDrawer(false);
    sheetMode = useSheets();
    if (sheetMode) {
      shotList = []; coverId = null; coverTouched = false; droppedShots.clear();
      ui.bar.classList.add("away");
      ui.handle.classList.remove("on");
      post({ type: "wrap_open" });
      post({ type: "sheet", kind: "wrap", page: pageMode });
      return;
    }
    const now = new Date();
    // 一起逛的票根轻一点：没有观影卡，只留标题、想留哪几句、收进一起逛 / 什么都不留
    // 截图一起逛也挑（留哪几张、哪张当卡的主图）；「今天是什么日子」和观后感只有观影卡有
    ui.occFld.style.display = pageMode ? "none" : "";
    ui.wextra.style.gridTemplateColumns = pageMode ? "minmax(0,1fr)" : "";
    ui.ticket.classList.toggle("tall", pageMode);   // 漫画是竖着的一页：截图格子也竖着放
    ui.wreview.style.display = pageMode ? "none" : "";
    ui.later.style.display = pageMode ? "none" : "";
    ui.discard.style.gridColumn = pageMode ? "1 / -1" : "";   // 一起逛只剩这一颗，铺满一行
    ui.done.textContent = pageMode ? "收进一起逛" : "看完了，收进观影卡";
    ui.ticket.setAttribute("aria-label", pageMode ? "结束这一次" : "结束这一场");
    ui.tmeta.textContent = metaLine();
    ui.wtitle.value = pageMode ? document.title : filmTitle || document.title;
    ui.picks.textContent = "";
    if (!history.length) ui.picks.append(h("div", { class: "pempty", text: "这一场还没说话" }));
    for (const [i, line] of history.entries()) {
      ui.picks.append(h("label", { class: `pk ${line.who}` }, [
        h("input", { type: "checkbox", "data-i": String(i) }),
        h("span", { style: "display:flex;flex-direction:column;gap:2px" }, [
          h("span", { class: "pm", text: `${tc(line.at)} · ${line.who === "him" ? "他" : "我"}` }),
          h("span", { class: "px", text: line.text }),
        ]),
      ]));
    }
    countPicks();
    coverTouched = false;
    droppedShots.clear();
    renderShots([], true);
    ui.dim.classList.add("on");
    ui.bar.classList.add("away");
    ui.handle.classList.remove("on");
    post({ type: "wrap_open" });   // 大管家递回这一场的截图（递给他看过的那几张）
  }
  function closeWrap() {
    if (!ui) return;
    ui.dim.classList.remove("on");
    ui.bar.classList.remove("away");
    if (sheetMode) post({ type: "sheet", kind: "none" });
  }
  function countPicks() {
    const picked = ui.picks.querySelectorAll("input:checked").length;
    ui.pcount.textContent = pickCount(history.length, picked, pageMode ? "这一次" : "这一场");
    // 全选 / 全不选：都勾上了就变成「全不选」
    ui.pall.textContent = history.length && picked === history.length ? "全不选" : "全选";
    ui.pall.style.display = history.length ? "" : "none";
  }
  function toggleAllPicks() {
    const boxes = [...ui.picks.querySelectorAll("input")];
    const all = boxes.length && boxes.every((b) => b.checked);
    for (const b of boxes) b.checked = !all;
    countPicks();
  }
  function renderShots(frames, loading = false) {
    shotList = frames;
    if (!frames.some((f) => f.id === coverId)) coverId = frames[0]?.id ?? null;
    ui.shots.textContent = "";
    if (!frames.length) {
      ui.shots.append(h("span", { class: "noshot", text: loading ? "取图中…" : "这一场还没截到图" }));
      return;
    }
    for (const f of frames) {
      const cover = f.id === coverId;
      const tile = h("span", { class: `shot${cover ? " cover" : ""}${droppedShots.has(f.id) ? " drop" : ""}`, title: f.at || "",
        on: { click: (e) => { if (e.target.closest(".star")) return; droppedShots.has(f.id) ? droppedShots.delete(f.id) : droppedShots.add(f.id); renderShots(shotList); } } }, [
        h("button", { class: "star", "aria-label": cover ? "主图（卡片背景）" : "设为主图",
          on: { click: () => { coverId = f.id; coverTouched = true; droppedShots.delete(f.id); renderShots(shotList); } } }, [icon("star", 14, cover)]),
      ]);
      if (f.image) tile.style.backgroundImage = `url("data:image/jpeg;base64,${f.image}")`;
      ui.shots.append(tile);
    }
  }

  function submitWrap(finished) {
    const picked = [...ui.picks.querySelectorAll("input:checked")]
      .map((b) => history[Number(b.dataset.i)])
      .filter(Boolean)
      .map((l) => ({ who: l.who, text: l.text, at: l.at }));
    if (pageMode) {
      post({ type: "browse_end", keep: true, title: ui.wtitle.value.trim(), picked, cover: coverTouched ? coverId : null,
        keep_frames: shotList.filter((f) => !droppedShots.has(f.id)).map((f) => f.id) });
      closeWrap();
      return;
    }
    post({ type: "wrap_up", finished, title: ui.wtitle.value.trim(), occasion: ui.occasion.value.trim(),
      her_review: ui.review.value.trim(), picked, cover: coverTouched ? coverId : null,
      keep_frames: shotList.filter((f) => !droppedShots.has(f.id)).map((f) => f.id) });
    ui.occasion.value = "";
    ui.review.value = "";
    closeWrap();
  }

  const fmtCount = (n) => (n >= 10000 ? `${Math.round(n / 1000) / 10} 万` : String(n));
  function showCandidates(m) {
    ui.finder.classList.add("on");
    if (m.query && !ui.fquery.value) ui.fquery.value = m.query;
    ui.flist.textContent = "";
    if (m.searching) { ui.fstat.textContent = "搜索中…"; return; }
    const items = Array.isArray(m.items) ? m.items : [];
    if (m.error) { ui.fstat.textContent = m.error; return; }
    if (!items.length) { ui.fstat.textContent = "没找到——换成英文片名再搜试试"; return; }
    ui.fstat.textContent = `找到 ${items.length} 条 · 点一条装上（SDH 会把音效也写出来，他「听」得更多）`;
    for (const c of items) {
      const meta = [c.year, c.hi ? "SDH" : null, `${fmtCount(Number(c.downloads) || 0)}次下载`].filter(Boolean).join(" · ");
      ui.flist.append(h("button", { class: "fitem", on: { click: () => { ui.fstat.textContent = "下载中…"; post({ type: "subtitles_pick", id: c.id }); } } }, [
        h("span", { class: "fn", text: c.name || c.movie || "字幕" }),
        h("span", { class: "fm", text: meta }),
      ]));
    }
  }

  // ── 耳朵：一直录着视频最近的声音（一段约 15 秒，留最近两段），大管家要的时候交出去 ──
  // 视频静音也录得到（captureStream 拿的是静音之前的声音）；跳过进度的那段作废（片内时间对不上了）
  let earsOn = false, rec = null, earsClipMs = 15000;
  const clips = [];
  function earsStop() {
    if (!rec) return;
    try { rec.r.stop(); } catch { /* 已经停了 */ }
    rec = null;
  }
  function earsDirty() { if (rec) { rec.meta.dirty = true; earsStop(); } }
  function earsStart() {
    if (!earsOn || !video || video.paused || rec || typeof MediaRecorder === "undefined") return;
    let tracks = [];
    try { tracks = (video.captureStream ? video.captureStream() : null)?.getAudioTracks() || []; } catch { return; }
    if (!tracks.length) return;
    let r;
    try { r = new MediaRecorder(new MediaStream(tracks), { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 }); } catch { return; }
    const parts = [];
    const meta = { start_at: video.currentTime, t0: performance.now(), dirty: false };
    r.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    r.onstop = () => {
      const dur = (performance.now() - meta.t0) / 1000;
      if (meta.dirty || dur < 4 || !parts.length) return;
      clips.push({ start_at: Math.round(meta.start_at * 10) / 10, dur: Math.round(dur * 10) / 10, blob: new Blob(parts, { type: "audio/webm" }) });
      while (clips.length > 2) clips.shift();
    };
    try { r.start(); } catch { return; }
    rec = { r, meta };
  }
  function earsTick() {
    if (!earsOn) { earsStop(); clips.length = 0; return; }
    if (rec && (!video || video.paused || performance.now() - rec.meta.t0 >= earsClipMs)) earsStop();
    if (!rec) earsStart();
  }
  const toB64 = (blob) => new Promise((ok) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] || "");
    fr.onerror = () => ok("");
    fr.readAsDataURL(blob);
  });
  async function sendClips(id) {
    const out = [];
    for (const c of clips) out.push({ start_at: c.start_at, dur: c.dur, mime: "audio/webm", b64: await toB64(c.blob) });
    post({ type: "ears_clip", id, clips: out.filter((c) => c.b64) });
  }

  // 「上次看到 26:39，接着看？」左上角一枚玻璃胶囊
  let resumeEl = null;
  // 「上次看到 x:xx」那张小条带来的位置：这张条只管把视频跳过去，不开场——开场还是她按「一起看」那一下
  // （她 10-21：从卡上进来就先跳出条、一点就开始共享，像是没经她同意；要「按了一起看再共享」）。
  // 按一起看时带上 resumed_from，他第一眼就知道是接着看的
  let resumeAt = null;
  function showResume(m) {
    hideResume();
    resumeAt = Number(m.at_sec) || 0;
    // 直接跳过去（她 10-22：从卡进来本来就跳了，再要她点一下多余）；视频还没好就等它好了再跳，最多等 20 秒
    const no = h("button", { class: "no", "aria-label": "从头看" }, [icon("x", 12)]);
    resumeEl = h("div", { class: "resume" }, [
      h("div", { style: "display:flex;flex-direction:column;gap:2px" }, [
        m.title ? h("div", { class: "t1", text: m.title }) : null,
        h("div", { class: "t2", text: `接着上次 ${m.at} 看` }),
      ]), no]);
    const at = Number(m.at_sec) || 0;
    let tries = 0;
    const jump = () => {
      if (!resumeEl) return;
      const ready = video && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0;
      if (ready) { if (Math.abs(video.currentTime - at) > 2) video.currentTime = at; return; }
      if (++tries < 40) setTimeout(jump, 500);
    };
    jump();
    // × = 从头看：跳回 0，开场时也不说是接着看的了
    no.addEventListener("click", () => { resumeAt = null; if (video) video.currentTime = 0; hideResume(); });
    ui.stage.append(resumeEl);
  }
  function hideResume() {
    if (resumeEl) resumeEl.remove();
    resumeEl = null;
  }

  function receive(json) {
    let m;
    try { m = JSON.parse(json); } catch { return; }
    if (!ui) return;
    if (m.type === "say") show(String(m.text || ""), "him", m.late || null, m.late && Number.isFinite(Number(m.late_sec)) ? Number(m.late_sec) : null);
    else if (m.type === "control") control(m);
    else if (m.type === "status") {
      setActive(!!m.active);
      if (typeof m.interval_sec === "number") {
        ui.slider.value = String(m.interval_sec);
        ui.ival.textContent = fmtIval(m.interval_sec);
      }
      if (m.frame_mode) ui.pick.checked = m.frame_mode === "pick";
      if (typeof m.sync_chat === "boolean") ui.sync.checked = m.sync_chat;
      if (typeof m.link === "boolean") setLink(m.link);
      if (typeof m.ears_available === "boolean") ui.earsRow.style.display = m.ears_available && !pageMode ? "" : "none";
      if (typeof m.hands === "boolean") { handsOn = m.hands; ui.handsSw.checked = m.hands; }
      if (typeof m.handle === "boolean") { handleOn = m.handle; ui.handleSw.checked = m.handle; if (!handleOn) ui.handle.classList.remove("on"); }
      if (typeof m.ears === "boolean") ui.earsSw.checked = m.ears;
      earsOn = !!m.active && !!m.ears_available && !!m.ears;
      if (typeof m.ears_clip_sec === "number") earsClipMs = Math.max(2000, m.ears_clip_sec * 1000);
      if (m.title) filmTitle = m.title;
      if (m.active) hideResume();
      refreshHead();
      if (nativeSheets) post({ type: "sheet_status" });
    } else if (m.type === "link") setLink(!!m.ok);
    else if (m.type === "appearance") { look = normLook(m.appearance); applyLook(); }
    else if (m.type === "wrap_frames") {
      const frames = Array.isArray(m.frames) ? m.frames : [];
      if (sheetMode) { shotList = frames; post({ type: "sheet_frames", frames: frames.map((f) => ({ id: f.id, at: f.at || "", image: f.image || "" })) }); }
      else if (ticketOpen()) renderShots(frames);
    }
    else if (m.type === "standby") standDown();
    else if (m.type === "resume_offer") showResume(m);
    else if (m.type === "subtitle_candidates") showCandidates(m);
    else if (m.type === "ears_get") sendClips(m.id);
    else if (m.type === "subtitle_now") {
      // 对轴按钮只在导入了字幕之后出现——没字幕时摆着只会让人看不懂
      ui.sub.classList.add("on");
      ui.subnow.textContent = m.text || "";
      if (String(m.text || "").startsWith("装上了")) ui.finder.classList.remove("on");
      if (nativeSheets) post({ type: "sheet_status" });
    }
  }

  // ── 手机壳的底部页：读状态 / 做动作。壳画抽屉和票根，芯还是那一份真相 ─────
  function nativeState() {
    if (!ui) return null;
    return {
      active, page: pageMode, title: filmTitle || document.title || "一起看", link: linkOk, mode: look.mode,
      elapsedMin: startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 60000)) : 0,
      meta: metaLine(),
      history: history.map((l) => ({ who: l.who, text: l.text, at: l.at, atText: tc(l.at), late: l.late || null })),
      settings: { interval: Number(ui.slider.value), sync: ui.sync.checked, pick: ui.pick.checked,
        earsAvailable: ui.earsRow.style.display !== "none", ears: ui.earsSw.checked, hands: ui.handsSw.checked, handle: ui.handleSw.checked,
        subtitles: ui.sub.classList.contains("on"), subNow: ui.subnow.textContent || "" },
    };
  }
  function nativeWrap(m) {
    const picked = (Array.isArray(m.picked) ? m.picked : []).map((i) => history[Number(i)]).filter(Boolean)
      .map((l) => ({ who: l.who, text: l.text, at: l.at }));
    const keep = Array.isArray(m.keep_frames) ? m.keep_frames.map(String) : shotList.map((f) => f.id);
    const cover = m.cover ? String(m.cover) : null;
    const title = String(m.title || "").trim();
    if (pageMode) post({ type: "browse_end", keep: true, title, picked, cover, keep_frames: keep });
    else post({ type: "wrap_up", finished: !!m.finished, title, occasion: String(m.occasion || "").trim(),
      her_review: String(m.review || "").trim(), picked, cover, keep_frames: keep });
    closeWrap();
  }
  function nativeAct(raw) {
    let m = raw;
    if (typeof raw === "string") { try { m = JSON.parse(raw); } catch { return; } }
    if (!ui || !m) return;
    switch (m.type) {
      case "seek": seekBack(m.at); break;
      case "settings":
        if (m.interval != null) { ui.slider.value = String(clampN(m.interval, 30, 900, 180)); ui.ival.textContent = fmtIval(Number(ui.slider.value)); }
        if (typeof m.sync === "boolean") ui.sync.checked = m.sync;
        if (typeof m.pick === "boolean") ui.pick.checked = m.pick;
        if (typeof m.ears === "boolean") { ui.earsSw.checked = m.ears; earsOn = active && m.ears; }
        if (typeof m.hands === "boolean") { ui.handsSw.checked = m.hands; handsOn = m.hands; }
        if (typeof m.handle === "boolean") { ui.handleSw.checked = m.handle; handleOn = m.handle; if (!handleOn) ui.handle.classList.remove("on"); }
        sendSettings();
        break;
      case "mode": toggleMode(); break;
      case "srt": post({ type: "subtitles_import", name: String(m.name || "字幕.srt"), text: String(m.text || "") }); break;
      case "offset": post({ type: "subtitle_offset", delta: Number(m.delta) || 0 }); break;
      case "drawer_closed": poke(); break;
      case "drawer": openDrawer(true); break;
      case "wrap": openWrap(); break;
      case "wrap_close": closeWrap(); break;
      case "wrap_submit": nativeWrap(m); break;
      case "wrap_discard": ui.discard.click(); break;
      default: break;
    }
  }

  // 大管家说这一页的视频在别的框里（跨域播放框打了招呼）：顶层这份「一起逛」撤掉——
  // 不然两条叠着，而且藏着的那条正好压在屏幕底部正中，一点就把一起看的场子换成一起逛（10-21 夜复现）
  function standDown() {
    if (!pageMode || active || !host) return;
    hideResume();
    flyQueue.length = 0;
    host.remove();
    host = null; root = null; ui = null;
    pageMode = false;
  }

  // 「一起逛」：顶层页面加载完一会儿还没有视频，就挂上「一起逛」（只在最外面那层，广告框里不挂）
  if (window === window.top) {
    const tryPage = () => {
      if (host || video || !document.documentElement) return;
      pageMode = true;
      mountUi();
      post({ type: "hello", hasVideo: false, page: true, url: location.href, title: document.title, vw: innerWidth, vh: innerHeight });
    };
    const later = () => setTimeout(tryPage, 1500);
    if (document.readyState === "complete") later();
    else addEventListener("load", later, { once: true });
  }

  window.__wt = {
    receive,
    probe,
    // 壳的原生输入条（手机 App）：她在那边打的字从这里进来，跟网页输入框发出去的一模一样；拿出来 / 收回去时这边的输入条让开
    say: sayLine,
    composing: setComposing,
    native: { state: nativeState, act: nativeAct },
    // 截图前把画面上的字藏起来。只调透明度，不用 visibility：visibility:hidden 会让输入框丢焦点，
    // 她打着字就被打断了（10-20 实测）
    hideUi(hd) { hidden = !!hd; if (host) host.style.opacity = hidden ? "0" : "1"; },
    // 测试钩子：真 Chrome 集成测试点不到封闭 shadow 里的按钮，从这里按
    test: {
      openWrap, submitWrap,
      pickAll: () => { ui.picks.querySelectorAll("input").forEach((b) => { b.checked = true; }); countPicks(); },
      pickCountText: () => ui.pcount.textContent,
      starShot: (i) => ui.shots.querySelectorAll(".star")[i]?.click(),
      shotCount: () => ui.shots.querySelectorAll(".shot").length,
      resumeShown: () => !!resumeEl, clickResume: () => resumeEl?.querySelector("button")?.click(),
      clickStart: () => ui.start.click(),
      clickLateTag: () => ui.lanes.querySelector(".tag")?.click(),
      openDrawer, showPage,
      look: () => look,
      herBubble: () => { const it = logItems.filter((x) => x.who === "her").at(-1); return it ? getComputedStyle(it.el).backgroundColor : null; },
      drawerBg: () => getComputedStyle(ui.drawer).backgroundColor,
      dot: () => (ui.dot.classList.contains("bad") ? "orange" : "green"),
      clickBg: (i) => ui.bgs.children[i]?.click(),
      clickPreset: (i) => ui.presets.children[i]?.click(),
      clickMode: () => ui.modeBtn.click(),
      findSubs: (q) => { ui.finder.classList.add("on"); ui.fquery.value = q || ""; ui.fgo.click(); },
      subItems: () => [...ui.flist.querySelectorAll(".fitem")].map((b) => b.textContent),
      pickSub: (i) => ui.flist.querySelectorAll(".fitem")[i]?.click(),
      pageMode: () => pageMode,
      setHands: (on) => { ui.handsSw.checked = !!on; ui.handsSw.dispatchEvent(new Event("change")); },
      lichessSocket: () => !!lichessSocket,
      earsState: () => ({ on: earsOn, clips: clips.map((c) => ({ start_at: c.start_at, dur: c.dur, bytes: c.blob.size })), row: ui.earsRow.style.display !== "none" }),
    },
    debugState: () => ({ hasVideo: !!video, danmaku: ui ? ui.lanes.childElementCount : 0,
      log: ui ? ui.log.childElementCount : 0, history: history.length, drawerOpen: ui ? drawerOpen() : false }),
  };
})();
