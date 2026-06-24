import AVFoundation
import CryptoKit

@MainActor
final class AudioPlayer {
    static let shared = AudioPlayer()

    private var player: AVAudioPlayer?
    private var preloadTask: Task<Void, Never>?
    private var speechPreloadTask: Task<Void, Never>?
    private var sequenceTask: Task<Void, Never>?
    private var memoryCache: [String: Data] = [:]
    private let cacheDir: URL

    private init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        cacheDir = base.appendingPathComponent("AudioCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
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

    // MARK: - Disk Cache

    private func cacheURL(forKey key: String) -> URL {
        let hash = Insecure.MD5.hash(data: Data(key.utf8))
            .map { String(format: "%02x", $0) }.joined()
        return cacheDir.appendingPathComponent(hash + ".audio")
    }

    private func cachedData(forKey key: String) -> Data? {
        if let data = memoryCache[key] { return data }
        let url = cacheURL(forKey: key)
        guard let data = FileManager.default.contents(atPath: url.path) else { return nil }
        memoryCache[key] = data
        return data
    }

    private func cacheData(_ data: Data, forKey key: String) {
        memoryCache[key] = data
        let url = cacheURL(forKey: key)
        try? data.write(to: url)
    }

    // MARK: - Playback

    /// Play the sentence audio for a word (from /words/:id/audio endpoint).
    func play(wordId: String) {
        let key = "word-audio:\(wordId)"
        if let data = cachedData(forKey: key) {
            playData(data)
            return
        }
        Task {
            do {
                let data = try await APIClient.shared.wordAudio(id: wordId)
                cacheData(data, forKey: key)
                playData(data)
            } catch {
                print("[Polycast] Failed to play audio for word \(wordId): \(error)")
            }
        }
    }

    /// Speak arbitrary text via the /speak endpoint (for word-only pronunciation).
    func speakText(_ text: String, languageCode: String?) {
        let key = "speak:\(text):\(languageCode ?? "")"
        if let data = cachedData(forKey: key) {
            playData(data)
            return
        }
        Task {
            do {
                let data = try await APIClient.shared.speak(text: text, languageCode: languageCode)
                cacheData(data, forKey: key)
                playData(data)
            } catch {
                print("[Polycast] Failed to speak text: \(error)")
            }
        }
    }

    /// Speak several text parts back-to-back, each in its own language/voice, so
    /// a mixed native+target prompt isn't read entirely by one voice (e.g. the
    /// English voice mangling the Spanish part). Empty parts are skipped.
    func speakSequence(_ parts: [(text: String, languageCode: String?)]) {
        sequenceTask?.cancel()
        stop()
        sequenceTask = Task {
            for part in parts {
                guard !Task.isCancelled else { break }
                let text = part.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                guard let data = await speakData(text: text, languageCode: part.languageCode),
                      !Task.isCancelled else { continue }
                let duration = playDataReturningDuration(data)
                if duration > 0 {
                    // Small tail so consecutive clips don't clip into each other.
                    try? await Task.sleep(nanoseconds: UInt64((duration + 0.15) * 1_000_000_000))
                }
            }
        }
    }

    /// Fetch (cache-first) the TTS audio for `text` in `languageCode`.
    private func speakData(text: String, languageCode: String?) async -> Data? {
        let key = "speak:\(text):\(languageCode ?? "")"
        if let data = cachedData(forKey: key) { return data }
        do {
            let data = try await APIClient.shared.speak(text: text, languageCode: languageCode)
            cacheData(data, forKey: key)
            return data
        } catch {
            print("[Polycast] Failed to speak text: \(error)")
            return nil
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
                let key = "word-audio:\(card.id)"
                guard cachedData(forKey: key) == nil else { continue }
                do {
                    let data = try await APIClient.shared.wordAudio(id: card.id)
                    guard !Task.isCancelled else { break }
                    cacheData(data, forKey: key)
                } catch {
                    print("[Polycast] Failed to preload audio for \(card.id): \(error)")
                }
            }
        }
    }

    /// Pre-fetch TTS for sentence-level speech (what speakText would request)
    /// so card flips play instantly instead of waiting on synthesis.
    func preloadSpeech(_ items: [(text: String, languageCode: String?)]) {
        speechPreloadTask?.cancel()
        speechPreloadTask = Task {
            for item in items {
                guard !Task.isCancelled else { break }
                let key = "speak:\(item.text):\(item.languageCode ?? "")"
                guard cachedData(forKey: key) == nil else { continue }
                do {
                    let data = try await APIClient.shared.speak(text: item.text, languageCode: item.languageCode)
                    guard !Task.isCancelled else { break }
                    cacheData(data, forKey: key)
                } catch {
                    print("[Polycast] Failed to preload speech for \"\(item.text)\": \(error)")
                }
            }
        }
    }

    func clearCache() {
        preloadTask?.cancel()
        speechPreloadTask?.cancel()
        sequenceTask?.cancel()
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

    @discardableResult
    private func playDataReturningDuration(_ data: Data) -> TimeInterval {
        do {
            let p = try AVAudioPlayer(data: data)
            player = p
            p.play()
            return p.duration
        } catch {
            print("[Polycast] AVAudioPlayer error: \(error)")
            return 0
        }
    }
}
