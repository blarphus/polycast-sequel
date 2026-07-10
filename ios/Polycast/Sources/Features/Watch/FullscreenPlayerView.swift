import SwiftUI
import UIKit

struct TimedCaptionWord: Hashable {
    let text: String
    let offset: Int
}

struct TimedCaptionCue: Identifiable, Hashable {
    var id: String { "\(offset)-\(duration)-\(text)" }
    let text: String
    let offset: Int
    let duration: Int
    let words: [TimedCaptionWord]
}

enum CaptionTrackKind: Equatable {
    case automatic
    case human
}

struct TimedCaptionTrack: Equatable {
    let kind: CaptionTrackKind
    let cues: [TimedCaptionCue]

    static func fallback(segments: [TranscriptSegment]) -> TimedCaptionTrack {
        TimedCaptionTrack(
            kind: .human,
            cues: segments.map {
                TimedCaptionCue(text: $0.text, offset: $0.offset, duration: $0.duration, words: [])
            }
        )
    }
}

struct CaptionDisplay: Equatable {
    let previousLine: String?
    let currentLine: String
    let sentence: String
}

func captionDisplay(track: TimedCaptionTrack, timeMilliseconds: Int) -> CaptionDisplay? {
    guard let index = track.cues.lastIndex(where: { $0.offset <= timeMilliseconds }) else { return nil }
    let cue = track.cues[index]
    let cueEnd = cue.offset + max(cue.duration, 1)
    guard timeMilliseconds < cueEnd else { return nil }

    if track.kind == .human || cue.words.isEmpty {
        let previous = index > 0 ? track.cues[index - 1].text : nil
        return CaptionDisplay(previousLine: previous, currentLine: cue.text, sentence: cue.text)
    }

    let visible = cue.words
        .filter { cue.offset + $0.offset <= timeMilliseconds }
        .map(\.text)
        .joined()
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !visible.isEmpty else { return nil }

    let previous = index > 0 ? track.cues[index - 1].text : nil
    return CaptionDisplay(previousLine: previous, currentLine: visible, sentence: cue.text)
}

/// Landscape watch mode. The official YouTube iframe remains unobstructed and
/// app-owned, tappable subtitles occupy a separate panel below it.
struct FullscreenPlayerView: View {
    let youtubeID: String
    let language: String
    let fallbackSegments: [TranscriptSegment]
    let initialTime: Double
    let initiallyPlaying: Bool
    let onDismiss: (Double, Bool) -> Void

    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore
    @Environment(\.dismiss) private var dismiss

    @State private var currentTime: Double
    @State private var seekTime: Double?
    @State private var isPlaying: Bool
    @State private var pausedForLookup = false
    @State private var resumeAfterLookup = false
    @State private var selectedLookup: LookupContext?
    @State private var captionTrack: TimedCaptionTrack
    @State private var captionError: String?

    init(
        youtubeID: String,
        language: String,
        fallbackSegments: [TranscriptSegment],
        initialTime: Double,
        initiallyPlaying: Bool,
        onDismiss: @escaping (Double, Bool) -> Void
    ) {
        self.youtubeID = youtubeID
        self.language = language
        self.fallbackSegments = fallbackSegments
        self.initialTime = initialTime
        self.initiallyPlaying = initiallyPlaying
        self.onDismiss = onDismiss
        _currentTime = State(initialValue: initialTime)
        _seekTime = State(initialValue: initialTime)
        _isPlaying = State(initialValue: initiallyPlaying)
        _captionTrack = State(initialValue: .fallback(segments: fallbackSegments))
    }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                YouTubePlayerView(
                    youtubeID: youtubeID,
                    currentTime: $currentTime,
                    seekTime: $seekTime,
                    pausedForLookup: $pausedForLookup,
                    isPlaying: $isPlaying,
                    playAfterInitialSeek: initiallyPlaying
                )
                .frame(height: playerHeight(for: geometry.size))
                .accessibilityIdentifier("landscape-video-player")

                LandscapeSubtitlePanel(
                    track: captionTrack,
                    timeMilliseconds: Int((currentTime * 1000).rounded()),
                    captionError: captionError,
                    hasFallback: !fallbackSegments.isEmpty,
                    selectedLookup: $selectedLookup,
                    onWordTap: pauseForLookup,
                    contentBottomInset: 14
                )
                    .frame(maxWidth: .infinity)
                    .frame(height: landscapeSubtitleStripHeight)
                    .clipped()
                    .accessibilityIdentifier("landscape-subtitle-panel")

