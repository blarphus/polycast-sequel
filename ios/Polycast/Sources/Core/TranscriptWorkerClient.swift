import Foundation

enum TranscriptWorkerError: LocalizedError {
    case requestFailed(Int, String)
    case invalidResponse
    case noCaptions

    var errorDescription: String? {
        switch self {
        case .requestFailed(let status, let message):
            return "Transcript service returned \(status): \(message)"
        case .invalidResponse:
            return "Invalid response from transcript service."
        case .noCaptions:
            return "No captions available for this video."
        }
    }
}

struct PlayabilityResult {
    let blocked: Set<String>
    let shorts: Set<String>
}

/// Authenticated facade for media metadata. Privileged provider credentials
/// remain on the server/Worker and are never distributed in the app binary.
enum TranscriptWorkerClient {
    static func fetchTranscript(youtubeId: String, lang: String) async throws -> [TranscriptSegment] {
        try await APIClient.shared.youtubeTranscript(youtubeID: youtubeId, language: lang)
    }

    static func fetchTimedCaptions(youtubeId: String, lang: String) async throws -> TimedCaptionTrack {
        try await APIClient.shared.youtubeTimedTranscript(youtubeID: youtubeId, language: lang)
    }

    static func checkPlayability(videoIds: [String]) async throws -> PlayabilityResult {
        guard !videoIds.isEmpty else { return PlayabilityResult(blocked: [], shorts: []) }
        return try await APIClient.shared.youtubePlayability(videoIDs: videoIds)
    }

    static func fetchRelatedVideos(youtubeId: String) async throws -> RelatedContent {
        try await APIClient.shared.youtubeRelated(youtubeID: youtubeId)
    }
}

/// Canonical JSON3 parser retained as a pure parser for imported/local caption
/// fixtures. Network fetching belongs to the authenticated API facade above.
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

        return TimedCaptionCue(text: text, offset: offset, duration: max(duration, 1), words: words)
    }

    guard !cues.isEmpty else { throw TranscriptWorkerError.noCaptions }
    return TimedCaptionTrack(kind: kind, cues: cues)
}
