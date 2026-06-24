import Foundation

// MARK: - Parsed book model

/// A single readable block of a chapter — a heading or a paragraph split into sentences.
struct BookBlock: Identifiable, Hashable, Codable {
    enum Kind: String, Hashable, Codable { case h1, h2, h3, p }
    let id = UUID()
    let kind: Kind
    let sentences: [String]

    // id is runtime-only; parsed chapters are cached to disk as JSON.
    private enum CodingKeys: String, CodingKey { case kind, sentences }

    var plainText: String { sentences.joined(separator: " ") }
}

struct BookChapter: Identifiable, Hashable, Codable {
    let id = UUID()
    let title: String
    let blocks: [BookBlock]

    private enum CodingKeys: String, CodingKey { case title, blocks }
}

struct ParsedBook {
    let title: String
    let author: String
    let coverImage: Data?
    let chapters: [BookChapter]
}

enum EpubError: LocalizedError {
    case missingContainer
    case missingOPF
    case noChapters

    var errorDescription: String? {
        switch self {
        case .missingContainer: return "EPUB is missing META-INF/container.xml."
        case .missingOPF: return "EPUB is missing its content (OPF) file."
        case .noChapters: return "No readable text was found in this EPUB."
        }
    }
}

enum EpubParser {
    /// Parses raw EPUB bytes into a readable book. Throws on a malformed archive.
    static func parse(_ fileData: Data) throws -> ParsedBook {
        let zip = try MiniZip(data: fileData)

        guard let container = try zip.string(for: "META-INF/container.xml"),
              let opfPath = firstMatch(in: container, pattern: #"full-path="([^"]+)""#) else {
            throw EpubError.missingContainer
        }
        guard let opf = try zip.string(for: opfPath) else { throw EpubError.missingOPF }

        let baseDir = (opfPath as NSString).deletingLastPathComponent

        let title = decodeEntities(firstMatch(in: opf, pattern: #"<dc:title[^>]*>([\s\S]*?)</dc:title>"#) ?? "Untitled")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let author = decodeEntities(firstMatch(in: opf, pattern: #"<dc:creator[^>]*>([\s\S]*?)</dc:creator>"#) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        // manifest: id -> href, and id -> properties
        var hrefByID: [String: String] = [:]
        var propsByID: [String: String] = [:]
        for item in matches(in: opf, pattern: #"<item\b([^>]*)/?>"#) {
            guard let id = attribute("id", in: item), let href = attribute("href", in: item) else { continue }
            hrefByID[id] = href
            if let props = attribute("properties", in: item) { propsByID[id] = props }
        }

        // spine order
        let spineIDs = matches(in: opf, pattern: #"<itemref\b[^>]*idref="([^"]+)"[^>]*>"#)
            .compactMap { firstMatch(in: $0, pattern: #"idref="([^"]+)""#) }

        // cover image: prefer manifest property, else <meta name="cover" content="id">
        var coverData: Data?
        if let coverID = propsByID.first(where: { $0.value.contains("cover-image") })?.key,
           let href = hrefByID[coverID] {
            coverData = try zip.data(for: resolve(href, base: baseDir))
        }
        if coverData == nil,
           let metaCover = firstMatch(in: opf, pattern: #"<meta[^>]*name="cover"[^>]*content="([^"]+)""#)
                ?? firstMatch(in: opf, pattern: #"<meta[^>]*content="([^"]+)"[^>]*name="cover""#),
           let href = hrefByID[metaCover] {
            coverData = try? zip.data(for: resolve(href, base: baseDir))
        }

        var chapters: [BookChapter] = []
        for id in spineIDs {
            guard let href = hrefByID[id] else { continue }
            let path = resolve(href, base: baseDir)
            guard let html = try zip.string(for: path) else { continue }
            let blocks = extractBlocks(from: html)
            guard !blocks.isEmpty else { continue }
            let chapterTitle = blocks.first(where: { $0.kind != .p })?.plainText
                ?? "Chapter \(chapters.count + 1)"
            chapters.append(BookChapter(title: chapterTitle, blocks: blocks))
        }

        guard !chapters.isEmpty else { throw EpubError.noChapters }
        return ParsedBook(
            title: title.isEmpty ? "Untitled" : title,
            author: author,
            coverImage: coverData,
            chapters: chapters
        )
    }

    // MARK: - Block extraction

    private static func extractBlocks(from html: String) -> [BookBlock] {
        // Drop everything that isn't body content.
        var body = html
        body = remove(pattern: #"<head[\s\S]*?</head>"#, in: body)
        body = remove(pattern: #"<script[\s\S]*?</script>"#, in: body)
        body = remove(pattern: #"<style[\s\S]*?</style>"#, in: body)

        var blocks: [BookBlock] = []
        // Match headings, paragraphs and list items in document order.
        let pattern = #"<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)</\1>"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return []
        }
        let ns = body as NSString
        regex.enumerateMatches(in: body, range: NSRange(location: 0, length: ns.length)) { match, _, _ in
            guard let match, match.numberOfRanges >= 3 else { return }
            let tag = ns.substring(with: match.range(at: 1)).lowercased()
            let inner = ns.substring(with: match.range(at: 2))
            let text = cleanText(inner)
            guard !text.isEmpty else { return }

            let kind: BookBlock.Kind
            switch tag {
            case "h1": kind = .h1
            case "h2", "h3": kind = .h2
            case "h4", "h5", "h6": kind = .h3
            default: kind = .p
            }
            blocks.append(BookBlock(kind: kind, sentences: splitSentences(text)))
        }
        return blocks
    }

    private static func cleanText(_ raw: String) -> String {
        var text = raw
        text = text.replacingOccurrences(of: #"<br\s*/?>"#, with: " ", options: .regularExpression)
        text = remove(pattern: #"<[^>]+>"#, in: text)
        text = decodeEntities(text)
        // collapse whitespace
        text = text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Splits a paragraph into sentences (matches the web reader's regex behaviour).
    static func splitSentences(_ text: String) -> [String] {
        let parts = text.components(separatedBy: .newlines).joined(separator: " ")
        guard let regex = try? NSRegularExpression(pattern: #"(?<=[.!?…])\s+"#) else { return [text] }
        let ns = parts as NSString
        var result: [String] = []
        var last = 0
        regex.enumerateMatches(in: parts, range: NSRange(location: 0, length: ns.length)) { match, _, _ in
            guard let match else { return }
            let sentence = ns.substring(with: NSRange(location: last, length: match.range.location - last))
            let trimmed = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { result.append(trimmed) }
            last = match.range.location + match.range.length
        }
        let tail = ns.substring(from: last).trimmingCharacters(in: .whitespacesAndNewlines)
        if !tail.isEmpty { result.append(tail) }
        return result.isEmpty ? [text] : result
    }

    // MARK: - Path & regex helpers

    private static func resolve(_ href: String, base: String) -> String {
        let cleaned = href.removingPercentEncoding ?? href
        if base.isEmpty { return cleaned }
        return ((base as NSString).appendingPathComponent(cleaned) as NSString).standardizingPath
    }

    private static func attribute(_ name: String, in tag: String) -> String? {
        firstMatch(in: tag, pattern: "\(name)=\"([^\"]*)\"")
    }

    private static func firstMatch(in text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let ns = text as NSString
        guard let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
              match.numberOfRanges >= 2 else { return nil }
        return ns.substring(with: match.range(at: 1))
    }

    private static func matches(in text: String, pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        let ns = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map {
            ns.substring(with: $0.range)
        }
    }

    private static func remove(pattern: String, in text: String) -> String {
        text.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
    }

    /// Decodes the HTML entities that appear in ebook text.
    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var result = text
        let named: [String: String] = [
            "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'",
            "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
            "&lsquo;": "\u{2018}", "&rsquo;": "\u{2019}", "&ldquo;": "\u{201C}", "&rdquo;": "\u{201D}",
            "&laquo;": "«", "&raquo;": "»", "&iexcl;": "¡", "&iquest;": "¿",
        ]
        for (entity, value) in named {
            result = result.replacingOccurrences(of: entity, with: value)
        }
        // numeric entities: &#123; and &#x1F;
        if let regex = try? NSRegularExpression(pattern: #"&#(x?[0-9A-Fa-f]+);"#) {
            let ns = result as NSString
            var output = ""
            var cursor = 0
            regex.enumerateMatches(in: result, range: NSRange(location: 0, length: ns.length)) { match, _, _ in
                guard let match else { return }
                output += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
                let token = ns.substring(with: match.range(at: 1))
                let scalarValue: UInt32?
                if token.hasPrefix("x") || token.hasPrefix("X") {
                    scalarValue = UInt32(token.dropFirst(), radix: 16)
                } else {
                    scalarValue = UInt32(token, radix: 10)
                }
                if let scalarValue, let scalar = Unicode.Scalar(scalarValue) {
                    output.append(Character(scalar))
                } else {
                    output += ns.substring(with: match.range)
                }
                cursor = match.range.location + match.range.length
            }
            output += ns.substring(from: cursor)
            result = output
        }
        return result
    }
}
