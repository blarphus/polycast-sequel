import Foundation

/// Lightweight metadata for a book in the on-device library.
struct BookMeta: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var author: String
    var hasCover: Bool
    var addedAt: Double
}

/// On-device EPUB library. Raw .epub bytes and cover images live in Application Support;
/// metadata is kept in a JSON manifest and reading progress in UserDefaults. Books are not
/// synced to the server (matching the web app, which stores them client-side in IndexedDB).
@MainActor
final class BookLibrary: ObservableObject {
    @Published private(set) var books: [BookMeta] = []
    @Published var error = ""

    private let directory: URL
    private let manifestURL: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        directory = base.appendingPathComponent("Books", isDirectory: true)
        manifestURL = directory.appendingPathComponent("library.json")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        load()
    }

    // MARK: - Persistence

    private func load() {
        guard let data = try? Data(contentsOf: manifestURL) else { return }
        if let decoded = try? JSONDecoder().decode([BookMeta].self, from: data) {
            books = decoded.sorted { $0.addedAt > $1.addedAt }
        }
    }

    private func saveManifest() {
        do {
            let data = try JSONEncoder().encode(books)
            try data.write(to: manifestURL, options: .atomic)
        } catch {
            self.error = "Could not save the library: \(error.localizedDescription)"
        }
    }

    // MARK: - Files

    func epubURL(for id: String) -> URL { directory.appendingPathComponent("\(id).epub") }
    func coverURL(for id: String) -> URL { directory.appendingPathComponent("\(id).cover") }
    func chaptersCacheURL(for id: String) -> URL { directory.appendingPathComponent("\(id).chapters") }

    /// Persists parsed chapters so reopening a book skips the expensive
    /// unzip + HTML parse of the raw EPUB.
    nonisolated static func cacheChapters(_ chapters: [BookChapter], at url: URL) {
        do {
            try JSONEncoder().encode(chapters).write(to: url, options: .atomic)
        } catch {
            PolycastLog.runtime.error("[Polycast] Could not write chapter cache: \(error.localizedDescription)")
        }
    }

    /// Loads the parsed-chapter cache; nil when absent (first open of older
    /// imports). Decode failures are logged and treated as a miss so the book
    /// falls back to a full parse.
    nonisolated static func cachedChapters(at url: URL) -> [BookChapter]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        do {
            return try JSONDecoder().decode([BookChapter].self, from: data)
        } catch {
            reportFallback(
                code: "epub_chapter_cache_miss_fallback",
                title: "Book cache fallback used",
                message: "The cached chapter data could not be read, so Polycast will parse the original EPUB again.",
                source: "ios.book-library",
                operation: "decode-chapter-cache",
                detail: "cache=\(url.lastPathComponent)",
                error: error
            )
            return nil
        }
    }

    func epubData(for id: String) -> Data? {
        try? Data(contentsOf: epubURL(for: id))
    }

    // MARK: - Audiobook linking

    /// Audio extensions accepted when linking a folder of tracks.
    private static let audioExtensions: Set<String> = ["mp3", "m4a", "m4b", "aac", "wav"]

    func audioDirectory(for id: String) -> URL {
        directory.appendingPathComponent("\(id).audio", isDirectory: true)
    }

    /// Linked audio tracks for a book, sorted by filename (track order for
    /// numbered mp3 folders). Empty when no audiobook is linked.
    func audioTrackURLs(for id: String) -> [URL] {
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: audioDirectory(for: id),
            includingPropertiesForKeys: nil
        ) else { return [] }
        return contents
            .filter { Self.audioExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    func hasAudio(for id: String) -> Bool {
        !audioTrackURLs(for: id).isEmpty
    }

    /// Links a single audiobook file (e.g. .m4a) to a book, replacing any
    /// previously linked audio.
    func linkAudioFile(from sourceURL: URL, to id: String) throws {
        let needsStop = sourceURL.startAccessingSecurityScopedResource()
        defer { if needsStop { sourceURL.stopAccessingSecurityScopedResource() } }
        try replaceAudio(for: id, with: [sourceURL])
    }

    /// Links every audio file inside a folder (e.g. per-chapter mp3s) to a
    /// book, replacing any previously linked audio. Track order follows the
    /// filenames' natural sort.
    func linkAudioFolder(from folderURL: URL, to id: String) throws {
        let needsStop = folderURL.startAccessingSecurityScopedResource()
        defer { if needsStop { folderURL.stopAccessingSecurityScopedResource() } }

        let contents = try FileManager.default.contentsOfDirectory(
            at: folderURL,
            includingPropertiesForKeys: nil
        )
        let audioFiles = contents.filter { Self.audioExtensions.contains($0.pathExtension.lowercased()) }
        guard !audioFiles.isEmpty else {
            throw NSError(domain: "BookLibrary", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "That folder has no audio files (mp3, m4a, m4b, aac, wav).",
            ])
        }
        try replaceAudio(for: id, with: audioFiles)
    }

    private func replaceAudio(for id: String, with sourceURLs: [URL]) throws {
        let dir = audioDirectory(for: id)
        try? FileManager.default.removeItem(at: dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for source in sourceURLs {
            try FileManager.default.copyItem(at: source, to: dir.appendingPathComponent(source.lastPathComponent))
        }
        AudiobookPlayer.clearPosition(for: id)
        objectWillChange.send()
    }

    func removeAudio(for id: String) {
        try? FileManager.default.removeItem(at: audioDirectory(for: id))
        AudiobookPlayer.clearPosition(for: id)
        objectWillChange.send()
    }

    // MARK: - Import / delete

    /// Imports an EPUB from a file URL (e.g. from the document picker). Parses it once to pull
    /// title/author/cover, persists the bytes, and adds it to the library.
    func importEpub(from sourceURL: URL) throws {
        let needsStop = sourceURL.startAccessingSecurityScopedResource()
        defer { if needsStop { sourceURL.stopAccessingSecurityScopedResource() } }

        let fileData = try Data(contentsOf: sourceURL)
        let parsed = try EpubParser.parse(fileData)

        let id = UUID().uuidString
        try fileData.write(to: epubURL(for: id), options: .atomic)
        if let cover = parsed.coverImage {
            try? cover.write(to: coverURL(for: id), options: .atomic)
        }
        Self.cacheChapters(parsed.chapters, at: chaptersCacheURL(for: id))

        var meta = BookMeta(
            id: id,
            title: parsed.title,
            author: parsed.author,
            hasCover: parsed.coverImage != nil,
            addedAt: Date().timeIntervalSince1970
        )
        if meta.title.isEmpty {
            meta.title = sourceURL.deletingPathExtension().lastPathComponent
        }
        books.insert(meta, at: 0)
        saveManifest()
    }

    func delete(_ id: String) {
        try? FileManager.default.removeItem(at: epubURL(for: id))
        try? FileManager.default.removeItem(at: coverURL(for: id))
        try? FileManager.default.removeItem(at: chaptersCacheURL(for: id))
        try? FileManager.default.removeItem(at: audioDirectory(for: id))
        AudiobookPlayer.clearPosition(for: id)
        UserDefaults.standard.removeObject(forKey: progressKey(id))
        UserDefaults.standard.removeObject(forKey: pageProgressKey(id))
        books.removeAll { $0.id == id }
        saveManifest()
    }

    // MARK: - Reading progress

    private func progressKey(_ id: String) -> String { "book.progress.\(id)" }
    private func pageProgressKey(_ id: String) -> String { "book.pageProgress.\(id)" }

    /// The last-read chapter index for a book (0 if never opened).
    func progress(for id: String) -> Int {
        UserDefaults.standard.integer(forKey: progressKey(id))
    }

    func setProgress(_ chapterIndex: Int, for id: String) {
        UserDefaults.standard.set(chapterIndex, forKey: progressKey(id))
    }

    func pageProgress(for id: String) -> Int {
        UserDefaults.standard.integer(forKey: pageProgressKey(id))
    }

    func setPageProgress(_ pageIndex: Int, for id: String) {
        UserDefaults.standard.set(pageIndex, forKey: pageProgressKey(id))
    }
}
