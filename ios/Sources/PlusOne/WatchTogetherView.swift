#if os(iOS)
import SwiftUI
import WebKit

/// 「一起看」：传一个网址进来，整屏放那一页；弹幕、输入条、抽屉、收卡都是网页里的芯画的，
/// 跟电脑上一模一样。外面这层只留左上角两颗玻璃小钮（关掉 / 网页后退），不碰画面就慢慢淡下去。
///
/// 横屏要宿主 App 自己放开（这个视图不管 App 的方向设置）。
public struct WatchTogetherView: View {
    public enum Start {
        /// 打开一个网址
        case link(URL)
        /// 从观影卡接着看：打开那一页，视频起来后跳到 atSec，弹「接着看」
        case resume(URL, atSec: Double, title: String)
        /// 一起逛的卡「接着读」：打开那一页，滑回上次停的百分之几（0~100）
        case page(URL, scrollPct: Double, title: String)
    }

    private let start: Start
    private let settings: PlusOneSettings
    private let onClose: () -> Void
    @StateObject private var model = Model()

    public init(_ start: Start, settings: PlusOneSettings, onClose: @escaping () -> Void) {
        self.start = start
        self.settings = settings
        self.onClose = onClose
    }

    public var body: some View {
        ZStack(alignment: .bottom) {
            GeometryReader { geo in
                let portrait = geo.size.height >= geo.size.width
                // 弹出来那一下状态栏才藏起来，顶上那条安全区会跟着变窄——网页整页跟着重排一次，看着像闪了一下缩小又回来（10-21 真机）。
                // 竖屏就一直按见过的最宽那条留，网页不跟着动
                let strip = portrait ? max(geo.safeAreaInsets.top, model.portraitStrip) : geo.safeAreaInsets.top
                ZStack(alignment: .topLeading) {
                    // 横屏告诉芯：抽屉和票根照旧自己画；竖屏才用下面那套底部页
                    Color.clear.frame(width: 0, height: 0)
                        .onAppear { model.controller?.setLandscape(!portrait) }
                        .onChange(of: portrait) { p in
                            model.controller?.setLandscape(!p)
                            // 转屏动画约半秒，转完了再把录屏重起（不然锁的还是转之前的方向）
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { ScreenGrabber.shared.restartForRotation() }
                        }
                    Color.black.ignoresSafeArea()
                    if let c = model.controller {
                        // 键盘弹起来时网页不跟着缩：缩一下再撑回来，有的站的播放器就坏了——进度条没了、点画面没反应（10-21 真机）。
                        // 字在下面那条原生输入条上打，键盘根本不碰这个 WKWebView
                        WebViewBox(webView: c.webView)
                            .padding(.top, strip)
                            .ignoresSafeArea(.container, edges: [.top, .bottom])
                            .ignoresSafeArea(.keyboard)
                    }
                    // 有的站开头一大片黑：中间转个小圈，别让人以为打不开
                    if model.loading {
                        ProgressView().controlSize(.regular).tint(.white)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .allowsHitTesting(false)
                            .transition(.opacity)
                    }
                    // 竖屏：顶上灵动岛那一条本来空着，两颗钮放进去，不盖网页；横屏没有那一条，就浮在画面上
                    chrome(showHost: strip < 40)
                        .padding(.top, strip >= 40 ? max(0, (strip - 48) / 2) : 4)
                        .ignoresSafeArea(.container, edges: .top)
                        .opacity(model.chromeAwake ? 1 : 0.28)
                        .animation(.easeInOut(duration: 0.6), value: model.chromeAwake)
                }
            }
            .ignoresSafeArea(.keyboard)
            // 手机上打字的那条是原生的：她点画面里的输入框，芯叫这边把它拿出来；键盘只顶这一条，网页一个像素都不动。
            // 样子照芯的 .bar（窄画面那一档）：绿点、输入框、发送
        }
        .ignoresSafeArea(.keyboard)
        // 抽屉和票根：手机上不塞进视频框，SwiftUI 画成底部页（数据还是芯的）
        .sheet(item: $model.sheet, onDismiss: { model.sheetDismissed() }) { kind in
            switch kind {
            case .drawer: DrawerSheet(model: model)
            case .wrap: TicketSheet(model: model)
            }
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .onAppear { model.boot(start, settings: settings) }
        .background(GeometryReader { g in
            Color.clear
                .onAppear { model.noteStrip(g) }
                .onChange(of: g.safeAreaInsets.top) { _ in model.noteStrip(g) }
        })
        .onDisappear { model.controller?.stop() }
        .onReceive(model.$sessionDone) { done in if done { close() } }
        .animation(.easeOut(duration: 0.25), value: model.loading)
        .confirmationDialog(model.browsing ? "这一次还没收进一起逛" : "这一场还没收进观影卡",
                            isPresented: $model.askBeforeClose, titleVisibility: .visible) {
            Button(model.browsing ? "回去挑一挑" : "回去收卡") { model.poke() }
            Button(model.browsing ? "直接关掉（说的话全留）" : "直接关掉", role: .destructive) { close() }
        } message: {
            Text(model.browsing ? "想挑留哪几句，点抽屉里的「结束这一场」。" : "想留下这一场，点画面里的「结束这一场」。")
        }
    }

    private func chrome(showHost: Bool) -> some View {
        HStack(spacing: 10) {
            GlassButton(symbol: "xmark", label: "关掉") {
                if model.controller?.engine.isWatching == true {
                    model.browsing = model.controller?.engine.mode == "page"
                    model.askBeforeClose = true
                } else { close() }
            }
            if model.canGoBack {
                GlassButton(symbol: "chevron.backward", label: "网页后退") { model.controller?.webView.goBack() }
            }
            if showHost, !model.host.isEmpty {
                Text(model.host)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .glassBackground(Capsule())
                    .allowsHitTesting(false)
            }
        }
        .padding(.leading, 10)
    }

    private func close() {
        model.controller?.stop()
        onClose()
    }

    @MainActor
    final class Model: ObservableObject {
        @Published var controller: WatchWebController?
        @Published var chromeAwake = true
        @Published var canGoBack = false
        @Published var host = ""
        @Published var askBeforeClose = false
        @Published var browsing = false
        /// 第一页还在载：转圈。载完一次就不转了（之后点链接网页自己有反应）
        @Published var loading = true
        @Published var sessionDone = false
        /// 竖屏见过的最宽的顶上安全区
        @Published var portraitStrip: CGFloat = 0
        /// 原生输入条拿出来了
        @Published var composing = false
        /// 拿出来那一刻芯那边的绿点是不是绿的、是不是一起逛
        @Published var composeLink = true
        @Published var composePage = false
        @Published var draft = ""
        /// 底部页：抽屉 / 票根
        @Published var sheet: NativeSheetKind?
        @Published var sheetState: NativeState?
        @Published var sheetPage = false
        @Published var wrapFrames: [WrapFrame] = []
        @Published var wrapLoading = false
        private var wrapSubmitted = false

        func openSheet(_ kind: String, page: Bool) {
            if kind == "none" { if sheet == .wrap { sheet = nil }; return }
            guard let k = NativeSheetKind(rawValue: kind) else { return }
            sheetPage = page
            if k == .wrap { wrapFrames = []; wrapLoading = true; wrapSubmitted = false }
            endCompose()
            Task { await refreshSheet() }
            sheet = k
        }

        func refreshSheet() async {
            guard let c = controller else { return }
            if let st = await c.nativeState() { sheetState = st }
        }

        func sheetDismissed() {
            // 她划掉的：抽屉 = 关上；票根没点钮 = 回去接着看
            if sheetPage, sheet == nil, wrapLoading { wrapLoading = false }
            if !wrapSubmitted, lastSheet == .wrap { act(["type": "wrap_close"]) }
            if lastSheet == .drawer { act(["type": "drawer_closed"]) }
            lastSheet = nil
        }
        private var lastSheet: NativeSheetKind?

        func act(_ obj: [String: Any]) {
            controller?.nativeAct(obj)
            Task { try? await Task.sleep(nanoseconds: 120_000_000); await refreshSheet() }
        }

        func submitWrap(finished: Bool, title: String, occasion: String, review: String, picked: [Int], cover: String?, keep: [String]) {
            wrapSubmitted = true
            var m: [String: Any] = ["type": "wrap_submit", "finished": finished, "title": title, "occasion": occasion, "review": review,
                                    "picked": picked, "keep_frames": keep]
            if let cover { m["cover"] = cover }
            controller?.nativeAct(m)
            sheet = nil
        }

        func discardWrap() {
            wrapSubmitted = true
            controller?.nativeAct(["type": "wrap_discard"])
            sheet = nil
        }

        /// 输入条拿出来的那一刻：头一秒内焦点被网页抢走不算她划掉
        var composeStartedAt = Date.distantPast
        /// 键盘现在多高（自己听通知算的，不靠 SwiftUI 的避让）
        @Published var keyboardHeight: CGFloat = 0
        private var keyboardObservers: [NSObjectProtocol] = []

        func watchKeyboard() {
            guard keyboardObservers.isEmpty else { return }
            let nc = NotificationCenter.default
            let show = nc.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] n in
                guard let self, let end = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
                guard let w = self.composerWindow else { self.keyboardHeight = 0; return }
                let local = w.convert(end, from: nil)
                let h = max(0, min(w.bounds.height, w.bounds.height - local.origin.y))
                NSLog("[plus-one] keyboard end=%@ local=%@ bounds=%@ h=%.0f", NSCoder.string(for: end), NSCoder.string(for: local), NSCoder.string(for: w.bounds), h)
                self.keyboardHeight = h
            }
            let hide = nc.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
                self?.keyboardHeight = 0
            }
            keyboardObservers = [show, hide]
        }

        func beginCompose(link: Bool, page: Bool) {
            composeLink = link
            composePage = page
            // 真机上她点网页里那个假输入框，WKWebView 自己会把第一响应者拿回去，原生输入条刚要键盘就丢焦点（10-22 真机）：先让网页放手
            controller?.webView.endEditing(true)
            composeStartedAt = Date()
            composing = true
            showComposerWindow()
            NSLog("[plus-one] beginCompose link=%d page=%d keyboardH=%.0f", link ? 1 : 0, page ? 1 : 0, keyboardHeight)
            controller?.setComposing(true)
            poke()
        }

        /// 输入条上的 ≡：收起输入条、开抽屉（跟网页那条上的 ≡ 一样）
        func openDrawerFromComposer() {
            endCompose()
            controller?.nativeAct(["type": "drawer"])
        }

        func sendDraft() {
            let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            draft = ""
            if !text.isEmpty { controller?.say(text) }
            // 发完收起来：键盘在横屏占一半多屏，她要看的是画面
            endCompose()
        }

        /// 键盘收了（她划掉的、系统收的）：输入条也收。刚拿出来那一秒内被网页抢走焦点的不算，NativeField 自己会再要一次
        func keyboardWentAway() {
            guard composing, Date().timeIntervalSince(composeStartedAt) > 1.0 else { return }
            endCompose()
        }

        func endCompose() {
            guard composing else { return }
            NSLog("[plus-one] endCompose")
            composing = false
            hideComposerWindow()
            controller?.setComposing(false)
        }

        // 原生输入条直接挂在最顶上那层 UIWindow 上，不另开一层窗口：玻璃只糊得到同一层窗口里的东西，另开窗口
        // material 糊不到底下的画面，只能用一块透的深色顶着（她 10-22：没网页那条玻璃）。这页是 UIKit 弹出来的，
        // SwiftUI 在页里叠的输入条真机上就是出不来（点叉弹个对话框重排一下才露头，10-22 一上午），挂在窗口上绕开了这页的层级。
        // 网页开了全屏时 WebKit 会另开一层窗口盖在上面，那就挂到最顶上那层去
        private var composerHost: UIHostingController<ComposerRoot>?
        private weak var composerWindow: UIWindow?

        func showComposerWindow() {
            guard composerHost == nil, let w = Self.topWindow() else { return }
            let host = UIHostingController(rootView: ComposerRoot(model: self))
            // 键盘的高度自己算、自己垫：别让 SwiftUI 再按键盘安全区推一次（推两次条就顶到天上去了）
            if #available(iOS 16.4, *) { host.safeAreaRegions = .container }
            host.view.backgroundColor = .clear
            host.view.frame = w.bounds
            host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            w.addSubview(host.view)
            if !w.isKeyWindow { w.makeKey() }   // 键盘只给 key window 里的第一响应者
            composerHost = host
            composerWindow = w
        }

        func hideComposerWindow() {
            composerHost?.view.endEditing(true)   // 先让输入框放手，键盘才收得下去
            composerHost?.view.removeFromSuperview()
            composerHost = nil
            composerWindow = nil
        }

        /// 这个场景里最顶上那层窗口（键盘自己那几层不算）：平时是 App 的主窗口，网页开了全屏就是 WebKit 的那层
        private static func topWindow() -> UIWindow? {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else { return nil }
            var top: UIWindow?
            for w in scene.windows where !w.isHidden && w.alpha > 0 {
                let name = String(describing: type(of: w))
                if name.contains("Keyboard") || name.contains("TextEffects") { continue }
                if let t = top, t.windowLevel > w.windowLevel { continue }
                top = w   // 同一层级里后加的在上面
            }
            return top
        }

        func noteStrip(_ g: GeometryProxy) {
            if g.size.height >= g.size.width, g.safeAreaInsets.top > portraitStrip { portraitStrip = g.safeAreaInsets.top }
        }
        private var sleepTask: Task<Void, Never>?
        private var backObservation: NSKeyValueObservation?
        private var loadObservation: NSKeyValueObservation?

        func boot(_ start: Start, settings: PlusOneSettings) {
            guard controller == nil else { return }
            watchKeyboard()
            let c = WatchWebController(settings: settings)
            c.onPageChange = { [weak self] _, url in self?.host = Self.shortHost(url) }
            c.onTouch = { [weak self] in self?.poke() }
            backObservation = c.webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] wv, _ in
                MainActor.assumeIsolated { self?.canGoBack = wv.canGoBack }
            }
            c.onSessionDone = { [weak self] in self?.sessionDone = true }
            c.onCompose = { [weak self] link, page in self?.beginCompose(link: link, page: page) }
            c.onSheet = { [weak self] kind, page in self?.openSheet(kind, page: page) }
            c.onSheetFrames = { [weak self] list in self?.wrapFrames = WrapFrame.from(list); self?.wrapLoading = false }
            c.onSheetUpdate = { [weak self] in Task { await self?.refreshSheet() } }
            loadObservation = c.webView.observe(\.isLoading, options: [.new]) { [weak self] wv, _ in
                MainActor.assumeIsolated { if !wv.isLoading { self?.loading = false } }
            }
            // 有的站一直不报载完（广告框转个不停）：最多转 20 秒
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                self?.loading = false
            }
            controller = c
            c.start()
            switch start {
            case .link(let url): c.load(url)
            case .resume(let url, let at, let title): c.resume(url: url, atSec: at, title: title)
            case .page(let url, let pct, let title): c.resumePage(url: url, scrollPct: pct, title: title)
            }
            poke()
        }

        func poke() {
            chromeAwake = true
            sleepTask?.cancel()
            sleepTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                guard !Task.isCancelled else { return }
                self?.chromeAwake = false
            }
        }

        static func shortHost(_ url: URL?) -> String {
            guard let h = url?.host else { return "" }
            return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
        }
    }
}

