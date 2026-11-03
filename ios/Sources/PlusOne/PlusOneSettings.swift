import Foundation

/// 叫醒接口在哪、钥匙、以及抽屉里改过的设置（多久看一眼、递帧方式、同步进聊天、抽屉的样子）。
/// 电脑上这些在 ~/.plus-one/config.json，手机上存在 App 的 UserDefaults 里，钥匙只在这台手机上。
public struct PlusOneSettings {
    /// 叫醒接口，比如 https://你的前端/watch/wake；取回复默认是同一处的 /watch/replies
    public var wakeURL: URL
    public var key: String
    public var repliesURL: URL?
    /// 几秒看一眼视频（电脑上的 probe_sec）
    public var probeSec: TimeInterval
    public var defaults: UserDefaults
    public var prefix: String
    /// 宿主自己给帧（base64 的 JPEG）。给了这个，壳就不开 App 内录屏、不弹录屏权限；拿到 nil 时退回 WKWebView 自己截。
    /// 为什么要这个：App 内录屏（RPScreenRecorder）横屏时拿不到网页里视频那一层，截出来是黑的；
    /// 系统级的录屏扩展（Broadcast）截的是真屏幕，但那是宿主 App 自己的零件，壳只认这个口子
    public var frameProvider: (() async -> String?)?
    /// 她按下「一起看 / 一起逛」那一下：宿主想在这时候做点什么（比如把系统的「开始直播」面板叫出来）
    public var onWatchStart: (() -> Void)?

    public init(wakeURL: URL, key: String, repliesURL: URL? = nil, probeSec: TimeInterval = 5,
                defaults: UserDefaults = .standard, prefix: String = "plusone.",
                frameProvider: (() async -> String?)? = nil, onWatchStart: (() -> Void)? = nil) {
        self.wakeURL = wakeURL
        self.key = key
        self.repliesURL = repliesURL
        self.probeSec = probeSec
        self.defaults = defaults
        self.prefix = prefix
        self.frameProvider = frameProvider
        self.onWatchStart = onWatchStart
    }

    /// 抽屉里改过的那些（interval_sec / frame_mode / sync_chat / appearance）
    public var saved: [String: Any] {
        guard let s = defaults.string(forKey: prefix + "settings"),
              let obj = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { return [:] }
        return obj
    }

    func save(patch: [String: Any]) {
        var next = saved
        for (k, v) in patch { next[k] = v }
        defaults.set(ButlerEngine.json(next), forKey: prefix + "settings")
    }

    func startConfigJSON() -> String {
        var c = saved
        c["wake_url"] = wakeURL.absoluteString
        c["key"] = key
        c["probe_sec"] = probeSec
        if let r = repliesURL { c["replies_url"] = r.absoluteString }
        return ButlerEngine.json(c)
    }

    func storeGet(_ key: String) -> String? { defaults.string(forKey: prefix + "store." + key) }
    func storeSet(_ key: String, json: String) { defaults.set(json, forKey: prefix + "store." + key) }
}
