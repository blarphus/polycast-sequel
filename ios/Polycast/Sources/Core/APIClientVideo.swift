import Foundation
import UIKit

extension APIClient {
    func studentDashboard() async throws -> StudentDashboard {
        try await request("/home/student-dashboard", queryItems: [
            URLQueryItem(name: "timeZone", value: TimeZone.current.identifier),
        ])
    }

    func classesToday() async throws -> [UpcomingClass] {
        struct Envelope: Codable { let classes: [UpcomingClass] }
        let envelope: Envelope = try await request("/classes/today")
        return envelope.classes
    }

    func classrooms() async throws -> [Classroom] {
        try await request("/classrooms")
    }

    func trendingVideos(lang: String) async throws -> [TrendingVideo] {
        var items = [URLQueryItem(name: "lang", value: lang)]
        if let region = regionCode() { items.append(.init(name: "userRegion", value: region)) }
        return try await request("/videos/trending", queryItems: items)
    }

    func channels(lang: String) async throws -> [ChannelSummary] {
        try await request("/videos/channels", queryItems: [.init(name: "lang", value: lang)])
    }

    /// Popular recent videos across the curated channels, for the Videos carousel.
    func channelHighlights(lang: String) async throws -> [TrendingVideo] {
        try await request("/videos/highlights", queryItems: [.init(name: "lang", value: lang)])
    }

    func subscriptionVideos(lang: String) async throws -> [TrendingVideo] {
        var items = [URLQueryItem(name: "lang", value: lang)]
        if let region = regionCode() { items.append(.init(name: "userRegion", value: region)) }
        return try await request("/videos/subscriptions", queryItems: items)
    }

    func shortsFeed(lang: String, cursor: String? = nil) async throws -> ShortsFeedResponse {
        var items = [URLQueryItem(name: "lang", value: lang)]
        if let region = regionCode() { items.append(.init(name: "userRegion", value: region)) }
        if let cursor, !cursor.isEmpty { items.append(.init(name: "cursor", value: cursor)) }
        return try await request("/videos/shorts", queryItems: items)
    }

    func channelSubscription(handle: String, lang: String) async throws -> ChannelSummary {
        try await request(
            "/videos/channels/\(handle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? handle)/subscription",
            queryItems: [.init(name: "lang", value: lang)]
        )
    }

    func setChannelSubscription(handle: String, lang: String, subscribed: Bool) async throws -> ChannelSummary {
        try await request(
            "/videos/channels/\(handle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? handle)/subscription",
            method: subscribed ? "POST" : "DELETE",
            queryItems: [.init(name: "lang", value: lang)]
        )
    }

    func channelDetail(handle: String, lang: String, pageToken: String? = nil) async throws -> ChannelDetail {
        var items = [URLQueryItem(name: "lang", value: lang)]
        if let region = regionCode() { items.append(.init(name: "userRegion", value: region)) }
        if let pageToken, !pageToken.isEmpty { items.append(.init(name: "pageToken", value: pageToken)) }
        return try await request("/videos/channel/\(handle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? handle)", queryItems: items)
    }

    func lessons(lang: String) async throws -> [LessonSummary] {
        var items = [URLQueryItem(name: "lang", value: lang)]
        if let region = regionCode() { items.append(.init(name: "userRegion", value: region)) }
        return try await request("/videos/lessons", queryItems: items)
    }

    func lessonDetail(id: String, lang: String) async throws -> LessonDetail {
        var items = [URLQueryItem(name: "lang", value: lang)]
        if let region = regionCode() { items.append(.init(name: "userRegion", value: region)) }
        return try await request("/videos/lesson/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)", queryItems: items)
    }

    func searchVideos(query: String, lang: String) async throws -> [TrendingVideo] {
        var items = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "lang", value: lang),
        ]
        if let region = regionCode() { items.append(.init(name: "userRegion", value: region)) }
        return try await request("/videos/search", queryItems: items)
    }

    func searchVideosAndChannels(query: String, lang: String) async throws -> VideoSearchResults {
        var items = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "lang", value: lang),
        ]
        if let region = regionCode() { items.append(.init(name: "userRegion", value: region)) }
        return try await request("/videos/search/full", queryItems: items)
    }

    func videoDetail(id: String) async throws -> VideoDetail {
        try await request("/videos/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")
    }

    func uploadTranscript(videoId: String, segments: [[String: Any]]) async throws -> VideoDetail {
        try await request(
            "/videos/\(videoId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? videoId)/transcript",
            method: "PUT",
            body: ["segments": segments]
        )
    }

    func youtubeTimedTranscript(youtubeID: String, language: String) async throws -> TimedCaptionTrack {
        struct Word: Decodable { let text: String; let offset: Int }
        struct Segment: Decodable {
            let text: String
            let offset: Int
            let duration: Int
            let words: [Word]?
        }
        struct Envelope: Decodable {
            let kind: String?
            let segments: [Segment]
        }
        let envelope: Envelope = try await request(
            "/videos/transcript/youtube",
            queryItems: [
                URLQueryItem(name: "youtubeId", value: youtubeID),
                URLQueryItem(name: "lang", value: language),
            ]
        )
        let kind: CaptionTrackKind = envelope.kind == "automatic" ? .automatic : .human
        return TimedCaptionTrack(
            kind: kind,
            cues: envelope.segments.map { segment in
                TimedCaptionCue(
                    text: segment.text,
                    offset: segment.offset,
                    duration: segment.duration,
                    words: kind == .automatic
                        ? (segment.words ?? []).map { TimedCaptionWord(text: $0.text, offset: $0.offset) }
                        : []
                )
            }
        )
    }

    func youtubeTranscript(youtubeID: String, language: String) async throws -> [TranscriptSegment] {
        let track = try await youtubeTimedTranscript(youtubeID: youtubeID, language: language)
        return track.cues.map { TranscriptSegment(text: $0.text, offset: $0.offset, duration: $0.duration) }
    }

    func youtubePlayability(videoIDs: [String]) async throws -> PlayabilityResult {
        struct Item: Decodable { let status: String; let isShort: Bool }
        struct Envelope: Decodable { let results: [String: Item] }
        let envelope: Envelope = try await request(
            "/videos/playability",
            method: "POST",
            body: ["videoIds": Array(videoIDs.prefix(50))]
        )
        let blocked = Set(envelope.results.compactMap { id, item in
            ["UNPLAYABLE", "CONTENT_CHECK_REQUIRED"].contains(item.status) ? id : nil
        })
        let shorts = Set(envelope.results.compactMap { id, item in item.isShort ? id : nil })
        return PlayabilityResult(blocked: blocked, shorts: shorts)
    }

    func youtubeRelated(youtubeID: String) async throws -> RelatedContent {
        try await request("/videos/related/\(youtubeID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? youtubeID)")
    }

    func addVideo(youtubeID: String, language: String) async throws -> VideoDetail {
        try await request("/videos", method: "POST", body: [
            "url": "https://www.youtube.com/watch?v=\(youtubeID)",
            "language": language,
        ])
    }


}
