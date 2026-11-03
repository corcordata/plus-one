#if os(iOS)
import SwiftUI
import UniformTypeIdentifiers

/// 手机上的抽屉和票根：芯在视频框里画的那两样，竖屏时那框只有两百来像素高，塞不下。
/// 这里用 SwiftUI 画成从底下升起来的页，数据从芯的 `__wt.native.state()` 读、动作走 `__wt.native.act()`，
/// 发给大管家的消息跟网页版一模一样。样子照画布「改后 · 抽屉 = 原生底部页 / 票根 = 原生整页」。

struct NativeState: Decodable {
    struct Line: Decodable {
        var who: String
        var text: String
        var at: Double
        var atText: String
        var late: String?
    }
    struct Settings: Decodable {
        var interval: Int
        var sync: Bool
        var pick: Bool
        var earsAvailable: Bool
        var ears: Bool
        var hands: Bool
        var handle: Bool?
        var subtitles: Bool
        var subNow: String
    }
    var active: Bool
    var page: Bool
    var title: String
    var link: Bool
    var mode: String
    var elapsedMin: Int
    var meta: String
    var history: [Line]
    var settings: Settings

    static func from(_ obj: Any?) -> NativeState? {
        guard let obj, JSONSerialization.isValidJSONObject(obj),
              let data = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
        return try? JSONDecoder().decode(NativeState.self, from: data)
    }
}

struct WrapFrame: Identifiable, Equatable {
    let id: String
    let at: String
    let image: UIImage?

    static func from(_ list: [[String: Any]]) -> [WrapFrame] {
        list.compactMap { d in
            guard let id = d["id"] as? String else { return nil }
            let b64 = d["image"] as? String ?? ""
            let img = Data(base64Encoded: b64).flatMap(UIImage.init(data:))
            return WrapFrame(id: id, at: d["at"] as? String ?? "", image: img)
        }
    }
}

enum NativeSheetKind: String, Identifiable {
    case drawer, wrap
    var id: String { rawValue }
}

enum SheetLook {
    static let gold = Color(red: 1, green: 217 / 255, blue: 138 / 255)
    static let goldInk = Color(red: 1, green: 231 / 255, blue: 181 / 255)
    static func ink(_ dark: Bool) -> Color { dark ? .white : Color(white: 0.11) }
    static func ink2(_ dark: Bool) -> Color { dark ? .white.opacity(0.6) : .black.opacity(0.55) }
    static func cell(_ dark: Bool) -> Color { dark ? .white.opacity(0.08) : .black.opacity(0.05) }
    static func page(_ dark: Bool) -> Color { dark ? Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255).opacity(0.78) : Color(red: 246 / 255, green: 244 / 255, blue: 240 / 255).opacity(0.9) }
}

/// 抽屉：片名、聊天记录、折起来的设置、结束这一场
struct DrawerSheet: View {
    @ObservedObject var model: WatchTogetherView.Model
    @State private var showSettings = false
    @State private var importing = false
    @State private var interval: Double = 180

    private var dark: Bool { model.sheetState?.mode != "light" }

