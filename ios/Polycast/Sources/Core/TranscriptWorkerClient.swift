import Foundation

enum TranscriptWorkerError: LocalizedError {
    case requestFailed(Int, String)
    case invalidResponse
    case noCaptions

    var errorDescription: String? {
        switch self {
        case .requestFailed(let status, let message):
            return "Worker returned \(status): \(message)"
        case .invalidResponse:
            return "Invalid response from transcript worker."
        case .noCaptions:
            return "No captions available for this video."
        }
    }
}

struct PlayabilityResult {
    let blocked: Set<String>
    let shorts: Set<String>
}

enum TranscriptWorkerClient {
    private static let innertubeAPIKey = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
    private static let innertubePlayerURL = "https://www.youtube.com/youtubei/v1/player"

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    // MARK: - Fetch Transcript (Direct InnerTube from device)

    /// Fetches transcript directly from YouTube's InnerTube API using the device's consumer IP.
    /// This bypasses the CF Worker which gets blocked by YouTube server-side.
    static func fetchTranscript(youtubeId: String, lang: String) async throws -> [TranscriptSegment] {
        // Step 1: Call InnerTube Player API to get caption track URLs
        let playerData = try await innertubePlayer(videoId: youtubeId)

        let playability = (playerData["playabilityStatus"] as? [String: Any])?["status"] as? String ?? ""
        if playability == "LOGIN_REQUIRED" || playability == "ERROR" {
            // Fall back to CF Worker — might work if the worker isn't rate-limited
            return try await fetchTranscriptViaCFWorker(youtubeId: youtubeId, lang: lang)
        }

        guard let captions = playerData["captions"] as? [String: Any],
              let renderer = captions["playerCaptionsTracklistRenderer"] as? [String: Any],
              let tracks = renderer["captionTracks"] as? [[String: Any]],
              !tracks.isEmpty else {
            throw TranscriptWorkerError.noCaptions
        }

        // Find matching language track, fall back to first
        let track = tracks.first(where: { ($0["languageCode"] as? String) == lang }) ?? tracks[0]
        guard let baseUrl = track["baseUrl"] as? String else {
            throw TranscriptWorkerError.invalidResponse
        }

        // Strip existing &fmt= and request json3
        let cleanUrl = baseUrl.replacingOccurrences(of: #"&fmt=[^&]*"#, with: "", options: .regularExpression)
        let timedtextUrl = cleanUrl + "&fmt=json3"

        // Step 2: Fetch timedtext JSON3
        guard let url = URL(string: timedtextUrl) else { throw TranscriptWorkerError.invalidResponse }
        let (data, response) = try await session.data(for: URLRequest(url: url))
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw TranscriptWorkerError.requestFailed(
                (response as? HTTPURLResponse)?.statusCode ?? 0,
                "Timedtext request failed"
            )
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let events = json["events"] as? [[String: Any]] else {
            throw TranscriptWorkerError.invalidResponse
        }

        // Parse JSON3 events into TranscriptSegments
        let segments: [TranscriptSegment] = events.compactMap { event in
            guard let segs = event["segs"] as? [[String: Any]] else { return nil }
            let text = segs.compactMap { $0["utf8"] as? String }.joined().trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }

            let offsetMs = event["tStartMs"] as? Int ?? 0
            let durationMs = event["dDurationMs"] as? Int ?? 0
            return TranscriptSegment(text: text, offset: offsetMs, duration: durationMs)
        }

        guard !segments.isEmpty else { throw TranscriptWorkerError.noCaptions }
        return segments
    }

    // MARK: - Check Playability (Direct InnerTube from device)

    /// Checks playability directly from the device. Since this uses a consumer IP,
    /// it won't get false LOGIN_REQUIRED responses like the CF Worker does.
    static func checkPlayability(videoIds: [String]) async throws -> PlayabilityResult {
        guard !videoIds.isEmpty else { return PlayabilityResult(blocked: [], shorts: []) }

        var blocked = Set<String>()
        var shorts = Set<String>()

        // Check in parallel, up to 50
        let idsToCheck = Array(videoIds.prefix(50))
        await withTaskGroup(of: (String, String, Bool).self) { group in
            for id in idsToCheck {
                group.addTask {
                    do {
                        let playerData = try await innertubePlayer(videoId: id)
                        let status = (playerData["playabilityStatus"] as? [String: Any])?["status"] as? String ?? "UNKNOWN"

                        // Check video dimensions to detect Shorts
                        var isShort = false
                        if let streaming = playerData["streamingData"] as? [String: Any],
                           let formats = streaming["adaptiveFormats"] as? [[String: Any]] {
                            for fmt in formats {
                                if let width = fmt["width"] as? Int, let height = fmt["height"] as? Int {
                                    isShort = height > width
                                    break
                                }
                            }
                        }

                        return (id, status, isShort)
                    } catch {
                        return (id, "ERROR", false)
                    }
                }
            }

            for await (id, status, isShort) in group {
                // Only filter genuinely unplayable videos.
                // LOGIN_REQUIRED from consumer IPs is rare but still not an embed issue.
                let unplayable = ["UNPLAYABLE", "CONTENT_CHECK_REQUIRED"]
                if unplayable.contains(status) { blocked.insert(id) }
                if isShort { shorts.insert(id) }
            }
        }

        return PlayabilityResult(blocked: blocked, shorts: shorts)
    }

    // MARK: - Private Helpers

    private static func innertubePlayer(videoId: String) async throws -> [String: Any] {
        guard let url = URL(string: "\(innertubePlayerURL)?key=\(innertubeAPIKey)") else {
            throw TranscriptWorkerError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "context": ["client": ["clientName": "IOS", "clientVersion": "20.10.4"]],
            "videoId": videoId,
        ])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw TranscriptWorkerError.requestFailed(
                (response as? HTTPURLResponse)?.statusCode ?? 0,
                "InnerTube Player API failed"
            )
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw TranscriptWorkerError.invalidResponse
        }

        return json
    }

    /// Fallback: fetch transcript via CF Worker (used when InnerTube returns LOGIN_REQUIRED from device)
    private static func fetchTranscriptViaCFWorker(youtubeId: String, lang: String) async throws -> [TranscriptSegment] {
        guard var components = URLComponents(string: AppConfig.transcriptWorkerURL) else {
            throw TranscriptWorkerError.invalidResponse
        }
        components.queryItems = [
            URLQueryItem(name: "videoId", value: youtubeId),
            URLQueryItem(name: "lang", value: lang),
        ]
        guard let url = components.url else { throw TranscriptWorkerError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(AppConfig.transcriptWorkerSecret)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw TranscriptWorkerError.invalidResponse }

        guard http.statusCode == 200 else {
            var message = "Worker returned \(http.statusCode)"
            if let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = parsed["error"] as? String {
                message = error
            }
            throw TranscriptWorkerError.requestFailed(http.statusCode, message)
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let success = json["success"] as? Bool, success,
              let segments = json["segments"] as? [[String: Any]] else {
            throw TranscriptWorkerError.invalidResponse
        }

        return segments.compactMap { seg in
            guard let text = seg["text"] as? String,
                  let start = seg["start"] as? Double,
                  let dur = seg["dur"] as? Double else { return nil }
            return TranscriptSegment(
                text: text,
                offset: Int((start * 1000).rounded()),
                duration: Int((dur * 1000).rounded())
            )
        }
    }
}
