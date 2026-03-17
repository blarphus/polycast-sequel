import SwiftUI

struct WordLookupView: View {
    let nativeLang: String
    let targetLang: String
    let onSave: (SavedWord) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var searchText = ""
    @State private var loading = false
    @State private var senses: [WiktSense] = []
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
                guard savingIndex == nil, !savedIndices.contains(index) else { return }
                Task { await save(sense: sense, index: index) }
            } label: {
                senseRow(sense: sense, index: index)
            }
            .buttonStyle(.plain)
            .disabled(savingIndex != nil || savedIndices.contains(index))
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

    private func save(sense: WiktSense, index: Int) async {
        savingIndex = index
        error = ""

        do {
            let enriched = try await APIClient.shared.enrichWord(
                word: searchText.trimmingCharacters(in: .whitespacesAndNewlines),
                sentence: "\(searchText): \(sense.gloss)",
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
                imageTerm: enriched.imageTerm
            )

            savedIndices.insert(index)
            onSave(saved)
        } catch {
            self.error = error.localizedDescription
        }

        savingIndex = nil
    }
}
