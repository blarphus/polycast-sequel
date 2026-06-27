import Foundation

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
    private static let stateKey = "todayWordsWidget.state"

    private static var defaults: UserDefaults {
        UserDefaults(suiteName: polycastAppGroupIdentifier) ?? .standard
    }

    static func loadSnapshot() -> TodayWordsWidgetSnapshot {
        guard let data = defaults.data(forKey: snapshotKey),
              let snapshot = try? JSONDecoder().decode(TodayWordsWidgetSnapshot.self, from: data)
        else {
            return .empty
        }
        return snapshot
    }

    static func saveSnapshot(_ snapshot: TodayWordsWidgetSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)

        let wordCount = max(snapshot.words.count, 1)
        var state = loadState()
        if state.selectedIndex >= wordCount {
            state.selectedIndex = 0
            state.isRevealed = false
            state.navigationDirection = 1
            saveState(state)
        }
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
}

enum TodayWordsWidgetImageStore {
    private static let directoryName = "TodayWordsWidgetImages"

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
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: polycastAppGroupIdentifier) else {
            return nil
        }
        return container.appendingPathComponent(directoryName, isDirectory: true)
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
}
