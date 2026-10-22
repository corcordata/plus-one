import XCTest
@testable import PlusOne

/// 真的 JavaScriptCore + 打包好的大管家，壳和网络都是假的：
/// 证明手机上跑的是跟电脑同一套门铃 / 打包 / 回复逻辑，而且 JSC 里缺的东西（URL、fetch、计时）都补上了。
@MainActor
final class FakeHost: ButlerHost {
    var logs: [String] = []
    var active: String?
    var delivered: [(frame: String, msg: [String: Any])] = []
    var probeReply = #"{"ok":true,"time":600,"duration":7200,"paused":false,"fingerprint":null}"#
    var opened: [String] = []
    var page = "https://films.example/watch/42"

    func butlerLog(_ text: String) { logs.append(text) }
    func setActive(frame: String?) { active = frame }
    func deliver(frame: String, json: String) -> Bool {
        let obj = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
        delivered.append((frame, obj))
        return true
    }
    func probe(frame: String) async throws -> String { probeReply }
    func capture(frame: String) async -> String? { "AAAA" }
    func pageURL() -> String { page }
    func openTab(_ url: String) -> Bool { opened.append(url); return true }

    func said() -> [String] { delivered.filter { $0.msg["type"] as? String == "say" }.compactMap { $0.msg["text"] as? String } }
}

@MainActor
final class ButlerEngineTests: XCTestCase {
    var requests: [URLRequest] = []
    var replies: [(Int, String)] = []

    func makeSettings() -> PlusOneSettings {
        let d = UserDefaults(suiteName: "plusone-tests-\(UUID().uuidString)")!
        return PlusOneSettings(wakeURL: URL(string: "https://relay.example/watch/wake")!, key: "secret", defaults: d)
    }

    func makeEngine(_ host: FakeHost, _ settings: PlusOneSettings? = nil) -> ButlerEngine {
        ButlerEngine(host: host, settings: settings ?? makeSettings()) { [unowned self] req in
            self.requests.append(req)
            let r = self.replies.isEmpty ? (202, "{}") : self.replies.removeFirst()
            return (r.0, Data(r.1.utf8))
        }
    }

