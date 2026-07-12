import SwiftUI

struct InlineTokenizedText: View {
    let text: String
    let sentence: String
    @Binding var selectedLookup: LookupContext?
    @Binding var pausedForLookup: Bool
    /// Computes the wider explain context (recent ~50 words) lazily at tap time.
    var contextProvider: (() -> String)? = nil
    var font: Font = .title3
    var textColor: Color = .primary
    /// Replaces the default tap behavior (open lookup) when set — used by the
    /// call screen to short-circuit words that aren't in the target language.
    var onWordTap: ((String) -> Void)? = nil

    @EnvironmentObject private var wordStore: WordStore

    var body: some View {
        WordFlowLayout(spacing: 0) {
            ForEach(Array(tokenize(text).enumerated()), id: \.offset) { _, token in
                if token.isWord {
                    Button {
                        if let onWordTap {
                            onWordTap(token.text)
                        } else {
                            selectedLookup = LookupContext(word: token.text, sentence: sentence, context: contextProvider?())
                            pausedForLookup = true
                        }
                    } label: {
                        Text(token.text)
                            .font(font)
                            .foregroundStyle(textColor)
                            .background(
                                wordStore.savedForms.contains(savedWordMatchKey(token.text))
                                    ? Color(red: 0.18, green: 0.8, blue: 0.443).opacity(0.22)
                                    : Color.clear,
                                in: RoundedRectangle(cornerRadius: 4)
                            )
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(token.text)
                        .font(font)
                        .foregroundStyle(textColor)
                }
            }
        }
    }
}

/// A target-language sentence whose individual words are tappable to open the
/// add-to-dictionary popup, mirroring `InlineTokenizedText`. The card's own
/// target word (the `~tilde~`-highlighted span) is rendered highlighted but is
/// intentionally NOT tappable — re-adding the card's own word causes trouble.
/// Used by the flashcard practice card; the font is supplied by the caller so
/// it matches each card layout.
struct TappableSentenceText: View {
    let text: String          // may contain ~tildes~ around the target word
    let font: Font
    @Binding var selectedLookup: LookupContext?

    @EnvironmentObject private var wordStore: WordStore

    private var plain: String { stripTildes(text) }

    /// Lowercased word tokens that make up the highlighted target word/phrase,
    /// so multi-word targets ("se levanta") are excluded too.
    private var excludedTokens: Set<String> {
        guard let target = tildeWord(text) else { return [] }
        return Set(tokenize(target).filter { $0.isWord }.map { savedWordMatchKey($0.text) })
    }

    var body: some View {
        let excluded = excludedTokens
        let sentence = plain
        WordFlowLayout(spacing: 0) {
            ForEach(Array(tokenize(sentence).enumerated()), id: \.offset) { _, token in
                if token.isWord && !excluded.contains(savedWordMatchKey(token.text)) {
                    Button {
                        selectedLookup = LookupContext(word: token.text, sentence: sentence)
                    } label: {
                        Text(token.text)
                            .font(font)
                            .background(
                                wordStore.savedForms.contains(savedWordMatchKey(token.text))
                                    ? Color(red: 0.18, green: 0.8, blue: 0.443).opacity(0.22)
                                    : Color.clear,
                                in: RoundedRectangle(cornerRadius: 4)
                            )
                    }
                    .buttonStyle(.plain)
                } else if token.isWord {
                    // The card's own target word — keep the green highlight, no tap.
                    Text(token.text)
                        .font(font)
                        .fontWeight(.semibold)
                        .foregroundStyle(.green)
                } else {
                    Text(token.text)
                        .font(font)
                }
            }
        }
    }
}
