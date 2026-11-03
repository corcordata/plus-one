#if os(iOS)
import os
import UIKit
import WebKit

/// 「一起看」的壳：一个 WKWebView。芯注进每一层框（跨域的视频框也注），
/// 芯发出来的消息转给大管家，大管家的话按框号递回那一层。
/// 电脑上这件事是 shell-chrome/shell.js 借 DevTools 协议做的；App 本身就是桥，不用开隧道。
@MainActor
public final class WatchWebController: NSObject, ButlerHost {
    public let webView: WKWebView
    public private(set) var engine: ButlerEngine!
    /// 大管家的日志。默认进系统日志（subsystem "plus-one"），Console.app 里看得到
    public var onLog: (String) -> Void = { WatchWebController.logger.info("\($0, privacy: .public)") }
    static let logger = Logger(subsystem: "plus-one", category: "watch")
    /// 网页标题 / 网址变了（给外面那层顶栏用）
    public var onPageChange: (String, URL?) -> Void = { _, _ in }
    /// 她碰了一下画面（外面那层顶栏醒过来）
    public var onTouch: () -> Void = {}
    /// 拦下的弹窗次数（爬虫站点一下就想开广告页）
    public private(set) var blockedPopups = 0
    /// 她在票根上点完（收进卡 / 改天再看 / 什么都不留），大管家把这一场交完了：外面那层直接关掉页面
    public var onSessionDone: () -> Void = {}
    /// 她点了画面里的输入框：外面那层把原生输入条拿出来（linkOK = 绿点这会儿是不是绿的，page = 一起逛）。
    /// 字在原生输入条上打，键盘就不碰 WKWebView——网页里的输入框一弹键盘，WebKit 把整页顶上去、
    /// 视觉视口缩一截，有的站的播放器就坏了（字幕没了、进度条点不出来，10-21 真机）
    public var onCompose: (_ linkOK: Bool, _ page: Bool) -> Void = { _, _ in }
    /// 输入条是从哪一层框叫出来的：打好的字递回那一层
    private var composeFrame: String?
    /// 抽屉 / 票根：手机上由外面那层用 SwiftUI 画成底部页，芯只管数据（kind = drawer / wrap / none）
    public var onSheet: (_ kind: String, _ page: Bool) -> Void = { _, _ in }
    /// 票根上的截图到了（大管家递回这一场的几张）
    public var onSheetFrames: ([[String: Any]]) -> Void = { _ in }
    /// 抽屉开着时有新的话 / 状态变了：外面那层重读一次 nativeState()
    public var onSheetUpdate: () -> Void = {}
    private var sheetFrame: String?
    /// 横屏时抽屉和票根照旧由芯画（框够高）；竖屏才用底部页。写进每一层框的 window.__wtLandscape 让芯自己判断
    public private(set) var landscape = false

    public func setLandscape(_ on: Bool) {
        guard on != landscape else { return }
        landscape = on
        for info in frames.values { tellLandscape(info) }
    }

    private func tellLandscape(_ info: WKFrameInfo) {
        webView.evaluateJavaScript("window.__wtLandscape = \(landscape)", in: info, in: .page) { _ in }
    }
    private var wrapping = false
    /// 弹键盘前页面滚到哪：键盘收起来滚回去（不然横屏发一句弹幕，视频被顶走、进度条被吞，10-21 真机）
    private var offsetBeforeKeyboard: CGPoint?
    private var zoomBeforeKeyboard: CGFloat = 1

    private var frames: [String: WKFrameInfo] = [:]
    private var active: String?
    private var titleObservation: NSKeyValueObservation?

    static func resource(_ name: String) -> String {
        guard let url = Bundle.module.url(forResource: name, withExtension: "js"),
              let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return s
    }

    private let settings: PlusOneSettings

