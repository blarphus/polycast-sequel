import AppIntents
import Foundation
import Security
import SwiftUI
import UIKit
import WidgetKit

struct PreviousTodayWordIntent: AppIntent {
    static let title: LocalizedStringResource = "Previous Word"
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        let start = TodayWordsWidgetTiming.now()
        let startedAt = Date()
        TodayWordsWidgetDebugSignal.post("page-previous-start")
        let totalWords = TodayWordsWidgetStore.snapshotWordCount()
        TodayWordsWidgetStore.pageWord(action: "previous", totalWords: totalWords, startedAt: startedAt)
        WidgetCenter.shared.reloadTimelines(ofKind: todayWordsWidgetKind)
        TodayWordsWidgetTiming.logPageIntent(action: "previous", start: start, totalWords: totalWords)
        TodayWordsWidgetDebugSignal.post("page-previous-intent-complete")
        return .result()
    }
}

struct NextTodayWordIntent: AppIntent {
    static let title: LocalizedStringResource = "Next Word"
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        let start = TodayWordsWidgetTiming.now()
        let startedAt = Date()
        TodayWordsWidgetDebugSignal.post("page-next-start")
        let totalWords = TodayWordsWidgetStore.snapshotWordCount()
        TodayWordsWidgetStore.pageWord(action: "next", totalWords: totalWords, startedAt: startedAt)
        WidgetCenter.shared.reloadTimelines(ofKind: todayWordsWidgetKind)
        TodayWordsWidgetTiming.logPageIntent(action: "next", start: start, totalWords: totalWords)
        TodayWordsWidgetDebugSignal.post("page-next-intent-complete")
        return .result()
    }
}

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
            print("[PolycastWidget] No shared auth token available for widget refresh")
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
            print("[PolycastWidget] Refreshed widget snapshot: due=\(snapshot.dueCount), words=\(snapshot.words.count)")
            TodayWordsWidgetDebugSignal.post("timeline-success")
            TodayWordsWidgetRefreshGate.reloadIfAllowed()

            Task {
                await TodayWordsWidgetAPIClient.cacheImages(for: snapshot, token: token)
            }

            return snapshot
        } catch {
            print("[PolycastWidget] Failed to refresh widget snapshot: \(error)")
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

private enum TodayWordsWidgetTiming {
    static func now() -> UInt64 {
        DispatchTime.now().uptimeNanoseconds
    }

    static func milliseconds(since start: UInt64) -> Double {
        Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
    }

    static func logPageIntent(action: String, start: UInt64, totalWords: Int) {
        let milliseconds = milliseconds(since: start)
        print("[PolycastWidget] Widget page \(action) intent-handler-ms=\(format(milliseconds)) totalWords=\(totalWords)")
        TodayWordsWidgetDebugSignal.postMilliseconds("page-\(action)-intent", milliseconds: milliseconds)
    }

    static func logPageTimeline(action: String, milliseconds: Double) {
        print("[PolycastWidget] Widget page \(action) timeline-ready-ms=\(format(milliseconds))")
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

private enum TodayWordsWidgetAPIClient {
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
            print("[PolycastWidget] Widget request transport failed for \(path): \(error)")
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
            print("[PolycastWidget] Widget request decode failed for \(path): \(error)")
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
            print("[PolycastWidget] No writable image cache directory")
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
                print("[PolycastWidget] Image fetch failed for \(wordLabel)")
                TodayWordsWidgetDebugSignal.post("image-failed")
                return nil
            }
            try thumbnailData.write(to: destinationURL, options: .atomic)
            TodayWordsWidgetImageStore.saveSharedImageData(thumbnailData, filename: filename)
            print("[PolycastWidget] Cached widget image for \(wordLabel)")
            TodayWordsWidgetDebugSignal.post("image-ready")
            return filename
        } catch {
            print("[PolycastWidget] Failed to cache widget image for \(wordLabel): \(error)")
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

private enum TodayWordsWidgetDebugSignal {
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

struct TodayWordsWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayWordsEntry

    private var words: [TodayWordsWidgetWord] {
        entry.snapshot.words
    }

    private var selectedWord: TodayWordsWidgetWord? {
        guard !entry.snapshot.isAllDone, !words.isEmpty else { return nil }
        return words[safe: entry.state.selectedIndex % max(words.count, 1)]
    }

    private var contentPadding: CGFloat {
        switch family {
        case .systemSmall:
            return 13
        case .systemMedium:
            return 24
        default:
            return 20
        }
    }

    var body: some View {
        ZStack {
            if entry.snapshot.isAllDone {
                allDoneView
            } else if let selectedWord {
                wordView(selectedWord)
            } else if entry.snapshot.hasPracticeData {
                noNewWordsView
            } else {
                emptyView
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .transaction { transaction in
            transaction.disablesAnimations = true
            transaction.animation = nil
        }
        .containerBackground(for: .widget) {
            ZStack {
                Color(red: 0.20, green: 0.07, blue: 0.48)
                subtleBackdrop
            }
        }
    }

    private var subtleBackdrop: some View {
        LinearGradient(
            colors: [
                Color(red: 0.93, green: 0.18, blue: 0.92).opacity(0.86),
                Color(red: 0.38, green: 0.36, blue: 1.00).opacity(0.68),
                Color(red: 0.00, green: 0.75, blue: 0.88).opacity(0.50),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    @ViewBuilder
    private func wordView(_ word: TodayWordsWidgetWord) -> some View {
        switch family {
        case .systemSmall:
            smallWordView(word)
        case .systemMedium:
            mediumWordView(word)
        default:
            largeWordView(word)
        }
    }

    private func smallWordView(_ word: TodayWordsWidgetWord) -> some View {
        ZStack(alignment: .bottomLeading) {
            wordImage(word, cornerRadius: 0)
            LinearGradient(
                colors: [.black.opacity(0.08), .black.opacity(0.68)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: 6) {
                compactHeader
                Spacer(minLength: 0)
                Text(word.word)
                    .font(.title3.bold())
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
                partOfSpeechPill(word.partOfSpeech)
                Text(word.definition)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(2)
                    .minimumScaleFactor(0.74)

            }
            .padding(13)

                if words.count > 1 {
                    HStack {
                        previousEdgeButton()
                        Spacer(minLength: 0)
                        nextEdgeButton()
                    }
                    .padding(.horizontal, 6)
                }
        }
    }

    private func mediumWordView(_ word: TodayWordsWidgetWord) -> some View {
        GeometryReader { proxy in
            ZStack {
                if let image = localImage(filename: word.localCardFilename) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .clipped()
                } else {
                    mediumLayeredWordView(word, size: proxy.size)
                }

                if words.count > 1 {
                    HStack {
                        previousEdgeButton(height: proxy.size.height)
                        Spacer(minLength: 0)
                        nextEdgeButton(height: proxy.size.height)
                    }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
    }

    private func mediumLayeredWordView(_ word: TodayWordsWidgetWord, size: CGSize) -> some View {
        HStack(spacing: 0) {
            wordImage(word, cornerRadius: 0)
                .frame(width: size.width * 0.43, height: size.height)
                .clipped()

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 0) {
                    reviewCountLabel
                    Spacer(minLength: 0)
                }
                wordTitle(word, font: .title2.bold())
                partOfSpeechPill(
                    word.partOfSpeech,
                    font: .caption.weight(.heavy),
                    horizontalPadding: 10,
                    verticalPadding: 5
                )
                definitionBlock(
                    word,
                    definitionLines: 2,
                    definitionFont: .subheadline.weight(.bold),
                    minimumScaleFactor: 0.56
                )
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(width: size.width * 0.57, height: size.height, alignment: .leading)
            .background(Color(red: 0.07, green: 0.06, blue: 0.16))
        }
        .frame(width: size.width, height: size.height)
    }

    private func largeWordView(_ word: TodayWordsWidgetWord) -> some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 0) {
                wordImage(word, cornerRadius: 0)
                    .frame(height: proxy.size.height * 0.47)
                    .clipped()

                VStack(alignment: .leading, spacing: 9) {
                    wordTitle(word, font: .title.bold())
                    partOfSpeechPill(word.partOfSpeech)
                    definitionBlock(word, definitionLines: 3, definitionFont: .title3.weight(.bold))

                    if let example = cleaned(word.exampleSentence), !example.isEmpty {
                        Text(example)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.64))
                            .lineLimit(2)
                    }

                    Spacer(minLength: 0)

                    HStack(spacing: 12) {
                        previousEdgeButton()
                        Spacer()
                        reviewCountLabel
                        Spacer()
                        nextEdgeButton()
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .background(Color(red: 0.07, green: 0.06, blue: 0.16).opacity(0.94))
            }
        }
    }

    private var compactHeader: some View {
        HStack(spacing: 6) {
            brandMark
            Text("Polycast")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white.opacity(0.92))
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }

    private var brandMark: some View {
        Image(systemName: "p.square.fill")
            .font(.caption.weight(.bold))
            .foregroundStyle(.purple, .white)
    }

    private var reviewCountLabel: some View {
        let count = max(entry.snapshot.dueCount, entry.snapshot.reviewCount + entry.snapshot.newCount)
        return Text("\(count) \(count == 1 ? "card" : "cards") due today")
            .font(.caption2.weight(.heavy))
            .foregroundStyle(.white.opacity(0.82))
            .lineLimit(1)
            .minimumScaleFactor(0.74)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.white.opacity(0.10), in: Capsule())
    }

    private func wordTitle(_ word: TodayWordsWidgetWord, font: Font) -> some View {
        Text(word.word)
            .font(font)
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.62)
    }

    @ViewBuilder
    private func partOfSpeechPill(
        _ partOfSpeech: String?,
        font: Font = .caption2.weight(.heavy),
        horizontalPadding: CGFloat = 8,
        verticalPadding: CGFloat = 4
    ) -> some View {
        if let partOfSpeech, !partOfSpeech.isEmpty {
            Text(partOfSpeech.uppercased())
                .font(font)
                .foregroundStyle(.white)
                .lineLimit(1)
                .padding(.horizontal, horizontalPadding)
                .padding(.vertical, verticalPadding)
                .background(.purple.opacity(0.86), in: Capsule())
        }
    }

    private func definitionBlock(
        _ word: TodayWordsWidgetWord,
        definitionLines: Int,
        definitionFont: Font = .caption,
        minimumScaleFactor: CGFloat = 0.72
    ) -> some View {
        Text(word.definition)
            .font(definitionFont)
            .foregroundStyle(.white)
            .lineLimit(definitionLines)
            .minimumScaleFactor(minimumScaleFactor)
    }

    @ViewBuilder
    private func nextButton(iconOnly: Bool) -> some View {
        if words.count > 1 {
            Button(intent: NextTodayWordIntent()) {
                if iconOnly {
                    Label("Next", systemImage: "arrow.right")
                        .labelStyle(.iconOnly)
                        .frame(width: 44, height: 32)
                } else {
                    Label("Next", systemImage: "arrow.right")
                        .frame(height: 32)
                }
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, iconOnly ? 0 : 10)
            .background(.purple, in: Capsule())
            .buttonStyle(.plain)
        }
    }

    private var previousButton: some View {
        Button(intent: PreviousTodayWordIntent()) {
            Label("Previous", systemImage: "arrow.left")
                .labelStyle(.iconOnly)
                .frame(width: 36, height: 32)
        }
        .font(.caption.weight(.bold))
        .foregroundStyle(.white)
        .background(.white.opacity(0.14), in: Capsule())
        .buttonStyle(.plain)
        .disabled(words.count < 2)
    }

    private func previousEdgeButton(height: CGFloat = 48) -> some View {
        Button(intent: PreviousTodayWordIntent()) {
            Image(systemName: "chevron.left")
                .font(.title3.weight(.semibold))
                .frame(width: 64, height: height)
                .contentShape(Rectangle())
        }
        .foregroundStyle(.white.opacity(0.88))
        .buttonStyle(.plain)
        .buttonRepeatBehavior(.enabled)
        .disabled(words.count < 2)
    }

    private func nextEdgeButton(height: CGFloat = 48) -> some View {
        Button(intent: NextTodayWordIntent()) {
            Image(systemName: "chevron.right")
                .font(.title3.weight(.semibold))
                .frame(width: 64, height: height)
                .contentShape(Rectangle())
        }
        .foregroundStyle(.white.opacity(0.88))
        .buttonStyle(.plain)
        .buttonRepeatBehavior(.enabled)
        .disabled(words.count < 2)
    }

    private func pageDots(dotSize: CGFloat = 6, spacing: CGFloat = 6) -> some View {
        HStack(spacing: spacing) {
            ForEach(0..<min(words.count, 5), id: \.self) { index in
                Circle()
                    .fill(dotIsSelected(index) ? Color.purple : Color.white.opacity(0.34))
                    .frame(width: dotSize, height: dotSize)
            }
        }
        .opacity(words.count > 1 ? 1 : 0)
    }

    private func dotIsSelected(_ index: Int) -> Bool {
        (entry.state.selectedIndex % max(min(words.count, 5), 1)) == index
    }

    @ViewBuilder
    private func wordImage(_ word: TodayWordsWidgetWord, cornerRadius: CGFloat) -> some View {
        if let image = localImage(for: word) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        } else {
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.34, green: 0.30, blue: 0.92),
                        Color(red: 0.09, green: 0.08, blue: 0.20),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Image(systemName: "photo")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.56))
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        }
    }

    private func localImage(for word: TodayWordsWidgetWord) -> UIImage? {
        if let image = localImage(filename: word.localImageFilename) {
            return image
        }
        guard let imageUrl = APIImageURLString(word.imageUrl),
              let data = TodayWordsWidgetImageStore.sharedImageData(for: word.id, imageURL: imageUrl)
        else {
            return nil
        }
        TodayWordsWidgetDebugSignal.post("shared-image-rendered")
        return UIImage(data: data)
    }

    private func localImage(filename: String?) -> UIImage? {
        guard let url = TodayWordsWidgetImageStore.imageURL(for: filename) else {
            return nil
        }
        return UIImage(contentsOfFile: url.path)
    }

    private func APIImageURLString(_ urlString: String?) -> String? {
        TodayWordsWidgetAPIClient.renderableImageURLString(urlString)
    }

    private var allDoneView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "checkmark.seal.fill")
                .font(.title2.bold())
                .foregroundStyle(.green)
            Text("All done for today")
                .font(.title2.bold())
                .foregroundStyle(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.78)
            Text("You cleared today's practice.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(2)
            Spacer(minLength: 0)
            Link(destination: URL(string: "polycast://practice")!) {
                Label("Open Polycast", systemImage: "arrow.up.right")
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(contentPadding)
    }

    private var noNewWordsView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "bolt.fill")
                .font(.title2.bold())
                .foregroundStyle(.purple)
            Text(entry.snapshot.reviewCount > 0 ? "Reviews ready" : "No new words")
                .font(.title2.bold())
                .foregroundStyle(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.78)
            Text(entry.snapshot.reviewCount > 0 ? "\(entry.snapshot.reviewCount) cards are waiting in practice." : "Your new-word queue is clear for today.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(3)
            Spacer(minLength: 0)
            Link(destination: URL(string: "polycast://practice")!) {
                Label("Open Practice", systemImage: "arrow.up.right")
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.borderedProminent)
            .tint(.purple)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(contentPadding)
    }

    private var emptyView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Polycast")
                .font(.headline.bold())
                .foregroundStyle(.white)
            Text("Open practice once to load today's words.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(3)
            Spacer(minLength: 0)
            Link(destination: URL(string: "polycast://practice")!) {
                Label("Open", systemImage: "arrow.up.right")
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.borderedProminent)
            .tint(.purple)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(contentPadding)
    }

    private func cleaned(_ text: String?) -> String? {
        text?.replacingOccurrences(of: "~", with: "")
    }
}

@main
struct PolycastWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWordsWidget()
    }
}

struct TodayWordsWidget: Widget {
    let kind = todayWordsWidgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayWordsProvider()) { entry in
            TodayWordsWidgetView(entry: entry)
        }
        .configurationDisplayName("Today's Words")
        .description("Preview and reveal the new words waiting in Polycast.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else { return nil }
        return self[index]
    }
}

#Preview(as: .systemMedium) {
    TodayWordsWidget()
} timeline: {
    TodayWordsEntry(date: .now, snapshot: .sample, state: .empty)
    TodayWordsEntry(date: .now, snapshot: .sample, state: TodayWordsWidgetState(selectedIndex: 1, isRevealed: true, navigationDirection: 1))
    TodayWordsEntry(date: .now, snapshot: .empty, state: .empty)
}
