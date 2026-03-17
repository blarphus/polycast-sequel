import Foundation

enum SRTParser {
    static func parse(_ contents: String) -> [TranscriptSegment] {
        let blocks = contents
            .replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n\n")

        var segments: [TranscriptSegment] = []

        for block in blocks {
            let lines = block.trimmingCharacters(in: .whitespacesAndNewlines)
                .components(separatedBy: "\n")
            guard lines.count >= 3 else { continue }

            // Line 0: sequence number (skip)
            // Line 1: timestamp line  "HH:MM:SS,mmm --> HH:MM:SS,mmm"
            let timeParts = lines[1].components(separatedBy: " --> ")
            guard timeParts.count == 2,
                  let startMs = parseTimestamp(timeParts[0].trimmingCharacters(in: .whitespaces)),
                  let endMs = parseTimestamp(timeParts[1].trimmingCharacters(in: .whitespaces))
            else { continue }

            // Lines 2+: subtitle text
            let text = lines[2...]
                .joined(separator: " ")
                .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)

            guard !text.isEmpty else { continue }

            let duration = max(endMs - startMs, 1)
            segments.append(TranscriptSegment(text: text, offset: startMs, duration: duration))
        }

        return segments
    }

    private static func parseTimestamp(_ stamp: String) -> Int? {
        // "HH:MM:SS,mmm" or "HH:MM:SS.mmm"
        let normalized = stamp.replacingOccurrences(of: ",", with: ".")
        let parts = normalized.components(separatedBy: ":")
        guard parts.count == 3 else { return nil }

        let secParts = parts[2].components(separatedBy: ".")
        guard secParts.count == 2,
              let hours = Int(parts[0]),
              let minutes = Int(parts[1]),
              let seconds = Int(secParts[0]),
              let millis = Int(secParts[1])
        else { return nil }

        return (hours * 3600 + minutes * 60 + seconds) * 1000 + millis
    }
}
