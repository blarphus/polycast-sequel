import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/// Drives the hands-free flashcard mode from headphone / lock-screen remote
/// controls. The practice view sets the callbacks and the controller translates
/// remote events into them:
///
///   - play / pause / toggle (single press) → onPlayPause
///       (reveal the answer, or — once revealed — mark Correct)
///   - next track (double press)            → onIncorrect
///   - previous track (triple press)        → onIncorrect
///   - volume up / down                     → onVolumeUp / onVolumeDown
///
/// iOS does NOT expose a headphone "long press" to apps (it's reserved for
/// Siri), so the short/long idea becomes: single-press flips then marks Correct,
/// and a double-press marks Incorrect. AirPods have no volume buttons, so volume
/// is only available on the phone's buttons / wired EarPods. Everything is
/// behind the practice screen's hands-free toggle, so when off this controller
/// is inert.
@MainActor
final class HandsFreeController: ObservableObject {
    static let shared = HandsFreeController()

    enum Event { case playPause, incorrect, volumeUp, volumeDown }

    // The view observes `eventTick` and reads `lastEvent`, so it handles the
    // event with its *current* @State (currentIndex, isFlipped) rather than a
    // stale value captured in a stored closure.
    @Published private(set) var eventTick = 0
    private(set) var lastEvent: Event = .playPause

    private func emit(_ event: Event) {
        lastEvent = event
        eventTick &+= 1
    }

    private var active = false
    private var volumeObserver: NSKeyValueObservation?
    private var lastVolume: Float = 0
    private var keepAlivePlayer: AVAudioPlayer?

    // The system volume is pinned to `baseline` so using the volume buttons as
    // Correct/Repeat triggers doesn't ratchet the real loudness up or down. The
    // user sets `baseline` via an on-screen slider; we apply it through a hidden
    // MPVolumeView's slider (which also suppresses the system volume HUD).
    private(set) var baseline: Float = 0.5
    private var volumeView: MPVolumeView?
    private weak var volumeSlider: UISlider?
    private var suppressingVolumeKVO = false
    private var expectingBaselineRestore = false

    private init() {}

    func activate() {
        guard !active else { return }
        active = true
        baseline = persistedBaseline()
        startKeepAlive()
        installVolumeView()
        configureRemoteCommands(enabled: true)
        observeVolume()
        applyBaselineToDevice()
        updateNowPlaying(title: "Hands-free practice", subtitle: "Polycast")
    }

    func deactivate() {
        guard active else { return }
        active = false
        configureRemoteCommands(enabled: false)
        volumeObserver?.invalidate()
        volumeObserver = nil
        removeVolumeView()
        stopKeepAlive()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    // MARK: - Volume pinning

    private func persistedBaseline() -> Float {
        let stored = UserDefaults.standard.object(forKey: "handsFreeVolume") as? Double
        return Float(stored ?? 0.5)
    }

    /// Update the pin level (from the on-screen slider) and apply it now.
    func setBaseline(_ value: Float) {
        baseline = min(max(value, 0), 1)
        applyBaselineToDevice()
    }

    /// Snap the system volume to `baseline` without re-triggering the KVO press
    /// detection.
    private func applyBaselineToDevice() {
        guard let slider = volumeSlider else { return }
        suppressingVolumeKVO = true
        expectingBaselineRestore = true
        // Set `.value` directly (not setValue:animated:) — that's what actually
        // drives MPVolumeView's slider to change the system volume.
        slider.value = baseline
        // Keep the guard up long enough for delayed KVO from our own restore.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            guard let self else { return }
            self.lastVolume = AVAudioSession.sharedInstance().outputVolume
            self.expectingBaselineRestore = false
            self.suppressingVolumeKVO = false
        }
    }

    /// A tiny, near-invisible MPVolumeView in the key window. Its presence
    /// suppresses the system HUD, and its slider lets us set the system volume.
    /// Kept ON-screen (not offscreen) so the slider actually lays out and
    /// controls volume.
    private func installVolumeView() {
        guard volumeView == nil, let window = Self.keyWindow() else { return }
        let view = MPVolumeView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        view.alpha = 0.0001
        view.isUserInteractionEnabled = false
        window.addSubview(view)
        window.layoutIfNeeded()
        volumeView = view
        grabSlider(attempt: 0)
    }

    /// The MPVolumeSlider subview can appear a beat after the view is added, so
    /// retry until it's there.
    private func grabSlider(attempt: Int) {
        if let slider = volumeView?.subviews.compactMap({ $0 as? UISlider }).first {
            volumeSlider = slider
            applyBaselineToDevice()
            return
        }
        guard attempt < 12 else {
            PolycastLog.runtime.error("[Polycast] Hands-free: MPVolumeView slider not found; volume won't be pinned")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.grabSlider(attempt: attempt + 1)
        }
    }

