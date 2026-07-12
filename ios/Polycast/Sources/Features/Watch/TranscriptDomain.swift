import SwiftUI

// MARK: - Shared Transcript Types

struct LookupContext: Identifiable {
    let id = UUID()
    let word: String
    let sentence: String
    // Wider rolling passage (recent ~50 transcript words) used only by
    // "Explain in context" so it can read usage beyond the tapped line.
    var context: String? = nil
}
/// Last `n` whitespace-separated words of `text` — the rolling explain window.
func lastNWords(_ text: String, _ n: Int) -> String {
    let words: [Substring] = text.split(whereSeparator: { $0.isWhitespace })
    return words.suffix(n).joined(separator: " ")
}
/// Strip YouTube's bracketed annotation cues ([Music], [música], [risadas], …)
/// from a caption line. Only brackets containing a letter or number are removed;
/// the profanity-censor marker "[ __ ]" (underscores only) is kept so swears
/// stay visible. Collapses leftover whitespace.
func cleanCaptionText(_ text: String) -> String {
    let stripped = text.replacingOccurrences(
        of: "\\[[^\\]]*[\\p{L}\\p{N}][^\\]]*\\]",
        with: "",
        options: .regularExpression
    )
    return stripped
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
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

/// Deterministic per-user color for transcript speaker names, matching the
/// palette used by the web client (utils/speakerColor.ts).
func speakerColor(for userId: String) -> Color {
    let palette: [Color] = [
        Color(red: 0.655, green: 0.545, blue: 0.980), // #a78bfa purple
        Color(red: 0.204, green: 0.827, blue: 0.600), // #34d399 green
        Color(red: 0.957, green: 0.447, blue: 0.714), // #f472b6 pink
        Color(red: 0.984, green: 0.749, blue: 0.141), // #fbbf24 amber
        Color(red: 0.376, green: 0.647, blue: 0.980), // #60a5fa blue
        Color(red: 0.973, green: 0.443, blue: 0.443), // #f87171 red
        Color(red: 0.176, green: 0.831, blue: 0.855), // #2dd4da cyan
        Color(red: 0.984, green: 0.573, blue: 0.235), // #fb923c orange
    ]
    var hash: UInt32 = 5381
    for scalar in userId.unicodeScalars {
        hash = hash &* 33 &+ scalar.value
    }
    return palette[Int(hash % UInt32(palette.count))]
}
