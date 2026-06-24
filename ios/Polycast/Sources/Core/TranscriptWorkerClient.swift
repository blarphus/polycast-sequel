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
    private static let innertubeNextURL = "https://www.youtube.com/youtubei/v1/next"

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

    /// Fetch the selected YouTube caption track without flattening automatic
    /// captions. JSON3's per-segment tOffsetMs values drive progressive words.
    static func fetchTimedCaptions(youtubeId: String, lang: String) async throws -> TimedCaptionTrack {
        do {
            return try await fetchTimedCaptionsDirect(youtubeId: youtubeId, lang: lang)
        } catch {
            let segments = try await fetchTranscriptViaCFWorker(youtubeId: youtubeId, lang: lang)
            return automaticTrack(from: segments)
        }
    }

    private static func fetchTimedCaptionsDirect(youtubeId: String, lang: String) async throws -> TimedCaptionTrack {
        let playerData = try await innertubePlayer(videoId: youtubeId)
        guard let captions = playerData["captions"] as? [String: Any],
              let renderer = captions["playerCaptionsTracklistRenderer"] as? [String: Any],
              let tracks = renderer["captionTracks"] as? [[String: Any]],
              !tracks.isEmpty else {
            throw TranscriptWorkerError.noCaptions
        }

        let normalizedLanguage = lang.lowercased()
        let track = tracks.first(where: {
            (($0["languageCode"] as? String) ?? "").lowercased() == normalizedLanguage
        }) ?? tracks.first(where: {
            (($0["languageCode"] as? String) ?? "").lowercased().split(separator: "-").first
                == normalizedLanguage.split(separator: "-").first
        }) ?? tracks[0]

        guard let baseURL = track["baseUrl"] as? String else {
            throw TranscriptWorkerError.invalidResponse
        }
        let kind: CaptionTrackKind = (track["kind"] as? String) == "asr" ? .automatic : .human
        let cleanURL = baseURL.replacingOccurrences(of: #"&fmt=[^&]*"#, with: "", options: .regularExpression)
        guard let url = URL(string: cleanURL + "&fmt=json3") else {
            throw TranscriptWorkerError.invalidResponse
        }

        let (data, response) = try await session.data(for: URLRequest(url: url))
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw TranscriptWorkerError.requestFailed(
                (response as? HTTPURLResponse)?.statusCode ?? 0,
                "Timedtext request failed"
            )
        }
        return try parseTimedCaptionJSON3(data, kind: kind)
    }

    /// The worker returns real YouTube cues but not JSON3's word offsets. When
    /// direct metadata is blocked, distribute each word over the cue duration
    /// so automatic captions still reveal progressively instead of vanishing.
    private static func automaticTrack(from segments: [TranscriptSegment]) -> TimedCaptionTrack {
        TimedCaptionTrack(kind: .automatic, cues: segments.map { segment in
            let tokens = tokenize(segment.text)
            let wordIndexes = tokens.indices.filter { tokens[$0].isWord }
            let wordCount = max(wordIndexes.count, 1)
            var seenWords = 0
            let words = tokens.compactMap { token -> TimedCaptionWord? in
                let offset = segment.duration * seenWords / wordCount
                if token.isWord { seenWords += 1 }
                return TimedCaptionWord(text: token.text, offset: offset)
            }
            return TimedCaptionCue(
                text: segment.text,
                offset: segment.offset,
                duration: segment.duration,
                words: words
            )
        })
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

    // MARK: - Related videos (YouTube's own recommendations for a video)

    /// Fetches YouTube's per-video recommendations via the InnerTube `next`
    /// endpoint. We read the end-screen video list (`endScreenVideoRenderer`),
    /// which is populated without consent cookies, unlike the watch-sidebar.
    static func fetchRelatedVideos(youtubeId: String) async throws -> RelatedContent {
        guard let url = URL(string: "\(innertubeNextURL)?key=\(innertubeAPIKey)") else {
            throw TranscriptWorkerError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "context": ["client": ["clientName": "WEB", "clientVersion": "2.20240101.00.00"]],
            "videoId": youtubeId,
        ])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw TranscriptWorkerError.requestFailed(
                (response as? HTTPURLResponse)?.statusCode ?? 0,
                "InnerTube Next API failed"
            )
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw TranscriptWorkerError.invalidResponse
        }

        var videos: [TrendingVideo] = []
        var seen = Set<String>()
        collectEndScreenVideos(json, into: &videos, seen: &seen)
        let owner = findVideoOwner(json)
        return RelatedContent(
            channelName: owner?.name,
            channelHandle: owner?.handle,
            channelID: owner?.id,
            channelAvatarURL: owner?.avatarURL,
            videos: videos
        )
    }

    private static func collectEndScreenVideos(
        _ node: Any,
        into videos: inout [TrendingVideo],
        seen: inout Set<String>
    ) {
        if let dict = node as? [String: Any] {
            if let renderer = dict["endScreenVideoRenderer"] as? [String: Any],
               let id = renderer["videoId"] as? String,
               !seen.contains(id) {
                let title = runsText(renderer["title"]) ?? simpleText(renderer["title"]) ?? ""
                let channel = runsText(renderer["shortBylineText"]) ?? ""
                if !title.isEmpty {
                    seen.insert(id)
                    videos.append(TrendingVideo(
                        youtubeId: id,
                        title: title,
                        channel: channel,
                        thumbnail: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg",
                        durationSeconds: nil,
                        publishedAt: nil,
                        viewCount: nil,
                        hasCaptions: nil
                    ))
                }
            }
            for value in dict.values {
                collectEndScreenVideos(value, into: &videos, seen: &seen)
            }
        } else if let array = node as? [Any] {
            for value in array {
                collectEndScreenVideos(value, into: &videos, seen: &seen)
            }
        }
    }

    struct VideoOwner: Equatable {
        let name: String?
        let handle: String?
        let id: String?
        let avatarURL: String?
    }

    static func findVideoOwner(_ node: Any) -> VideoOwner? {
        if let dict = node as? [String: Any] {
            if let owner = dict["videoOwnerRenderer"] as? [String: Any] {
                let name = runsText(owner["title"])
                var handle: String?
                var id: String?
                if let nav = owner["navigationEndpoint"] as? [String: Any],
                   let browse = nav["browseEndpoint"] as? [String: Any] {
                    id = browse["browseId"] as? String
                    if let canonical = browse["canonicalBaseUrl"] as? String,
                       canonical.hasPrefix("/@") {
                        handle = String(canonical.dropFirst(2))
                    }
                }
                return VideoOwner(
                    name: name,
                    handle: handle,
                    id: id,
                    avatarURL: largestThumbnailURL(owner["thumbnail"])
                )
            }
            for value in dict.values {
                if let result = findVideoOwner(value) { return result }
            }
        } else if let array = node as? [Any] {
            for value in array {
                if let result = findVideoOwner(value) { return result }
            }
        }
        return nil
    }

    private static func largestThumbnailURL(_ node: Any?) -> String? {
        guard let dict = node as? [String: Any],
              let thumbnails = dict["thumbnails"] as? [[String: Any]] else { return nil }
        return thumbnails.max {
            (($0["width"] as? NSNumber)?.intValue ?? 0) < (($1["width"] as? NSNumber)?.intValue ?? 0)
        }?["url"] as? String
    }

    private static func runsText(_ node: Any?) -> String? {
        guard let dict = node as? [String: Any], let runs = dict["runs"] as? [[String: Any]] else { return nil }
        let joined = runs.compactMap { $0["text"] as? String }.joined()
        return joined.isEmpty ? nil : joined
    }

    private static func simpleText(_ node: Any?) -> String? {
        (node as? [String: Any])?["simpleText"] as? String
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

func parseTimedCaptionJSON3(_ data: Data, kind: CaptionTrackKind) throws -> TimedCaptionTrack {
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let events = json["events"] as? [[String: Any]] else {
        throw TranscriptWorkerError.invalidResponse
    }

    let cues: [TimedCaptionCue] = events.compactMap { event in
        guard let segments = event["segs"] as? [[String: Any]] else { return nil }
        let pieces = segments.compactMap { $0["utf8"] as? String }
        let text = pieces.joined().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        let offset = (event["tStartMs"] as? NSNumber)?.intValue ?? 0
        let duration = (event["dDurationMs"] as? NSNumber)?.intValue ?? 0
        let words: [TimedCaptionWord]
        if kind == .automatic {
            words = segments.compactMap { segment in
                guard let text = segment["utf8"] as? String,
                      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
                return TimedCaptionWord(
                    text: text,
                    offset: (segment["tOffsetMs"] as? NSNumber)?.intValue ?? 0
                )
            }
        } else {
            words = []
        }

        return TimedCaptionCue(text: text, offset: offset, duration: duration, words: words)
    }

    guard !cues.isEmpty else { throw TranscriptWorkerError.noCaptions }
    return TimedCaptionTrack(kind: kind, cues: cues)
}