    private func removeVolumeView() {
        volumeView?.removeFromSuperview()
        volumeView = nil
        volumeSlider = nil
    }

    private static func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ??
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }.first
    }

    // MARK: - Silent keep-alive

    /// Headphone remote presses only reach us while we're the active "now
    /// playing" app — which lapses as soon as the prompt audio stops. Looping a
    /// silent track keeps the audio session playing so play/pause events route
    /// here reliably (otherwise flips/grades are intermittent).
    private func startKeepAlive() {
        guard keepAlivePlayer == nil else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            let player = try AVAudioPlayer(data: Self.silentWav())
            player.numberOfLoops = -1
            player.volume = 0
            player.play()
            keepAlivePlayer = player
        } catch {
            PolycastLog.runtime.error("[Polycast] Hands-free keep-alive failed: \(error)")
        }
    }

    private func stopKeepAlive() {
        keepAlivePlayer?.stop()
        keepAlivePlayer = nil
    }

    /// A 1-second silent 16-bit mono PCM WAV, generated in code (no bundled asset).
    private static func silentWav(seconds: Double = 1.0, sampleRate: Int = 8000) -> Data {
        let channels = 1, bitsPerSample = 16
        let frames = Int(Double(sampleRate) * seconds)
        let dataSize = frames * channels * bitsPerSample / 8
        var d = Data()
        func ascii(_ s: String) { d.append(s.data(using: .ascii)!) }
        func u32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        ascii("RIFF"); u32(UInt32(36 + dataSize)); ascii("WAVE")
        ascii("fmt "); u32(16); u16(1); u16(UInt16(channels))
        u32(UInt32(sampleRate))
        u32(UInt32(sampleRate * channels * bitsPerSample / 8))
        u16(UInt16(channels * bitsPerSample / 8))
        u16(UInt16(bitsPerSample))
        ascii("data"); u32(UInt32(dataSize))
        d.append(Data(count: dataSize)) // zeros = silence
        return d
    }

    /// Refresh the lock-screen text so the learner can see the current prompt.
    func setNowPlaying(_ title: String, subtitle: String) {
        guard active else { return }
        updateNowPlaying(title: title, subtitle: subtitle)
    }

    // MARK: - Remote commands

    private func configureRemoteCommands(enabled: Bool) {
        let center = MPRemoteCommandCenter.shared()
        let commands = [
            center.togglePlayPauseCommand, center.playCommand, center.pauseCommand,
            center.nextTrackCommand, center.previousTrackCommand,
        ]
        for command in commands {
            // removeTarget(nil) clears ALL targets — required because handlers
            // added via addTarget(handler:) aren't removed by removeTarget(self).
            // Without this, each activate cycle stacks a duplicate handler and a
            // single press fires multiple times (reveal AND grade at once).
            command.removeTarget(nil)
            command.isEnabled = enabled
        }
        guard enabled else { return }

        let playPause: (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus = { [weak self] _ in
            self?.emit(.playPause)
            return .success
        }
        center.togglePlayPauseCommand.addTarget(handler: playPause)
        center.playCommand.addTarget(handler: playPause)
        center.pauseCommand.addTarget(handler: playPause)
        // Double/triple press → mark Incorrect (single press handles reveal+Correct).
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.emit(.incorrect)
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.emit(.incorrect)
            return .success
        }
    }

    // MARK: - Volume buttons (wired headphones)

    private func observeVolume() {
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(true)
        lastVolume = session.outputVolume
        volumeObserver = session.observe(\.outputVolume, options: [.new]) { [weak self] _, change in
            guard let newValue = change.newValue else { return }
            Task { @MainActor in
                guard let self, self.active else { return }
                let previous = self.lastVolume
                self.lastVolume = newValue

                // Ignore our own baseline-restore writes. `lastVolume` still
                // tracks the real observed value so the next user press is
                // classified by actual movement, not by the configured baseline.
                if self.suppressingVolumeKVO || self.expectingBaselineRestore {
                    if abs(newValue - self.baseline) <= 0.01 {
                        self.expectingBaselineRestore = false
                        self.suppressingVolumeKVO = false
                    }
                    return
                }

                let delta = newValue - previous
                if delta > 0.005 {
                    self.emit(.volumeUp)
                    self.applyBaselineToDevice()
                } else if delta < -0.005 {
                    self.emit(.volumeDown)
                    self.applyBaselineToDevice()
                }
            }
        }
    }

    // MARK: - Now Playing

    private func updateNowPlaying(title: String, subtitle: String) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: subtitle,
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
        ]
        info[MPNowPlayingInfoPropertyIsLiveStream] = true
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
