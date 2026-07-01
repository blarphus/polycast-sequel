import Foundation
import Security
import UIKit

let todayWordsWidgetKind = "TodayWordsWidget"
let polycastAppGroupIdentifier = "group.com.patron.polycast"

struct TodayWordsWidgetWord: Codable, Hashable, Identifiable {
    let id: String
    let word: String
    let translation: String
    let definition: String
    let partOfSpeech: String?
    let exampleSentence: String?
    let sentenceTranslation: String?
    let imageUrl: String?
    let localImageFilename: String?
    let localCardFilename: String?
}

struct TodayWordsWidgetSnapshot: Codable, Hashable {
    let generatedAt: Date
    let dueCount: Int
    let reviewCount: Int
    let newCount: Int
    let dailyNewLimit: Int
    let feedTitle: String?
    let words: [TodayWordsWidgetWord]

    var hasPracticeData: Bool {
        generatedAt > Date.distantPast.addingTimeInterval(1)
    }

    var isAllDone: Bool {
        hasPracticeData && words.isEmpty && dueCount == 0 && newCount == 0
    }

    static let empty = TodayWordsWidgetSnapshot(
        generatedAt: .distantPast,
        dueCount: 0,
        reviewCount: 0,
        newCount: 0,
        dailyNewLimit: 0,
        feedTitle: nil,
        words: []
    )

    static let sample = TodayWordsWidgetSnapshot(
        generatedAt: .now,
        dueCount: 0,
        reviewCount: 0,
        newCount: 3,
        dailyNewLimit: 5,
        feedTitle: "Today",
        words: [
            TodayWordsWidgetWord(
                id: "sample-aprender",
                word: "aprender",
                translation: "to learn",
                definition: "to gain knowledge or skill",
                partOfSpeech: "verb",
                exampleSentence: "Quiero ~aprender~ algo nuevo hoy.",
                sentenceTranslation: "I want to ~learn~ something new today.",
                imageUrl: nil,
                localImageFilename: nil,
                localCardFilename: nil
            ),
            TodayWordsWidgetWord(
                id: "sample-claro",
                word: "claro",
                translation: "clear",
                definition: "easy to understand or see",
                partOfSpeech: "adjective",
                exampleSentence: "La respuesta es muy ~clara~.",
                sentenceTranslation: "The answer is very ~clear~.",
                imageUrl: nil,
                localImageFilename: nil,
                localCardFilename: nil
            ),
            TodayWordsWidgetWord(
                id: "sample-listo",
                word: "listo",
                translation: "ready",
                definition: "prepared for what comes next",
                partOfSpeech: "adjective",
                exampleSentence: "Estoy ~listo~ para empezar.",
                sentenceTranslation: "I am ~ready~ to start.",
                imageUrl: nil,
                localImageFilename: nil,
                localCardFilename: nil
            ),
        ]
    )
}

struct TodayWordsWidgetState: Codable, Hashable {
    var selectedIndex: Int
    var isRevealed: Bool
    var navigationDirection: Int = 1

    static let empty = TodayWordsWidgetState(selectedIndex: 0, isRevealed: false, navigationDirection: 1)

    init(selectedIndex: Int, isRevealed: Bool, navigationDirection: Int = 1) {
        self.selectedIndex = selectedIndex
        self.isRevealed = isRevealed
        self.navigationDirection = navigationDirection
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        selectedIndex = try container.decode(Int.self, forKey: .selectedIndex)
        isRevealed = try container.decode(Bool.self, forKey: .isRevealed)
        navigationDirection = try container.decodeIfPresent(Int.self, forKey: .navigationDirection) ?? 1
    }
}

enum TodayWordsWidgetStore {
    private static let snapshotKey = "todayWordsWidget.snapshot"
    private static let snapshotWordCountKey = "todayWordsWidget.snapshotWordCount"
    private static let stateKey = "todayWordsWidget.state"
    private static let pagingActionKey = "todayWordsWidget.pagingAction"
    private static let pagingStartedAtKey = "todayWordsWidget.pagingStartedAt"
    private static let keychainService = "com.patron.polycast.today-words-widget"
    private static let keychainSnapshotAccount = "snapshot"

