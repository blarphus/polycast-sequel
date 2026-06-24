import SwiftUI
import UIKit

/// Kindle-style immersive reader: chrome is hidden while reading; tapping the
/// center of the page toggles the toolbars, tapping the left/right edges turns
/// pages, and an always-visible footer cycles through progress displays.
struct ReaderView: View {
    let meta: BookMeta

    @EnvironmentObject private var library: BookLibrary
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore
    @Environment(\.dismiss) private var dismiss

    @State private var chapters: [BookChapter] = []
    @State private var currentChapter = 0
    @State private var currentPage = 0
    @State private var pages: [ReaderPage] = []
    @State private var readerSize: CGSize = .zero
    @State private var restoredPage = 0
    @State private var loading = true
    @State private var error = ""

    @State private var showChrome = false
    @State private var showTOC = false
    @State private var showSettings = false
    @State private var scrub: Double = 0
    @State private var isScrubbing = false
    @State private var returnPage: Int?

    @AppStorage(ReaderPrefKey.fontScale) private var fontScale: Double = 1.0
    @AppStorage(ReaderPrefKey.font) private var fontID: String = ReaderFontChoice.defaultChoice.id
    @AppStorage(ReaderPrefKey.lineSpacing) private var lineSpacingID: String = ReaderLineSpacing.normal.rawValue
    @AppStorage(ReaderPrefKey.margin) private var marginID: String = ReaderMargin.medium.rawValue
    @AppStorage(ReaderPrefKey.progressMode) private var progressModeID: String = ReaderProgressMode.pageInBook.rawValue
    @AppStorage(AppTheme.storageKey) private var appThemeRaw: String = AppTheme.dark.rawValue
    @Environment(\.colorScheme) private var colorScheme

    @State private var selectedLookup: LookupContext?
    @State private var selectedPhrase: PhraseContext?

    // Audiobook playback (nil when the book has no linked audio).
    @State private var audiobook: AudiobookPlayer?
    @State private var pausedForPopup = false
    @AppStorage("audiobookRate") private var audiobookRate: Double = 1.0

    private var savedSet: Set<String> { wordStore.savedForms }
    /// The reader follows the app-wide light/dark theme (the root view applies
    /// AppTheme via preferredColorScheme, so the environment scheme is effective).
    private var theme: ReaderTheme { colorScheme == .dark ? .dark : .light }
    private var fontChoice: ReaderFontChoice { ReaderFontChoice.choice(for: fontID) }
    private var lineSpacing: CGFloat { (ReaderLineSpacing(rawValue: lineSpacingID) ?? .normal).value }
    private var margin: CGFloat { (ReaderMargin(rawValue: marginID) ?? .medium).value }
    private var progressMode: ReaderProgressMode { ReaderProgressMode(rawValue: progressModeID) ?? .pageInBook }