    public init(settings: PlusOneSettings, fetch: ButlerEngine.Fetch? = nil) {
        self.settings = settings
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsPictureInPictureMediaPlayback = false
        if #available(iOS 16.4, *) { config.preferences.isElementFullscreenEnabled = true }
        let ucc = WKUserContentController()
        for name in ["frame-shim", "core"] {
            ucc.addUserScript(WKUserScript(source: Self.resource(name), injectionTime: .atDocumentStart,
                                           forMainFrameOnly: false, in: .page))
        }
        config.userContentController = ucc
        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        super.init()
        ucc.add(WeakHandler(self), contentWorld: .page, name: "wt")
        webView.uiDelegate = self
        webView.navigationDelegate = self
        engine = ButlerEngine(host: self, settings: settings, fetch: fetch)
        let tap = UITapGestureRecognizer(target: self, action: #selector(touched))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        webView.addGestureRecognizer(tap)
        titleObservation = webView.observe(\.title, options: [.new]) { [weak self] wv, _ in
            MainActor.assumeIsolated { self?.onPageChange(wv.title ?? "", wv.url) }
        }
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(keyboardWillShow), name: UIResponder.keyboardWillShowNotification, object: nil)
        nc.addObserver(self, selector: #selector(keyboardDidHide), name: UIResponder.keyboardDidHideNotification, object: nil)
    }

    @objc private func keyboardWillShow() {
        if offsetBeforeKeyboard == nil {
            offsetBeforeKeyboard = webView.scrollView.contentOffset
            zoomBeforeKeyboard = webView.scrollView.zoomScale
        }
    }

    @objc private func keyboardDidHide() {
        guard let o = offsetBeforeKeyboard else { return }
        offsetBeforeKeyboard = nil
        let sv = webView.scrollView
        sv.contentInset = .zero
        // 有的站没写 viewport，点输入框时 iOS 会自己放大页面；收键盘时缩回原来的倍数
        if abs(sv.zoomScale - zoomBeforeKeyboard) > 0.01 { sv.setZoomScale(zoomBeforeKeyboard, animated: false) }
        let maxY = max(0, sv.contentSize.height - sv.bounds.height)
        let target = CGPoint(x: o.x, y: min(max(0, o.y), maxY))
        sv.setContentOffset(target, animated: true)
        // WebKit 自己收尾时还会再挪一下（实测键盘收完半秒又被滚上去 5 点）：等它挪完再摆回来
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            guard let sv = self?.webView.scrollView, self?.offsetBeforeKeyboard == nil else { return }
            if abs(sv.contentOffset.y - target.y) > 0.5 { sv.setContentOffset(target, animated: true) }
        }
    }

    @objc private func touched() { onTouch() }

    public func load(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    /// 从观影卡接着看：打开那一页，视频起来后跳到 atSec，弹「接着看」
    public func resume(url: URL, atSec: Double, title: String) {
        engine.open(url: url.absoluteString, atSec: atSec, title: title)
    }

    /// 一起逛的卡「接着读」：打开那一页，滑回上次停的地方
    public func resumePage(url: URL, scrollPct: Double, title: String) {
        engine.open(url: url.absoluteString, atSec: 0, title: title, scrollPct: scrollPct)
    }

    public func start() {
        engine.startTimers()
        startProbeIfAsked()
    }

#if DEBUG
    /// 开发时看网页里的东西（没有 Web Inspector 可用）：启动参数带 -watchProbe、环境变量 WATCH_PROBE 指向一个 js 文件，
    /// 每 3 秒把那个文件的内容在正在放片的框里跑一遍（没有就主框），结果记进日志（[plus-one] probe …）。
    /// 文件改了不用重编。正式包里没有这段
    private var probeTimer: Timer?
    private func startProbeIfAsked() {
        guard ProcessInfo.processInfo.arguments.contains("-watchProbe"),
              let path = ProcessInfo.processInfo.environment["WATCH_PROBE"] else { return }
        probeTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            guard let self, let js = try? String(contentsOfFile: path, encoding: .utf8), !js.isEmpty else { return }
            let info = self.active.flatMap { self.frames[$0] }
            Task { @MainActor in
                do {
                    let r = try await self.webView.callAsyncJavaScript(js, arguments: [:], in: info, contentWorld: .page)
                    // 日志一条最多 1024 字节，长的切成几段（probe 1/3 …）
                    let text = String(describing: r ?? "nil")
                    let parts = stride(from: 0, to: max(text.count, 1), by: 700).map { i -> String in
                        let a = text.index(text.startIndex, offsetBy: i), b = text.index(a, offsetBy: 700, limitedBy: text.endIndex) ?? text.endIndex
                        return String(text[a..<b])
                    }
                    for (i, part) in parts.enumerated() { NSLog("[plus-one] probe %d/%d %@", i + 1, parts.count, part) }
                } catch {
                    NSLog("[plus-one] probe error %@", error.localizedDescription)
                }
            }
        }
    }
#else
    private func startProbeIfAsked() {}
#endif

    /// 原生输入条上打好的一句递进芯：跟网页输入框发出去的一样——飘弹幕、进抽屉、叫大管家
    public func say(_ text: String) {
        runInComposeFrame("window.__wt && window.__wt.say(\(Self.jsString(text)))")
    }

    /// 原生输入条拿出来 / 收回去：芯自己那条让开 / 回来
    public func setComposing(_ on: Bool) {
        runInComposeFrame("window.__wt && window.__wt.composing(\(on))")
    }

