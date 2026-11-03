import Foundation
import JavaScriptCore

/// 大管家在网页那头要壳替它做的事。iOS 上由 `WatchWebController` 实现（WKWebView），测试里可以假装。
@MainActor
public protocol ButlerHost: AnyObject {
    func butlerLog(_ text: String)
    /// 正在放片的那一层框（芯发来 start_request 的那个）
    func setActive(frame: String?)
    /// 往某一层框里的芯递一条消息（JSON），递得到就返回 true
    func deliver(frame: String, json: String) -> Bool
    /// 问那一层框的芯：视频在哪、停没停、画面指纹。返回 JSON
    func probe(frame: String) async throws -> String
    /// 截一张图（JPEG 的 base64）。截之前把芯画的字藏起来
    func capture(frame: String) async -> String?
    /// 最外面那一页的网址（视频常在别家网站的框里）
    func pageURL() -> String
    /// 打开一个网址（手机上就是这个网页本身换过去）
    func openTab(_ url: String) -> Bool
}

/// 跑在 JavaScriptCore 里的大管家：跟电脑上同一份 butler/session.js，
/// 联网（叫醒接口）、存东西、计时由这里代办。全程在主线程。
@MainActor
public final class ButlerEngine {
    public typealias Fetch = (URLRequest) async throws -> (Int, Data)

    private let context: JSContext
    private weak var host: ButlerHost?
    private let settings: PlusOneSettings
    private let fetch: Fetch
    private var timers: [Timer] = []
    public private(set) var lastError: String?

    public init(host: ButlerHost, settings: PlusOneSettings, fetch: Fetch? = nil) {
        self.host = host
        self.settings = settings
        self.fetch = fetch ?? { req in
            let (data, res) = try await URLSession.shared.data(for: req)
            return ((res as? HTTPURLResponse)?.statusCode ?? 0, data)
        }
        context = JSContext()!
        context.name = "plus-one butler"
        context.exceptionHandler = { [weak self] _, exc in
            let text = exc?.toString() ?? "?"
            MainActor.assumeIsolated { self?.lastError = text; self?.host?.butlerLog("js: \(text)") }
        }
        let bridge: @convention(block) (String, String) -> String = { [weak self] kind, json in
            MainActor.assumeIsolated { self?.handle(kind, json) ?? "" }
        }
        context.setObject(bridge, forKeyedSubscript: "__host" as NSString)
        context.evaluateScript(Self.bundleSource)
        _ = plusOne.invokeMethod("start", withArguments: [settings.startConfigJSON()])
    }

    static let bundleSource: String = {
        guard let url = Bundle.module.url(forResource: "butler.bundle", withExtension: "js"),
              let src = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return src
    }()

    private var plusOne: JSValue { context.objectForKeyedSubscript("PlusOne") }

    // MARK: 从壳来的

    /// 芯从某一层框发出来的一条消息
    public func message(frame: String, json: String) {
        plusOne.invokeMethod("message", withArguments: [frame, json])
    }

    /// 观影卡上「接着看」：打开那一页，等视频打招呼时跳到 atSec；
    /// 一起逛的卡「接着读」带 scrollPct：页面起来后滑回上次停的百分之几
    public func open(url: String, atSec: Double, title: String, scrollPct: Double? = nil) {
        var payload: [String: Any] = ["url": url, "at_sec": atSec, "title": title]
        if let scrollPct { payload["scroll_pct"] = scrollPct }
        plusOne.invokeMethod("open", withArguments: [Self.json(payload)])
    }

    public func tick() { plusOne.invokeMethod("tick", withArguments: []) }
    public func pollOnce() { plusOne.invokeMethod("pollOnce", withArguments: []) }
    public func frameGone(_ frame: String) { plusOne.invokeMethod("frameGone", withArguments: [frame]) }

    private var status: [String: Any] {
        let s = plusOne.invokeMethod("status", withArguments: [])?.toString() ?? "{}"
        return (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Any] ?? [:]
    }

