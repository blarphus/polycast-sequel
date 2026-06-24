import SwiftUI
import WebKit
import UIKit

struct WatchView: View {
    let videoID: String
    private let playAfterInitialSeek: Bool?

    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore
    @Environment(\.dismiss) private var dismiss

    @State private var video: VideoDetail?
    @State private var loading = true
    @State private var error = ""
    @State private var currentTime: Double = 0
    @State private var seekTime: Double?
    @State private var lastProgressSaveAt: TimeInterval = 0
    @State private var selectedLookup: LookupContext?
    @State private var clientFetching = false
    @State private var pausedForLookup = false
    @State private var fullscreenPresented = false
    @State private var inlineIsPlaying = false
    @State private var captionTrack = TimedCaptionTrack(kind: .human, cues: [])
    @State private var captionTrackError: String?
    @State private var related: [TrendingVideo] = []
    @State private var relatedChannelName: String?
    @State private var relatedChannelHandle: String?
    @State private var relatedChannelID: String?
    @State private var relatedChannelAvatarURL: String?
    @State private var selectedChannel: ChannelSummary?
    @State private var subscriptionUpdating = false
    @State private var pushTarget: WatchTarget?

    init(
        videoID: String,
        initialVideo: VideoDetail? = nil,
        initialTime: Double = 0,
        playAfterInitialSeek: Bool? = nil
    ) {
        self.videoID = videoID
        self.playAfterInitialSeek = playAfterInitialSeek
        _video = State(initialValue: initialVideo)
        _loading = State(initialValue: initialVideo == nil)
        _currentTime = State(initialValue: initialTime)
        _seekTime = State(initialValue: initialTime > 0 ? initialTime : nil)
    }

