import SwiftUI

/// Remove all `~` characters from text.
func stripTildes(_ text: String) -> String {
    text.replacingOccurrences(of: "~", with: "")
}

/// Return the contents of the first `~word~` token (tildes stripped), or nil if
/// the text has no tilde-highlighted span. Used to identify a card's own target
/// word so it can be excluded from tap-to-add.
func tildeWord(_ text: String) -> String? {
    let pattern = try! NSRegularExpression(pattern: "~([^~]+)~")
    let nsText = text as NSString
    guard let match = pattern.firstMatch(in: text, range: NSRange(location: 0, length: nsText.length)) else {
        return nil
    }
    return nsText.substring(with: match.range(at: 1))
}

/// Replace `~word~` with `_____` for cloze front display.
func renderCloze(_ text: String) -> AttributedString {
    var result = AttributedString()
    let pattern = try! NSRegularExpression(pattern: "~([^~]+)~")
    let nsText = text as NSString
    var lastEnd = 0

    let matches = pattern.matches(in: text, range: NSRange(location: 0, length: nsText.length))

    for match in matches {
        // Append text before the match
        if match.range.location > lastEnd {
            let before = nsText.substring(with: NSRange(location: lastEnd, length: match.range.location - lastEnd))
            result.append(AttributedString(before))
        }

        // Append underscores for the cloze blank
        var blank = AttributedString("_____")
        blank.foregroundColor = .secondary
        blank.font = .system(size: 20, weight: .bold, design: .rounded)
        result.append(blank)

        lastEnd = match.range.location + match.range.length
    }

    // Append remaining text
    if lastEnd < nsText.length {
        let remaining = nsText.substring(from: lastEnd)
        result.append(AttributedString(remaining))
    }

    return result
}

/// Highlight `~word~` portions, stripping the tildes.
func renderTildeHighlight(_ text: String, baseColor: Color? = nil, highlightColor: Color = .green) -> AttributedString {
    var result = AttributedString()
    let pattern = try! NSRegularExpression(pattern: "~([^~]+)~")
    let nsText = text as NSString
    var lastEnd = 0

    let matches = pattern.matches(in: text, range: NSRange(location: 0, length: nsText.length))

    for match in matches {
        // Append text before the match
        if match.range.location > lastEnd {
            let before = nsText.substring(with: NSRange(location: lastEnd, length: match.range.location - lastEnd))
            var plain = AttributedString(before)
            if let baseColor {
                plain.foregroundColor = baseColor
            }
            result.append(plain)
        }

        // Append highlighted word (without tildes)
        let word = nsText.substring(with: match.range(at: 1))
        var highlighted = AttributedString(word)
        highlighted.foregroundColor = highlightColor
        highlighted.font = .system(.body, weight: .semibold)
        result.append(highlighted)

        lastEnd = match.range.location + match.range.length
    }

    // Append remaining text
    if lastEnd < nsText.length {
        let remaining = nsText.substring(from: lastEnd)
        var plain = AttributedString(remaining)
        if let baseColor {
            plain.foregroundColor = baseColor
        }
        result.append(plain)
    }

    return result
}
