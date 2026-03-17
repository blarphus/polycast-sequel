import Foundation

@MainActor
final class WordStore: ObservableObject {
    @Published var words: [SavedWord] = []
    @Published var loading = false
    @Published var error = ""

    private var hasFetched = false

    func prefetch() {
        guard !hasFetched && !loading else { return }
        hasFetched = true
        loading = true
        Task {
            await load()
        }
    }

    func load() async {
        loading = true
        error = ""
        do {
            words = try await APIClient.shared.savedWords()
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
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
