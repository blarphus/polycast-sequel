import SwiftUI
import UIKit

// MARK: - Phrase selection context

/// A learner-selected phrase/sentence plus its surrounding paragraph (with the selection
/// wrapped in tildes), used by the "explain in context" flow.
struct PhraseContext: Identifiable {
    let id = UUID()
    let selection: String
    let context: String
}

// MARK: - Saved-word highlighting

/// Builds the lowercase set of every saved word, its lemma, and inflected forms so the reader
/// can highlight known vocabulary inline.
func savedWordForms(_ words: [SavedWord]) -> Set<String> {
    var set = Set<String>()

    func insert(_ value: String?) {
        guard let value else { return }
        let key = savedWordMatchKey(value)
        if !key.isEmpty { set.insert(key) }
    }

    func parseForms(_ rawForms: String?) -> [String] {
        guard let rawForms, !rawForms.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return []
        }
        let trimmed = rawForms.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("["),
           let data = trimmed.data(using: .utf8),
           let parsed = try? JSONDecoder().decode([String].self, from: data) {
            return parsed
        }
        return trimmed
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    for word in words {
        insert(word.word)
        insert(word.lemma)
        for form in parseForms(word.forms) {
            insert(form)
        }
    }
    return set
}

// MARK: - Book-style flow layout

/// Marks gap tokens (spaces between words) that justification may stretch.
struct ReaderStretchableGapKey: LayoutValueKey {
    static let defaultValue = false
}

/// Token flow layout with print typography: first-line indent, inter-line
/// spacing, and full justification (extra space distributed across the gaps of
/// every line except the last). Line breaking mirrors ReaderLayout.lineCount
/// so pagination estimates stay accurate.
struct ReaderFlowLayout: Layout {
    var lineSpacing: CGFloat = 5
    var firstLineIndent: CGFloat = 0
    var justify: Bool = true

    private struct Placed {
        let index: Int
        let size: CGSize
        let stretchable: Bool
    }

    private func computeLines(subviews: Subviews, width: CGFloat) -> [[Placed]] {
        var lines: [[Placed]] = [[]]
        var lineWidth: CGFloat = firstLineIndent
        var hasToken = false

        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            let placed = Placed(index: index, size: size, stretchable: subview[ReaderStretchableGapKey.self])
            if hasToken && lineWidth + size.width > width {
                lines.append([placed])
                lineWidth = size.width
            } else {
                lines[lines.count - 1].append(placed)
                lineWidth += size.width
                hasToken = true
            }
        }
        return lines
    }

    private func lineHeight(_ line: [Placed]) -> CGFloat {
        line.reduce(0) { max($0, $1.size.height) }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        let lines = computeLines(subviews: subviews, width: width)
        let height = lines.reduce(0) { $0 + lineHeight($1) }
            + CGFloat(max(lines.count - 1, 0)) * lineSpacing
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let lines = computeLines(subviews: subviews, width: bounds.width)
        var y = bounds.minY

        for (lineIndex, line) in lines.enumerated() {
            var x = bounds.minX + (lineIndex == 0 ? firstLineIndent : 0)
            let isLastLine = lineIndex == lines.count - 1

            var stretch: CGFloat = 0
            if justify && !isLastLine {
                let contentWidth = line.reduce(0) { $0 + $1.size.width }
                    + (lineIndex == 0 ? firstLineIndent : 0)
                let gaps = line.dropLast().filter(\.stretchable).count
                if gaps > 0 {
                    stretch = max(0, bounds.width - contentWidth) / CGFloat(gaps)
                }
            }

            for (position, placed) in line.enumerated() {
                subviews[placed.index].place(
                    at: CGPoint(x: x, y: y),
                    proposal: ProposedViewSize(placed.size)
                )
                x += placed.size.width
                if placed.stretchable && position < line.count - 1 {
                    x += stretch
                }
            }
            y += lineHeight(line) + lineSpacing
        }
    }
}

// MARK: - Block rendering

private struct ReaderToken: Identifiable {
    let id: Int
    let text: String
    let isWord: Bool
    let sentence: String
}

struct ReaderBlockView: View {
    let render: ReaderRenderBlock
    let savedSet: Set<String>
    let theme: ReaderTheme
    let font: ReaderFontChoice
    let fontScale: Double
    let lineSpacing: CGFloat
    @Binding var selectedLookup: LookupContext?
    @Binding var selectedPhrase: PhraseContext?

    private var block: BookBlock { render.block }

    var body: some View {
        switch block.kind {
        case .h1, .h2, .h3:
            Text(block.plainText)
                .font(Font(headingUIFont as CTFont))
                .foregroundStyle(theme.text)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .p:
            ReaderFlowLayout(
                lineSpacing: lineSpacing,
                firstLineIndent: render.indentFirstLine ? bodySize * 1.3 : 0
            ) {
                ForEach(tokens) { token in
                    if token.isWord {
                        Text(token.text)
                            .font(bodyFont)
                            .foregroundStyle(theme.text)
                            .padding(.horizontal, 1)
                            .background(
                                savedSet.contains(savedWordMatchKey(token.text))
                                    ? theme.savedHighlight
                                    : Color.clear,
                                in: RoundedRectangle(cornerRadius: 4)
                            )
                            .onTapGesture {
                                selectedLookup = LookupContext(word: token.text, sentence: token.sentence)
                            }
                            .onLongPressGesture(minimumDuration: 0.35) {
                                selectedPhrase = makePhrase(sentence: token.sentence)
                            }
                    } else {
                        Text(token.text)
                            .font(bodyFont)
                            .foregroundStyle(theme.text)
                            .layoutValue(
                                key: ReaderStretchableGapKey.self,
                                value: token.text.contains(where: \.isWhitespace)
                            )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var bodySize: CGFloat { 18 * fontScale }
    private var bodyFont: Font { Font(font.uiFont(size: bodySize) as CTFont) }

    private var headingUIFont: UIFont {
        let size: CGFloat
        switch block.kind {
        case .h1: size = 26 * fontScale
        case .h2: size = 22 * fontScale
        default: size = 20 * fontScale
        }
        return font.uiFont(size: size, bold: true)
    }

    private var tokens: [ReaderToken] {
        var result: [ReaderToken] = []
        var index = 0
        for (sentenceIndex, sentence) in block.sentences.enumerated() {
            for token in tokenize(sentence) {
                result.append(ReaderToken(id: index, text: token.text, isWord: token.isWord, sentence: sentence))
                index += 1
            }
            if sentenceIndex < block.sentences.count - 1 {
                result.append(ReaderToken(id: index, text: " ", isWord: false, sentence: sentence))
                index += 1
            }
        }
        return result
    }

    private func makePhrase(sentence: String) -> PhraseContext {
        let paragraph = block.plainText
        let wrapped = paragraph.replacingOccurrences(of: sentence, with: "~\(sentence)~")
        return PhraseContext(selection: sentence, context: wrapped)
    }
}
