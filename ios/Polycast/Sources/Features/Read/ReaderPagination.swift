import SwiftUI
import UIKit

// MARK: - Page model

/// A block placed on a page, with the spacing/indent decisions made during
/// pagination so rendering and measurement stay in sync.
struct ReaderRenderBlock: Identifiable, Hashable {
    let id: Int
    let block: BookBlock
    /// First-line indent (print convention: paragraphs following another
    /// paragraph indent; section openers, paragraphs after headings, and
    /// continuation fragments split across pages do not).
    let indentFirstLine: Bool
    /// Vertical gap above this block on its page.
    let topSpacing: CGFloat
}

struct ReaderPage: Identifiable {
    let id: Int
    let chapterIndex: Int
    let chapterPageIndex: Int
    let blocks: [ReaderRenderBlock]
}

// MARK: - Measurement context

/// Everything pagination needs to measure text exactly the way ReaderBlockView
/// renders it: page size, font choice, scale, and line spacing.
/// Memoizes measured token widths — words repeat constantly in a book, so this
/// cuts full-book pagination from many seconds to well under one.
private final class TokenWidthCache {
    var widths: [String: CGFloat] = [:]
}

struct ReaderLayout {
    let width: CGFloat
    let height: CGFloat
    let fontScale: Double
    let font: ReaderFontChoice
    let lineSpacing: CGFloat

    private let widthCache = TokenWidthCache()

    var bodySize: CGFloat { 18 * fontScale }
    /// Matches the web reader's `text-indent: 1.3em`.
    var indentWidth: CGFloat { bodySize * 1.3 }

    func fontSize(for kind: BookBlock.Kind) -> CGFloat {
        switch kind {
        case .h1: return 26 * fontScale
        case .h2: return 22 * fontScale
        case .h3: return 20 * fontScale
        case .p: return bodySize
        }
    }

    func uiFont(for kind: BookBlock.Kind) -> UIFont {
        font.uiFont(size: fontSize(for: kind), bold: kind != .p)
    }

    /// Vertical gap between two consecutive blocks on a page. Paragraphs run
    /// together (indents separate them, like print); headings get breathing room.
    func gap(after previous: BookBlock.Kind?, before next: BookBlock.Kind) -> CGFloat {
        guard previous != nil else { return 0 }
        if next != .p { return 18 }
        if previous != .p { return 10 }
        return 0
    }

    func height(of block: BookBlock, indented: Bool) -> CGFloat {
        let blockFont = uiFont(for: block.kind)
        let lines = lineCount(block.plainText, font: blockFont, indent: indented ? indentWidth : 0)
        return CGFloat(lines) * blockFont.lineHeight + CGFloat(max(lines - 1, 0)) * lineSpacing + 2
    }

    /// Greedy token wrap mirroring ReaderFlowLayout's line breaking.
    private func lineCount(_ text: String, font: UIFont, indent: CGFloat) -> Int {
        var lines = 1
        var lineWidth: CGFloat = indent
        var hasToken = false
        let fontKey = "\(font.fontName)#\(font.pointSize)|"
        for token in tokenize(text) {
            let cacheKey = fontKey + token.text
            var tokenWidth: CGFloat
            if let cached = widthCache.widths[cacheKey] {
                tokenWidth = cached
            } else {
                tokenWidth = (token.text as NSString).size(withAttributes: [.font: font]).width
                widthCache.widths[cacheKey] = tokenWidth
            }
            if token.isWord { tokenWidth += 2 }
            if hasToken && lineWidth + tokenWidth > width {
                lines += 1
                lineWidth = tokenWidth
            } else {
                lineWidth += tokenWidth
                hasToken = true
            }
        }
        return lines
    }
}

// MARK: - Pagination

