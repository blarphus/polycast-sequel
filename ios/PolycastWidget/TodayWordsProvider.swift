import AppIntents
import Foundation
import OSLog
import Security
import SwiftUI
import UIKit
import WidgetKit

private let widgetLogger = Logger(subsystem: "app.polycast.widget", category: "Runtime")

struct TodayWordsEntry: TimelineEntry {
    let date: Date
    let snapshot: TodayWordsWidgetSnapshot
    let state: TodayWordsWidgetState
}
struct TodayWordsProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayWordsEntry {
        TodayWordsEntry(date: .now, snapshot: .sample, state: .empty)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayWordsEntry) -> Void) {
        let isPreview = context.isPreview
        let completion = WidgetCompletion(completion)
        Task {
            let snapshot = await loadSnapshot(isPreview: isPreview, refreshInBackground: false)
            completion.call(TodayWordsEntry(date: .now, snapshot: snapshot, state: TodayWordsWidgetStore.loadState()))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayWordsEntry>) -> Void) {
        let isPreview = context.isPreview
        let completion = WidgetCompletion(completion)
        Task {
            let isPagingReload = TodayWordsWidgetStore.pendingPagingAge().map { $0 >= 0 && $0 < 5 } ?? false
            let snapshot: TodayWordsWidgetSnapshot
            if isPagingReload {
                TodayWordsWidgetDebugSignal.post("timeline-start")
                snapshot = TodayWordsWidgetStore.loadSnapshot()
                if snapshot.hasPracticeData {
                    TodayWordsWidgetDebugSignal.post("timeline-returned-cached")
                }
            } else {
                snapshot = await loadSnapshot(isPreview: isPreview, refreshInBackground: true)
            }
            let cadence: TimeInterval = 1_800
            var state = TodayWordsWidgetStore.loadState()
            if snapshot.words.count > 1, snapshot.hasPracticeData {
                let elapsed = max(0, Date().timeIntervalSince(snapshot.generatedAt))
                let rotationOffset = Int(elapsed / cadence)
                state.selectedIndex = (state.selectedIndex + rotationOffset) % snapshot.words.count
            }
            let entry = TodayWordsEntry(date: .now, snapshot: snapshot, state: state)
            let refreshDelay: TimeInterval = snapshot.hasPracticeData ? cadence : 60
            if let paging = TodayWordsWidgetStore.completePendingPagingIfNeeded() {
                TodayWordsWidgetTiming.logPageTimeline(action: paging.action, milliseconds: paging.milliseconds)
                TodayWordsWidgetDebugSignal.post("page-\(paging.action)-timeline-complete")
            }
            if !isPagingReload, snapshot.hasPracticeData, snapshot.words.contains(where: { $0.imageUrl != nil && $0.localImageFilename == nil }) {
                Task {
                    guard let token = TodayWordsWidgetKeychainTokenStore.load() else { return }
                    await TodayWordsWidgetAPIClient.cacheImages(for: snapshot, token: token)
                }
            }
            completion.call(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(refreshDelay))))
        }
    }

    private func loadSnapshot(isPreview: Bool, refreshInBackground: Bool) async -> TodayWordsWidgetSnapshot {
        if isPreview {
            return .sample
        }

        TodayWordsWidgetDebugSignal.post("timeline-start")
        let cached = TodayWordsWidgetStore.loadSnapshot()
        if cached.hasPracticeData {
            TodayWordsWidgetDebugSignal.post("timeline-returned-cached")
        }

        guard let token = TodayWordsWidgetKeychainTokenStore.load() else {
            widgetLogger.error("[PolycastWidget] No shared auth token available for widget refresh")
            TodayWordsWidgetDebugSignal.post("token-missing")
            return cached
        }
        TodayWordsWidgetDebugSignal.post("token-ready")

        if refreshInBackground {
            Task {
                await refreshSnapshot(token: token)
            }
            return cached
        }

        guard !cached.hasPracticeData else { return cached }
        return await refreshSnapshot(token: token) ?? cached
    }

    @discardableResult
    private func refreshSnapshot(token: String) async -> TodayWordsWidgetSnapshot? {
        do {
            let snapshot = try await TodayWordsWidgetAPIClient.fetchSnapshot(token: token)
            TodayWordsWidgetStore.saveSnapshot(snapshot)
            widgetLogger.error("[PolycastWidget] Refreshed widget snapshot: due=\(snapshot.dueCount), words=\(snapshot.words.count)")
            TodayWordsWidgetDebugSignal.post("timeline-success")
            TodayWordsWidgetRefreshGate.reloadIfAllowed()

            Task {
                await TodayWordsWidgetAPIClient.cacheImages(for: snapshot, token: token)
            }

            return snapshot
        } catch {
            widgetLogger.error("[PolycastWidget] Failed to refresh widget snapshot: \(error)")
            TodayWordsWidgetDebugSignal.post("timeline-failed")
            return nil
        }
    }
}
private final class WidgetCompletion<Value>: @unchecked Sendable {
    private let handler: (Value) -> Void

