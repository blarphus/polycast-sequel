import Foundation

@MainActor
final class WordStore: ObservableObject {
    @Published var words: [SavedWord] = [] {
        didSet { savedForms = savedWordForms(words) }
    }
    /// Lowercased set of every saved word, lemma, and inflected form — computed
    /// once per change so views can highlight tokens cheaply.
    @Published private(set) var savedForms: Set<String> = []
    @Published var loading = false
    @Published var error = ""

    private var hasFetched = false
    private var lastLoadedAt: Date?

    func prefetch() {
        guard !hasFetched && !loading else { return }
        hasFetched = true
        loading = true
        Task {
            await load()
        }
    }

    func load(showLoading: Bool = true) async {
        if showLoading {
            loading = true
        }
        error = ""
        do {
            words = try await APIClient.shared.savedWords()
            hasFetched = true
            lastLoadedAt = Date()
        } catch {
            self.error = error.localizedDescription
        }
        if showLoading {
            loading = false
        }
    }

    func insert(_ word: SavedWord) {
        if !words.contains(where: { $0.id == word.id }) {
            words.insert(word, at: 0)
        }
    }

    func update(_ word: SavedWord) {
        if let idx = words.firstIndex(where: { $0.id == word.id }) {
            words[idx] = word
        }
    }

    /// Replace the matching word in place, or insert it if not present. Used
    /// when self-heal persists a newly-encountered inflection onto a saved word.
    func upsert(_ word: SavedWord) {
        if let idx = words.firstIndex(where: { $0.id == word.id }) {
            words[idx] = word
        } else {
            words.insert(word, at: 0)
        }
    }

    func upsert(contentsOf incomingWords: [SavedWord]) {
        guard !incomingWords.isEmpty else { return }
        for word in incomingWords {
            upsert(word)
        }
    }

    func remove(id: String) {
        words.removeAll { $0.id == id }
    }

    func reset() {
        words = []
        hasFetched = false
        loading = false
        error = ""
    }
}