    /// 等异步那几跳（Task → resolve → JS 微任务）走完
    func settle(until: @escaping () -> Bool = { false }) async {
        for _ in 0..<50 {
            if until() { return }
            await Task.yield()
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    func send(_ e: ButlerEngine, _ frame: String, _ msg: [String: Any]) {
        e.message(frame: frame, json: ButlerEngine.json(msg))
    }

    func testBundleLoadsWithoutErrors() {
        XCTAssertFalse(ButlerEngine.bundleSource.isEmpty)
        let host = FakeHost()
        let e = makeEngine(host)
        XCTAssertNil(e.lastError)
        XCTAssertFalse(e.isWatching)
    }

    func testWatchRoundTrip() async throws {
        let host = FakeHost()
        let e = makeEngine(host)
        send(e, "fA", ["type": "start_request", "title": "La La Land (2016)", "url": "https://cdn.example/e/1"])
        await settle { e.isWatching && host.delivered.contains { $0.msg["type"] as? String == "status" } }
        XCTAssertEqual(host.active, "fA")
        XCTAssertTrue(e.isWatching)

        // 她说话 → 立刻按门铃
        send(e, "fA", ["type": "user_said", "text": "好看", "at": 601])
        await settle { !self.requests.isEmpty }
        let wake = try XCTUnwrap(requests.first)
        XCTAssertEqual(wake.url?.absoluteString, "https://relay.example/watch/wake")
        XCTAssertEqual(wake.httpMethod, "POST")
        XCTAssertEqual(wake.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        XCTAssertEqual(wake.timeoutInterval, 90)
        let glance = try XCTUnwrap(JSONSerialization.jsonObject(with: wake.httpBody!) as? [String: Any])
        XCTAssertEqual(glance["reasons"] as? [String], ["user_message"])
        XCTAssertEqual(glance["title"] as? String, "La La Land (2016)")
        let session = try XCTUnwrap(glance["session"] as? String)

        // 202 → 去取回复
        replies = [(200, #"{"replies":[{"id":5,"say":["我也觉得"],"actions":["seek -10"]}]}"#)]
        e.pollOnce()
        await settle { !host.said().isEmpty }
        XCTAssertEqual(requests.last?.url?.absoluteString,
                       "https://relay.example/watch/replies?session=\(session)&after=0")
        XCTAssertEqual(host.said(), ["我也觉得"])
        XCTAssertTrue(host.delivered.contains { $0.msg["action"] as? String == "seek" && $0.msg["by"] as? Int == -10 })
    }

    func testTickCapturesAndWrapUpUsesPageURL() async throws {
        let host = FakeHost()
        let settings = makeSettings()
        let e = makeEngine(host, settings)
        send(e, "fA", ["type": "start_request", "title": "Interstellar", "url": "https://cdn.example/e/9"])
        await settle { e.isWatching }
        e.tick()   // 没指纹、从没截过 → 截一张
        await settle()
        send(e, "fA", ["type": "user_said", "text": "看", "at": 600])
        await settle { !self.requests.isEmpty }
        let glance = try XCTUnwrap(JSONSerialization.jsonObject(with: requests[0].httpBody!) as? [String: Any])
        let frames = try XCTUnwrap(glance["frames"] as? [[String: Any]])
        XCTAssertEqual(frames.first?["image"] as? String, "AAAA")

        send(e, "fA", ["type": "wrap_up", "finished": true, "title": "", "occasion": "", "her_review": "", "picked": []])
        await settle { self.requests.count >= 2 }
        let pkg = try XCTUnwrap(JSONSerialization.jsonObject(with: requests[1].httpBody!) as? [String: Any])
        XCTAssertEqual(pkg["reason"] as? String, "wrap_up")
        XCTAssertEqual(pkg["url"] as? String, "https://films.example/watch/42")
        let date = try XCTUnwrap(pkg["date"] as? String)
        XCTAssertNotNil(date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression), "toLocaleDateString in JSC: \(date)")
        await settle { !e.isWatching }
        XCTAssertFalse(e.isWatching)
        // 本机备份进了 App 自己的存储
        XCTAssertTrue(settings.storeGet("films")?.contains("finished") == true)
    }

    func testResumeFromFilmCard() async {
        let host = FakeHost()
        let e = makeEngine(host)
        e.open(url: "https://films.example/watch/42", atSec: 1599, title: "La La Land")
        await settle { !host.opened.isEmpty }
        XCTAssertEqual(host.opened, ["https://films.example/watch/42"])
        send(e, "fV", ["type": "hello", "hasVideo": true, "url": "https://cdn.example/e/1", "title": ""])
        await settle { host.delivered.count >= 2 }
        XCTAssertEqual(host.delivered.first?.frame, "fV")
        XCTAssertEqual(host.delivered.first?.msg["action"] as? String, "seek_to")
        XCTAssertEqual(host.delivered.last?.msg["at"] as? String, "26:39")
    }

    func testResumePageScrollsBack() async {
        let host = FakeHost()
        let e = makeEngine(host)
        e.open(url: "https://comic.example/12", atSec: 0, title: "某漫画", scrollPct: 63)
        await settle { !host.opened.isEmpty }
        send(e, "fP", ["type": "hello", "hasVideo": false, "page": true, "url": "https://comic.example/12", "title": ""])
        await settle { !host.delivered.isEmpty }
        XCTAssertEqual(host.delivered.first?.msg["action"] as? String, "scroll_to")
        XCTAssertEqual(host.delivered.first?.msg["pct"] as? Int, 63)
    }

    func testDrawerSettingsPersist() async {
        let host = FakeHost()
        let settings = makeSettings()
        let e = makeEngine(host, settings)
        send(e, "fA", ["type": "settings", "interval_sec": 60, "frame_mode": "pick", "sync_chat": true])
        await settle()
        XCTAssertEqual(settings.saved["interval_sec"] as? Int, 60)
        XCTAssertEqual(settings.saved["sync_chat"] as? Bool, true)
        // 下次开页面，设置带回大管家
        XCTAssertTrue(settings.startConfigJSON().contains("\"frame_mode\":\"pick\""))
    }

    func testJSStringEscaping() {
        #if os(iOS)
        XCTAssertEqual(WatchWebController.jsString("a\"b\n</script>"), #""a\"b\n<\/script>""#)
        #endif
        XCTAssertEqual(ButlerEngine.json("x"), "\"x\"")
    }
}
