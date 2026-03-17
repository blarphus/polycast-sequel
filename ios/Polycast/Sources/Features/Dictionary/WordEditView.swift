import SwiftUI

struct WordEditView: View {
    let word: SavedWord
    let onUpdate: (SavedWord) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var translation: String
    @State private var definition: String
    @State private var exampleSentence: String
    @State private var sentenceTranslation: String
    @State private var partOfSpeech: String
    @State private var saving = false
    @State private var error = ""
    @State private var showingImagePicker = false

    init(word: SavedWord, onUpdate: @escaping (SavedWord) -> Void) {
        self.word = word
        self.onUpdate = onUpdate
        _translation = State(initialValue: word.translation)
        _definition = State(initialValue: word.definition)
        _exampleSentence = State(initialValue: word.exampleSentence ?? "")
        _sentenceTranslation = State(initialValue: word.sentenceTranslation ?? "")
        _partOfSpeech = State(initialValue: word.partOfSpeech ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Word") {
                    Text(word.word)
                        .font(.title3.bold())
                        .foregroundStyle(.tint)
                }

                Section("Translation") {
                    TextField("Translation", text: $translation)
                }

                Section("Definition") {
                    TextField("Definition", text: $definition, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("Part of Speech") {
                    TextField("e.g. noun, verb, adjective", text: $partOfSpeech)
                        .autocorrectionDisabled()
                }

                Section("Example") {
                    TextField("Example sentence", text: $exampleSentence, axis: .vertical)
                        .lineLimit(2...4)
                    TextField("Sentence translation", text: $sentenceTranslation, axis: .vertical)
                        .lineLimit(2...4)
                }

                Section("Image") {
                    if let url = APIClient.proxyImageURL(word.imageUrl) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .scaledToFit()
                                    .frame(maxWidth: .infinity)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            default:
                                EmptyView()
                            }
                        }
                    }

                    Button {
                        showingImagePicker = true
                    } label: {
                        Label(
                            word.imageUrl != nil ? "Change image" : "Add image",
                            systemImage: "photo.badge.plus"
                        )
                    }
                }

                if !error.isEmpty {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Edit Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(saving || translation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .sheet(isPresented: $showingImagePicker) {
                ImagePickerView(
                    initialQuery: word.imageTerm ?? word.translation,
                    onSelect: { url in
                        Task { await updateImage(url: url) }
                    }
                )
            }
        }
    }

    private func save() async {
        saving = true
        error = ""

        do {
            let updated = try await APIClient.shared.updateWord(
                id: word.id,
                translation: translation.trimmingCharacters(in: .whitespacesAndNewlines),
                definition: definition.trimmingCharacters(in: .whitespacesAndNewlines),
                exampleSentence: exampleSentence.trimmingCharacters(in: .whitespacesAndNewlines),
                sentenceTranslation: sentenceTranslation.trimmingCharacters(in: .whitespacesAndNewlines),
                partOfSpeech: partOfSpeech.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            onUpdate(updated)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }

        saving = false
    }

    private func updateImage(url: String) async {
        error = ""
        do {
            let updated = try await APIClient.shared.updateWordImage(id: word.id, imageUrl: url)
            onUpdate(updated)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