    var body: some View {
        VStack(spacing: 0) {
            if loading {
                LoadingStateView(title: "Loading video…")
            } else if let video {
                content(for: video)
            } else {
                EmptyStateView(title: "Could not load video.", subtitle: error)
            }
        }
        .texturedBackground()
        .navigationBarBackButtonHidden()
        .statusBarHidden(fullscreenPresented)
        .toolbar(fullscreenPresented ? .hidden : .visible, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Back") { dismiss() }
            }
        }
        .task {
            guard video == nil else { return }
            await load()
        }
        .task(id: video?.transcriptStatus) {
            guard let video, video.transcriptStatus == "processing" else { return }
            // Poll every 4 seconds while server is still processing transcript
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                guard !Task.isCancelled else { break }
                do {
                    let updated = try await APIClient.shared.videoDetail(id: videoID)
                    self.video = updated
                    if updated.transcriptStatus != "processing" { break }
                } catch {
                    print("[Polycast] Transcript poll failed: \(error)")
                    break
                }
            }
        }
        .task(id: video?.youtubeId) {
            guard let video, !video.youtubeId.isEmpty else { return }
            await loadCaptionsAndRelated(for: video)
        }
        .navigationDestination(item: $pushTarget) { target in
            WatchView(videoID: target.id)
        }
        .onAppear { UIDevice.current.beginGeneratingDeviceOrientationNotifications() }
        .onDisappear {
            saveVideoProgress()
            UIDevice.current.endGeneratingDeviceOrientationNotifications()
        }
        .onChange(of: currentTime) { _, newTime in
            saveVideoProgressIfNeeded(newTime)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            handleDeviceRotation()
        }
        .overlay {
            if let context = selectedLookup {
                WordPopupView(context: context, onDismiss: {
                    selectedLookup = nil
                    pausedForLookup = false
                })
                    .environmentObject(session)
            }
        }
    }

    private func handleDeviceRotation() {
        guard video != nil else { return }
        let orientation = UIDevice.current.orientation
        if orientation.isLandscape && !fullscreenPresented {
            enterLandscape()
        } else if orientation.isPortrait && fullscreenPresented {
            leaveLandscape()
        }
    }

    @ViewBuilder
    private func content(for video: VideoDetail) -> some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                if !fullscreenPresented {
                    Text(video.title)
                        .font(.title3.weight(.bold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                        .padding(.bottom, 12)
                }

                player(for: video, in: geometry.size)

                if fullscreenPresented {
                    LandscapeSubtitlePanel(
                        track: captionTrack,
                        timeMilliseconds: Int((currentTime * 1000).rounded()),
                        captionError: captionTrackError,
                        hasFallback: !(video.transcript ?? []).isEmpty,
                        selectedLookup: $selectedLookup,
                        onWordTap: { pausedForLookup = true },
                        contentBottomInset: 14
                    )
                    .frame(maxWidth: .infinity)
                    .frame(height: landscapeSubtitleStripHeight)
                    .clipped()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .accessibilityIdentifier("landscape-subtitle-panel")
                } else {
                    portraitBody(video)
                }
            }
            .background(fullscreenPresented ? Color.black : Color.clear)
        }
        .ignoresSafeArea(edges: fullscreenPresented ? .all : [])
        .onDisappear {
            if fullscreenPresented {
                OrientationController.leaveLandscape()
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if fullscreenPresented {
                Text(String(format: "%.1f", currentTime))
                    .font(.system(size: 1))
                    .opacity(0.01)
                    .accessibilityIdentifier("landscape-player-time")
                    .accessibilityValue(String(format: "%.1f", currentTime))
            }
        }
    }

    @ViewBuilder
    private func player(for video: VideoDetail, in size: CGSize) -> some View {
        YouTubePlayerView(
            youtubeID: video.youtubeId,
            currentTime: $currentTime,
            seekTime: $seekTime,
            pausedForLookup: $pausedForLookup,
            isPlaying: $inlineIsPlaying,
            playAfterInitialSeek: playAfterInitialSeek
        )
        .frame(height: fullscreenPresented ? landscapePlayerHeight(for: size) : 240)
        .clipShape(RoundedRectangle(cornerRadius: fullscreenPresented ? 0 : 24))
        .overlay(alignment: fullscreenPresented ? .topLeading : .topTrailing) {
            Button {
                fullscreenPresented ? leaveLandscape() : enterLandscape()
            } label: {
                Image(systemName: fullscreenPresented ? "chevron.down" : "arrow.up.left.and.arrow.down.right")
                    .font(.system(size: fullscreenPresented ? 17 : 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(fullscreenPresented ? 10 : 8)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .accessibilityLabel(fullscreenPresented ? "Close landscape player" : "Open landscape player")
            .padding(fullscreenPresented ? 12 : 10)
        }
        .accessibilityIdentifier(fullscreenPresented ? "landscape-video-player" : "inline-video-player")
    }

    /// Portrait layout below the persistent player.
    @ViewBuilder
    private func portraitBody(_ video: VideoDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                portraitCaptionPanel(video)

                recommendationsSection(video)
            }
            .padding(.top, 12)
            .padding(.bottom, 12)
        }
    }

    @ViewBuilder
    private func portraitCaptionPanel(_ video: VideoDetail) -> some View {
        if clientFetching || video.transcriptStatus == "processing" {
            LoadingStateView(title: "Fetching captions...")
                .frame(height: 180)
        } else if captionTrack.cues.isEmpty && (video.transcript ?? []).isEmpty {
            EmptyStateView(
                title: "Transcript unavailable",
                subtitle: video.transcriptError ?? video.transcriptLastError ?? "This video does not have a ready transcript yet."
            )
        } else {
            PortraitSubtitlePanel(
                track: captionTrack,
                timeMilliseconds: Int((currentTime * 1000).rounded()),
                captionError: captionTrackError,
                hasFallback: !(video.transcript ?? []).isEmpty,
                selectedLookup: $selectedLookup,
                onWordTap: { pausedForLookup = true }
            )
            .frame(height: 84, alignment: .bottom)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .padding(.horizontal)
            .accessibilityIdentifier("portrait-subtitle-panel")
        }
    }

    @ViewBuilder
    private func recommendationsSection(_ video: VideoDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            channelLink(for: video)

            if !related.isEmpty {
                SectionHeader("Recommended")
                    .padding(.horizontal)

                LazyVStack(spacing: 14) {
                    ForEach(related) { item in
                        Button {
                            Task { await openRecommended(item) }
                        } label: {
                            RecommendedVideoRow(video: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    @ViewBuilder
    private func channelLink(for video: VideoDetail) -> some View {
        let name = relatedChannelName ?? video.channel
        HStack(spacing: 10) {
            if let selectedChannel {
                NavigationLink {
                    ChannelDetailView(handle: selectedChannel.handle, title: selectedChannel.name)
                } label: {
                    channelLinkLabel(name, avatarURL: relatedChannelAvatarURL, accessory: "chevron.right")
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("watch-channel-link")
            } else {
                channelLinkLabel(name, avatarURL: relatedChannelAvatarURL, accessory: nil)
            }

            if let selectedChannel {
                Button {
                    Task {
                        await setChannelSubscription(
                            selectedChannel,
                            subscribed: !(selectedChannel.subscribed ?? false)
                        )
                    }
                } label: {
                    Text((selectedChannel.subscribed ?? false) ? "Unsubscribe" : "Subscribe")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle((selectedChannel.subscribed ?? false) ? Color.secondary : Color.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            (selectedChannel.subscribed ?? false) ? .white.opacity(0.12) : Color.accentColor,
                            in: Capsule()
                        )
                }
                .buttonStyle(.plain)
                .disabled(subscriptionUpdating)
                .accessibilityIdentifier("watch-channel-subscribe")
            }
        }
        .padding(.trailing)
    }

    private func channelLinkLabel(_ name: String, avatarURL: String?, accessory: String?) -> some View {
        HStack(spacing: 10) {
            AsyncImage(url: avatarURL.flatMap(URL.init(string:))) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Image(systemName: "person.crop.circle.fill")
                    .resizable()
                    .foregroundStyle(.secondary)
            }
            .frame(width: 36, height: 36)
            .clipShape(Circle())
            Text(name)
                .font(.headline)
                .lineLimit(1)
            Spacer(minLength: 0)
            if let accessory {
                Image(systemName: accessory)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal)
        .contentShape(Rectangle())
    }

    private func setChannelSubscription(_ channel: ChannelSummary, subscribed: Bool) async {
        guard !subscriptionUpdating else { return }
        guard let targetLanguage = session.user?.targetLanguage else { return }
        subscriptionUpdating = true
        defer { subscriptionUpdating = false }

        do {
            _ = try await APIClient.shared.setChannelSubscription(
                handle: channel.handle,
                lang: targetLanguage,
                subscribed: subscribed
            )
            selectedChannel = ChannelSummary(
                name: channel.name,
                handle: channel.handle,
                channelId: channel.channelId,
                thumbnails: channel.thumbnails,
                subscribed: subscribed
            )
            NotificationCenter.default.post(name: .channelSubscriptionsDidChange, object: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func channelForWatchRow(
        matched: ChannelSummary?,
        content: RelatedContent,
        video: VideoDetail
    ) async throws -> ChannelSummary? {
        guard let targetLanguage = session.user?.targetLanguage else { return matched }
        let fallback = fallbackChannel(content: content, video: video)
        guard let channel = matched ?? fallback else { return nil }
        return try await APIClient.shared.channelSubscription(handle: channel.handle, lang: targetLanguage)
    }

    private func fallbackChannel(content: RelatedContent, video: VideoDetail) -> ChannelSummary? {
        let channelId = content.channelID?.trimmingCharacters(in: .whitespacesAndNewlines)
        let handle = channelId?.isEmpty == false
            ? channelId
            : content.channelHandle?
                .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let handle, !handle.isEmpty else { return nil }

        return ChannelSummary(
            name: content.channelName ?? video.channel,
            handle: handle,
            channelId: channelId?.isEmpty == false ? channelId! : handle,
            thumbnails: content.channelAvatarURL.map { [$0] } ?? [],
            subscribed: false
        )
    }

    private func landscapePlayerHeight(for size: CGSize) -> CGFloat {
        // Fit the video above the fixed-height subtitle strip within the
        // available landscape height (video may end up slightly shorter than 16:9).
        min(size.width * 9 / 16, size.height - landscapeSubtitleStripHeight)
    }

    private func loadCaptionsAndRelated(for video: VideoDetail) async {
        captionTrack = .fallback(segments: video.transcript ?? [])

        async let captionsResult = TranscriptWorkerClient.fetchTimedCaptions(
            youtubeId: video.youtubeId,
            lang: video.language
        )
        async let relatedResult = TranscriptWorkerClient.fetchRelatedVideos(youtubeId: video.youtubeId)
        async let channelsResult = APIClient.shared.channels(
            lang: session.user?.targetLanguage ?? video.language
        )

        do {
            captionTrack = try await captionsResult
            captionTrackError = nil
        } catch {
            captionTrackError = error.localizedDescription
        }

        do {
            let content = try await relatedResult
            related = content.videos
            relatedChannelName = content.channelName
            relatedChannelHandle = content.channelHandle
            relatedChannelID = content.channelID
            relatedChannelAvatarURL = content.channelAvatarURL

            do {
                let channels = try await channelsResult
                let matchedChannel = matchingChannel(
                    in: channels,
                    id: content.channelID,
                    handle: content.channelHandle,
                    name: content.channelName ?? video.channel
                )
                selectedChannel = try await channelForWatchRow(
                    matched: matchedChannel,
                    content: content,
                    video: video
                )
            } catch {
                print("[Polycast] Channel lookup failed: \(error)")
                selectedChannel = fallbackChannel(content: content, video: video)
            }
        } catch {
            print("[Polycast] Related videos fetch failed: \(error)")
            _ = try? await channelsResult
        }
    }

    private func openRecommended(_ item: TrendingVideo) async {
        guard let targetLanguage = session.user?.targetLanguage else { return }
        saveVideoProgress()
        do {
            let detail = try await APIClient.shared.addVideo(
                youtubeID: item.youtubeId,
                language: targetLanguage
            )
            pushTarget = WatchTarget(id: detail.id)
        } catch {
            print("[Polycast] Failed to open recommended video: \(error)")
        }
    }

    private func enterLandscape() {
        fullscreenPresented = true
        OrientationController.enterLandscape()
    }

    private func leaveLandscape() {
        fullscreenPresented = false
        OrientationController.leaveLandscape()
    }

    private func load() async {
        loading = true
        do {
            let detail = try await APIClient.shared.videoDetail(id: videoID)
            video = detail
            restoreVideoProgressIfNeeded(for: detail)

            let hasTranscript = detail.transcript != nil && !(detail.transcript ?? []).isEmpty
            if !hasTranscript && detail.transcriptStatus != "ready" {
                clientFetching = true
                do {
                    let segments = try await TranscriptWorkerClient.fetchTranscript(
                        youtubeId: detail.youtubeId,
                        lang: detail.language
                    )
                    nonisolated(unsafe) let segmentsPayload: [[String: Any]] = segments.map { seg in
                        ["text": seg.text, "offset": seg.offset, "duration": seg.duration]
                    }
                    let updated = try await APIClient.shared.uploadTranscript(
                        videoId: videoID,
                        segments: segmentsPayload
                    )
                    video = updated
                } catch {
                    print("[Polycast] Client-side transcript fetch failed: \(error)")
                }
                clientFetching = false
            }
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func restoreVideoProgressIfNeeded(for detail: VideoDetail) {
        guard currentTime <= 0 else { return }
        let savedTime = VideoProgressStore.savedTime(forYoutubeID: detail.youtubeId)
        guard savedTime > 0 else { return }
        currentTime = savedTime
        seekTime = savedTime
    }

    private func saveVideoProgressIfNeeded(_ time: Double) {
        let now = Date().timeIntervalSince1970
        guard now - lastProgressSaveAt >= 5 else { return }
        lastProgressSaveAt = now
        saveVideoProgress(at: time)
    }

    private func saveVideoProgress() {
        saveVideoProgress(at: currentTime)
    }

    private func saveVideoProgress(at time: Double) {
        guard let video else { return }
        VideoProgressStore.save(
            youtubeID: video.youtubeId,
            seconds: time,
            durationSeconds: video.durationSeconds.map(Double.init)
        )
    }

}

func matchingChannel(
    in channels: [ChannelSummary],
    id: String?,
    handle: String?,
    name: String?
) -> ChannelSummary? {
    let normalizedHandle = handle?
        .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        .lowercased()
    let normalizedName = name?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

    return channels.first { channel in
        if let id, channel.channelId.caseInsensitiveCompare(id) == .orderedSame { return true }
        if let normalizedHandle, channel.handle.lowercased() == normalizedHandle { return true }
        if let normalizedName, channel.name.lowercased() == normalizedName { return true }
        return false
    }
}

private struct RecommendedVideoRow: View {
    let video: TrendingVideo

    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottom) {
                AsyncImage(url: URL(string: video.thumbnail)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Rectangle().fill(.white.opacity(0.08))
                }
                .frame(width: 140, height: 79)
                .clipped()

                PlaybackProgressBar(
                    fraction: VideoProgressStore.progressFraction(
                        forYoutubeID: video.youtubeId,
                        durationSeconds: video.durationSeconds
                    )
                )
            }
            .frame(width: 140, height: 79)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                Text(video.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(video.channel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

enum VideoProgressStore {
    struct Progress: Codable {
        let seconds: Double
        let durationSeconds: Double?
        let updatedAt: TimeInterval
    }

    private static let keyPrefix = "polycast.videoProgress."
    private static let minimumSavedSeconds: Double = 5
    private static let finishedThresholdSeconds: Double = 10

    static func savedTime(forYoutubeID youtubeID: String) -> Double {
        guard let progress = progress(forYoutubeID: youtubeID) else { return 0 }
        return progress.seconds
    }

    static func progressFraction(forYoutubeID youtubeID: String, durationSeconds: Int?) -> Double? {
        guard let progress = progress(forYoutubeID: youtubeID), progress.seconds >= minimumSavedSeconds else {
            return nil
        }
        let duration = progress.durationSeconds ?? durationSeconds.map(Double.init)
        guard let duration, duration > 0 else { return nil }
        let remaining = duration - progress.seconds
        guard remaining > finishedThresholdSeconds else { return nil }
        return min(max(progress.seconds / duration, 0), 1)
    }

    static func save(youtubeID: String, seconds: Double, durationSeconds: Double?) {
        let normalizedID = youtubeID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedID.isEmpty else { return }

        if seconds < minimumSavedSeconds {
            clear(youtubeID: normalizedID)
            return
        }

        if let durationSeconds, durationSeconds > 0, durationSeconds - seconds <= finishedThresholdSeconds {
            clear(youtubeID: normalizedID)
            return
        }

        let progress = Progress(
            seconds: max(0, seconds),
            durationSeconds: durationSeconds,
            updatedAt: Date().timeIntervalSince1970
        )
        guard let data = try? JSONEncoder().encode(progress) else { return }
        UserDefaults.standard.set(data, forKey: key(forYoutubeID: normalizedID))
    }

    static func clear(youtubeID: String) {
        let normalizedID = youtubeID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedID.isEmpty else { return }
        UserDefaults.standard.removeObject(forKey: key(forYoutubeID: normalizedID))
    }

    private static func progress(forYoutubeID youtubeID: String) -> Progress? {
        let normalizedID = youtubeID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedID.isEmpty else { return nil }
        guard let data = UserDefaults.standard.data(forKey: key(forYoutubeID: normalizedID)) else {
            return nil
        }
        return try? JSONDecoder().decode(Progress.self, from: data)
    }

    private static func key(forYoutubeID youtubeID: String) -> String {
        "\(keyPrefix)\(youtubeID)"
    }
}

struct YouTubePlayerView: UIViewRepresentable {
    let youtubeID: String
    @Binding var currentTime: Double
    @Binding var seekTime: Double?
    @Binding var pausedForLookup: Bool
    @Binding var isPlaying: Bool
    let playAfterInitialSeek: Bool?

    init(
        youtubeID: String,
        currentTime: Binding<Double>,
        seekTime: Binding<Double?>,
        pausedForLookup: Binding<Bool>,
        isPlaying: Binding<Bool>,
        playAfterInitialSeek: Bool? = nil
    ) {
        self.youtubeID = youtubeID
        _currentTime = currentTime
        _seekTime = seekTime
        _pausedForLookup = pausedForLookup
        _isPlaying = isPlaying
        self.playAfterInitialSeek = playAfterInitialSeek
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "playerState")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.accessibilityIdentifier = "youtube-player-webview"
        webView.accessibilityLabel = "YouTube player"
        webView.accessibilityValue = UUID().uuidString
        webView.loadHTMLString(html(videoID: youtubeID), baseURL: AppConfig.baseURL)
        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if let seekTime, context.coordinator.ready {
            context.coordinator.seek(to: seekTime, playAfterSeek: playAfterInitialSeek)
            DispatchQueue.main.async {
                self.seekTime = nil
            }
        }

        if pausedForLookup != context.coordinator.isPaused, context.coordinator.ready {
            context.coordinator.isPaused = pausedForLookup
            if pausedForLookup {
                webView.evaluateJavaScript("if (player && player.pauseVideo) player.pauseVideo();")
            } else {
                webView.evaluateJavaScript("if (player && player.playVideo) player.playVideo();")
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            currentTime: $currentTime,
            seekTime: $seekTime,
            pausedForLookup: $pausedForLookup,
            isPlaying: $isPlaying,
            playAfterInitialSeek: playAfterInitialSeek
        )
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        @Binding var currentTime: Double
        @Binding var seekTime: Double?
        @Binding var pausedForLookup: Bool
        @Binding var isPlaying: Bool
        let playAfterInitialSeek: Bool?
        weak var webView: WKWebView?
        var isPaused = false
        var ready = false

        init(
            currentTime: Binding<Double>,
            seekTime: Binding<Double?>,
            pausedForLookup: Binding<Bool>,
            isPlaying: Binding<Bool>,
            playAfterInitialSeek: Bool?
        ) {
            _currentTime = currentTime
            _seekTime = seekTime
            _pausedForLookup = pausedForLookup
            _isPlaying = isPlaying
            self.playAfterInitialSeek = playAfterInitialSeek
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "playerState", let body = message.body as? [String: Any] else { return }
            let time = (body["time"] as? NSNumber)?.doubleValue ?? 0
            let state = (body["state"] as? NSNumber)?.intValue ?? -1
            let isReady = (body["ready"] as? NSNumber)?.boolValue ?? false
            DispatchQueue.main.async {
                self.ready = self.ready || isReady
                self.currentTime = time
                if state == 1 {
                    self.isPlaying = true
                    self.pausedForLookup = false
                    self.isPaused = false
                } else if state == 2 || state == 0 {
                    self.isPlaying = false
                }
                if isReady, let seekTime = self.seekTime {
                    self.seek(to: seekTime, playAfterSeek: self.playAfterInitialSeek)
                    self.seekTime = nil
                }
            }
        }

        func seek(to seconds: Double, playAfterSeek: Bool?) {
            let playValue = playAfterSeek.map { $0 ? "true" : "false" } ?? "null"
            webView?.evaluateJavaScript(
                "seekToSeconds(\(String(format: "%.2f", seconds)), \(playValue));"
            )
        }
    }

    private func html(videoID: String) -> String {
        """
        <!doctype html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
          <style>
            html, body { margin:0; padding:0; background:#000; overflow:hidden; width:100%; height:100%; }
            #player { position:absolute; inset:0; }
            #player iframe { width:100% !important; height:100% !important; }
          </style>
        </head>
        <body>
          <div id="player"></div>
          <script src="https://www.youtube.com/iframe_api"></script>
          <script>
            let player;
            function onYouTubeIframeAPIReady() {
              player = new YT.Player('player', {
                width: '100%',
                height: '100%',
                videoId: '\(videoID)',
                playerVars: {
                  playsinline: 1,
                  rel: 0,
                  origin: '\(AppConfig.baseURL.absoluteString)'
                },
                events: {
                  onReady: () => {
                    window.webkit.messageHandlers.playerState.postMessage({
                      time: player.getCurrentTime(),
                      state: player.getPlayerState ? player.getPlayerState() : -1,
                      ready: true
                    });
                    setInterval(() => {
                      if (player && player.getCurrentTime) {
                        window.webkit.messageHandlers.playerState.postMessage({
                          time: player.getCurrentTime(),
                          state: player.getPlayerState ? player.getPlayerState() : -1,
                          ready: false
                        });
                      }
                    }, 250);
                  },
                  onStateChange: () => {
                    window.webkit.messageHandlers.playerState.postMessage({
                      time: player.getCurrentTime(),
                      state: player.getPlayerState()
                    });
                  }
                }
              });
            }
            function seekToSeconds(value, shouldPlay) {
              if (player && player.seekTo) {
                player.seekTo(value, true);
                if (shouldPlay === true) player.playVideo();
                if (shouldPlay === false) player.pauseVideo();
              }
            }
          </script>
        </body>
        </html>
        """
    }
}