    var body: some View {
        let st = model.sheetState
        ZStack {
            SheetLook.page(dark).ignoresSafeArea()
            VStack(spacing: 0) {
                header(st)
                log(st)
                if let s = st?.settings { settingsBlock(s) }
                Button { model.act(["type": "wrap"]) } label: {
                    Text(st?.page == true ? "结束这一次" : "结束这一场")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(dark ? Color(white: 0.07) : .white)
                        .frame(maxWidth: .infinity).frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(dark ? Color.white.opacity(0.92) : Color(white: 0.11)))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 8)
            }
        }
        .background(.ultraThinMaterial)
        .presentationDetents([.fraction(0.62), .large])
        .presentationDragIndicator(.visible)
        .onAppear { interval = Double(st?.settings.interval ?? 180) }
        .onChange(of: st?.settings.interval) { v in if let v { interval = Double(v) } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.plainText, .data, UTType(filenameExtension: "srt") ?? .plainText]) { result in
            guard case .success(let url) = result else { return }
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url) {
                let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
                model.act(["type": "srt", "name": url.lastPathComponent, "text": text])
            }
        }
    }

    private func header(_ st: NativeState?) -> some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(st?.title ?? "一起看").font(.system(size: 17, weight: .semibold)).foregroundColor(SheetLook.ink(dark)).lineLimit(1)
                if let st, st.active {
                    Text("\(st.page ? "一起逛" : "一起看")了 \(st.elapsedMin) 分钟").font(.system(size: 12)).foregroundColor(SheetLook.ink2(dark))
                }
            }
            Spacer(minLength: 8)
            iconButton(dark ? "moon" : "sun.max", "切换浅色 / 深色") { model.act(["type": "mode"]) }
            iconButton("slider.horizontal.3", "设置") { withAnimation(.snappy(duration: 0.25)) { showSettings.toggle() } }
            iconButton("xmark", "关上") { model.sheet = nil }
        }
        .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 8)
    }

    private func iconButton(_ symbol: String, _ label: String, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Image(systemName: symbol).font(.system(size: 14, weight: .semibold)).foregroundColor(SheetLook.ink(dark))
                .frame(width: 36, height: 36)
                .background(Circle().fill(dark ? Color.white.opacity(0.14) : Color.black.opacity(0.08)))
                .contentShape(Circle().inset(by: -4))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func log(_ st: NativeState?) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    let lines = st?.history ?? []
                    if lines.isEmpty {
                        Text("这一场还没说话").font(.system(size: 13)).foregroundColor(SheetLook.ink2(dark)).padding(.top, 30)
                    }
                    ForEach(Array(lines.enumerated()), id: \.offset) { i, l in
                        bubble(l).id(i)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 6)
            }
            .onAppear { if let n = st?.history.count, n > 0 { proxy.scrollTo(n - 1, anchor: .bottom) } }
            .onChange(of: st?.history.count) { n in if let n, n > 0 { withAnimation { proxy.scrollTo(n - 1, anchor: .bottom) } } }
        }
    }

    private func bubble(_ l: NativeState.Line) -> some View {
        let mine = l.who != "him"
        let shape = UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: mine ? 16 : 4,
                                           bottomTrailingRadius: mine ? 4 : 16, topTrailingRadius: 16, style: .continuous)
        return HStack {
            if mine { Spacer(minLength: 60) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                Text(l.text)
                    .font(.system(size: 14)).lineSpacing(2)
                    .foregroundColor(mine ? Color(white: 0.07) : (dark ? SheetLook.goldInk : Color(red: 0.11, green: 0.11, blue: 0.12)))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background {
                        if mine { shape.fill(Color.white.opacity(0.92)) }
                        else {
                            shape.fill(SheetLook.gold.opacity(dark ? 0.18 : 0.16))
                                .overlay(shape.strokeBorder(SheetLook.gold.opacity(dark ? 0.32 : 0.45), lineWidth: 1))
                        }
                    }
                // 说晚了的那句：点一下跳回他说话那一帧
                if !mine, let late = l.late {
                    Button { model.act(["type": "seek", "at": l.at]) } label: {
                        Text("\(late) · 跳回这里").font(.system(size: 12)).foregroundColor(dark ? SheetLook.gold.opacity(0.85) : Color(red: 0.54, green: 0.39, blue: 0.13))
                            .frame(height: 28)
                    }
                    .buttonStyle(.plain)
                }
            }
            if !mine { Spacer(minLength: 50) }
        }
    }

    private func settingsBlock(_ s: NativeState.Settings) -> some View {
        VStack(spacing: 1) {
            Button { withAnimation(.snappy(duration: 0.25)) { showSettings.toggle() } } label: {
                HStack {
                    Text(showSettings ? "设置" : "设置 · \(ivalText(s.interval))一眼\(s.sync ? " · 同步进聊天" : "")")
                        .font(.system(size: 14)).foregroundColor(SheetLook.ink(dark)).lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundColor(SheetLook.ink2(dark))
                        .rotationEffect(.degrees(showSettings ? 180 : 0))
                }
                .padding(.horizontal, 14).frame(height: 46)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if showSettings {
                VStack(spacing: 1) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack { Text("他多久看一眼"); Spacer(); Text(ivalText(Int(interval))).foregroundColor(SheetLook.ink2(dark)) }
                        Slider(value: $interval, in: 30...900, step: 30) { editing in
                            if !editing { model.act(["type": "settings", "interval": Int(interval)]) }
                        }
                        .tint(SheetLook.gold)
                    }
                    .font(.system(size: 14)).foregroundColor(SheetLook.ink(dark))
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(SheetLook.cell(dark))
                    toggleRow("同步进聊天记录", s.sync) { model.act(["type": "settings", "sync": $0]) }
                    if s.earsAvailable { toggleRow("他听得到声音（Gemini）", s.ears) { model.act(["type": "settings", "ears": $0]) } }
                    toggleRow("让他自己挑帧", s.pick) { model.act(["type": "settings", "pick": $0]) }
                    if model.sheetState?.page == true { toggleRow("让他动手", s.hands) { model.act(["type": "settings", "hands": $0]) } }
                    toggleRow("条藏起来后留个把手", s.handle ?? false) { model.act(["type": "settings", "handle": $0]) }
                    if model.sheetState?.page != true {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("字幕").font(.system(size: 14)).foregroundColor(SheetLook.ink(dark))
                                Spacer()
                                Button("导入 .srt") { importing = true }
                                    .font(.system(size: 14)).foregroundColor(SheetLook.ink(dark).opacity(0.88)).underline(true, color: SheetLook.ink2(dark))
                                    .frame(height: 32)
                            }
                            if s.subtitles {
                                HStack(spacing: 6) {
                                    ForEach([-5.0, -0.5, 0.5, 5.0], id: \.self) { d in
                                        Button(d > 0 ? "+\(fmt(d))s" : "−\(fmt(-d))s") { model.act(["type": "offset", "delta": d]) }
                                            .font(.system(size: 12)).foregroundColor(SheetLook.ink(dark))
                                            .frame(height: 32).padding(.horizontal, 10)
                                            .background(Capsule().fill(dark ? Color.white.opacity(0.14) : Color.black.opacity(0.08)))
                                    }
                                }
                                Text(s.subNow).font(.system(size: 12)).foregroundColor(SheetLook.ink2(dark)).lineLimit(2)
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(SheetLook.cell(dark))
                    }
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(dark ? Color.white.opacity(0.08) : Color.black.opacity(0.04)))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal, 12)
    }

    private func toggleRow(_ label: String, _ on: Bool, _ change: @escaping (Bool) -> Void) -> some View {
        HStack {
            Text(label).font(.system(size: 14)).foregroundColor(SheetLook.ink(dark))
            Spacer()
            Toggle("", isOn: Binding(get: { on }, set: { change($0) })).labelsHidden().tint(Color(red: 0.204, green: 0.780, blue: 0.349))
        }
        .padding(.horizontal, 14).frame(height: 46)
        .background(SheetLook.cell(dark))
    }

    private func ivalText(_ s: Int) -> String { s < 60 ? "\(s) 秒" : "\(Double(s / 6) / 10 == Double(s / 60) ? "\(s / 60)" : String(format: "%.1f", Double(s) / 60)) 分钟" }
    private func fmt(_ d: Double) -> String { d == d.rounded() ? "\(Int(d))" : "\(d)" }
}

