import SwiftUI

struct WordLookupView: View {
    let nativeLang: String
    let targetLang: String
    let onSave: (SavedWord) -> Void

    @EnvironmentObject private var wordStore: WordStore
    @Environment(\.dismiss) private var dismiss

    @State private var searchText = ""
    @State private var loading = false
    @State private var senses: [WiktSense] = []
    // savingIndex is no longer used now that saving is optimistic (instant checkmark).
    // Flagged for deletion in a future audit.
    @State private var savingIndex: Int?
    @State private var savedIndices: Set<Int> = []
    @State private var error = ""
    @State private var hasSearched = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchBar
                    .padding()

                if !error.isEmpty {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                if loading {
                    Spacer()
                    ProgressView("Looking up...")
                    Spacer()
                } else if senses.isEmpty && hasSearched {
                    Spacer()
                    Text("No definitions found")
                        .foregroundStyle(.secondary)
                    Spacer()
                } else {
                    senseList
                }
            }
            .navigationTitle("Add Word")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack {
            TextField("Search a word...", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .onSubmit { Task { await lookup() } }

            Button("Search") {
                Task { await lookup() }
            }
            .disabled(searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || loading)
        }
    }

    // MARK: - Sense List

    private var senseList: some View {
        List(Array(senses.enumerated()), id: \.offset) { index, sense in
            Button {
                guard !savedIndices.contains(index) else { return }
                save(sense: sense, index: index)
            } label: {
                senseRow(sense: sense, index: index)
            }
            .buttonStyle(.plain)
            .disabled(savedIndices.contains(index))
        }
        .listStyle(.plain)
    }

    private func senseRow(sense: WiktSense, index: Int) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                if let pos = sense.pos, !pos.isEmpty {
                    Text(pos.uppercased())
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(.secondary.opacity(0.15), in: Capsule())
                        .foregroundStyle(.secondary)
                }

                Text(sense.gloss)
                    .font(.body)

                if let example = sense.example, let text = example.text, !text.isEmpty {
                    Text(text)
                        .font(.caption)
                        .italic()
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if savingIndex == index {
                ProgressView()
            } else if savedIndices.contains(index) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }
        }
        .contentShape(Rectangle())
    }

    // MARK: - Actions

    private func lookup() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }

        loading = true
        error = ""
        senses = []
        savedIndices = []
        hasSearched = true

        do {
            let response = try await APIClient.shared.wiktLookup(
                word: query,
                targetLang: targetLang,
                nativeLang: nativeLang
            )
            senses = response.senses
        } catch {
            self.error = error.localizedDescription
        }

        loading = false
    }

    /// Optimistic save, matching the Watch/Reader flow: mark the sense saved and
    /// insert a placeholder row instantly, then run the slow enrichment + save in
    /// the background and swap in the server's row when it lands.
    private func save(sense: WiktSense, index: Int) {
        let word = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !word.isEmpty else { return }

        savedIndices.insert(index)
        error = ""

        let tempId = "optimistic-\(UUID().uuidString)"
        let placeholder = SavedWord(
            id: tempId,
            word: word,
            translation: "",
            definition: sense.gloss,
            targetLanguage: targetLang,
            sentenceContext: nil,
            createdAt: ISO8601DateFormatter().string(from: .now),
            frequency: nil,
            frequencyCount: nil,
            exampleSentence: sense.example?.text,
            sentenceTranslation: nil,
            partOfSpeech: sense.pos,
            srsInterval: 0,
            dueAt: nil,
            lastReviewedAt: nil,
            correctCount: 0,
            incorrectCount: 0,
            easeFactor: 2.5,
            learningStep: nil,
            promptStage: 0,
            imageUrl: nil,
            lemma: nil,
            forms: nil,
            priority: false,
            imageTerm: nil,
            queuePosition: nil,
            introducedDate: nil,
            relearningDate: nil,
            stageSentences: nil
        )
        wordStore.insert(placeholder)
        onSave(placeholder)

        Task {
            do {
                let enriched = try await APIClient.shared.enrichWord(
                    word: word,
                    sentence: "\(word): \(sense.gloss)",
                    nativeLang: nativeLang,
                    targetLang: targetLang
                )

                let saved = try await APIClient.shared.saveWord(
                    word: enriched.word,
                    translation: enriched.translation,
                    definition: enriched.definition,
                    targetLanguage: targetLang,
                    frequency: enriched.frequency,
                    frequencyCount: enriched.frequencyCount,
                    exampleSentence: enriched.exampleSentence,
                    sentenceTranslation: enriched.sentenceTranslation,
                    partOfSpeech: enriched.partOfSpeech,
                    imageUrl: enriched.imageUrl,
                    lemma: enriched.lemma,
                    forms: enriched.forms,
                    surfaceForm: word,
                    imageTerm: enriched.imageTerm
                )

                wordStore.remove(id: tempId)
                wordStore.insert(saved)
            } catch {
                // Roll back the optimistic row and surface the failure.
                print("[Polycast] Save word failed: \(error.localizedDescription)")
                wordStore.remove(id: tempId)
                savedIndices.remove(index)
                self.error = error.localizedDescription
            }
        }
    }
}
