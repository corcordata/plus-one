// 在芯之前注进每一层框（WKUserScript，forMainFrameOnly: false）。两件事：
// 1. 给这一层框起个号：芯发消息时优先用 window.__wtSend，这里把它接到 App 的 "wt" 通道，
//    顺带捎上框号——App 回话时才知道该回到哪一层（电脑上这件事由 DevTools 协议的执行环境号做）。
// 2. iPhone 上的 <video> 默认点了播放就跳系统全屏播放器，那里盖不了弹幕。
//    给每个视频补上 playsinline，让它留在网页里放。
(function () {
  if (typeof window === "undefined" || window.__wtSend) return;
  var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.wt;
  if (!h) return;
  var id = "f" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  Object.defineProperty(window, "__wtSend", {
    value: function (s) { h.postMessage({ f: id, m: String(s) }); },
    configurable: false, writable: false,
  });
  // 告诉芯这是手机 App：字在 App 的原生输入条上打（网页里的输入框一弹键盘，WebKit 就把整页顶走、播放器跟着坏）；
  // 抽屉和票根也由 App 画成底部页（sheets），芯只管数据
  Object.defineProperty(window, "__wtNative", {
    value: Object.freeze({ compose: true, sheets: true }),
    configurable: false, writable: false,
  });

  function inline(v) {
    if (!v.hasAttribute("playsinline")) v.setAttribute("playsinline", "");
    if (!v.hasAttribute("webkit-playsinline")) v.setAttribute("webkit-playsinline", "");
  }
  function sweep(root) {
    if (root.nodeName === "VIDEO") inline(root);
    if (root.querySelectorAll) root.querySelectorAll("video").forEach(inline);
  }
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var added = list[i].addedNodes;
      for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) sweep(added[j]);
    }
  }).observe(document, { childList: true, subtree: true });
  // 有的播放器在 play() 前才建 <video>：播放前再补一次
  document.addEventListener("play", function (e) { if (e.target && e.target.nodeName === "VIDEO") inline(e.target); }, true);
})();