    private static var defaults: UserDefaults {
        UserDefaults(suiteName: polycastAppGroupIdentifier) ?? .standard
    }

    static func loadSnapshot() -> TodayWordsWidgetSnapshot {
        let local = defaults.data(forKey: snapshotKey)
            .flatMap { try? JSONDecoder().decode(TodayWordsWidgetSnapshot.self, from: $0) }
        let shared = loadSharedSnapshot()

        switch (local, shared) {
        case let (local?, shared?):
            return shared.generatedAt > local.generatedAt ? shared : local
        case let (local?, nil):
            return local
        case let (nil, shared?):
            return shared
        case (nil, nil):
            return .empty
        }
    }

    static func saveSnapshot(_ snapshot: TodayWordsWidgetSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)
        defaults.set(snapshot.words.count, forKey: snapshotWordCountKey)
        saveSharedSnapshotData(data)
        postDebugSignal("shared-snapshot-saved")
        postDebugSignal("shared-snapshot-words-\(snapshot.words.count)")

        let wordCount = max(snapshot.words.count, 1)
        var state = loadState()
        if state.selectedIndex >= wordCount {
            state.selectedIndex = 0
            state.isRevealed = false
            state.navigationDirection = 1
            saveState(state)
        }
    }

    static func clearSnapshot() {
        defaults.removeObject(forKey: snapshotKey)
        defaults.removeObject(forKey: snapshotWordCountKey)
        deleteSharedSnapshotData()
        saveState(.empty)
    }

    static func snapshotWordCount() -> Int {
        if defaults.object(forKey: snapshotWordCountKey) != nil {
            return defaults.integer(forKey: snapshotWordCountKey)
        }
        return loadSnapshot().words.count
    }

    static func loadState() -> TodayWordsWidgetState {
        guard let data = defaults.data(forKey: stateKey),
              let state = try? JSONDecoder().decode(TodayWordsWidgetState.self, from: data)
        else {
            return .empty
        }
        return state
    }

    static func saveState(_ state: TodayWordsWidgetState) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        defaults.set(data, forKey: stateKey)
    }

    static func revealCurrentWord() {
        var state = loadState()
        state.isRevealed = true
        saveState(state)
    }

    static func advanceWord(totalWords: Int) {
        guard totalWords > 0 else {
            saveState(.empty)
            return
        }

        var state = loadState()
        state.selectedIndex = (state.selectedIndex + 1) % totalWords
        state.isRevealed = false
        state.navigationDirection = 1
        saveState(state)
    }

    static func retreatWord(totalWords: Int) {
        guard totalWords > 0 else {
            saveState(.empty)
            return
        }

        var state = loadState()
        state.selectedIndex = (state.selectedIndex - 1 + totalWords) % totalWords
        state.isRevealed = false
        state.navigationDirection = -1
        saveState(state)
    }

    static func notePagingStarted(action: String, startedAt: Date = .now) {
        defaults.set(action, forKey: pagingActionKey)
        defaults.set(startedAt, forKey: pagingStartedAtKey)
    }

    static func pendingPagingAge(now: Date = .now) -> TimeInterval? {
        guard let startedAt = defaults.object(forKey: pagingStartedAtKey) as? Date else { return nil }
        return now.timeIntervalSince(startedAt)
    }

    static func completePendingPagingIfNeeded(now: Date = .now, maxAge: TimeInterval = 5) -> (action: String, milliseconds: Double)? {
        guard
            let startedAt = defaults.object(forKey: pagingStartedAtKey) as? Date,
            let action = defaults.string(forKey: pagingActionKey)
        else { return nil }

        let age = now.timeIntervalSince(startedAt)
        defaults.removeObject(forKey: pagingActionKey)
        defaults.removeObject(forKey: pagingStartedAtKey)
        guard age >= 0, age <= maxAge else { return nil }
        return (action, age * 1_000)
    }

    private static func loadSharedSnapshot() -> TodayWordsWidgetSnapshot? {
        guard let data = loadSharedSnapshotData() else { return nil }
        return try? JSONDecoder().decode(TodayWordsWidgetSnapshot.self, from: data)
    }

    private static func loadSharedSnapshotData() -> Data? {
        guard let accessGroup = sharedAccessGroup else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainSnapshotAccount,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return data
    }

    private static func saveSharedSnapshotData(_ data: Data) {
        guard let accessGroup = sharedAccessGroup else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainSnapshotAccount,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return }

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus != errSecSuccess && addStatus != errSecDuplicateItem {
            print("[PolycastWidget] Failed to save shared widget snapshot: \(addStatus)")
        }
    }

    private static func deleteSharedSnapshotData() {
        guard let accessGroup = sharedAccessGroup else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainSnapshotAccount,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private static var sharedAccessGroup: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "PolycastSharedKeychainAccessGroup") as? String,
              !value.isEmpty,
              !value.contains("$")
        else { return nil }
        return value
    }

    private static func postDebugSignal(_ event: String) {
        let name = "com.patron.polycast.widget.\(event)" as CFString
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name),
            nil,
            nil,
            true
        )
    }
}

