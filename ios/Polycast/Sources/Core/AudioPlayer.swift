import AVFoundation

@MainActor
final class AudioPlayer {
    static let shared = AudioPlayer()

    private var player: AVAudioPlayer?
    private var preloadedAudio: [String: Data] = [:]
    private var preloadTask: Task<Void, Never>?

    private init() {
        configureAudioSession()
    }

    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[Polycast] Failed to configure audio session: \(error)")
        }
    }

    /// Play the cached sentence audio for a word (from /words/:id/audio endpoint).
    func play(wordId: String) {
        if let data = preloadedAudio[wordId] {
            playData(data)
            return
        }
        Task {
            do {
                let data = try await APIClient.shared.wordAudio(id: wordId)
                preloadedAudio[wordId] = data
                playData(data)
            } catch {
                print("[Polycast] Failed to play audio for word \(wordId): \(error)")
            }
        }
    }

    /// Speak arbitrary text via the /speak endpoint (for word-only pronunciation).
    func speakText(_ text: String, languageCode: String?) {
        Task {
            do {
                let data = try await APIClient.shared.speak(text: text, languageCode: languageCode)
                playData(data)
            } catch {
                print("[Polycast] Failed to speak text: \(error)")
            }
        }
    }

    func stop() {
        player?.stop()
        player = nil
    }

    func preload(cards: [SavedWord]) {
        preloadTask?.cancel()
        preloadTask = Task {
            for card in cards {
                guard !Task.isCancelled else { break }
                guard preloadedAudio[card.id] == nil else { continue }
                do {
                    let data = try await APIClient.shared.wordAudio(id: card.id)
                    guard !Task.isCancelled else { break }
                    preloadedAudio[card.id] = data
                } catch {
                    print("[Polycast] Failed to preload audio for \(card.id): \(error)")
                }
            }
        }
    }

    func clearCache() {
        preloadTask?.cancel()
        preloadedAudio.removeAll()
        stop()
    }

    private func playData(_ data: Data) {
        do {
            player = try AVAudioPlayer(data: data)
            player?.play()
        } catch {
            print("[Polycast] AVAudioPlayer error: \(error)")
        }
    }
}