    var body: some View {
        ZStack {
            theme.background.ignoresSafeArea()

            content

            if let context = selectedLookup {
                WordPopupView(context: context) { selectedLookup = nil }
                    .environmentObject(session)
                    .environmentObject(wordStore)
                    .transition(.opacity)
            }

            if let context = selectedPhrase {
                PhrasePopupView(context: context) { selectedPhrase = nil }
                    .environmentObject(session)
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .top) {
            topIcons
        }
        .overlay(alignment: .bottom) {
            if showChrome { bottomChrome.transition(.move(edge: .bottom).combined(with: .opacity)) }
        }
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .sheet(isPresented: $showTOC) { tableOfContents }
        .sheet(isPresented: $showSettings) { ReaderSettingsSheet(theme: theme) }
        .onChange(of: fontScale) { repaginate(preservingPosition: true) }
        .onChange(of: fontID) { repaginate(preservingPosition: true) }
        .onChange(of: lineSpacingID) { repaginate(preservingPosition: true) }
        .onChange(of: marginID) { repaginate(preservingPosition: true) }
        .onChange(of: currentPage) {
            persistCurrentPosition()
            if !isScrubbing { scrub = Double(currentPage) }
        }
        .onChange(of: selectedLookup?.id) { syncAudiobookWithPopup() }
        .onChange(of: selectedPhrase?.id) { syncAudiobookWithPopup() }
        .task {
            // Make sure saved-word highlighting has data even if the launch-time
            // fetch failed (e.g. flaky network) — prefetch() won't retry errors.
            if wordStore.words.isEmpty && !wordStore.loading {
                await wordStore.load()
            }
        }
        .task {
            guard chapters.isEmpty else { return }
            await loadBook()
        }
        .task {
            guard audiobook == nil else { return }
            audiobook = AudiobookPlayer(
                bookID: meta.id,
                tracks: library.audioTrackURLs(for: meta.id),
                rate: audiobookRate
            )
        }
        .onDisappear {
            persistCurrentPosition()
            audiobook?.stop()
        }
    }

    // MARK: - Page content

    @ViewBuilder
    private var content: some View {
        if loading {
            LoadingStateView(title: "Opening book…")
        } else if !error.isEmpty {
            EmptyStateView(title: "Could not open this book.", subtitle: error)
        } else if !chapters.isEmpty {
            VStack(spacing: 0) {
                GeometryReader { geometry in
                    Group {
                        if pages.isEmpty {
                            LoadingStateView(title: "Laying out pages…")
                        } else {
                            TabView(selection: $currentPage) {
                                ForEach(pages) { page in
                                    pageView(page, size: geometry.size)
                                        .tag(page.id)
                                }
                            }
                            .tabViewStyle(.page(indexDisplayMode: .never))
                            .indexViewStyle(.page(backgroundDisplayMode: .never))
                            .contentShape(Rectangle())
                            .onTapGesture { location in
                                handlePageTap(at: location, width: geometry.size.width)
                            }
                        }
                    }
                    .onAppear {
                        readerSize = geometry.size
                        repaginate(preservingPosition: false)
                    }
                    .onChange(of: geometry.size) {
                        readerSize = geometry.size
                        repaginate(preservingPosition: true)
                    }
                }

                footer
            }
        }
    }

    private func pageView(_ page: ReaderPage, size: CGSize) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(page.blocks) { render in
                ReaderBlockView(
                    render: render,
                    savedSet: savedSet,
                    theme: theme,
                    font: fontChoice,
                    fontScale: fontScale,
                    lineSpacing: lineSpacing,
                    selectedLookup: $selectedLookup,
                    selectedPhrase: $selectedPhrase
                )
                .padding(.top, render.topSpacing)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, margin)
        .padding(.top, 48)
        .padding(.bottom, 6)
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .clipped()
    }

    /// Kindle tap zones: left edge turns back, right edge turns forward, the
    /// center toggles the toolbars. A tap anywhere dismisses open chrome first.
    private func handlePageTap(at location: CGPoint, width: CGFloat) {
        if showChrome {
            setChrome(false)
            return
        }
        if location.x < width * 0.3 {
            turnPage(-1)
        } else if location.x > width * 0.65 {
            turnPage(1)
        } else {
            setChrome(true)
        }
    }

    private func setChrome(_ visible: Bool) {
        withAnimation(.easeOut(duration: 0.2)) { showChrome = visible }
        if !visible { returnPage = nil }
    }

    // MARK: - Persistent progress footer

    private var footer: some View {
        HStack {
            Text(footerText)
                .font(.system(size: 12))
                .foregroundStyle(theme.secondaryText)
            Spacer()
            if progressMode != .percent && progressMode != .off && !pages.isEmpty {
                Text("\(percentRead)%")
                    .font(.system(size: 12).monospacedDigit())
                    .foregroundStyle(theme.secondaryText)
            }
        }
        .padding(.horizontal, margin)
        .frame(height: 28)
        .contentShape(Rectangle())
        .onTapGesture {
            progressModeID = progressMode.next.rawValue
        }
    }

    private var percentRead: Int {
        guard !pages.isEmpty else { return 0 }
        return Int((Double(currentPage + 1) / Double(pages.count) * 100).rounded())
    }

    private var footerText: String {
        guard pages.indices.contains(currentPage) else { return "" }
        switch progressMode {
        case .pageInBook:
            return "Page \(currentPage + 1) of \(pages.count)"
        case .pageInChapter:
            let chapterIndex = pages[currentPage].chapterIndex
            let chapterPages = pages.filter { $0.chapterIndex == chapterIndex }.count
            return "Page \(pages[currentPage].chapterPageIndex + 1) of \(chapterPages) in chapter"
        case .percent:
            return "\(percentRead)%"
        case .off:
            return ""
        }
    }

    // MARK: - Chrome