func paginate(chapters: [BookChapter], layout: ReaderLayout) -> [ReaderPage] {
    guard layout.width > 0, layout.height > 0 else { return [] }
    var result: [ReaderPage] = []
    var blockID = 0

    for (chapterIndex, chapter) in chapters.enumerated() {
        var pageBlocks: [ReaderRenderBlock] = []
        var usedHeight: CGFloat = 0
        var chapterPageIndex = 0
        /// Kind of the previous block in the chapter source (decides paragraph indents).
        var previousKind: BookBlock.Kind?

        func flushPage() {
            guard !pageBlocks.isEmpty else { return }
            result.append(ReaderPage(
                id: result.count,
                chapterIndex: chapterIndex,
                chapterPageIndex: chapterPageIndex,
                blocks: pageBlocks
            ))
            chapterPageIndex += 1
            pageBlocks = []
            usedHeight = 0
        }

        func gapBefore(_ kind: BookBlock.Kind) -> CGFloat {
            pageBlocks.isEmpty ? 0 : layout.gap(after: pageBlocks.last?.block.kind, before: kind)
        }

        func appendBlock(_ block: BookBlock, indented: Bool) {
            let spacing = gapBefore(block.kind)
            usedHeight += spacing + layout.height(of: block, indented: indented)
            pageBlocks.append(ReaderRenderBlock(
                id: blockID,
                block: block,
                indentFirstLine: indented,
                topSpacing: spacing
            ))
            blockID += 1
        }

        for block in chapter.blocks {
            if block.kind != .p {
                let blockHeight = layout.height(of: block, indented: false)
                if !pageBlocks.isEmpty && usedHeight + gapBefore(block.kind) + blockHeight > layout.height {
                    flushPage()
                }
                appendBlock(block, indented: false)
                previousKind = block.kind
                continue
            }

            let wantsIndent = previousKind == .p
            var startsParagraph = true
            var fragment: [String] = []

            func fragmentIndent() -> Bool { wantsIndent && startsParagraph }

            for sentence in block.sentences {
                let candidate = BookBlock(kind: .p, sentences: fragment + [sentence])
                let base = usedHeight + gapBefore(.p)

                if base + layout.height(of: candidate, indented: fragmentIndent()) <= layout.height {
                    fragment.append(sentence)
                    continue
                }

                if !fragment.isEmpty {
                    appendBlock(BookBlock(kind: .p, sentences: fragment), indented: fragmentIndent())
                    fragment = []
                    startsParagraph = false
                    flushPage()
                } else if !pageBlocks.isEmpty {
                    flushPage()
                }

                let sentenceBlock = BookBlock(kind: .p, sentences: [sentence])
                if layout.height(of: sentenceBlock, indented: fragmentIndent()) <= layout.height {
                    fragment = [sentence]
                } else {
                    for chunk in splitToFit(sentence, layout: layout) {
                        appendBlock(BookBlock(kind: .p, sentences: [chunk]), indented: fragmentIndent())
                        startsParagraph = false
                        flushPage()
                    }
                }
            }

            if !fragment.isEmpty {
                let fragmentBlock = BookBlock(kind: .p, sentences: fragment)
                if !pageBlocks.isEmpty &&
                    usedHeight + gapBefore(.p) + layout.height(of: fragmentBlock, indented: fragmentIndent()) > layout.height {
                    flushPage()
                }
                appendBlock(fragmentBlock, indented: fragmentIndent())
            }
            previousKind = .p
        }
        flushPage()
    }

    return result
}

/// Splits a sentence too tall for one page into page-sized word chunks.
private func splitToFit(_ sentence: String, layout: ReaderLayout) -> [String] {
    let words = sentence.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    var chunks: [String] = []
    var current: [String] = []

    for word in words {
        let candidate = (current + [word]).joined(separator: " ")
        let block = BookBlock(kind: .p, sentences: [candidate])
        if !current.isEmpty && layout.height(of: block, indented: false) > layout.height {
            chunks.append(current.joined(separator: " "))
            current = [word]
        } else {
            current.append(word)
        }
    }
    if !current.isEmpty { chunks.append(current.joined(separator: " ")) }
    return chunks
}