    private func runInComposeFrame(_ js: String) {
        // 叫出输入条的那一层框要是已经没了（打着字时页面跳了），退回正在放片的框；都没了只能记日志
        guard let info = composeFrame.flatMap({ frames[$0] }) ?? active.flatMap({ frames[$0] }) else {
            Self.logger.error("compose js dropped: no live frame")
            return
        }
        webView.evaluateJavaScript(js, in: info, in: .page) { r in
            if case .failure(let e) = r { Self.logger.error("compose js failed: \(e.localizedDescription, privacy: .public)") }
        }
    }

    /// 底部页读芯的状态（片名、说过的话、设置）
    func nativeState() async -> NativeState? {
        guard let f = sheetFrame ?? composeFrame ?? active, let info = frames[f] else { return nil }
        let r = try? await webView.callAsyncJavaScript("return window.__wt && window.__wt.native ? window.__wt.native.state() : null;",
                                                       arguments: [:], in: info, contentWorld: .page)
        return NativeState.from(r)
    }

    /// 底部页上的动作递给芯（seek / settings / mode / srt / offset / wrap / wrap_submit …）
    func nativeAct(_ obj: [String: Any]) {
        guard let f = sheetFrame ?? composeFrame ?? active, let info = frames[f] else { return }
        let json = ButlerEngine.json(obj)
        webView.evaluateJavaScript("window.__wt && window.__wt.native && window.__wt.native.act(\(Self.jsString(json)))", in: info, in: .page) { r in
            if case .failure(let e) = r { Self.logger.error("native act failed: \(e.localizedDescription, privacy: .public)") }
        }
    }

    public func stop() {
        engine.stop()
        ScreenGrabber.shared.stop()
        webView.stopLoading()
        // 声音别跟着页面关掉后还在放
        webView.pauseAllMediaPlayback {}
    }

    // MARK: ButlerHost

    public func butlerLog(_ text: String) { onLog(text) }

    public func setActive(frame: String?) { active = frame }

    public func deliver(frame: String, json: String) -> Bool {
        guard let info = frames[frame] else { return false }
        Self.logger.debug("deliver \(frame, privacy: .public): \(json.prefix(120), privacy: .public)")
        // 票根点完之后大管家收尾，最后一句是「不在一起看了」：这时候交完了，可以关页面
        if wrapping, json.contains(#""type":"status""#), json.contains(#""active":false"#) {
            wrapping = false
            DispatchQueue.main.async { [weak self] in self?.onSessionDone() }
        }
        webView.evaluateJavaScript("window.__wt && window.__wt.receive(\(Self.jsString(json)))", in: info, in: .page) { r in
            if case .failure(let e) = r { Self.logger.error("deliver failed: \(e.localizedDescription, privacy: .public) \(String(describing: e), privacy: .public)") }
        }
        return true
    }