    /// 现在在不在一起看（关页面前问一声要不要先收卡）
    public var isWatching: Bool { status["active"] as? Bool ?? false }

    /// 一起看（"video"）还是一起逛（"page"）；没在看是 nil
    public var mode: String? { status["mode"] as? String }

    public func stop() {
        plusOne.invokeMethod("stop", withArguments: [])
        stopTimers()
    }

    /// 电脑上 main.js 里那两个 setInterval：每 probe_sec 秒看一眼视频，每秒取一次回复
    public func startTimers() {
        stopTimers()
        // 挂在 .common 模式：她手指划着网页（UITrackingRunLoopMode）的时候也照跑，不然一起逛滑着滑着他就不回了
        let probe = Timer(timeInterval: settings.probeSec, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        let poll = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.pollOnce() }
        }
        for t in [probe, poll] { RunLoop.main.add(t, forMode: .common) }
        timers = [probe, poll]
    }

    public func stopTimers() {
        timers.forEach { $0.invalidate() }
        timers = []
    }

    // MARK: JS 叫 Swift

    private func handle(_ kind: String, _ json: String) -> String {
        let p = (try? JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])) ?? NSNull()
        let d = p as? [String: Any] ?? [:]
        let id = d["id"] as? Int ?? 0
        switch kind {
        case "log":
            host?.butlerLog(p as? String ?? json)
        case "setActive":
            host?.setActive(frame: d["frame"] as? String)
        case "deliver":
            guard let frame = d["frame"] as? String, let msg = d["msg"] else { return "false" }
            return host?.deliver(frame: frame, json: Self.json(msg)) == true ? "true" : "false"
        case "pageUrl":
            return Self.json(host?.pageURL() ?? "")
        case "openTab":
            return host?.openTab(d["url"] as? String ?? "") == true ? "true" : "false"
        case "saveSettings":
            settings.save(patch: d)
        case "storeGet":
            return settings.storeGet(p as? String ?? "") ?? ""
        case "storeSet":
            if let key = d["key"] as? String { settings.storeSet(key, json: Self.json(d["value"] ?? NSNull())) }
        case "probe":
            let frame = d["frame"] as? String ?? ""
            Task { @MainActor [weak self] in
                guard let host = self?.host else { self?.resolve(id, error: "no host"); return }
                do { self?.resolve(id, json: try await host.probe(frame: frame)) }
                catch { self?.resolve(id, error: error.localizedDescription) }
            }
        case "capture":
            let frame = d["frame"] as? String ?? ""
            Task { @MainActor [weak self] in
                let shot = await self?.host?.capture(frame: frame)
                self?.resolve(id, json: shot.map { Self.json($0) } ?? "null")
            }
        case "fetch":
            runFetch(id: id, d)
        default:
            break
        }
        return ""
    }

    private func runFetch(id: Int, _ d: [String: Any]) {
        guard let url = URL(string: d["url"] as? String ?? "") else { resolve(id, error: "bad url"); return }
        var req = URLRequest(url: url, timeoutInterval: (d["timeoutMs"] as? Double ?? 30000) / 1000)
        req.httpMethod = d["method"] as? String ?? "GET"
        for (k, v) in d["headers"] as? [String: String] ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
        if let body = d["body"] as? String { req.httpBody = Data(body.utf8) }
        let fetch = self.fetch
        Task { @MainActor [weak self] in
            do {
                let (status, data) = try await fetch(req)
                let out: [String: Any] = ["status": status, "body": String(decoding: data, as: UTF8.self)]
                self?.resolve(id, json: Self.json(out))
            } catch {
                self?.resolve(id, error: error.localizedDescription)
            }
        }
    }

    private func resolve(_ id: Int, json: String? = nil, error: String? = nil) {
        plusOne.invokeMethod("resolve", withArguments: [id, error ?? NSNull(), json ?? NSNull()])
    }

    nonisolated static func json(_ obj: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.fragmentsAllowed]) else { return "null" }
        return String(decoding: data, as: UTF8.self)
    }
}