    init(_ handler: @escaping (Value) -> Void) {
        self.handler = handler
    }

    func call(_ value: Value) {
        handler(value)
    }
}

enum TodayWordsWidgetTiming {
    static func now() -> UInt64 {
        DispatchTime.now().uptimeNanoseconds
    }

    static func milliseconds(since start: UInt64) -> Double {
        Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
    }

    static func logPageIntent(action: String, start: UInt64, totalWords: Int) {
        let milliseconds = milliseconds(since: start)
        widgetLogger.error("[PolycastWidget] Widget page \(action) intent-handler-ms=\(format(milliseconds)) totalWords=\(totalWords)")
        TodayWordsWidgetDebugSignal.postMilliseconds("page-\(action)-intent", milliseconds: milliseconds)
    }

    static func logPageTimeline(action: String, milliseconds: Double) {
        widgetLogger.error("[PolycastWidget] Widget page \(action) timeline-ready-ms=\(format(milliseconds))")
        TodayWordsWidgetDebugSignal.postMilliseconds("page-\(action)-timeline", milliseconds: milliseconds)
    }

    private static func format(_ milliseconds: Double) -> String {
        String(format: "%.2f", milliseconds)
    }
}

private enum TodayWordsWidgetKeychainTokenStore {
    private static let service = "com.patron.polycast"
    private static let account = "auth-token"

    static func load() -> String? {
        guard let accessGroup = sharedAccessGroup else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static var sharedAccessGroup: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "PolycastSharedKeychainAccessGroup") as? String,
              !value.isEmpty,
              !value.contains("$")
        else { return nil }
        return value
    }
}

