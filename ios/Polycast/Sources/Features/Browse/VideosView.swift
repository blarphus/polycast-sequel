import SwiftUI

extension Notification.Name {
    static let channelSubscriptionsDidChange = Notification.Name("Polycast.channelSubscriptionsDidChange")
}

private enum VideosTopTab: String, CaseIterable {
    case subscriptions = "Subscriptions"
    case shorts = "Shorts"
    case channels = "Channels"
}

private enum VideoSearchResultItem: Identifiable {
    case channel(ChannelSummary, Int)
    case video(TrendingVideo, Int)

    var id: String {
        switch self {
        case .channel(let channel, _):
            return "channel-\(channel.channelId.isEmpty ? channel.handle : channel.channelId)"
        case .video(let video, _):
            return "video-\(video.youtubeId)"
        }
    }

    var rank: Int {
        switch self {
        case .channel(_, let rank), .video(_, let rank):
            return rank
        }
    }
}

/// Videos tab: browse curated target-language YouTube channels (tap a channel
/// to see all its videos), or search for a specific video. Replaces the old
/// trending feed.
struct VideosView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var selectedTab: VideosTopTab = .subscriptions
    @State private var query = ""
    @State private var activeQuery = ""
    @State private var channels: [ChannelSummary] = []
    @State private var highlights: [TrendingVideo] = []
    @State private var subscriptionVideos: [TrendingVideo] = []
    @State private var searchChannels: [ChannelSummary] = []
    @State private var searchResults: [TrendingVideo] = []
    @State private var loading = false
    @State private var subscriptionsLoading = true
    @State private var error = ""
    @State private var watchTarget: WatchTarget?
    @State private var shortsPresented = false

    private let grid = [
        GridItem(.flexible(), spacing: 12, alignment: .top),
        GridItem(.flexible(), spacing: 12, alignment: .top),
    ]

    private var rankedSearchItems: [VideoSearchResultItem] {
        let foldedQuery = activeQuery.trimmingCharacters(in: .whitespacesAndNewlines).searchFolded()
        guard !foldedQuery.isEmpty else { return [] }
        let localMatches = channels.filter { channel in
            channel.name.searchFolded().contains(foldedQuery) ||
                channel.handle.searchFolded().contains(foldedQuery) ||
                "@\(channel.handle)".searchFolded().contains(foldedQuery)
        }
        var seenChannels = Set<String>()
        let channelItems = (searchChannels + localMatches).enumerated().compactMap { index, channel -> VideoSearchResultItem? in
            let key = channel.channelId.isEmpty ? channel.handle : channel.channelId
            guard seenChannels.insert(key.searchFolded()).inserted else { return nil }
            return .channel(channel, channel.searchRank ?? 10_000 + index)
        }
        let videoItems = searchResults.enumerated().map { index, video in
            VideoSearchResultItem.video(video, video.searchRank ?? 20_000 + index)
        }
        return (channelItems + videoItems).sorted { lhs, rhs in
            if lhs.rank != rhs.rank { return lhs.rank < rhs.rank }
            return lhs.id < rhs.id
        }
    }

    private var subscribedChannels: [ChannelSummary] {
        channels.filter { $0.subscribed ?? false }
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                searchBar

                Picker("Videos", selection: $selectedTab) {
                    ForEach(VideosTopTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(.horizontal)
            .padding(.top)

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                if loading {
                    LoadingStateView(title: activeQuery.isEmpty ? "Loading channels…" : "Searching…")
                        .frame(height: 220)
                } else if !error.isEmpty {
                    EmptyStateView(title: "Could not load videos.", subtitle: error)
                } else {
                    switch selectedTab {
                    case .channels:
                        if activeQuery.isEmpty {
                            channelGrid
                        } else {
                            resultsGrid
                        }
                    case .shorts:
                        EmptyView()
                    case .subscriptions:
                        subscriptionsGrid
                    }
                }
            }
            .padding()
            }
        }
        .background(Color.clear)
        .texturedBackground()
        .navigationTitle("Videos")
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            if selectedTab == .subscriptions {
                await loadSubscriptions()
            } else if channels.isEmpty {
                await loadChannels()
            }
        }
        .onChange(of: selectedTab) { _, tab in
            if tab == .subscriptions {
                clearSearch()
                if subscriptionVideos.isEmpty {
                    Task { await loadSubscriptions() }
                }
            } else if tab == .shorts {
                clearSearch()
                shortsPresented = true
                selectedTab = .subscriptions
            } else if tab == .channels, channels.isEmpty {
                Task { await loadChannels() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .channelSubscriptionsDidChange)) { _ in
            Task { await refreshSubscriptionsAndChannels() }
        }
        .fullScreenCover(item: $watchTarget) { target in
            NavigationStack {
                WatchView(videoID: target.id)
            }
        }
        .fullScreenCover(isPresented: $shortsPresented) {
            NavigationStack {
                ShortsFeedView(isStandalone: true)
                    .environmentObject(session)
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.headline)
                .foregroundStyle(.secondary)

            TextField("Search videos and channels", text: $query)
                .submitLabel(.search)
                .onSubmit { Task { await search() } }

            Button {
                Task { await search() }
            } label: {
                Text("Go")
                    .font(.headline.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(12)
        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(.white.opacity(0.12), lineWidth: 1)
        )
    }

    @ViewBuilder
    private var highlightsCarousel: some View {
        if !highlights.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader("Popular Now")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) {
                        ForEach(highlights) { video in
                            Button {
                                Task { await launch(video: video) }
                            } label: {
                                CompactVideoCard(video: video, showsChannel: true)
                                    .frame(width: 240, alignment: .leading)
                                    .clipped()
                            }
                            .frame(width: 240, alignment: .leading)
                            .clipped()
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private var channelGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            highlightsCarousel

            SectionHeader("Channels")
            if subscribedChannels.isEmpty {
                EmptyStateView(title: "No subscribed channels yet.", subtitle: "Search for a channel and subscribe to add it here.")
            } else {
                LazyVGrid(columns: grid, spacing: 16) {
                    ForEach(subscribedChannels) { channel in
                        NavigationLink {
                            ChannelDetailView(handle: channel.handle, title: channel.name)
                        } label: {
                            ChannelCard(channel: channel)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var resultsGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Button {
                    clearSearch()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.headline.weight(.semibold))
                        .frame(width: 34, height: 34)
                        .background(.white.opacity(0.10), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back to channels")

                SectionHeader("Results for \"\(activeQuery)\"")
            }

            LazyVGrid(columns: grid, spacing: 16) {
                ForEach(rankedSearchItems) { item in
                    switch item {
                    case .channel(let channel, _):
                        NavigationLink {
                            ChannelDetailView(handle: channel.handle, title: channel.name)
                        } label: {
                            SearchChannelCard(channel: channel)
                        }
                        .buttonStyle(.plain)
                    case .video(let video, _):
                        Button {
                            Task { await launch(video: video) }
                        } label: {
                            CompactVideoCard(video: video, showsChannel: true)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var subscriptionsGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Subscriptions")

            if subscriptionsLoading {
                LoadingStateView(title: "Loading subscriptions…")
                    .frame(height: 220)
            } else if subscriptionVideos.isEmpty {
                EmptyStateView(title: "No subscription videos yet.", subtitle: "Subscribe to channels to build this feed.")
            } else {
                LazyVGrid(columns: grid, spacing: 16) {
                    ForEach(subscriptionVideos) { video in
                        Button {
                            Task { await launch(video: video) }
                        } label: {
                            CompactVideoCard(video: video, showsChannel: true)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func loadChannels() async {
        guard let targetLanguage = session.user?.targetLanguage else {
            loading = false
            return
        }
        loading = true
        error = ""
        async let channelValue = APIClient.shared.channels(lang: targetLanguage)
        async let highlightValue = APIClient.shared.channelHighlights(lang: targetLanguage)
        do {
            channels = try await channelValue
            activeQuery = ""
        } catch {
            self.error = error.localizedDescription
        }
        // The carousel is a nice-to-have; surface its failure in the log but
        // don't block the channel list on it.
        do {
            highlights = await removingUnplayableAndShorts(from: try await highlightValue)
        } catch {
            print("[Polycast] Highlights load failed: \(error)")
        }
        loading = false
    }

    private func clearSearch() {
        query = ""
        activeQuery = ""
        searchChannels = []
        searchResults = []
    }

    private func loadSubscriptions() async {
        guard let targetLanguage = session.user?.targetLanguage else { return }
        subscriptionsLoading = true
        error = ""
        do {
            let videos = try await APIClient.shared.subscriptionVideos(lang: targetLanguage)
            subscriptionVideos = await removingUnplayableAndShorts(from: videos)
        } catch {
            self.error = error.localizedDescription
        }
        subscriptionsLoading = false
    }

    private func refreshSubscriptionsAndChannels() async {
        guard let targetLanguage = session.user?.targetLanguage else { return }
        do {
            channels = try await APIClient.shared.channels(lang: targetLanguage)
        } catch {
            print("[Polycast] Channel subscription refresh failed: \(error)")
        }
        subscriptionVideos = []
        await loadSubscriptions()
    }

    private func setSubscription(for channel: ChannelSummary, subscribed: Bool) async {
        guard let targetLanguage = session.user?.targetLanguage else { return }
        do {
            _ = try await APIClient.shared.setChannelSubscription(
                handle: channel.handle,
                lang: targetLanguage,
                subscribed: subscribed
            )
            channels = channels.map { existing in
                guard existing.handle == channel.handle else { return existing }
                return ChannelSummary(
                    name: existing.name,
                    handle: existing.handle,
                    channelId: existing.channelId,
                    thumbnails: existing.thumbnails,
                    subscribed: subscribed
                )
            }
            subscriptionVideos = []
            NotificationCenter.default.post(name: .channelSubscriptionsDidChange, object: nil)
            if selectedTab == .subscriptions {
                await loadSubscriptions()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func search() async {
        guard let targetLanguage = session.user?.targetLanguage else { return }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            searchChannels = []
            await loadChannels()
            return
        }
        selectedTab = .channels
        loading = true
        error = ""
        do {
            if channels.isEmpty {
                do {
                    channels = try await APIClient.shared.channels(lang: targetLanguage)
                } catch {
                    print("[Polycast] Channel search hydrate failed: \(error)")
                }
            }
            let results = try await APIClient.shared.searchVideosAndChannels(query: trimmed, lang: targetLanguage)
            searchChannels = results.channels
            searchResults = results.videos
            activeQuery = trimmed
            await filterUnplayable()
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func filterUnplayable() async {
        searchResults = await removingUnplayableAndShorts(from: searchResults)
    }

    private func removingUnplayableAndShorts(from videos: [TrendingVideo]) async -> [TrendingVideo] {
        let ids = videos.map(\.youtubeId)
        guard !ids.isEmpty else { return videos }
        do {
            let result = try await TranscriptWorkerClient.checkPlayability(videoIds: ids)
            if !result.blocked.isEmpty || !result.shorts.isEmpty {
                return videos.filter { video in
                    !result.blocked.contains(video.youtubeId) && !result.shorts.contains(video.youtubeId)
                }
            }
        } catch {
            print("[Polycast] Playability filter failed: \(error)")
        }
        return videos
    }

    private func launch(video: TrendingVideo) async {
        guard let targetLanguage = session.user?.targetLanguage else { return }
        do {
            let detail = try await APIClient.shared.addVideo(youtubeID: video.youtubeId, language: targetLanguage)
            watchTarget = WatchTarget(id: detail.id)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private enum ShortsReaction: String {
    case liked
    case disliked
}

private enum ShortsPreferenceStore {
    private static let key = "polycast.shorts.preferences"

    static func load() -> [String: Double] {
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let values = try? JSONDecoder().decode([String: Double].self, from: data)
        else { return [:] }
        return values
    }

    static func save(_ values: [String: Double]) {
        guard let data = try? JSONEncoder().encode(values) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}

private struct ShortsFeedView: View {
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss

    let isStandalone: Bool

    @State private var videos: [TrendingVideo] = []
    @State private var activeVideoID: String?
    @State private var nextCursor: String?
    @State private var exhausted = false
    @State private var loading = true
    @State private var loadingMore = false
    @State private var error = ""
    @State private var feedPreferences = ShortsPreferenceStore.load()
    @State private var reactions: [String: ShortsReaction] = [:]

    private var activeIndex: Int? {
        guard let activeVideoID else { return nil }
        return videos.firstIndex { $0.youtubeId == activeVideoID }
    }

    var body: some View {
        Group {
            if loading && videos.isEmpty {
                LoadingStateView(title: "Loading shorts...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if videos.isEmpty {
                EmptyStateView(
                    title: error.isEmpty ? "No shorts found." : "Could not load shorts.",
                    subtitle: error.isEmpty ? "Subscribe to channels or try again later." : error
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                GeometryReader { geometry in
                    ScrollView(.vertical) {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(videos.enumerated()), id: \.element.youtubeId) { index, video in
                                let isActive = activeVideoID == video.youtubeId
                                let isPreloaded = isActive || activeIndex.map { index == $0 + 1 } == true
                                ShortsPlayerPage(
                                    video: video,
                                    isActive: isActive,
                                    isPreloaded: isPreloaded,
                                    reaction: reactions[video.youtubeId],
                                    viewportSize: geometry.size,
                                    onUnavailable: { remove(video) },
                                    onReaction: { reaction in handleReaction(reaction, for: video) }
                                )
                                .id(video.youtubeId)
                                .containerRelativeFrame(.vertical)
                            }

                            if loadingMore {
                                LoadingStateView(title: "Loading more...")
                                    .containerRelativeFrame(.vertical)
                            }
                        }
                        .scrollTargetLayout()
                    }
                    .scrollIndicators(.hidden)
                    .scrollTargetBehavior(.paging)
                    .scrollPosition(id: $activeVideoID)
                    .onChange(of: activeVideoID) { _, newValue in
                        guard let newValue else { return }
                        maybeLoadMore(near: newValue)
                    }
                }
            }
        }
        .background(Color.clear)
        .texturedBackground()
        .navigationTitle(isStandalone ? "Shorts" : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            if isStandalone {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.headline.weight(.semibold))
                            .frame(width: 36, height: 36)
                            .background(.white.opacity(0.10), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Back")
                }
            }
        }
        .task {
            guard videos.isEmpty else { return }
            await reload()
        }
        .onReceive(NotificationCenter.default.publisher(for: .channelSubscriptionsDidChange)) { _ in
            Task { await reload() }
        }
    }

    private func reload() async {
        videos = []
        activeVideoID = nil
        nextCursor = nil
        exhausted = false
        feedPreferences = ShortsPreferenceStore.load()
        reactions = [:]
        loading = true
        error = ""
        await loadMorePages(maxAttempts: 3)
        loading = false
    }

    private func maybeLoadMore(near videoID: String) {
        guard !loadingMore, !exhausted else { return }
        guard let index = videos.firstIndex(where: { $0.youtubeId == videoID }) else { return }
        if videos.distance(from: index, to: videos.endIndex) <= 4 {
            Task { await loadMorePages(maxAttempts: 2) }
        }
    }

    private func loadMorePages(maxAttempts: Int) async {
        guard !loadingMore, !exhausted else { return }
        guard let targetLanguage = session.user?.targetLanguage else {
            error = "No target language is set."
            return
        }

        loadingMore = true
        defer { loadingMore = false }

        for _ in 0..<maxAttempts {
            do {
                let response = try await APIClient.shared.shortsFeed(lang: targetLanguage, cursor: nextCursor)
                nextCursor = response.nextCursor
                if response.nextCursor == nil { exhausted = true }

                let playable = await keepingPlayableShorts(from: response.videos)
                appendUnique(playable)

                if !playable.isEmpty || exhausted { break }
            } catch {
                self.error = error.localizedDescription
                exhausted = true
                break
            }
        }
    }

    private func keepingPlayableShorts(from candidates: [TrendingVideo]) async -> [TrendingVideo] {
        let ids = candidates.map(\.youtubeId)
        guard !ids.isEmpty else { return [] }
        do {
            let result = try await TranscriptWorkerClient.checkPlayability(videoIds: ids)
            return candidates.filter { video in
                result.shorts.contains(video.youtubeId) && !result.blocked.contains(video.youtubeId)
            }
        } catch {
            print("[Polycast] Shorts playability filter failed: \(error)")
            return []
        }
    }

    private func appendUnique(_ newVideos: [TrendingVideo]) {
        guard !newVideos.isEmpty else { return }
        let existing = Set(videos.map(\.youtubeId))
        let unique = newVideos.filter { !existing.contains($0.youtubeId) }
        videos.append(contentsOf: rankedVideos(unique))
        if activeVideoID == nil {
            activeVideoID = videos.first?.youtubeId
        }
    }

    private func remove(_ video: TrendingVideo) {
        guard let index = videos.firstIndex(where: { $0.youtubeId == video.youtubeId }) else { return }
        let wasActive = activeVideoID == video.youtubeId
        videos.remove(at: index)
        if wasActive {
            activeVideoID = videos.indices.contains(index)
                ? videos[index].youtubeId
                : videos.last?.youtubeId
        }
        if videos.count < 4, !exhausted {
            Task { await loadMorePages(maxAttempts: 2) }
        }
    }

    private func handleReaction(_ reaction: ShortsReaction, for video: TrendingVideo) {
        let previous = reactions[video.youtubeId]
        if previous == reaction {
            reactions.removeValue(forKey: video.youtubeId)
            applyPreferenceDelta(reaction == .liked ? -10 : 10, for: video)
        } else {
            if previous == .liked {
                applyPreferenceDelta(-10, for: video)
            } else if previous == .disliked {
                applyPreferenceDelta(10, for: video)
            }
            reactions[video.youtubeId] = reaction
            applyPreferenceDelta(reaction == .liked ? 10 : -10, for: video)
        }
        ShortsPreferenceStore.save(feedPreferences)
        rerankUpcomingVideos(after: video)
    }

    private func applyPreferenceDelta(_ delta: Double, for video: TrendingVideo) {
        for key in preferenceKeys(for: video) {
            let multiplier: Double
            if key.hasPrefix("niche:") {
                multiplier = 1.2
            } else if key.hasPrefix("creator:") {
                multiplier = 0.7
            } else {
                multiplier = 1
            }
            let next = min(100, max(-100, (feedPreferences[key] ?? 0) + delta * multiplier))
            if abs(next) < 0.001 {
                feedPreferences.removeValue(forKey: key)
            } else {
                feedPreferences[key] = next
            }
        }
    }

    private func rerankUpcomingVideos(after video: TrendingVideo) {
        guard let index = videos.firstIndex(where: { $0.youtubeId == video.youtubeId }) else { return }
        let fixed = Array(videos.prefix(index + 1))
        let upcoming = rankedVideos(Array(videos.suffix(from: index + 1)))
        videos = fixed + upcoming
    }

    private func rankedVideos(_ candidates: [TrendingVideo]) -> [TrendingVideo] {
        candidates.sorted { lhs, rhs in
            let lhsScore = score(lhs)
            let rhsScore = score(rhs)
            if abs(lhsScore - rhsScore) > 0.0001 { return lhsScore > rhsScore }
            return (lhs.publishedAt ?? "") > (rhs.publishedAt ?? "")
        }
    }

    private func score(_ video: TrendingVideo) -> Double {
        var total = 0.0
        var weight = 0.0
        for key in preferenceKeys(for: video) {
            let keyWeight: Double
            if key.hasPrefix("niche:") {
                keyWeight = 1.35
            } else if key.hasPrefix("creator:") {
                keyWeight = 0.85
            } else {
                keyWeight = 1
            }
            total += ((feedPreferences[key] ?? 0) / 100) * keyWeight
            weight += keyWeight
        }

        let preferenceScore = weight > 0 ? total / weight : 0
        let viewScore = video.viewCount.map { min(log10(Double($0) + 10) / 8, 1) } ?? 0
        let priorityScore = video.isabellaPriority == true ? 0.08 : 0
        let recencyScore = recencyScore(video.publishedAt)
        return preferenceScore * 2.8 + viewScore * 0.16 + recencyScore * 0.18 + priorityScore
    }

    private func recencyScore(_ value: String?) -> Double {
        guard let value, let date = ISO8601DateFormatter().date(from: value) else { return 0 }
        let ageDays = max(0, Date().timeIntervalSince(date) / 86_400)
        return exp(-ageDays / 45)
    }

    private func preferenceKeys(for video: TrendingVideo) -> [String] {
        var keys: [String] = []
        if let niche = normalizedPreferenceKey(prefix: "niche", value: video.primaryNiche) {
            keys.append(niche)
        }
        let creator = video.channelHandle ?? video.channelId ?? video.channel
        if let creatorKey = normalizedPreferenceKey(prefix: "creator", value: creator) {
            keys.append(creatorKey)
        }
        for tag in video.tags ?? [] {
            if let tagKey = normalizedPreferenceKey(prefix: "tag", value: tag) {
                keys.append(tagKey)
            }
        }
        return Array(Set(keys))
    }

    private func normalizedPreferenceKey(prefix: String, value: String?) -> String? {
        let normalized = (value ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !normalized.isEmpty else { return nil }
        return "\(prefix):\(normalized)"
    }
}

private struct ShortsPlayerPage: View {
    let video: TrendingVideo
    let isActive: Bool
    let isPreloaded: Bool
    let reaction: ShortsReaction?
    let viewportSize: CGSize
    let onUnavailable: () -> Void
    let onReaction: (ShortsReaction) -> Void

    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var wordStore: WordStore

    @State private var currentTime: Double = 0
    @State private var seekTime: Double?
    @State private var pausedForLookup = false
    @State private var isPlaying = false
    @State private var resumeAfterLookup = false
    @State private var selectedLookup: LookupContext?
    @State private var captionTrack = TimedCaptionTrack(kind: .human, cues: [])
    @State private var captionError: String?
    @State private var lastProgressSaveAt: TimeInterval = 0

    private var playerHeight: CGFloat {
        let metadataHeight: CGFloat = 50
        let subtitleHeight: CGFloat = 96
        let verticalPadding: CGFloat = 18
        return max(280, viewportSize.height - metadataHeight - subtitleHeight - verticalPadding)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .bottomLeading) {
                ZStack {
                    if isPreloaded {
                        YouTubePlayerView(
                            youtubeID: video.youtubeId,
                            currentTime: $currentTime,
                            seekTime: $seekTime,
                            pausedForLookup: $pausedForLookup,
                            isPlaying: $isPlaying,
                            playAfterInitialSeek: true
                        )
                    } else {
                        AsyncImage(url: URL(string: video.thumbnail)) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Rectangle().fill(.white.opacity(0.08))
                        }
                        .overlay {
                            Image(systemName: "play.fill")
                                .font(.system(size: 42, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.92))
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: playerHeight)
                .background(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                Text(video.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        LinearGradient(
                            colors: [.clear, .black.opacity(0.72)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                reactionButtons
            }
            .padding(.horizontal, 8)

            PortraitSubtitlePanel(
                track: captionTrack,
                timeMilliseconds: Int((currentTime * 1000).rounded()),
                captionError: captionError,
                hasFallback: false,
                selectedLookup: $selectedLookup,
                onWordTap: pauseForLookup
            )
            .frame(height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal, 8)

            Text(video.channel)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .padding(.horizontal, 12)

            if let niche = video.primaryNiche {
                Text(niche.replacingOccurrences(of: "_", with: " "))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
            }

            Spacer(minLength: 0)
        }
        .padding(.top, 8)
        .padding(.bottom, 4)
        .overlay {
            if let context = selectedLookup {
                WordPopupView(context: context, onDismiss: closeLookup)
                    .environmentObject(session)
                    .environmentObject(wordStore)
            }
        }
        .onAppear {
            if isActive { activate() }
        }
        .onChange(of: isActive) { _, active in
            if active {
                activate()
            } else {
                saveProgress()
                selectedLookup = nil
                pausedForLookup = true
            }
        }
        .onChange(of: currentTime) { _, newTime in
            saveProgressIfNeeded(newTime)
        }
        .task(id: isPreloaded) {
            guard isPreloaded else { return }
            await loadCaptions()
        }
    }

    private var reactionButtons: some View {
        VStack(spacing: 12) {
            reactionButton(
                reaction: .liked,
                inactiveIcon: "hand.thumbsup",
                activeIcon: "hand.thumbsup.fill",
                label: "Like short"
            )
            reactionButton(
                reaction: .disliked,
                inactiveIcon: "hand.thumbsdown",
                activeIcon: "hand.thumbsdown.fill",
                label: "Dislike short"
            )
        }
        .padding(.trailing, 16)
        .padding(.bottom, 74)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
    }

    private func reactionButton(
        reaction value: ShortsReaction,
        inactiveIcon: String,
        activeIcon: String,
        label: String
    ) -> some View {
        Button {
            onReaction(value)
        } label: {
            Image(systemName: reaction == value ? activeIcon : inactiveIcon)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 48, height: 48)
                .background(
                    (reaction == value ? Color.accentColor : Color.black.opacity(0.58)),
                    in: Circle()
                )
                .overlay(Circle().stroke(.white.opacity(0.18), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func activate() {
        let savedTime = VideoProgressStore.savedTime(forYoutubeID: video.youtubeId)
        currentTime = savedTime
        seekTime = max(savedTime, 0.01)
        pausedForLookup = false
        captionError = nil
    }

    private func loadCaptions() async {
        do {
            captionTrack = try await TranscriptWorkerClient.fetchTimedCaptions(
                youtubeId: video.youtubeId,
                lang: session.user?.targetLanguage ?? "en"
            )
            captionError = nil
        } catch {
            captionError = error.localizedDescription
            onUnavailable()
        }
    }

    private func pauseForLookup() {
        resumeAfterLookup = isPlaying
        pausedForLookup = true
    }

    private func closeLookup() {
        selectedLookup = nil
        pausedForLookup = !resumeAfterLookup
        resumeAfterLookup = false
    }

    private func saveProgressIfNeeded(_ time: Double) {
        let now = Date().timeIntervalSince1970
        guard now - lastProgressSaveAt >= 5 else { return }
        lastProgressSaveAt = now
        VideoProgressStore.save(
            youtubeID: video.youtubeId,
            seconds: time,
            durationSeconds: video.durationSeconds.map(Double.init)
        )
    }

    private func saveProgress() {
        VideoProgressStore.save(
            youtubeID: video.youtubeId,
            seconds: currentTime,
            durationSeconds: video.durationSeconds.map(Double.init)
        )
    }
}

private struct ChannelCard: View {
    let channel: ChannelSummary

    var body: some View {
        VStack(alignment: .center, spacing: 9) {
            ZStack {
                AsyncImage(url: URL(string: channel.thumbnails.first ?? "")) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    ZStack {
                        Circle().fill(.white.opacity(0.08))
                        Image(systemName: "person.crop.circle.fill")
                            .font(.system(size: 34))
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 96, height: 96)
                .clipShape(Circle())
            }

            Text(channel.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }
}

private struct SearchChannelCard: View {
    let channel: ChannelSummary

    var body: some View {
        VStack(alignment: .center, spacing: 9) {
            AsyncImage(url: URL(string: channel.thumbnails.first ?? "")) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ZStack {
                    Circle().fill(.white.opacity(0.08))
                    Image(systemName: "person.crop.circle.fill")
                        .font(.system(size: 34))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 92, height: 92)
            .clipShape(Circle())

            Text(channel.name)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.center)

            Text(channel.handle.hasPrefix("UC") ? "Channel" : "@\(channel.handle)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }
}

private struct CompactVideoCard: View {
    let video: TrendingVideo
    let showsChannel: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            GeometryReader { proxy in
                ZStack(alignment: .bottomTrailing) {
                    AsyncImage(url: URL(string: video.thumbnail)) { image in
                        image
                            .resizable()
                            .scaledToFill()
                    } placeholder: {
                        Rectangle().fill(.white.opacity(0.08))
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .clipped()

                    PlaybackProgressBar(
                        fraction: VideoProgressStore.progressFraction(
                            forYoutubeID: video.youtubeId,
                            durationSeconds: video.durationSeconds
                        )
                    )

                    if let duration = video.durationSeconds {
                        Text(formatDuration(duration))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 3)
                            .background(.black.opacity(0.82), in: RoundedRectangle(cornerRadius: 4))
                            .padding(5)
                    }
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipped()

            Text(video.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)

            if showsChannel {
                Text(video.channel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if let metadata = metadataText {
                Text(metadata)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let remainingSeconds = seconds % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, remainingSeconds)
        }
        return String(format: "%d:%02d", minutes, remainingSeconds)
    }

    private var metadataText: String? {
        var parts: [String] = []
        if let viewCount = video.viewCount {
            parts.append("\(formatViewCount(viewCount)) views")
        }
        if let published = formatPublishedDate(video.publishedAt) {
            parts.append(published)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func formatViewCount(_ count: Int) -> String {
        let value = Double(count)
        switch count {
        case 1_000_000_000...:
            return String(format: "%.1fB", value / 1_000_000_000).replacingOccurrences(of: ".0", with: "")
        case 1_000_000...:
            return String(format: "%.1fM", value / 1_000_000).replacingOccurrences(of: ".0", with: "")
        case 1_000...:
            return String(format: "%.1fK", value / 1_000).replacingOccurrences(of: ".0", with: "")
        default:
            return NumberFormatter.localizedString(from: NSNumber(value: count), number: .decimal)
        }
    }

    private func formatPublishedDate(_ value: String?) -> String? {
        guard let value, let date = ISO8601DateFormatter().date(from: value) else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct PlaybackProgressBar: View {
    let fraction: Double?

    var body: some View {
        GeometryReader { geometry in
            if let fraction, fraction > 0 {
                VStack {
                    Spacer(minLength: 0)
                    HStack(spacing: 0) {
                        Rectangle()
                            .fill(Color.red)
                            .frame(width: max(2, geometry.size.width * min(max(fraction, 0), 1)))
                        Spacer(minLength: 0)
                    }
                    .frame(height: 4)
                    .background(Color.black.opacity(0.18))
                }
            }
        }
        .allowsHitTesting(false)
    }
}
