import Foundation
import UIKit

extension APIClient {
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
            PolycastLog.runtime.error("[Polycast] Failed to cache shared widget image for \(word.word): \(error)")
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
        imageTerm: String? = nil,
        rankVersionId: String? = nil,
        lemmaFrequencyRank: Int? = nil,
        senseRank: Int? = nil,
        lemmaOccurrencesPerBillion: Int? = nil,
        frequencyConfidence: String? = nil,
        frequencySources: [FrequencySource]? = nil
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
        if let rankVersionId { body["rank_version_id"] = rankVersionId }
        if let lemmaFrequencyRank { body["lemma_frequency_rank"] = lemmaFrequencyRank }
        if let senseRank { body["sense_rank"] = senseRank }
        if let lemmaOccurrencesPerBillion { body["lemma_occurrences_per_billion"] = lemmaOccurrencesPerBillion }
        if let frequencyConfidence { body["frequency_confidence"] = frequencyConfidence }
        if let frequencySources, let encoded = try? JSONEncoder().encode(frequencySources),
           let json = try? JSONSerialization.jsonObject(with: encoded) { body["frequency_sources"] = json }

        let response: SavedWordResponse = try await request("/dictionary/words", method: "POST", body: body)
        if response.created == true {
            await MainActor.run {
                DailyWordGoalStore.shared.recordWordAdded()
            }
        }
        return response.value
    }

    func rebuildFrequencyQueue() async throws -> Int {
        struct Response: Codable { let reordered: Int }
        let response: Response = try await request("/dictionary/queue-rebuild", method: "POST")
        return response.reordered
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
        let components = URLComponents(
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
        if http.statusCode == 401 {
            invalidateSessionAfterUnauthorizedResponse(path: "/dictionary/words/\(id)")
            throw APIError.unauthorized
        }
        guard (200...299).contains(http.statusCode) else {
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = payload["error"] as? String ?? payload["message"] as? String {
                throw APIError.server(message)
            }
            throw APIError.server("Request failed with status \(http.statusCode).")
        }
    }

    func reviewWord(id: String, answer: String) async throws -> SavedWord {
        try await request(
            "/dictionary/words/\(id)/review",
            method: "PATCH",
            body: [
                "answer": answer,
                "timeZone": TimeZone.current.identifier,
            ],
            maxRetries: 1,
            idempotencyKey: UUID().uuidString
        )
    }

    // MARK: - Audio

    func wordAudio(id: String) async throws -> Data {
        let components = URLComponents(
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

        if http.statusCode == 401 {
            invalidateSessionAfterUnauthorizedResponse(path: "/dictionary/words/\(id)/audio")
            throw APIError.unauthorized
        }
        guard (200...299).contains(http.statusCode) else {
            throw APIError.server("Audio request failed with status \(http.statusCode).")
        }

        return data
    }

    func speak(text: String, languageCode: String?) async throws -> Data {
        let components = URLComponents(
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
        if http.statusCode == 401 {
            invalidateSessionAfterUnauthorizedResponse(path: "/practice/voice/speak")
            throw APIError.unauthorized
        }
        guard (200...299).contains(http.statusCode) else {
            throw APIError.server("Speak request failed with status \(http.statusCode).")
        }
        return data
    }

    // MARK: - Social


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
