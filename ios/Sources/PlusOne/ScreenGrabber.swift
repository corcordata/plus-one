#if os(iOS)
import CoreImage
import ReplayKit
import UIKit

/// 给他截画面：WKWebView 自己的 takeSnapshot 截不到视频那一层（硬解的视频单独一层，截出来是黑的，
/// 选集页之类的网页倒是截得到——10-21 真机上撞到的）。ReplayKit 的 App 内录屏拿得到真正显示在屏幕上的样子，
/// 包括视频。她按「一起看」那一下开始录（系统会问一次「允许录制屏幕吗」），只留最新的一帧，关页面就停。
/// 她点过「不允许」就不再问第二次；系统把录屏停掉之后（App 进后台、来电话）不拿旧帧充数，退回 takeSnapshot。
final class ScreenGrabber: NSObject, RPScreenRecorderDelegate, @unchecked Sendable {
    static let shared = ScreenGrabber()

    private let lock = NSLock()
    private var latest: CVPixelBuffer?
    private var latestAt: CFAbsoluteTime = 0
    private var running = false
    private var starting = false
    private var declinedOnce = false
    private let context = CIContext()
    /// 多久没来新帧就当录屏已经停了：系统在 App 进后台时会停掉，不一定马上告诉我们
    static let staleSec: CFAbsoluteTime = 2

    private override init() {
        super.init()
        RPScreenRecorder.shared().delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(appWentToBackground),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    var isRunning: Bool { lock.lock(); defer { lock.unlock() }; return running }
    /// 她点过「不允许」：这一次打开 App 都不再问
    var declined: Bool { lock.lock(); defer { lock.unlock() }; return declinedOnce }
    /// 还在录、而且最近两秒内收到过帧
    var isLive: Bool {
        lock.lock(); defer { lock.unlock() }
        return running && latest != nil && CFAbsoluteTimeGetCurrent() - latestAt < Self.staleSec
    }

    func start() {
        lock.lock()
        let busy = running || starting || declinedOnce
        if !busy { starting = true }
        lock.unlock()
        guard !busy else { return }
        let recorder = RPScreenRecorder.shared()
        guard recorder.isAvailable else { lock.lock(); starting = false; lock.unlock(); return }
        recorder.isMicrophoneEnabled = false
        recorder.startCapture(handler: { [weak self] sample, type, _ in
            guard type == .video, let buffer = CMSampleBufferGetImageBuffer(sample) else { return }
            let now = CFAbsoluteTimeGetCurrent()
            self?.lock.lock(); self?.latest = buffer; self?.latestAt = now; self?.lock.unlock()
        }, completionHandler: { [weak self] error in
            guard let self else { return }
            let ns = error as NSError?
            let declined = ns.map { $0.domain == RPRecordingErrorDomain && $0.code == RPRecordingErrorCode.userDeclined.rawValue } ?? false
            self.lock.lock()
            self.starting = false
            self.running = (error == nil)
            if declined { self.declinedOnce = true }
            self.lock.unlock()
        })
    }

    func stop() {
        lock.lock()
        let was = running
        running = false
        latest = nil
        lock.unlock()
        if was { RPScreenRecorder.shared().stopCapture { _ in } }
    }

    /// 转屏了：录屏停了重起。App 内录屏起来那一刻把窗口的转向锁死（日志里 setWindowRotationLocked），之后手机转横，
    /// 它还按竖的那套渲染——中继里收到的全是竖排版、视频那块黑的（10-21 ～ 10-22 真机每一场都这样；竖着起、竖着看的那几场就有画面）。
    /// 重起之后按现在的方向锁。系统已经允许过一次，再起不会再问
    func restartForRotation() {
        lock.lock()
        let was = running
        lock.unlock()
        guard was else { return }
        lock.lock(); running = false; latest = nil; lock.unlock()
        RPScreenRecorder.shared().stopCapture { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self?.start() }
        }
    }

    /// 最新那一帧，缩到宽 maxWidth 像素的 JPEG（base64）；没在录、或者帧已经过期（录屏被系统停了）就是 nil
    func jpeg(maxWidth: CGFloat = 960) -> String? {
        lock.lock()
        let buffer = latest
        let live = running && CFAbsoluteTimeGetCurrent() - latestAt < Self.staleSec
        lock.unlock()
        guard live, let buffer else { return nil }
        var image = CIImage(cvPixelBuffer: buffer)
        let scale = min(1, maxWidth / max(1, image.extent.width))
        image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cg = context.createCGImage(image, from: image.extent) else { return nil }
        return UIImage(cgImage: cg).jpegData(compressionQuality: 0.5)?.base64EncodedString()
    }

    @objc private func appWentToBackground() { stop() }

    // MARK: RPScreenRecorderDelegate — 系统停了录屏（进后台、来电话、别的 App 抢了）
    func screenRecorder(_ screenRecorder: RPScreenRecorder, didStopRecordingWith previewViewController: RPPreviewViewController?, error: Error?) {
        lock.lock(); running = false; starting = false; latest = nil; lock.unlock()
    }
}
#endif
