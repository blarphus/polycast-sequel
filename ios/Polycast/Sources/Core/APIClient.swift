import Foundation
import UIKit

enum APIError: LocalizedError {
    case invalidResponse
    case server(String)
    case unauthorized
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The server returned an invalid response."
        case .server(let message):
            return message
        case .unauthorized:
            return "Your session has expired. Please log in again."
        case .encodingFailed:
            return "The request could not be encoded."
        }
    }
}

final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    var token: String?

    private let decoder: JSONDecoder
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        session = URLSession(configuration: config)

        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    private func regionCode() -> String? {
        Locale.current.region?.identifier
    }

    private func surfaceFallbackNotices(from data: Data) {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let notices = object["fallback_notices"] as? [[String: Any]]
        else { return }

        for item in notices {
            let title = item["title"] as? String ?? "Fallback used"
            let message = item["message"] as? String ?? ""
            let detail = item["detail"] as? String ?? ""
            let combined = [message, detail]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            Task { @MainActor in
                FallbackNoticeCenter.shared.show(title: title, message: combined.isEmpty ? "Polycast used a fallback path." : combined)
            }
        }
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        queryItems: [URLQueryItem] = [],
        body: [String: Any]? = nil,
        maxRetries: Int = 1
    ) async throws -> T {
        var components = URLComponents(url: AppConfig.baseURL.appendingPathComponent("api\(path)"), resolvingAgainstBaseURL: false)
        if !queryItems.isEmpty {
            components?.queryItems = queryItems
        }
        guard let url = components?.url else { throw APIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            guard JSONSerialization.isValidJSONObject(body) else { throw APIError.encodingFailed }
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        var lastError: Error = APIError.invalidResponse
        for attempt in 0...maxRetries {
            if attempt > 0 {
                try await Task.sleep(nanoseconds: 1_000_000_000)
            }

            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }

            if http.statusCode == 401 {
                throw APIError.unauthorized
            }

            if http.statusCode >= 500, attempt < maxRetries {
                print("[Polycast] Server returned \(http.statusCode) on attempt \(attempt + 1), retrying...")
                lastError = APIError.server("Request failed with status \(http.statusCode).")
                continue
            }

            guard (200...299).contains(http.statusCode) else {
                if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let message = payload["error"] as? String ?? payload["message"] as? String {
                    throw APIError.server(message)
                }
                throw APIError.server("Request failed with status \(http.statusCode).")
            }

            surfaceFallbackNotices(from: data)
            return try decoder.decode(T.self, from: data)
        }

        throw lastError
    }

    func login(username: String, password: String) async throws -> AuthResponse {
        try await request("/login", method: "POST", body: [
            "username": username,
            "password": password,
        ])
    }

    func signup(username: String, password: String, displayName: String) async throws -> AuthResponse {
        try await request("/signup", method: "POST", body: [
            "username": username,
            "password": password,
            "display_name": displayName,
        ])
    }

    func getMe() async throws -> AuthUser {
        try await request("/me")
    }

    func exportSessionToken() async throws -> String {
        struct SessionTokenResponse: Codable {
            let token: String
        }

        let response: SessionTokenResponse = try await request("/session/export", method: "POST")
        return response.token
    }

    func updateSettings(
        nativeLanguage: String?,
        targetLanguage: String?,
        dailyNewLimit: Int,
        accountType: String,
        cefrLevel: String?
    ) async throws -> AuthUser {
        var body: [String: Any] = [
            "native_language": nativeLanguage as Any,
            "target_language": targetLanguage as Any,
            "daily_new_limit": dailyNewLimit,
            "account_type": accountType,
        ]
        if let cefrLevel {
            body["cefr_level"] = cefrLevel
        }
        return try await request("/me/settings", method: "PATCH", body: body)
    }

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

    func addVideo(youtubeID: String, language: String) async throws -> VideoDetail {
        try await request("/videos", method: "POST", body: [
            "url": "https://www.youtube.com/watch?v=\(youtubeID)",
            "language": language,
        ])
    }

    func news(lang: String, level: String?) async throws -> [NewsArticle] {
        var items = [URLQueryItem(name: "lang", value: lang)]
        if let level, !level.isEmpty { items.append(.init(name: "level", value: level)) }
        return try await request("/news", queryItems: items)
    }

    func savedWords() async throws -> [SavedWord] {
        try await request("/dictionary/words", queryItems: [
            URLQueryItem(name: "timeZone", value: TimeZone.current.identifier),
        ])
    }

    func studyOverview() async throws -> StudyOverview {
        try await request("/dictionary/study-overview", queryItems: [
            URLQueryItem(name: "timeZone", value: TimeZone.current.identifier),
        ])
    }

    func newWordPreview(limit: Int = 50) async throws -> [SavedWord] {
        try await request("/dictionary/new-preview", queryItems: [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "timeZone", value: TimeZone.current.identifier),
        ])
    }

    func todayWordsWidgetSnapshot(limit: Int = 20) async throws -> TodayWordsWidgetSnapshot {
        let payload: TodayWordsWidgetPreviewPayload = try await request("/dictionary/widget-preview", queryItems: [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "timeZone", value: TimeZone.current.identifier),
        ])
        let newCount = min(payload.overview.newAvailable, payload.overview.dailyNewLimit)
        return TodayWordsWidgetSnapshot(
            generatedAt: .now,
            dueCount: payload.overview.due + newCount,
            reviewCount: payload.overview.due,
            newCount: newCount,
            dailyNewLimit: payload.overview.dailyNewLimit,
            feedTitle: newCount > 0 ? "Today" : "Queue",
            words: payload.words.prefix(limit).map { $0.widgetWord }
        )
    }

    func cacheTodayWordsWidgetImages(for snapshot: TodayWordsWidgetSnapshot, limit: Int = 20) async {
        let words = Array(snapshot.words.prefix(limit))
        guard !words.isEmpty else { return }

        await withTaskGroup(of: Void.self) { group in
            var nextIndex = 0
            let concurrentDownloads = min(4, words.count)

            for _ in 0..<concurrentDownloads {
                let word = words[nextIndex]
                nextIndex += 1
                group.addTask { await self.cacheTodayWordsWidgetImage(for: word) }
            }

            while await group.next() != nil {
                guard nextIndex < words.count else { continue }
                let word = words[nextIndex]
                nextIndex += 1
                group.addTask { await self.cacheTodayWordsWidgetImage(for: word) }
            }
        }

        postTodayWordsWidgetDebugSignal("shared-image-batch-complete")
        postTodayWordsWidgetDebugSignal("shared-image-batch-\(words.count)")
    }

    private func cacheTodayWordsWidgetImage(for word: TodayWordsWidgetWord) async {
        guard let remoteURL = Self.proxyImageURL(word.imageUrl) else { return }
        let filename = TodayWordsWidgetImageStore.filename(for: word.id, imageURL: remoteURL.absoluteString)
        if TodayWordsWidgetImageStore.sharedImageData(forFilename: filename) != nil {
            postTodayWordsWidgetDebugSignal("shared-image-cache-hit")
            return
        }

        do {
            postTodayWordsWidgetDebugSignal("shared-image-start")
            var request = authorizedRequest(for: remoteURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 12
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let image = UIImage(data: data),
                  let thumbnailData = image.todayWordsWidgetThumbnailJPEGData(maxDimension: 560)
            else {
                postTodayWordsWidgetDebugSignal("shared-image-failed")
                return
            }
            TodayWordsWidgetImageStore.saveSharedImageData(thumbnailData, filename: filename)
        } catch {
            print("[Polycast] Failed to cache shared widget image for \(word.word): \(error)")
            postTodayWordsWidgetDebugSignal("shared-image-failed")
        }
    }

    func dueWords(newLimitOverride: Int? = nil, limit: Int? = nil, offset: Int? = nil) async throws -> [SavedWord] {
        var items = [URLQueryItem(name: "timeZone", value: TimeZone.current.identifier)]
        if let newLimitOverride {
            items.append(URLQueryItem(name: "newLimitOverride", value: String(newLimitOverride)))
        }
        if let limit {
            items.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        if let offset {
            items.append(URLQueryItem(name: "offset", value: String(offset)))
        }
        return try await request("/dictionary/due", queryItems: items)
    }

    func registerIOSVoIPToken(deviceToken: String, apnsEnvironment: String, bundleId: String) async throws {
        let _: OKResponse = try await request(
            "/users/me/ios-voip-token",
            method: "PUT",
            body: [
                "device_token": deviceToken,
                "apns_environment": apnsEnvironment,
                "bundle_id": bundleId,
            ]
        )
    }

    func unregisterIOSVoIPToken(deviceToken: String) async throws {
        let _: OKResponse = try await request(
            "/users/me/ios-voip-token",
            method: "DELETE",
            body: ["device_token": deviceToken]
        )
    }

    func lookupWord(word: String, sentence: String, nativeLang: String, targetLang: String?) async throws -> LookupResponse {
        var items = [
            URLQueryItem(name: "word", value: word),
            URLQueryItem(name: "sentence", value: sentence),
            URLQueryItem(name: "nativeLang", value: nativeLang),
        ]
        if let targetLang { items.append(.init(name: "targetLang", value: targetLang)) }
        return try await request("/dictionary/lookup", queryItems: items)
    }

    func wiktLookup(word: String, targetLang: String, nativeLang: String) async throws -> WiktLookupResponse {
        try await request("/dictionary/wikt-lookup", queryItems: [
            URLQueryItem(name: "word", value: word),
            URLQueryItem(name: "targetLang", value: targetLang),
            URLQueryItem(name: "nativeLang", value: nativeLang),
        ])
    }

    func enrichWord(word: String, sentence: String, nativeLang: String, targetLang: String?) async throws -> EnrichResponse {
        var body: [String: Any] = [
            "word": word,
            "sentence": sentence,
            "nativeLang": nativeLang,
        ]
        if let targetLang { body["targetLang"] = targetLang }
        return try await request("/dictionary/enrich", method: "POST", body: body)
    }

    func saveWord(
        word: String,
        translation: String,
        definition: String,
        targetLanguage: String?,
        sentenceContext: String? = nil,
        frequency: Int? = nil,
        frequencyCount: Int? = nil,
        exampleSentence: String? = nil,
        sentenceTranslation: String? = nil,
        partOfSpeech: String? = nil,
        imageUrl: String? = nil,
        lemma: String? = nil,
        forms: String? = nil,
        surfaceForm: String? = nil,
        imageTerm: String? = nil
    ) async throws -> SavedWord {
        var body: [String: Any] = [
            "word": word,
            "translation": translation,
            "definition": definition,
            "target_language": targetLanguage as Any,
            "sentence_context": sentenceContext as Any,
            "timeZone": TimeZone.current.identifier,
        ]
        if let frequency { body["frequency"] = frequency }
        if let frequencyCount { body["frequency_count"] = frequencyCount }
        if let exampleSentence { body["example_sentence"] = exampleSentence }
        if let sentenceTranslation { body["sentence_translation"] = sentenceTranslation }
        if let partOfSpeech { body["part_of_speech"] = partOfSpeech }
        if let imageUrl { body["image_url"] = imageUrl }
        if let lemma { body["lemma"] = lemma }
        if let forms { body["forms"] = forms }
        if let surfaceForm { body["surface_form"] = surfaceForm }
        if let imageTerm { body["image_term"] = imageTerm }

        let response: SavedWordResponse = try await request("/dictionary/words", method: "POST", body: body)
        return response.value
    }

    /// Append a surface form to an already-saved word's inflection list so the
    /// exact form a learner encountered highlights everywhere afterward.
    func addWordForm(id: String, form: String) async throws -> SavedWord {
        try await request("/dictionary/words/\(id)/forms", method: "POST", body: ["form": form])
    }

    func explainWord(word: String, sentence: String, nativeLang: String, targetLang: String?, context: String? = nil) async throws -> ExplainResponse {
        var items = [
            URLQueryItem(name: "word", value: word),
            URLQueryItem(name: "sentence", value: sentence),
            URLQueryItem(name: "nativeLang", value: nativeLang),
        ]
        if let targetLang { items.append(.init(name: "targetLang", value: targetLang)) }
        // Wider rolling-window passage for "Explain in context".
        if let context, !context.isEmpty, context != sentence {
            items.append(.init(name: "context", value: context))
        }
        return try await request("/dictionary/explain", queryItems: items)
    }

    func translatePhrase(phrase: String, nativeLang: String, targetLang: String) async throws -> String {
        let response: TranslateResponse = try await request("/translate/phrase", method: "POST", body: [
            "phrase": phrase,
            "nativeLang": nativeLang,
            "targetLang": targetLang,
        ])
        return response.translation
    }

    func explainSelection(selection: String, context: String, nativeLang: String, targetLang: String?) async throws -> String {
        var body: [String: Any] = [
            "selection": selection,
            "context": context,
            "nativeLang": nativeLang,
        ]
        if let targetLang { body["targetLang"] = targetLang }
        let response: SelectionExplainResponse = try await request("/dictionary/explain-selection", method: "POST", body: body)
        return response.explanation
    }

    func searchImages(query: String) async throws -> [String] {
        struct Envelope: Decodable { let images: [String] }
        let envelope: Envelope = try await request("/dictionary/image-search", queryItems: [
            URLQueryItem(name: "q", value: query),
        ])
        return envelope.images
    }

    func updateWordImage(id: String, imageUrl: String, imageTerm: String? = nil) async throws -> SavedWord {
        var body: [String: Any] = ["image_url": imageUrl]
        if let imageTerm { body["image_term"] = imageTerm }
        return try await request("/dictionary/words/\(id)/image", method: "PATCH", body: body)
    }

    func updateWord(
        id: String,
        word: String? = nil,
        translation: String? = nil,
        definition: String? = nil,
        exampleSentence: String? = nil,
        sentenceTranslation: String? = nil,
        partOfSpeech: String? = nil,
        imageUrl: String? = nil,
        imageTerm: String? = nil
    ) async throws -> SavedWord {
        var body: [String: Any] = [:]
        if let word { body["word"] = word }
        if let translation { body["translation"] = translation }
        if let definition { body["definition"] = definition }
        if let exampleSentence { body["example_sentence"] = exampleSentence }
        if let sentenceTranslation { body["sentence_translation"] = sentenceTranslation }
        if let partOfSpeech { body["part_of_speech"] = partOfSpeech }
        if let imageUrl { body["image_url"] = imageUrl }
        if let imageTerm { body["image_term"] = imageTerm }
        return try await request("/dictionary/words/\(id)", method: "PATCH", body: body)
    }

    func deleteWord(id: String) async throws {
        var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/dictionary/words/\(id)"),
            resolvingAgainstBaseURL: false
        )
        guard let url = components?.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = payload["error"] as? String ?? payload["message"] as? String {
                throw APIError.server(message)
            }
            throw APIError.server("Request failed with status \(http.statusCode).")
        }
    }

    func reviewWord(id: String, answer: String) async throws -> SavedWord {
        try await request("/dictionary/words/\(id)/review", method: "PATCH", body: [
            "answer": answer,
            "timeZone": TimeZone.current.identifier,
        ])
    }

    func drillSessions() async throws -> [DrillSession] {
        let envelope: DrillSessionsEnvelope = try await request("/practice/drill-sessions")
        return envelope.sessions
    }

    // MARK: - Audio

    func wordAudio(id: String) async throws -> Data {
        var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/dictionary/words/\(id)/audio"),
            resolvingAgainstBaseURL: false
        )
        guard let url = components?.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }

        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            throw APIError.server("Audio request failed with status \(http.statusCode).")
        }

        return data
    }

    func speak(text: String, languageCode: String?) async throws -> Data {
        var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/practice/voice/speak"),
            resolvingAgainstBaseURL: false
        )
        guard let url = components?.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        var body: [String: Any] = ["text": text]
        if let languageCode { body["languageCode"] = languageCode }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            throw APIError.server("Speak request failed with status \(http.statusCode).")
        }
        return data
    }

    // MARK: - Social

    func conversations() async throws -> [Conversation] {
        try await request("/conversations")
    }

    func messages(friendId: String, before: String? = nil) async throws -> MessagesPage {
        var items: [URLQueryItem] = []
        if let before { items.append(.init(name: "before", value: before)) }
        return try await request("/messages/\(friendId)", queryItems: items)
    }

    func sendMessage(friendId: String, body: String) async throws -> ChatMessage {
        try await request("/messages/\(friendId)", method: "POST", body: ["body": body])
    }

    func markMessagesRead(friendId: String) async throws {
        struct ReadResult: Codable { let updated: Int }
        let _: ReadResult = try await request("/messages/\(friendId)/read", method: "POST")
    }

    func friends() async throws -> [Friend] {
        try await request("/friends")
    }

    func friendRequests() async throws -> [FriendRequest] {
        try await request("/friends/requests")
    }

    func sendFriendRequest(userId: String) async throws {
        struct Result: Codable { let id: String }
        let _: Result = try await request("/friends/request", method: "POST", body: ["userId": userId])
    }

    func acceptFriendRequest(id: String) async throws {
        var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/friends/\(id)/accept"),
            resolvingAgainstBaseURL: false
        )
        guard let url = components?.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = payload["error"] as? String ?? payload["message"] as? String {
                throw APIError.server(message)
            }
            throw APIError.server("Request failed with status \(http.statusCode).")
        }
    }

    func rejectFriendRequest(id: String) async throws {
        var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/friends/\(id)/reject"),
            resolvingAgainstBaseURL: false
        )
        guard let url = components?.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = payload["error"] as? String ?? payload["message"] as? String {
                throw APIError.server(message)
            }
            throw APIError.server("Request failed with status \(http.statusCode).")
        }
    }

    func searchUsers(query: String) async throws -> [UserSearchResult] {
        try await request("/users/search", queryItems: [.init(name: "q", value: query)])
    }

    // MARK: - Students

    func getClassroomStudents(classroomId: String) async throws -> [ClassroomStudent] {
        try await request("/classrooms/\(classroomId)/students")
    }

    func addClassroomStudent(classroomId: String, studentId: String) async throws {
        struct Result: Codable { let classroomId: String }
        let _: Result = try await request("/classrooms/\(classroomId)/students", method: "POST", body: [
            "studentId": studentId,
        ])
    }

    func removeClassroomStudent(classroomId: String, studentId: String) async throws {
        var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/classrooms/\(classroomId)/students/\(studentId)"),
            resolvingAgainstBaseURL: false
        )
        guard let url = components?.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = payload["error"] as? String ?? payload["message"] as? String {
                throw APIError.server(message)
            }
            throw APIError.server("Request failed with status \(http.statusCode).")
        }
    }

    func getStudentStats(classroomId: String, studentId: String) async throws -> StudentDetailResponse {
        try await request("/classrooms/\(classroomId)/students/\(studentId)/stats")
    }

    // MARK: - Video Calling

    func iceServers() async throws -> IceServerResponse {
        try await request("/ice-servers")
    }

    // MARK: - Image Proxy

    func authorizedRequest(for url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        guard Self.isSameOrigin(url, AppConfig.baseURL), let token else {
            return request
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    static func proxyImageURL(_ urlString: String?) -> URL? {
        guard let urlString else { return nil }
        let normalizedURLString = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedURLString.isEmpty else { return nil }

        // Proxy Pixabay images to avoid hotlinking and rate-limiting issues.
        // We match both pixabay.com/get/... and cdn.pixabay.com/...
        // Support both http and https prefixes to be safe against older data.
        let isPixabay = normalizedURLString.hasPrefix("https://pixabay.com/") ||
                        normalizedURLString.hasPrefix("http://pixabay.com/") ||
                        normalizedURLString.hasPrefix("https://cdn.pixabay.com/") ||
                        normalizedURLString.hasPrefix("http://cdn.pixabay.com/")

        if isPixabay {
            var components = URLComponents(url: AppConfig.baseURL.appendingPathComponent("api/dictionary/image-proxy"), resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "url", value: normalizedURLString)]
            return components?.url
        }

        // Server-relative paths (e.g. /api/dictionary/image/<id>) resolve
        // against the API host.
        if normalizedURLString.hasPrefix("/") {
            return URL(string: normalizedURLString, relativeTo: AppConfig.baseURL)?.absoluteURL
        }

        return URL(string: normalizedURLString)
    }

    private static func isSameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && effectivePort(lhs) == effectivePort(rhs)
    }

    private static func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }
}

private func postTodayWordsWidgetDebugSignal(_ event: String) {
    let name = "com.patron.polycast.widget.\(event)" as CFString
    CFNotificationCenterPostNotification(
        CFNotificationCenterGetDarwinNotifyCenter(),
        CFNotificationName(name),
        nil,
        nil,
        true
    )
}

private struct TodayWordsWidgetPreviewPayload: Decodable {
    let overview: StudyOverview
    let words: [TodayWordsWidgetPreviewWord]
}

private struct TodayWordsWidgetPreviewWord: Decodable {
    let id: String
    let word: String
    let translation: String
    let definition: String
    let exampleSentence: String?
    let sentenceTranslation: String?
    let partOfSpeech: String?
    let imageUrl: String?

    var widgetWord: TodayWordsWidgetWord {
        TodayWordsWidgetWord(
            id: id,
            word: word,
            translation: translation,
            definition: definition,
            partOfSpeech: partOfSpeech,
            exampleSentence: exampleSentence,
            sentenceTranslation: sentenceTranslation,
            imageUrl: imageUrl,
            localImageFilename: nil,
            localCardFilename: nil
        )
    }
}