/// 那层 UIWindow 里的内容：整屏一个透明的接点层（点画面任何地方 = 收起来），底下是输入条
private struct ComposerRoot: View {
    @ObservedObject var model: WatchTogetherView.Model
    var body: some View {
        ZStack(alignment: .bottom) {
            // 点画面任何地方 / 往下一划 = 收起来（contentShape 保证透明的也接得到点）
            Color.clear
                .contentShape(Rectangle())
                .ignoresSafeArea()
                .onTapGesture { model.endCompose() }
                .gesture(DragGesture(minimumDistance: 20).onEnded { v in if v.translation.height > 30 { model.endCompose() } })
            Composer(model: model).padding(.bottom, model.keyboardHeight)
        }
        .ignoresSafeArea(.keyboard)
    }
}

/// 原生输入条：跟芯画在画面里的那条一个样子（绿点 · 输入框 · 发送），只是字在这里打
private struct Composer: View {
    @ObservedObject var model: WatchTogetherView.Model

    private var dot: Color {
        model.composeLink ? Color(red: 0.204, green: 0.780, blue: 0.349) : Color(red: 1.0, green: 0.624, blue: 0.039)
    }

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width > 600   // 横屏：芯那条是大一号的（padding 8、框 40、钮 40、≡），这里一模一样
            let h: CGFloat = wide ? 40 : 32
            HStack(spacing: wide ? 10 : 6) {
                Circle().fill(dot)
                    .frame(width: 9, height: 9)
                    .background(Circle().fill(dot.opacity(0.22)).frame(width: 17, height: 17))
                    .frame(width: wide ? 28 : 20, height: h)
                    .accessibilityLabel(model.composeLink ? "他看得见" : "连接异常")
                // UIKit 的输入框：自己 becomeFirstResponder，真机上 SwiftUI 的 @FocusState 在这层 UIHostingController 里要不到键盘（10-22）
                NativeField(text: $model.draft, placeholder: "跟他说…", onSubmit: { model.sendDraft() },
                            stillComposing: { model.composing })
                    .frame(height: h)
                    .padding(.horizontal, wide ? 16 : 12)
                    .frame(width: wide ? min(420, geo.size.width - 200) : nil)
                    .background(Capsule().fill(Color.black.opacity(0.25)))
                Button { model.sendDraft() } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: wide ? 16 : 15, weight: .bold))
                        .foregroundStyle(Color(white: 0.07))
                        .frame(width: h, height: h)
                        .background(Circle().fill(.white))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("发送")
                Button { model.openDrawerFromComposer() } label: {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: wide ? 16 : 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: h, height: h)
                        .background(Circle().fill(Color.white.opacity(0.16)))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("聊天记录和设置")
            }
            .padding(wide ? 8 : 5)
            // 网页那条：白 14% 压在 30px 的磨砂上、描边白 26%。现在跟网页同一层窗口，玻璃糊得到底下的画面
            .glassCapsule()
            .shadow(color: .black.opacity(0.3), radius: 20, y: 10)
            .fixedSize(horizontal: wide, vertical: false)
            .frame(maxWidth: .infinity)
        }
        .frame(height: 60)
        .onAppear { NSLog("[plus-one] Composer onAppear") }
        .background(GeometryReader { g in Color.clear.onAppear { NSLog("[plus-one] Composer frame=%@", NSCoder.string(for: g.frame(in: .global))) } })
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .onChange(of: model.draft) { t in if t.count > 200 { model.draft = String(t.prefix(200)) } }
    }
}