enum TodayWordsWidgetImageStore {
    private static let directoryName = "TodayWordsWidgetImages"
    private static let keychainService = "com.patron.polycast.today-words-widget-images"

    static func filename(for wordID: String) -> String {
        filename(for: wordID, imageURL: nil)
    }

    static func filename(for wordID: String, imageURL: String?) -> String {
        "\(basename(for: wordID))-\(imageURL.flatMap { stableHash($0) } ?? "image").jpg"
    }

    static func cardFilename(for wordID: String) -> String {
        "\(basename(for: wordID))-medium-card.png"
    }

    private static func basename(for wordID: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let sanitized = wordID.unicodeScalars
            .map { allowed.contains($0) ? String($0) : "-" }
            .joined()
            .trimmingCharacters(in: CharacterSet(charactersIn: "-_"))
        return sanitized.isEmpty ? "word" : String(sanitized.prefix(64))
    }

    static func directoryURL() -> URL? {
        let baseURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: polycastAppGroupIdentifier)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard let baseURL else {
            return nil
        }
        return baseURL.appendingPathComponent(directoryName, isDirectory: true)
    }

    static func ensureDirectory() throws -> URL? {
        guard let directory = directoryURL() else { return nil }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    static func imageURL(for filename: String?) -> URL? {
        guard let filename, !filename.isEmpty, let directory = directoryURL() else {
            return nil
        }
        return directory.appendingPathComponent(filename)
    }

    static func sharedImageData(for wordID: String, imageURL: String?) -> Data? {
        guard let imageURL else { return nil }
        return sharedImageData(forFilename: filename(for: wordID, imageURL: imageURL))
    }

    static func sharedImageData(forFilename filename: String?) -> Data? {
        guard let filename, !filename.isEmpty, let accessGroup = sharedAccessGroup else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: filename,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return data
    }

    static func saveSharedImageData(_ data: Data, filename: String) {
        guard !filename.isEmpty, let accessGroup = sharedAccessGroup else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: filename,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess {
            postDebugSignal("shared-image-ready")
            return
        }

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecSuccess || addStatus == errSecDuplicateItem {
            postDebugSignal("shared-image-ready")
        } else {
            print("[PolycastWidget] Failed to save shared widget image: \(addStatus)")
            postDebugSignal("shared-image-failed")
        }
    }

    static func removeUnusedImages(keeping filenames: Set<String>) {
        guard let directory = directoryURL(),
              let contents = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        else { return }

        for url in contents where !filenames.contains(url.lastPathComponent) {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private static func stableHash(_ value: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(hash, radix: 16)
    }

    private static var sharedAccessGroup: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "PolycastSharedKeychainAccessGroup") as? String,
              !value.isEmpty,
              !value.contains("$")
        else { return nil }
        return value
    }

    private static func postDebugSignal(_ event: String) {
        let name = "com.patron.polycast.widget.\(event)" as CFString
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name),
            nil,
            nil,
            true
        )
    }
}

extension UIImage {
    func todayWordsWidgetThumbnailJPEGData(maxDimension: CGFloat) -> Data? {
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
