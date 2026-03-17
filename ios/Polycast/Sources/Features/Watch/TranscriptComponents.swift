import SwiftUI

// MARK: - Shared Transcript Types

struct LookupContext: Identifiable {
    let id = UUID()
    let word: String
    let sentence: String
}

struct TextToken {
    let text: String
    let isWord: Bool
}

// MARK: - Shared Transcript Functions

func tokenize(_ text: String) -> [TextToken] {
    var tokens: [TextToken] = []
    var current = text.startIndex
    while current < text.endIndex {
        let char = text[current]
        if char.isLetter || char.isNumber || char == "'" {
            var end = text.index(after: current)
            while end < text.endIndex && (text[end].isLetter || text[end].isNumber || text[end] == "'") {
                end = text.index(after: end)
            }
            tokens.append(TextToken(text: String(text[current..<end]), isWord: true))
            current = end
        } else {
            var end = text.index(after: current)
            while end < text.endIndex && !text[end].isLetter && !text[end].isNumber && text[end] != "'" {
                end = text.index(after: end)
            }
            tokens.append(TextToken(text: String(text[current..<end]), isWord: false))
            current = end
        }
    }
    return tokens
}

func timestampText(_ milliseconds: Int) -> String {
    let totalSeconds = milliseconds / 1000
    let minutes = totalSeconds / 60
    let seconds = totalSeconds % 60
    return String(format: "%d:%02d", minutes, seconds)
}

// MARK: - Shared Transcript Views

struct TranscriptScrollView: View {
    let segments: [TranscriptSegment]
    let currentTime: Double
    @Binding var seekTime: Double?
    @Binding var selectedLookup: LookupContext?
    @Binding var pausedForLookup: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(segments) { segment in
                        let isActive = currentTime * 1000 >= Double(segment.offset) && currentTime * 1000 < Double(segment.offset + segment.duration)

                        TranscriptRow(
                            segment: segment,
                            isActive: isActive,
                            seekTime: $seekTime,
                            selectedLookup: $selectedLookup,
                            pausedForLookup: $pausedForLookup
                        )
                        .id(segment.id)
                    }
                }
                .padding(.vertical, 8)
            }
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
            .onChange(of: activeSegmentID) { _, newID in
                guard let newID else { return }
                withAnimation(.easeInOut(duration: 0.3)) {
                    proxy.scrollTo(newID, anchor: .center)
                }
            }
        }
    }

    private var activeSegmentID: String? {
        let ms = currentTime * 1000
        return segments.first { ms >= Double($0.offset) && ms < Double($0.offset + $0.duration) }?.id
    }
}

struct TranscriptRow: View {
    let segment: TranscriptSegment
    let isActive: Bool
    @Binding var seekTime: Double?
    @Binding var selectedLookup: LookupContext?
    @Binding var pausedForLookup: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Button {
                seekTime = Double(segment.offset) / 1000
            } label: {
                Text(timestampText(segment.offset))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(isActive ? .purple : .secondary)
            }
            .buttonStyle(.plain)
            .frame(width: 40, alignment: .leading)

            InlineTokenizedText(
                text: segment.text,
                sentence: segment.text,
                selectedLookup: $selectedLookup,
                pausedForLookup: $pausedForLookup
            )
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
        .background(isActive ? .purple.opacity(0.08) : .clear)
    }
}

struct InlineTokenizedText: View {
    let text: String
    let sentence: String
    @Binding var selectedLookup: LookupContext?
    @Binding var pausedForLookup: Bool

    var body: some View {
        WordFlowLayout(spacing: 0) {
            ForEach(Array(tokenize(text).enumerated()), id: \.offset) { _, token in
                if token.isWord {
                    Button {
                        selectedLookup = LookupContext(word: token.text, sentence: sentence)
                        pausedForLookup = true
                    } label: {
                        Text(token.text)
                            .font(.title3)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(token.text)
                        .font(.title3)
                }
            }
        }
    }
}

// MARK: - Word Popup

struct WordPopupView: View {
    @EnvironmentObject private var session: SessionStore

    let context: LookupContext
    let onDismiss: () -> Void

