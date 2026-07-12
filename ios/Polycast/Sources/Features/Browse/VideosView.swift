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
            PolycastLog.runtime.error("[Polycast] Highlights load failed: \(error)")
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
            PolycastLog.runtime.error("[Polycast] Channel subscription refresh failed: \(error)")
        }
        subscriptionVideos = []
        await loadSubscriptions()
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
                    PolycastLog.runtime.error("[Polycast] Channel search hydrate failed: \(error)")
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
            PolycastLog.runtime.error("[Polycast] Playability filter failed: \(error)")
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

enum ShortsReaction: String {
    case liked
    case disliked
}

enum ShortsPreferenceStore {
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
