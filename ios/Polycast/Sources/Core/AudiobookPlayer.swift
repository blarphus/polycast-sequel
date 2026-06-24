import AVFoundation
import Observation

/// Local audiobook playback for a book in the library: a single .m4a file or a
/// folder of .mp3s played as sequential tracks. Supports variable speed,
/// +/-15s seeking across track boundaries, and remembers the playback
/// position per book.
@MainActor
@Observable
final class AudiobookPlayer: NSObject, AVAudioPlayerDelegate {
    private(set) var isPlaying = false
    private(set) var rate: Double = 1.0
    private(set) var trackIndex = 0

    private let bookID: String
    private let tracks: [URL]
    private var player: AVAudioPlayer?

    static let speedOptions: [Double] = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
    private static let skipInterval: TimeInterval = 15

    /// Creates a player for the book's linked audio tracks and restores the
    /// last playback position. Returns nil when the book has no audio.
    init?(bookID: String, tracks: [URL], rate: Double) {
        guard !tracks.isEmpty else { return nil }
        self.bookID = bookID
        self.tracks = tracks
        self.rate = rate
        super.init()

        let saved = Self.savedPosition(for: bookID)
        let index = min(max(saved.track, 0), tracks.count - 1)
        do {
            try loadTrack(index, at: saved.time)
        } catch {
            print("[Polycast] Could not open audiobook track: \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - Controls

    func togglePlayPause() {
        if isPlaying { pause() } else { play() }
    }

    func play() {
        guard let player else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[Polycast] Could not activate audio session: \(error)")
        }
        player.rate = Float(rate)
        player.play()
        isPlaying = true
    }

    func pause() {
        player?.pause()
        isPlaying = false
        savePosition()
    }

    /// Stops playback and persists the position. Call when leaving the reader.
    func stop() {
        savePosition()
        player?.stop()
        isPlaying = false
    }

    func setRate(_ newRate: Double) {
        rate = newRate
        player?.rate = Float(newRate)
    }

    func skipForward() { skip(Self.skipInterval) }
    func skipBackward() { skip(-Self.skipInterval) }

    /// Seeks by a signed offset, crossing into the previous/next track when
    /// the target falls outside the current one.
    private func skip(_ seconds: TimeInterval) {
        guard let player else { return }
        let target = player.currentTime + seconds

        if target < 0 {
            if trackIndex > 0 {
                let wasPlaying = isPlaying
                do {
                    try loadTrack(trackIndex - 1, at: 0)
                    // Land `target` seconds before the end of the previous track.
                    if let previous = self.player {
                        previous.currentTime = max(previous.duration + target, 0)
                    }
                    if wasPlaying { play() }
                } catch {
                    print("[Polycast] Could not open audiobook track: \(error.localizedDescription)")
                }
            } else {
                player.currentTime = 0
            }
        } else if target >= player.duration {
            if trackIndex < tracks.count - 1 {
                let wasPlaying = isPlaying
                do {
                    try loadTrack(trackIndex + 1, at: target - player.duration)
                    if wasPlaying { play() }
                } catch {
                    print("[Polycast] Could not open audiobook track: \(error.localizedDescription)")
                }
            } else {
                player.currentTime = max(player.duration - 0.5, 0)
            }
        } else {
            player.currentTime = target
        }
        savePosition()
    }

    // MARK: - Track loading

    private func loadTrack(_ index: Int, at time: TimeInterval) throws {
        let next = try AVAudioPlayer(contentsOf: tracks[index])
        next.enableRate = true
        next.rate = Float(rate)
        next.delegate = self
        next.prepareToPlay()
        next.currentTime = min(max(time, 0), max(next.duration - 0.1, 0))
        player = next
        trackIndex = index
    }

    /// Auto-advance to the next track when one finishes.
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            guard trackIndex < tracks.count - 1 else {
                isPlaying = false
                Self.clearPosition(for: bookID)
                return
            }
            let wasPlaying = isPlaying
            do {
                try loadTrack(trackIndex + 1, at: 0)
                if wasPlaying { play() }
                savePosition()
            } catch {
                print("[Polycast] Could not open audiobook track: \(error.localizedDescription)")
                isPlaying = false
            }
        }
    }

    // MARK: - Position persistence

    private static func trackKey(_ id: String) -> String { "book.audio.track.\(id)" }
    private static func timeKey(_ id: String) -> String { "book.audio.time.\(id)" }

    private func savePosition() {
        guard let player else { return }
        UserDefaults.standard.set(trackIndex, forKey: Self.trackKey(bookID))
        UserDefaults.standard.set(player.currentTime, forKey: Self.timeKey(bookID))
    }

    private static func savedPosition(for id: String) -> (track: Int, time: TimeInterval) {
        (
            UserDefaults.standard.integer(forKey: trackKey(id)),
            UserDefaults.standard.double(forKey: timeKey(id))
        )
    }

    /// Removes the stored playback position (book deleted or audio unlinked).
    static func clearPosition(for id: String) {
        UserDefaults.standard.removeObject(forKey: trackKey(id))
        UserDefaults.standard.removeObject(forKey: timeKey(id))
    }
}