                Spacer(minLength: 0)
            }
            .background(Color.black)
        }
        .ignoresSafeArea()
        .statusBarHidden(true)
        .overlay(alignment: .topLeading) {
            Button {
                close()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(10)
                    .background(.black.opacity(0.55), in: Circle())
            }
            .accessibilityLabel("Close landscape player")
            .padding(12)
        }
        .overlay(alignment: .bottomTrailing) {
            Text(String(format: "%.1f", currentTime))
                .font(.system(size: 1))
                .opacity(0.01)
                .accessibilityIdentifier("landscape-player-time")
                .accessibilityLabel("Landscape player time")
                .accessibilityValue(String(format: "%.1f", currentTime))
        }
        .overlay {
            if let context = selectedLookup {
                WordPopupView(context: context, onDismiss: closeLookup)
                    .environmentObject(session)
                    .environmentObject(wordStore)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("landscape-word-popup")
                    .accessibilityLabel("Word lookup for \(context.word)")
                    .accessibilityValue(context.word)
            }
        }
        .task {
            OrientationController.enterLandscape()
            do {
                captionTrack = try await TranscriptWorkerClient.fetchTimedCaptions(
                    youtubeId: youtubeID,
                    lang: language
                )
                captionError = nil
            } catch {
                captionError = error.localizedDescription
            }
        }
        .onDisappear {
            OrientationController.leaveLandscape()
        }
    }

    private func playerHeight(for size: CGSize) -> CGFloat {
        // Fit the video above a fixed-height subtitle strip within the available
        // landscape height (the video may end up slightly shorter than 16:9).
        min(size.width * 9 / 16, size.height - landscapeSubtitleStripHeight)
    }

    private func pauseForLookup() {
        resumeAfterLookup = isPlaying
        pausedForLookup = true
    }

    private func closeLookup() {
        selectedLookup = nil
        pausedForLookup = false
        if resumeAfterLookup { isPlaying = true }
        resumeAfterLookup = false
    }

    private func close() {
        onDismiss(currentTime, isPlaying && !pausedForLookup)
        dismiss()
    }
}

/// Fixed height of the landscape caption strip below the video. Tall enough for
/// two caption lines (~58pt) with roughly equal black margins above and below.
let landscapeSubtitleStripHeight: CGFloat = 90

struct LandscapeSubtitlePanel: View {
    let track: TimedCaptionTrack
    let timeMilliseconds: Int
    let captionError: String?
    let hasFallback: Bool
    @Binding var selectedLookup: LookupContext?
    let onWordTap: () -> Void
    var contentBottomInset: CGFloat = 40

    private let fontSize: CGFloat = 20
    private let rowHeight: CGFloat = 28
    private let rowSpacing: CGFloat = 2