/// 原生输入条里的那个框：UITextField，拿出来就 becomeFirstResponder（SwiftUI 的 @FocusState 在真机这层里要不到键盘）
private struct NativeField: UIViewRepresentable {
    @Binding var text: String
    let placeholder: String
    let onSubmit: () -> Void
    /// 输入条还开着：焦点被谁收走都再要回来（网页的播放器会时不时把焦点抢走，真机 10-22）；她点画面或发出去才算收
    let stillComposing: () -> Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextField {
        let tf = UITextField()
        tf.delegate = context.coordinator
        tf.font = .systemFont(ofSize: 16)
        tf.textColor = .white
        tf.tintColor = .white
        tf.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: UIColor.white.withAlphaComponent(0.6)])
        tf.returnKeyType = .send
        tf.autocorrectionType = .default
        tf.backgroundColor = .clear
        tf.setContentHuggingPriority(.defaultLow, for: .horizontal)
        tf.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tf.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        // 晚一点要键盘：网页那一下点击的收尾还在跑，这时候要会被它抢回去
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak tf] in
            let ok = tf?.becomeFirstResponder() ?? false
            NSLog("[plus-one] field becomeFirstResponder=%d window=%d first=%d", ok ? 1 : 0, tf?.window == nil ? 0 : 1, tf?.isFirstResponder == true ? 1 : 0)
        }
        return tf
    }

    func updateUIView(_ tf: UITextField, context: Context) {
        if tf.text != text { tf.text = text }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: NativeField
        init(_ p: NativeField) { parent = p }

        @objc func changed(_ tf: UITextField) { parent.text = tf.text ?? "" }

        func textFieldShouldReturn(_ tf: UITextField) -> Bool { parent.onSubmit(); return true }

        func textFieldDidEndEditing(_ tf: UITextField) {
            let still = parent.stillComposing
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak tf] in
                if let tf, tf.window != nil, still(), !tf.isFirstResponder { tf.becomeFirstResponder() }
            }
        }
    }
}

private struct WebViewBox: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

private struct GlassButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    var body: some View {
        // 圆看着 36，点击区 48（她 10-22：关掉那颗叉很难点到）
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .glassBackground(Circle())
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

extension View {
    /// 输入条的底：iOS 26 液态玻璃带一点白；老系统磨砂 + 白 14% + 描边（照芯 .bar 的样子）
    @ViewBuilder
    func glassCapsule() -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.tint(Color.white.opacity(0.14)), in: Capsule())
        } else {
            self.background(Capsule().fill(Color.white.opacity(0.14)))
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.26), lineWidth: 1))
        }
    }

    /// iOS 26 的液态玻璃；老系统退回磨砂
    @ViewBuilder
    func glassBackground<S: Shape>(_ shape: S) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular, in: shape)
        } else {
            self.background(.ultraThinMaterial, in: shape)
        }
    }
}
#endif