enum TodayWordsWidgetAPIClient {
    private static let baseURL = URL(string: "https://polycast-sequel.onrender.com/api")!
    private static let appBaseURL = URL(string: "https://polycast-sequel.onrender.com")!
    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 25
        return URLSession(configuration: config)
    }()

    static func fetchSnapshot(token: String) async throws -> TodayWordsWidgetSnapshot {
        let payload: WidgetPreview = try await request(
            "/dictionary/widget-preview",
            token: token,
            queryItems: timeZoneQuery + [URLQueryItem(name: "limit", value: "20")],
            signalName: "request-preview"
        )
        TodayWordsWidgetDebugSignal.post("request-core-success")

        let overview = payload.overview
        let newCount = min(overview.newAvailable, overview.dailyNewLimit)
        let dueCount = overview.due + newCount

        return TodayWordsWidgetSnapshot(
            generatedAt: .now,
            dueCount: dueCount,
            reviewCount: overview.due,
            newCount: newCount,
            dailyNewLimit: overview.dailyNewLimit,
            feedTitle: newCount > 0 ? "Today" : "Queue",
            words: Array(payload.words.prefix(20)).map(widgetWord)
        )
    }

    static func cacheImages(for snapshot: TodayWordsWidgetSnapshot, token: String) async {
        var words = snapshot.words
        var changed = false

        for index in words.indices.prefix(4) where words[index].localImageFilename == nil {
            let filename = await cacheWidgetImage(
                wordID: words[index].id,
                imageUrl: words[index].imageUrl,
                wordLabel: words[index].word,
                token: token
            )
            guard let filename else { continue }
            words[index] = words[index].withLocalImageFilename(filename)
            changed = true
        }

        guard changed else { return }

        let updated = TodayWordsWidgetSnapshot(
            generatedAt: snapshot.generatedAt,
            dueCount: snapshot.dueCount,
            reviewCount: snapshot.reviewCount,
            newCount: snapshot.newCount,
            dailyNewLimit: snapshot.dailyNewLimit,
            feedTitle: snapshot.feedTitle,
            words: words
        )
        TodayWordsWidgetStore.saveSnapshot(updated)
        TodayWordsWidgetRefreshGate.reloadIfAllowed()
    }

    private static func request<T: Decodable>(
        _ path: String,
        token: String,
        queryItems: [URLQueryItem],
        signalName: String
    ) async throws -> T {
        TodayWordsWidgetDebugSignal.post("\(signalName)-start")
        var components = URLComponents(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))), resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems
        guard let url = components?.url else { throw URLError(.badURL) }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            widgetLogger.error("[PolycastWidget] Widget request transport failed for \(path): \(error)")
            TodayWordsWidgetDebugSignal.post("\(signalName)-failed")
            TodayWordsWidgetDebugSignal.post("\(signalName)-transport-failed")
            if let urlError = error as? URLError {
                TodayWordsWidgetDebugSignal.post("\(signalName)-transport-code-\(urlError.errorCode)")
            }
            throw error
        }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            if let http = response as? HTTPURLResponse {
                TodayWordsWidgetDebugSignal.post("\(signalName)-status-\(http.statusCode)")
            } else {
                TodayWordsWidgetDebugSignal.post("\(signalName)-non-http-response")
            }
            TodayWordsWidgetDebugSignal.post("\(signalName)-failed")
            throw URLError(.badServerResponse)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        do {
            let decoded = try decoder.decode(T.self, from: data)
            TodayWordsWidgetDebugSignal.post("\(signalName)-success")
            TodayWordsWidgetDebugSignal.post("\(signalName)-bytes-\(data.count)")
            return decoded
        } catch {
            widgetLogger.error("[PolycastWidget] Widget request decode failed for \(path): \(error)")
            TodayWordsWidgetDebugSignal.post("\(signalName)-failed")
            TodayWordsWidgetDebugSignal.post("\(signalName)-decode-failed")
            TodayWordsWidgetDebugSignal.post("\(signalName)-decode-bytes-\(data.count)")
            throw error
        }
    }

    private static var timeZoneQuery: [URLQueryItem] {
        [URLQueryItem(name: "timeZone", value: TimeZone.current.identifier)]
    }

    private static func widgetWord(_ word: SavedWord) -> TodayWordsWidgetWord {
        TodayWordsWidgetWord(
            id: word.id,
            word: word.word,
            translation: word.translation,
            definition: word.definition,
            partOfSpeech: word.partOfSpeech,
            exampleSentence: word.exampleSentence,
            sentenceTranslation: word.sentenceTranslation,
            imageUrl: word.imageUrl,
            localImageFilename: nil,
            localCardFilename: nil
        )
    }

    static func renderableImageURLString(_ urlString: String?) -> String? {
        imageURL(urlString)?.absoluteString
    }

    private static func cacheWidgetImage(wordID: String, imageUrl: String?, wordLabel: String, token: String) async -> String? {
        guard let remoteURL = imageURL(imageUrl) else { return nil }
        let filename = TodayWordsWidgetImageStore.filename(for: wordID, imageURL: remoteURL.absoluteString)
        if TodayWordsWidgetImageStore.sharedImageData(forFilename: filename) != nil {
            TodayWordsWidgetDebugSignal.post("image-ready")
            return filename
        }
        guard let directory = try? TodayWordsWidgetImageStore.ensureDirectory() else {
            widgetLogger.error("[PolycastWidget] No writable image cache directory")
            TodayWordsWidgetDebugSignal.post("image-cache-missing")
            return nil
        }
        let destinationURL = directory.appendingPathComponent(filename)

        if FileManager.default.fileExists(atPath: destinationURL.path) {
            TodayWordsWidgetDebugSignal.post("image-ready")
            return filename
        }

        do {
            TodayWordsWidgetDebugSignal.post("image-start")
            var request = URLRequest(url: remoteURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 8
            if isSameOrigin(remoteURL, appBaseURL) {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            let imageRequest = request
            let (data, response) = try await withTimeout(seconds: 4) {
                try await session.data(for: imageRequest)
            }
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let image = UIImage(data: data),
                  let thumbnailData = image.widgetThumbnailJPEGData(maxDimension: 560)
            else {
                widgetLogger.error("[PolycastWidget] Image fetch failed for \(wordLabel)")
                TodayWordsWidgetDebugSignal.post("image-failed")
                return nil
            }
            try thumbnailData.write(to: destinationURL, options: .atomic)
            TodayWordsWidgetImageStore.saveSharedImageData(thumbnailData, filename: filename)
            widgetLogger.error("[PolycastWidget] Cached widget image for \(wordLabel)")
            TodayWordsWidgetDebugSignal.post("image-ready")
            return filename
        } catch {
            widgetLogger.error("[PolycastWidget] Failed to cache widget image for \(wordLabel): \(error)")
            TodayWordsWidgetDebugSignal.post("image-failed")
            return nil
        }
    }

    private static func withTimeout<T: Sendable>(
        seconds: UInt64,
        operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }
            group.addTask {
                try await Task.sleep(nanoseconds: seconds * 1_000_000_000)
                throw URLError(.timedOut)
            }

            guard let result = try await group.next() else {
                throw URLError(.unknown)
            }
            group.cancelAll()
            return result
        }
    }

    private static func imageURL(_ urlString: String?) -> URL? {
        guard let urlString else { return nil }
        let normalizedURLString = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedURLString.isEmpty else { return nil }

        let isPixabay = normalizedURLString.hasPrefix("https://pixabay.com/") ||
                        normalizedURLString.hasPrefix("http://pixabay.com/") ||
                        normalizedURLString.hasPrefix("https://cdn.pixabay.com/") ||
                        normalizedURLString.hasPrefix("http://cdn.pixabay.com/")

        if isPixabay {
            var components = URLComponents(url: baseURL.appendingPathComponent("dictionary/image-proxy"), resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "url", value: normalizedURLString)]
            return components?.url
        }

        if normalizedURLString.hasPrefix("/") {
            return URL(string: normalizedURLString, relativeTo: appBaseURL)?.absoluteURL
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

    private struct WidgetPreview: Decodable {
        let overview: StudyOverview
        let words: [SavedWord]
    }

    private struct StudyOverview: Decodable {
        let due: Int
        let newAvailable: Int
        let dailyNewLimit: Int
    }

    private struct SavedWord: Decodable {
        let id: String
        let word: String
        let translation: String
        let definition: String
        let exampleSentence: String?
        let sentenceTranslation: String?
        let partOfSpeech: String?
        let imageUrl: String?
    }
}