    public func probe(frame: String) async throws -> String {
        guard let info = frames[frame] else { return #"{"ok":false,"why":"frame gone"}"# }
        let r = try await webView.callAsyncJavaScript(
            "return window.__wt ? window.__wt.probe() : { ok: false, why: 'no core' };",
            arguments: [:], in: info, contentWorld: .page)
        guard let obj = r, JSONSerialization.isValidJSONObject(obj) else { return #"{"ok":false,"why":"empty probe"}"# }
        return ButlerEngine.json(obj)
    }

    public func capture(frame: String) async -> String? {
        guard webView.window != nil else { return nil }
        let info = frames[frame]
        let grabber = ScreenGrabber.shared
        // 宿主自己给帧的（比如系统级的录屏扩展）：拿到就用，不藏弹幕和条——那是真屏幕，她看见什么他看见什么；
        // 藏着等帧要等好几秒，把手和条会跟着「消失」（她 10-22）。拿不到才走下面的老路
        if let provider = settings.frameProvider, let shot = await provider() { return shot }
        if settings.frameProvider == nil, !grabber.isRunning { grabber.start() }   // 平时在她按「一起看」时就开了；系统停掉过（进后台）就再起一次，这一张先用老办法
        if let info { _ = try? await webView.callAsyncJavaScript("window.__wt && window.__wt.hideUi(true)", arguments: [:], in: info, contentWorld: .page) }
        defer {
            if let info { webView.evaluateJavaScript("window.__wt && window.__wt.hideUi(false)", in: info, in: .page) { _ in } }
        }
        if grabber.isLive {
            // 等录屏送来藏掉弹幕之后的那一帧；转 JPEG 不在主线程做，视频别掉帧
            try? await Task.sleep(nanoseconds: 180_000_000)
            if let shot = await Task.detached(priority: .userInitiated, operation: { grabber.jpeg() }).value { return shot }
        }
        // 没录屏（她没允许、或者还没开起来）：WKWebView 自己截，视频那块可能是黑的
        let cfg = WKSnapshotConfiguration()
        // 手机屏是 3 倍像素，原样截太大：宽 960 足够他看清画面
        let scale = webView.window?.screen.scale ?? 3
        cfg.snapshotWidth = NSNumber(value: Double(min(webView.bounds.width, 960 / scale)))
        cfg.afterScreenUpdates = true
        guard let img = try? await webView.takeSnapshot(configuration: cfg) else { return nil }
        return img.jpegData(compressionQuality: 0.5)?.base64EncodedString()
    }

    public func pageURL() -> String { webView.url?.absoluteString ?? "" }

    public func openTab(_ url: String) -> Bool {
        guard let u = URL(string: url) else { return false }
        webView.load(URLRequest(url: u))
        return true
    }

    // MARK: 芯来的消息

    fileprivate func received(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let frame = body["f"] as? String, let json = body["m"] as? String else { return }
        let firstSeen = frames[frame] == nil
        frames[frame] = message.frameInfo
        if firstSeen, landscape { tellLandscape(message.frameInfo) }
        Self.logger.debug("core \(frame, privacy: .public): \(json.prefix(120), privacy: .public)")
        // 她按「一起看 / 一起逛」那一下就开录屏：系统那句「允许录制屏幕吗」跟着她的动作来，别开场五秒后冷不丁弹出来
        if json.contains(#""type":"start_request""#) {
            if let hook = settings.onWatchStart { hook() } else if settings.frameProvider == nil { ScreenGrabber.shared.start() }
        }
        if json.contains(#""type":"wrap_up""#) || json.contains(#""type":"browse_end""#) || json.contains(#""type":"stop_request""#) {
            wrapping = true
        }
        // 抽屉 / 票根（底部页）是壳自己的事，不进大管家
        if json.contains(#""type":"sheet"#),
           let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
           let t = obj["type"] as? String, t.hasPrefix("sheet") {
            sheetFrame = frame
            switch t {
            case "sheet": onSheet(obj["kind"] as? String ?? "", obj["page"] as? Bool ?? false)
            case "sheet_frames": onSheetFrames(obj["frames"] as? [[String: Any]] ?? [])
            default: onSheetUpdate()
            }
            return
        }
        // 「把输入条拿出来」是壳自己的事，不进大管家
        if json.contains(#""type":"compose""#),
           let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
           obj["type"] as? String == "compose" {
            composeFrame = frame
            NSLog("[plus-one] compose from frame %@ fullscreen=%d", frame, webView.fullscreenState == .inFullscreen ? 1 : 0)
            onCompose(obj["link"] as? Bool ?? true, obj["page"] as? Bool ?? false)
            return
        }
        // 框号只留最近的一些：长时间刷抖音一类的页面会不停起新框
        if frames.count > 64, let drop = frames.keys.first(where: { $0 != active && $0 != frame }) {
            frames.removeValue(forKey: drop)
            engine.frameGone(drop)
        }
        engine.message(frame: frame, json: json)
    }

    /// 字符串原样塞进一段 JS 里（JSON 转义就是合法的 JS 字符串字面量）
    static func jsString(_ s: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [s]),
              let arr = String(data: d, encoding: .utf8) else { return "\"\"" }
        return String(arr.dropFirst().dropLast())
    }
}

extension WatchWebController: WKUIDelegate, WKNavigationDelegate {
    /// 网页要开新窗口：同一个站的链接就在这里打开，别家的（多半是广告）拦下
    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url,
           navigationAction.navigationType == .linkActivated,
           url.host != nil, url.host == webView.url?.host {
            webView.load(navigationAction.request)
        } else {
            blockedPopups += 1
            onLog("blocked popup: \(navigationAction.request.url?.host ?? "?")")
        }
        return nil
    }

    public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // 整页换了：旧框的号全作废（新页的芯会再打招呼；同一页重载时大管家会把正在看的场子认回来）
        if let a = active { engine.frameGone(a) }
        frames.removeAll()
        active = nil
        composeFrame = nil
        sheetFrame = nil
        onPageChange(webView.title ?? "", webView.url)
    }

    /// 网页进程被系统收掉（内存紧）：重新载入，芯会再打招呼
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if let a = active { engine.frameGone(a) }
        frames.removeAll()
        active = nil
        composeFrame = nil
        webView.reload()
    }
}

extension WatchWebController: UIGestureRecognizerDelegate {
    // 只是听一下她碰没碰，不抢网页自己的手势
    public func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}

/// WKUserContentController 会一直抓着 handler 不放：隔一层弱引用，关掉页面时才放得掉
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WatchWebController?
    init(_ t: WatchWebController) { target = t }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { target?.received(message) }
    }
}
#endif
