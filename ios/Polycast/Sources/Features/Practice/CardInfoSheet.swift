import SwiftUI

struct CardInfoSheet: View {
    let card: SavedWord
    let onDelete: () -> Void
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Word") {
                    LabeledContent("Word", value: card.word)
                    LabeledContent("Translation", value: card.translation)
                    if !card.definition.isEmpty {
                        LabeledContent("Definition", value: card.definition)
                    }
                    if let pos = card.partOfSpeech, !pos.isEmpty {
                        LabeledContent("Part of Speech", value: pos)
                    }
                }

                if let example = card.exampleSentence, !example.isEmpty {
                    Section("Example") {
                        Text(renderTildeHighlight(example))
                        if let sentenceTranslation = card.sentenceTranslation, !sentenceTranslation.isEmpty {
                            Text(sentenceTranslation)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let url = APIClient.proxyImageURL(card.imageUrl) {
                    Section("Image") {
                        AuthorizedAsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .scaledToFit()
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                            default:
                                ProgressView()
                            }
                        }
                    }
                }

                Section("Review Stats") {
                    let status = getDueStatus(card)
                    LabeledContent("Status", value: status.label)
                    if card.srsInterval > 0 {
                        LabeledContent("Interval", value: formatDuration(card.srsInterval))
                    }
                    LabeledContent("Correct", value: "\(card.correctCount)")
                    LabeledContent("Incorrect", value: "\(card.incorrectCount)")
                    LabeledContent("Ease", value: "\(Int(card.easeFactor * 100))%")
                }

                Section {
                    Button("Delete Word", role: .destructive) {
                        onDelete()
                    }
                }
            }
            .navigationTitle("Card Info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
