import SwiftUI
import AVKit

struct LocalPlayerView: UIViewControllerRepresentable {
    let url: URL
    @Binding var currentTime: Double
    @Binding var seekTime: Double?
    @Binding var pausedForLookup: Bool

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[Polycast] LocalPlayerView: audio session error: \(error)")
        }

        let player = AVPlayer(url: url)
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = false

        context.coordinator.player = player
        context.coordinator.startTimeObserver(player: player)

        player.play()

        return vc
    }

    func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {
        if let seekTime {
            let cmTime = CMTime(seconds: seekTime, preferredTimescale: 1000)
            uiViewController.player?.seek(to: cmTime, toleranceBefore: .zero, toleranceAfter: .zero)
            DispatchQueue.main.async {
                self.seekTime = nil
            }
        }

        if pausedForLookup != context.coordinator.isPaused {
            context.coordinator.isPaused = pausedForLookup
            if pausedForLookup {
                uiViewController.player?.pause()
            } else {
                uiViewController.player?.play()
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(currentTime: $currentTime)
    }

    final class Coordinator: NSObject, @unchecked Sendable {
        @Binding var currentTime: Double
        weak var player: AVPlayer?
        var isPaused = false
        private var timeObserverToken: Any?

        init(currentTime: Binding<Double>) {
            _currentTime = currentTime
        }

        func startTimeObserver(player: AVPlayer) {
            let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
            timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
                self?.currentTime = time.seconds
            }
        }

        deinit {
            if let token = timeObserverToken, let player {
                player.removeTimeObserver(token)
            }
        }
    }
}