    /// Always-visible floating icons (no header bar), mirroring the web
    /// reader's top bar: back, audiobook controls (when linked), theme toggle,
    /// display settings, contents.
    private var topIcons: some View {
        HStack(spacing: 2) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 38, height: 38)
                    .contentShape(Rectangle())
            }

            Spacer()

            if let audiobook {
                audiobookControls(audiobook)
                Spacer()
            }

            Button {
                appThemeRaw = theme.isDark ? AppTheme.light.rawValue : AppTheme.dark.rawValue
            } label: {
                Image(systemName: theme.isDark ? "sun.max" : "moon")
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: 38, height: 38)
                    .contentShape(Rectangle())
            }

            Button { showSettings = true } label: {
                Image(systemName: "textformat.size")
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: 38, height: 38)
                    .contentShape(Rectangle())
            }

            Button { showTOC = true } label: {
                Image(systemName: "book")
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: 38, height: 38)
                    .contentShape(Rectangle())
            }
        }
        .foregroundStyle(theme.secondaryText)
        .padding(.horizontal, 8)
    }

    // MARK: - Audiobook

    /// Speed, rewind 15s, play/pause, forward 15s — compact so it fits in the
    /// top icon row next to the reader controls.
    private func audiobookControls(_ player: AudiobookPlayer) -> some View {
        HStack(spacing: 0) {
            Menu {
                ForEach(AudiobookPlayer.speedOptions, id: \.self) { speed in
                    Button {
                        audiobookRate = speed
                        player.setRate(speed)
                    } label: {
                        if speed == player.rate {
                            Label(speedLabel(speed), systemImage: "checkmark")
                        } else {
                            Text(speedLabel(speed))
                        }
                    }
                }
            } label: {
                Text(speedLabel(player.rate))
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .frame(width: 40, height: 38)
                    .contentShape(Rectangle())
            }

            Button { player.skipBackward() } label: {
                Image(systemName: "gobackward.15")
                    .font(.system(size: 15, weight: .medium))
                    .frame(width: 34, height: 38)
                    .contentShape(Rectangle())
            }

            Button { player.togglePlayPause() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 16, weight: .medium))
                    .frame(width: 34, height: 38)
                    .contentShape(Rectangle())
            }

            Button { player.skipForward() } label: {
                Image(systemName: "goforward.15")
                    .font(.system(size: 15, weight: .medium))
                    .frame(width: 34, height: 38)
                    .contentShape(Rectangle())
            }
        }
    }

    private func speedLabel(_ speed: Double) -> String {
        speed == speed.rounded()
            ? "\(Int(speed))x"
            : String(format: "%g", speed) + "x"
    }

    /// Pause playback while a word/phrase popup is open; resume on close only
    /// when the popup itself caused the pause.
    private func syncAudiobookWithPopup() {
        guard let audiobook else { return }
        let popupOpen = selectedLookup != nil || selectedPhrase != nil
        if popupOpen {
            if audiobook.isPlaying {
                audiobook.pause()
                pausedForPopup = true
            }
        } else if pausedForPopup {
            pausedForPopup = false
            audiobook.play()
        }
    }

    private var bottomChrome: some View {
        VStack(spacing: 10) {
            if let returnPage {
                Button {
                    currentPage = returnPage
                    self.returnPage = nil
                } label: {
                    Label("Back to page \(returnPage + 1)", systemImage: "arrow.uturn.backward")
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(theme.background, in: Capsule())
                        .overlay(Capsule().strokeBorder(theme.divider, lineWidth: 1))
                }
                .foregroundStyle(theme.text)
            }

            if pages.indices.contains(scrubPage) {
                Text(chapters[pages[scrubPage].chapterIndex].title)
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
                    .lineLimit(1)
            }

            Slider(
                value: $scrub,
                in: 0...Double(max(pages.count - 1, 1)),
                step: 1
            ) { editing in
                if editing {
                    if returnPage == nil { returnPage = currentPage }
                    isScrubbing = true
                } else {
                    isScrubbing = false
                    currentPage = Int(scrub)
                }
            }
            .tint(.purple)
            .disabled(pages.count < 2)

            HStack {
                Text("Page \(scrubPage + 1) of \(max(pages.count, 1))")
                    .font(.caption2.monospacedDigit())
                Spacer()
                Text("\(scrubPercent)%")
                    .font(.caption2.monospacedDigit())
            }
            .foregroundStyle(theme.secondaryText)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background {
            theme.chrome
                .shadow(color: .black.opacity(theme.isDark ? 0.5 : 0.12), radius: 8, y: -2)
                .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            theme.divider.frame(height: 0.5)
        }
    }

    private var scrubPage: Int { min(max(Int(scrub), 0), max(pages.count - 1, 0)) }

    private var scrubPercent: Int {
        guard !pages.isEmpty else { return 0 }
        return Int((Double(scrubPage + 1) / Double(pages.count) * 100).rounded())
    }

    // MARK: - Table of contents

    private var tableOfContents: some View {
        NavigationStack {
            List(Array(chapters.enumerated()), id: \.offset) { index, chapter in
                Button {
                    goto(index)
                    showTOC = false
                } label: {
                    HStack {
                        Text(chapter.title)
                            .lineLimit(2)
                            .foregroundStyle(index == currentChapter ? .purple : theme.text)
                        Spacer()
                        if index == currentChapter {
                            Image(systemName: "book.fill").foregroundStyle(.purple)
                        }
                    }
                }
                .listRowBackground(theme.background)
            }
            .scrollContentBackground(.hidden)
            .background(theme.background)
            .navigationTitle("Contents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { showTOC = false }
                        .foregroundStyle(.purple)
                }
            }
            .toolbarBackground(theme.chrome, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
    }

    // MARK: - Navigation

    private func goto(_ index: Int) {
        guard chapters.indices.contains(index) else { return }
        guard let page = pages.first(where: { $0.chapterIndex == index }) else { return }
        withAnimation { currentPage = page.id }
    }

    private func turnPage(_ offset: Int) {
        let destination = currentPage + offset
        guard pages.indices.contains(destination) else { return }
        withAnimation { currentPage = destination }
    }

    // MARK: - Loading & layout

    private func loadBook() async {
        loading = true
        error = ""
        let id = meta.id
        let restored = library.progress(for: id)
        restoredPage = library.pageProgress(for: id)

        // Fast path: parsed chapters are cached on import, so opening a book
        // skips the expensive unzip + HTML parse.
        let cacheURL = library.chaptersCacheURL(for: id)
        if let cached = await Task.detached(priority: .userInitiated, operation: {
            BookLibrary.cachedChapters(at: cacheURL)
        }).value {
            chapters = cached
            currentChapter = min(max(restored, 0), cached.count - 1)
            loading = false
            return
        }

        guard let data = library.epubData(for: id) else {
            error = "The book file is missing."
            loading = false
            return
        }
        do {
            let parsed = try await Task.detached(priority: .userInitiated) {
                let book = try EpubParser.parse(data)
                BookLibrary.cacheChapters(book.chapters, at: cacheURL)
                return book
            }.value
            chapters = parsed.chapters
            currentChapter = min(max(restored, 0), parsed.chapters.count - 1)
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func repaginate(preservingPosition: Bool) {
        guard readerSize.width > 0, readerSize.height > 0, !chapters.isEmpty else { return }

        let oldChapter = preservingPosition && pages.indices.contains(currentPage)
            ? pages[currentPage].chapterIndex
            : currentChapter
        let oldChapterPage = preservingPosition && pages.indices.contains(currentPage)
            ? pages[currentPage].chapterPageIndex
            : restoredPage

        pages = paginate(
            chapters: chapters,
            layout: ReaderLayout(
                width: readerSize.width - margin * 2,
                height: readerSize.height - 54,
                fontScale: fontScale,
                font: fontChoice,
                lineSpacing: lineSpacing
            )
        )

        if let restoredIndex = pages.firstIndex(where: {
            $0.chapterIndex == oldChapter && $0.chapterPageIndex == oldChapterPage
        }) {
            currentPage = restoredIndex
        } else if let chapterStart = pages.firstIndex(where: { $0.chapterIndex == oldChapter }) {
            currentPage = chapterStart
        } else {
            currentPage = 0
        }
        scrub = Double(currentPage)
        persistCurrentPosition()
    }

    private func persistCurrentPosition() {
        guard pages.indices.contains(currentPage) else { return }
        let page = pages[currentPage]
        currentChapter = page.chapterIndex
        library.setProgress(page.chapterIndex, for: meta.id)
        library.setPageProgress(page.chapterPageIndex, for: meta.id)
    }
}