    @State private var lookup: LookupResponse?
    @State private var saving = false
    @State private var saved = false
    @State private var error = ""
    @State private var showContext = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { onDismiss() }

            VStack(alignment: .leading, spacing: 10) {
                if let lookup {
                    HStack {
                        Text(lookup.word)
                            .font(.title3.bold())
                            .foregroundStyle(.purple)

                        Spacer()

                        Button {
                            Task { await save(lookup) }
                        } label: {
                            if saving {
                                ProgressView()
                                    .controlSize(.small)
                            } else if saved {
                                Label("Added", systemImage: "checkmark")
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.green)
                            } else {
                                Label("Add", systemImage: "plus")
                                    .font(.subheadline.weight(.medium))
                            }
                        }
                        .disabled(saving || saved)

                        Button { onDismiss() } label: {
                            Image(systemName: "xmark")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }

                    Text(lookup.translation)
                        .font(.body.weight(.medium))

                    if let pos = lookup.partOfSpeech, !pos.isEmpty {
                        Text(pos.uppercased())
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.purple.opacity(0.15))
                            .foregroundStyle(.purple)
                            .clipShape(Capsule())
                    }

                    if showContext, let st = lookup.sentenceTranslation {
                        highlightedText(st)
                            .font(.subheadline)
                    } else if let ex = lookup.example {
                        VStack(alignment: .leading, spacing: 2) {
                            highlightedText(ex)
                                .font(.subheadline)
                                .italic()
                            if let et = lookup.exampleTranslation {
                                highlightedText(et)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } else {
                        Text(lookup.definition)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 6) {
                        if lookup.example != nil || lookup.sentenceTranslation != nil {
                            Button(showContext ? "Example" : "Context") {
                                showContext.toggle()
                            }
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.white.opacity(0.08))
                            .clipShape(Capsule())
                        }
                        if let source = lookup.definitionSource {
                            Text(source)
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(source == "wiktionary" ? .blue.opacity(0.15) : .orange.opacity(0.15))
                                .foregroundStyle(source == "wiktionary" ? .blue : .orange)
                                .clipShape(Capsule())
                        }
                    }

                    if !error.isEmpty {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                } else if !error.isEmpty {
                    HStack {
                        Text(context.word)
                            .font(.title3.bold())
                            .foregroundStyle(.purple)
                        Spacer()
                        Button { onDismiss() } label: {
                            Image(systemName: "xmark")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(.red)
                } else {
                    HStack {
                        Text(context.word)
                            .font(.title3.bold())
                            .foregroundStyle(.purple)
                        Spacer()
                        Button { onDismiss() } label: {
                            Image(systemName: "xmark")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                    ProgressView("Looking up...")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
            .padding(16)
            .frame(width: 300)
            .background(.ultraThinMaterial)
            .background(Color(.systemBackground).opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: .black.opacity(0.3), radius: 20, y: 8)
            .frame(maxHeight: .infinity, alignment: .center)
        }
        .animation(.easeOut(duration: 0.2), value: lookup != nil)
        .task {
            guard lookup == nil && error.isEmpty else { return }
            await load()
        }
    }

    private func highlightedText(_ text: String) -> Text {
        let parts = text.components(separatedBy: "~")
        var result = Text("")
        for (i, part) in parts.enumerated() {
            if part.isEmpty { continue }
            if i % 2 == 1 {
                result = result + Text(part).foregroundColor(.purple).bold()
            } else {
                result = result + Text(part)
            }
        }
        return result
    }

    private func load() async {
        guard let user = session.user else { return }
        do {
            lookup = try await APIClient.shared.lookupWord(
                word: context.word,
                sentence: context.sentence,
                nativeLang: user.nativeLanguage ?? "en",
                targetLang: user.targetLanguage
            )
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func save(_ lookup: LookupResponse) async {
        saving = true
        do {
            _ = try await APIClient.shared.saveWord(
                word: lookup.word,
                translation: lookup.translation,
                definition: lookup.definition,
                targetLanguage: session.user?.targetLanguage,
                sentenceContext: context.sentence
            )
            saved = true
            error = ""
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}