    private var words: [RollingCaptionWord] {
        revealedRollingWords(track: track, timeMilliseconds: timeMilliseconds)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color(red: 0.055, green: 0.055, blue: 0.07)

            if words.isEmpty {
                if let captionError, !hasFallback {
                    Text(captionError)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding()
                }
            } else {
                GeometryReader { proxy in
                    // The text wraps inside a wide column (roughly twice the
                    // portrait width). The column is centered on screen but its
                    // text is left-aligned, so words keep their position as more
                    // arrive instead of re-centering.
                    let column = min(max(proxy.size.width - 48, 0), 720)
                    RollingCaptionLines(
                        words: words,
                        maxWidth: column,
                        fontSize: fontSize,
                        rowHeight: rowHeight,
                        rowSpacing: rowSpacing,
                        visibleLines: 2,
                        selectedLookup: $selectedLookup,
                        onWordTap: onWordTap
                    )
                    .frame(width: column, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .frame(height: proxy.size.height, alignment: .center)
                }
                .padding(.vertical, contentBottomInset)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

struct CaptionWordToken: Equatable {
    var text: String
    let word: String
}

struct PortraitCaptionToken: Equatable {
    let text: String
    let word: String
    let sentence: String
}

func captionWordTokens(_ text: String) -> [CaptionWordToken] {
    var result: [CaptionWordToken] = []
    var prefix = ""

    for token in tokenize(text) {
        if token.isWord {
            result.append(CaptionWordToken(text: prefix + token.text, word: token.text))
            prefix = ""
        } else if result.isEmpty {
            prefix += token.text
        } else {
            result[result.count - 1].text += token.text
        }
    }

    return result
}

func portraitCaptionTokens(_ display: CaptionDisplay) -> [PortraitCaptionToken] {
    var previous = captionWordTokens(display.previousLine ?? "").map {
        PortraitCaptionToken(text: $0.text, word: $0.word, sentence: display.previousLine ?? "")
    }
    let current = captionWordTokens(display.currentLine).map {
        PortraitCaptionToken(text: $0.text, word: $0.word, sentence: display.sentence)
    }

    if !previous.isEmpty, !current.isEmpty,
       previous[previous.count - 1].text.last?.isWhitespace != true,
       current[0].text.first?.isWhitespace != true {
        let last = previous.removeLast()
        previous.append(
            PortraitCaptionToken(
                text: last.text + " ",
                word: last.word,
                sentence: last.sentence
            )
        )
    }

    return previous + current
}

/// One revealed word in the rolling portrait caption stream.
struct RollingCaptionWord: Equatable, Identifiable {
    let id: String        // positional: "cueIndex-wordIndex" — append-only over time
    let text: String      // display text, may include a leading space
    let word: String      // bare word for lookup / saved-word highlight
    let sentence: String  // the cue text, used as lookup context
}

/// The full ordered stream of caption words revealed by `timeMilliseconds`,
/// across every cue — not just the current one. Automatic captions reveal
/// word-by-word from their per-word timings; human / whole-cue captions reveal
/// a full cue at its start. Word ids are positional so the stream only ever
/// grows by appending as playback advances; that append-only property is what
/// lets the rolling view keep already-placed words fixed and just scroll whole
/// lines up. A leading space is inserted between adjacent cues when needed so
/// their words don't run together.
func revealedRollingWords(track: TimedCaptionTrack, timeMilliseconds: Int) -> [RollingCaptionWord] {
    var result: [RollingCaptionWord] = []

    for (cueIndex, cue) in track.cues.enumerated() {
        guard cue.offset <= timeMilliseconds else { continue }

        var cueTokens: [(text: String, word: String)] = []
        if track.kind == .human || cue.words.isEmpty {
            cueTokens = captionWordTokens(cue.text).map { ($0.text, $0.word) }
        } else {
            for w in cue.words {
                guard cue.offset + w.offset <= timeMilliseconds else { break }
                let bare = w.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !bare.isEmpty else { continue }
                cueTokens.append((w.text, bare))
            }
        }

        for (wordIndex, token) in cueTokens.enumerated() {
            var text = token.text
            if wordIndex == 0, let previous = result.last,
               previous.text.last?.isWhitespace != true,
               text.first?.isWhitespace != true {
                text = " " + text
            }
            result.append(
                RollingCaptionWord(
                    id: "\(cueIndex)-\(wordIndex)",
                    text: text,
                    word: token.word,
                    sentence: cue.text
                )
            )
        }
    }

    return result
}

/// Portrait subtitles as a fixed two-line rolling window over the whole caption
/// stream. Words are wrapped to the portrait width with our own greedy line
/// breaks (ignoring YouTube's), and only the bottom two rows are shown.
struct PortraitSubtitlePanel: View {
    let track: TimedCaptionTrack
    let timeMilliseconds: Int
    let captionError: String?
    let hasFallback: Bool
    @Binding var selectedLookup: LookupContext?
    let onWordTap: () -> Void

    private let fontSize: CGFloat = 20
    private let rowHeight: CGFloat = 28
    private let rowSpacing: CGFloat = 2

    private var words: [RollingCaptionWord] {
        revealedRollingWords(track: track, timeMilliseconds: timeMilliseconds)
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color(red: 0.055, green: 0.055, blue: 0.07)

            if words.isEmpty {
                if let captionError, !hasFallback {
                    Text(captionError)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                        .padding(16)
                }
            } else {
                GeometryReader { proxy in
                    RollingCaptionLines(
                        words: words,
                        maxWidth: proxy.size.width,
                        fontSize: fontSize,
                        rowHeight: rowHeight,
                        rowSpacing: rowSpacing,
                        visibleLines: 2,
                        selectedLookup: $selectedLookup,
                        onWordTap: onWordTap
                    )
                    .frame(width: proxy.size.width, height: proxy.size.height, alignment: .bottomLeading)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// Maintains committed line breaks for the rolling caption. New words are
/// appended to the bottom line; when one would overflow, a fresh line starts —
/// existing lines are never re-wrapped, so placed words stay put and the view
/// only ever scrolls whole lines up. Line breaks are measured against the real
/// font width so we control the wrapping, not the source captions.
private struct RollingCaptionLines: View {
    let words: [RollingCaptionWord]
    let maxWidth: CGFloat
    let fontSize: CGFloat
    let rowHeight: CGFloat
    let rowSpacing: CGFloat
    let visibleLines: Int
    @Binding var selectedLookup: LookupContext?
    let onWordTap: () -> Void

    @EnvironmentObject private var wordStore: WordStore

    @State private var lines: [[RollingCaptionWord]] = []
    @State private var consumedCount = 0
    @State private var lastConsumedID: String?
    @State private var packedWidth: CGFloat = 0

    // A few extra committed lines are retained above the visible window so a
    // seek that nudges backwards doesn't force a full rebuild.
    private let maxKeptLines = 6

    private var uiFont: UIFont { .systemFont(ofSize: fontSize, weight: .semibold) }
    private var visible: [[RollingCaptionWord]] { Array(lines.suffix(visibleLines)) }

    var body: some View {
        VStack(alignment: .leading, spacing: rowSpacing) {
            ForEach(Array(visible.enumerated()), id: \.offset) { _, line in
                lineView(line)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { rebuild() }
        .onChange(of: words) { _, _ in sync() }
        .onChange(of: maxWidth) { _, _ in rebuild() }
    }

    private func lineView(_ line: [RollingCaptionWord]) -> some View {
        HStack(spacing: 0) {
            ForEach(line) { token in
                Button {
                    selectedLookup = LookupContext(word: token.word, sentence: token.sentence)
                    onWordTap()
                } label: {
                    Text(token.text)
                        .font(.system(size: fontSize, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(height: rowHeight)
                        .background(
                            wordStore.savedForms.contains(savedWordMatchKey(token.word))
                                ? Color(red: 0.18, green: 0.8, blue: 0.443).opacity(0.22)
                                : Color.clear,
                            in: RoundedRectangle(cornerRadius: 4)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(token.word)
                .accessibilityIdentifier("portrait-caption-word")
            }
        }
    }

    private func width(of text: String) -> CGFloat {
        (text as NSString).size(withAttributes: [.font: uiFont]).width
    }

    /// Append one word, starting a new line if it would overflow. Committed
    /// lines are never re-wrapped.
    private func append(_ word: RollingCaptionWord) {
        let wordWidth = width(of: word.text)
        if var last = lines.last, !last.isEmpty {
            let used = last.reduce(0) { $0 + width(of: $1.text) }
            if used + wordWidth > maxWidth {
                lines.append([word])
            } else {
                last.append(word)
                lines[lines.count - 1] = last
            }
        } else {
            lines.append([word])
        }
    }

    private func trim() {
        if lines.count > maxKeptLines {
            lines.removeFirst(lines.count - maxKeptLines)
        }
    }

    private func rebuild() {
        guard maxWidth > 0 else { return }
        lines = []
        for word in words { append(word) }
        trim()
        consumedCount = words.count
        lastConsumedID = words.last?.id
        packedWidth = maxWidth
    }

    /// Fast path when the stream simply extended (same prefix): append only the
    /// new tail. Otherwise (a seek changed the prefix) rebuild from scratch.
    private func sync() {
        guard maxWidth > 0 else { return }
        let isAppend = packedWidth == maxWidth
            && words.count >= consumedCount
            && (consumedCount == 0 || words[consumedCount - 1].id == lastConsumedID)
        guard isAppend else {
            rebuild()
            return
        }
        if words.count > consumedCount {
            for word in words[consumedCount...] { append(word) }
            trim()
            consumedCount = words.count
            lastConsumedID = words.last?.id
        }
    }
}

enum OrientationController {
    @MainActor
    static func enterLandscape() {
        AppDelegate.orientationMask = .landscape
        request(.landscapeRight)
    }

    /// Permit free rotation (call screen) without forcing an orientation.
    @MainActor
    static func unlockRotation() {
        AppDelegate.orientationMask = .allButUpsideDown
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
    }

    @MainActor
    static func leaveLandscape() {
        AppDelegate.orientationMask = .portrait
        request(.portrait)
    }

    @MainActor
    private static func request(_ orientation: UIInterfaceOrientation) {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        let preferences = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: orientation == .portrait ? .portrait : .landscape)
        scene.requestGeometryUpdate(preferences)
        scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
    }
}

private extension UIWindowScene {
    var keyWindow: UIWindow? {
        windows.first(where: \.isKeyWindow)
    }
}