/// 票根：这一场想留哪几句、今天是什么日子、截图挑主图、观后感；收进观影卡 / 改天再看 / 什么都不留
struct TicketSheet: View {
    @ObservedObject var model: WatchTogetherView.Model
    @State private var title = ""
    @State private var occasion = ""
    @State private var review = ""
    @State private var picked: Set<Int> = []
    @State private var cover: String?
    @State private var coverTouched = false
    @State private var dropped: Set<String> = []
    @State private var seeded = false

    private var page: Bool { model.sheetPage }
    private var lines: [NativeState.Line] { model.sheetState?.history ?? [] }

    var body: some View {
        ZStack {
            Color(red: 36 / 255, green: 36 / 255, blue: 40 / 255).opacity(0.8).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(model.sheetState?.meta ?? "").font(.system(size: 12)).tracking(0.8).foregroundColor(.white.opacity(0.55))
                        TextField("片名", text: $title).font(.system(size: 24, weight: .bold)).foregroundColor(.white).tint(.white)
                    }
                    picks
                    if !page {
                        field("今天是什么日子") { TextField("可以不写", text: $occasion).foregroundColor(.white).tint(.white).padding(.horizontal, 12).frame(height: 44).background(fieldBg) }
                    }
                    shots
                    if !page {
                        field("我的观后感") {
                            TextEditor(text: $review).scrollContentBackground(.hidden).foregroundColor(.white).tint(.white)
                                .padding(.horizontal, 8).frame(height: 72).background(fieldBg)
                        }
                    }
                    buttons
                }
                .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 28)
            }
        }
        .background(.ultraThinMaterial)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear { seed() }
        .onChange(of: model.sheetState?.title) { _ in seed() }
        .onChange(of: model.wrapFrames) { frames in if cover == nil || !frames.contains(where: { $0.id == cover }) { cover = frames.first?.id } }
    }

    private func seed() {
        guard !seeded, let st = model.sheetState else { return }
        seeded = true
        title = st.title
        cover = model.wrapFrames.first?.id
    }

    private var fieldBg: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.black.opacity(0.22))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13)).foregroundColor(.white.opacity(0.6))
            c()
        }
    }

    private var picks: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("想留哪几句").font(.system(size: 13)).foregroundColor(.white.opacity(0.6))
                Spacer()
                Text("\(page ? "这一次" : "这一场") \(lines.count) 句 · 选了 \(picked.count) 句").font(.system(size: 13)).foregroundColor(.white.opacity(0.6))
                if !lines.isEmpty {
                    Button(picked.count == lines.count ? "全不选" : "全选") {
                        picked = picked.count == lines.count ? [] : Set(lines.indices)
                    }
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(.white)
                    .frame(height: 32).padding(.horizontal, 12)
                    .background(Capsule().fill(Color.white.opacity(0.1)).overlay(Capsule().strokeBorder(Color.white.opacity(0.28), lineWidth: 1)))
                }
            }
            VStack(spacing: 1) {
                if lines.isEmpty {
                    Text("这一\(page ? "次" : "场")还没说话").font(.system(size: 13)).foregroundColor(.white.opacity(0.5)).padding(14)
                }
                ForEach(Array(lines.enumerated()), id: \.offset) { i, l in
                    Button {
                        if picked.contains(i) { picked.remove(i) } else { picked.insert(i) }
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: picked.contains(i) ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 22)).foregroundColor(picked.contains(i) ? SheetLook.gold : .white.opacity(0.45))
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(l.atText) · \(l.who == "him" ? "他" : "我")").font(.system(size: 12)).foregroundColor(l.who == "him" ? SheetLook.gold.opacity(0.85) : .white.opacity(0.55))
                                Text(l.text).font(.system(size: 14)).lineSpacing(2).foregroundColor(.white).multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 11)
                        .background(Color.white.opacity(0.05))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxHeight: 260)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.06)))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private var shots: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("截图").font(.system(size: 13)).foregroundColor(.white.opacity(0.6))
                Spacer()
                Text("点星星设主图 · 点图不留").font(.system(size: 12)).foregroundColor(.white.opacity(0.6))
            }
            if model.wrapFrames.isEmpty {
                Text(model.wrapLoading ? "取图中…" : "这一场还没截到图").font(.system(size: 12)).foregroundColor(.white.opacity(0.45)).frame(height: 44)
            } else {
                HStack(spacing: 8) {
                    ForEach(model.wrapFrames) { f in
                        ZStack(alignment: .topTrailing) {
                            Group {
                                if let img = f.image { Image(uiImage: img).resizable().scaledToFill() } else { Color(white: 0.22) }
                            }
                            .frame(height: page ? 96 : 72).frame(maxWidth: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(cover == f.id ? Color.white : .clear, lineWidth: 2))
                            .opacity(dropped.contains(f.id) ? 0.35 : 1)
                            .overlay { if dropped.contains(f.id) { Text("不留").font(.system(size: 12, weight: .semibold)).foregroundColor(.white) } }
                            .contentShape(Rectangle())
                            .onTapGesture { if dropped.contains(f.id) { dropped.remove(f.id) } else { dropped.insert(f.id) } }
                            Button {
                                cover = f.id; coverTouched = true; dropped.remove(f.id)
                            } label: {
                                Image(systemName: cover == f.id ? "star.fill" : "star")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(cover == f.id ? Color(red: 0.72, green: 0.53, blue: 0.17) : .white.opacity(0.85))
                                    .frame(width: 28, height: 28)
                                    .background(Circle().fill(cover == f.id ? Color.white : Color.black.opacity(0.35)))
                            }
                            .buttonStyle(.plain)
                            .padding(6)
                            .accessibilityLabel(cover == f.id ? "主图（卡片背景）" : "设为主图")
                        }
                    }
                }
            }
        }
    }

    private var buttons: some View {
        VStack(spacing: 8) {
            Button { submit(finished: true) } label: {
                Text(page ? "收进一起逛" : "看完了，收进观影卡").font(.system(size: 15, weight: .semibold)).foregroundColor(Color(white: 0.07))
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            }
            .buttonStyle(.plain)
            HStack(spacing: 8) {
                if !page {
                    Button { submit(finished: false) } label: {
                        Text("改天再看").font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.14)))
                    }
                    .buttonStyle(.plain)
                }
                Button { model.discardWrap() } label: {
                    Text("什么都不留").font(.system(size: 15)).foregroundColor(.white.opacity(0.8))
                        .frame(maxWidth: .infinity).frame(height: 44)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.14)))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 4)
    }

    private func submit(finished: Bool) {
        model.submitWrap(finished: finished, title: title, occasion: occasion, review: review,
                         picked: picked.sorted(), cover: coverTouched ? cover : nil,
                         keep: model.wrapFrames.map(\.id).filter { !dropped.contains($0) })
    }
}
#endif