private extension TodayWordsWidgetWord {
    func withLocalImageFilename(_ filename: String) -> TodayWordsWidgetWord {
        TodayWordsWidgetWord(
            id: id,
            word: word,
            translation: translation,
            definition: definition,
            partOfSpeech: partOfSpeech,
            exampleSentence: exampleSentence,
            sentenceTranslation: sentenceTranslation,
            imageUrl: imageUrl,
            localImageFilename: filename,
            localCardFilename: localCardFilename
        )
    }
}

private enum TodayWordsWidgetRefreshGate {
    private static let key = "todayWordsWidget.lastReloadAfterRefresh"
    private static let minimumInterval: TimeInterval = 30

    static func reloadIfAllowed() {
        let now = Date()
        let lastReload = UserDefaults.standard.object(forKey: key) as? Date ?? .distantPast
        guard now.timeIntervalSince(lastReload) >= minimumInterval else { return }
        UserDefaults.standard.set(now, forKey: key)
        WidgetCenter.shared.reloadTimelines(ofKind: todayWordsWidgetKind)
    }
}

enum TodayWordsWidgetDebugSignal {
    private static let prefix = "com.patron.polycast.widget"

    static func post(_ event: String) {
        let name = "\(prefix).\(event)" as CFString
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name),
            nil,
            nil,
            true
        )
    }

    static func postMilliseconds(_ event: String, milliseconds: Double) {
        let rounded = min(max(Int(milliseconds.rounded()), 0), 9_999)
        post("\(event)-ms-\(rounded)")
        post(milliseconds <= 50 ? "\(event)-fast" : "\(event)-slow")
    }
}

private extension UIImage {
    func widgetThumbnailJPEGData(maxDimension: CGFloat) -> Data? {
        let longestSide = max(size.width, size.height)
        guard longestSide > 0 else { return nil }

        let scale = min(1, maxDimension / longestSide)
        let outputImage: UIImage
        if scale < 1 {
            let outputSize = CGSize(width: size.width * scale, height: size.height * scale)
            let renderer = UIGraphicsImageRenderer(size: outputSize)
            outputImage = renderer.image { _ in
                draw(in: CGRect(origin: .zero, size: outputSize))
            }
        } else {
            outputImage = self
        }

        return outputImage.jpegData(compressionQuality: 0.84)
    }
}
