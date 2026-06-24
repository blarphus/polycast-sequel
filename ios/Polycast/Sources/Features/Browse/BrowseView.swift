import SwiftUI

struct BrowseView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var query = ""
    @State private var activeQuery = ""
    @State private var videos: [TrendingVideo] = []
    @State private var lessons: [LessonSummary] = []
    @State private var loading = true
    @State private var error = ""
    @State private var watchTarget: WatchTarget?
    @State private var subscription: ChannelSummary?
    @State private var subscriptionUpdating = false

    private let grid = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                searchBar

                if !lessons.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 14) {
                            ForEach(lessons.prefix(10)) { lesson in
                                NavigationLink {
                                    LessonDetailView(lessonID: lesson.id, title: lesson.title)
                                } label: {
                                    VStack(alignment: .leading, spacing: 8) {
                                        AsyncImage(url: URL(string: lesson.thumbnails.first ?? "")) { image in
                                            image.resizable().scaledToFill()
                                        } placeholder: {
                                            Rectangle().fill(.white.opacity(0.08))
                                        }
                                        .frame(width: 170, height: 100)
                                        .clipShape(RoundedRectangle(cornerRadius: 18))
                                        Text(lesson.title)
                                            .font(.headline)
                                            .lineLimit(2)
                                    }
                                    .frame(width: 170, alignment: .leading)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                NavigationLink {
                    LocalLibraryView()
                } label: {
                    HStack {
                        Image(systemName: "folder.fill")
                        Text("Local Videos")
                            .font(.headline)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)

                NavigationLink {
                    LibraryView()
                } label: {
                    HStack {
                        Image(systemName: "books.vertical.fill")
                        Text("Books")
                            .font(.headline)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)

                SectionHeader(activeQuery.isEmpty ? "Trending" : "Results for \"\(activeQuery)\"")

                if loading {
                    LoadingStateView(title: "Loading videos…")
                        .frame(height: 220)
                } else if !error.isEmpty {
                    EmptyStateView(title: "Could not load videos.", subtitle: error)
                } else {
                    LazyVGrid(columns: grid, spacing: 14) {
                        ForEach(videos) { video in
                            Button {
                                Task { await launch(video: video) }
                            } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    AsyncImage(url: URL(string: video.thumbnail)) { image in
                                        image.resizable().scaledToFill()
                                    } placeholder: {
                                        Rectangle().fill(.white.opacity(0.08))
                                    }
                                    .frame(height: 110)
                                    .clipShape(RoundedRectangle(cornerRadius: 18))

                                    Text(video.title)
                                        .font(.headline)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                    Text(video.channel)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding()
        }
        .background(Color.clear)
        .texturedBackground()
        .navigationTitle("Browse")
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            guard videos.isEmpty else { return }
            await loadTrending()
        }
        .fullScreenCover(item: $watchTarget) { target in
            NavigationStack {
                WatchView(videoID: target.id)
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: 12) {
            TextField("Search videos…", text: $query)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.search)
                .onSubmit {
                    Task { await search() }
                }

            Button("Go") {
                Task { await search() }
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func loadTrending() async {
        guard let targetLanguage = session.user?.targetLanguage else {
            loading = false
            return
        }

        loading = true
        error = ""
        do {
            async let videoValue = APIClient.shared.trendingVideos(lang: targetLanguage)
            async let lessonValue = APIClient.shared.lessons(lang: targetLanguage)
            videos = try await videoValue
            lessons = try await lessonValue
            activeQuery = ""
            await filterUnplayable()
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func search() async {
        guard let targetLanguage = session.user?.targetLanguage else { return }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            await loadTrending()
            return
        }

        loading = true
        error = ""
        do {
            videos = try await APIClient.shared.searchVideos(query: trimmed, lang: targetLanguage)
            activeQuery = trimmed
            await filterUnplayable()
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func filterUnplayable() async {
        let ids = videos.map(\.youtubeId)
        guard !ids.isEmpty else { return }
        do {
            let result = try await TranscriptWorkerClient.checkPlayability(videoIds: ids)
            if !result.blocked.isEmpty || !result.shorts.isEmpty {
                videos.removeAll { result.blocked.contains($0.youtubeId) || result.shorts.contains($0.youtubeId) }
            }
        } catch {
            print("[Polycast] Playability filter failed: \(error)")
        }
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

enum ChannelSort: String, CaseIterable {
    case recent = "Recent"
    case popular = "Most Popular"
}

struct ChannelDetailView: View {
    let handle: String
    let title: String

    @EnvironmentObject private var session: SessionStore
    @State private var detail: ChannelDetail?
    @State private var sort: ChannelSort = .recent
    @State private var loading = true
    @State private var error = ""
    @State private var watchTarget: WatchTarget?
    @State private var subscription: ChannelSummary?
    @State private var subscriptionUpdating = false
    @State private var loadingMore = false

    private let channelColumns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    /// Channel videos arrive newest-first from the uploads playlist; "Recent"
    /// preserves that, "Most Popular" reorders by view count.
    private var sortedVideos: [TrendingVideo] {
        guard let videos = detail?.videos else { return [] }
        switch sort {
        case .recent:
            return videos.sorted { ($0.publishedAt ?? "") > ($1.publishedAt ?? "") }
        case .popular:
            return videos.sorted { ($0.viewCount ?? 0) > ($1.viewCount ?? 0) }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if loading {
                    LoadingStateView(title: "Loading channel…")
                } else if detail != nil {
                    channelHeader

                    Picker("Sort", selection: $sort) {
                        ForEach(ChannelSort.allCases, id: \.self) { option in
                            Text(option.rawValue).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)

                    LazyVGrid(columns: channelColumns, spacing: 16) {
                        ForEach(sortedVideos) { video in
                            ChannelVideoCard(video: video) {
                                Task { await launch(video: video) }
                            }
                        }
                    }

                    if detail?.nextPageToken != nil {
                        Button {
                            Task { await loadMore() }
                        } label: {
                            HStack {
                                if loadingMore {
                                    ProgressView()
                                }
                                Text(loadingMore ? "Loading..." : "Load more videos")
                                    .font(.headline)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(loadingMore)
                    }
                } else {
                    EmptyStateView(title: "Could not load channel.", subtitle: error)
                }
            }
            .padding()
        }
        .navigationTitle(title)
        .task {
            guard detail == nil else { return }
            await load()
        }
        .fullScreenCover(item: $watchTarget) { target in
            NavigationStack {
                WatchView(videoID: target.id)
            }
        }
    }

    private var channelHeader: some View {
        HStack(spacing: 12) {
            Text(detail?.channel.name ?? title)
                .font(.title3.weight(.semibold))
                .lineLimit(2)
            Spacer(minLength: 0)
            Button {
                Task { await toggleSubscription() }
            } label: {
                Text((subscription?.subscribed ?? false) ? "Unsubscribe" : "Subscribe")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle((subscription?.subscribed ?? false) ? Color.secondary : Color.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(
                        (subscription?.subscribed ?? false) ? .white.opacity(0.12) : Color.accentColor,
                        in: Capsule()
                    )
            }
            .buttonStyle(.plain)
            .disabled(subscriptionUpdating)
        }
    }

    private func load() async {
        guard let targetLanguage = session.user?.targetLanguage else {
            loading = false
            return
        }
        do {
            async let detailValue = APIClient.shared.channelDetail(handle: handle, lang: targetLanguage)
            async let subscriptionValue = APIClient.shared.channelSubscription(handle: handle, lang: targetLanguage)
            var loaded = try await detailValue
            subscription = try? await subscriptionValue
            let ids = loaded.videos.map(\.youtubeId)
            if !ids.isEmpty {
                do {
                    let result = try await TranscriptWorkerClient.checkPlayability(videoIds: ids)
                    if !result.blocked.isEmpty || !result.shorts.isEmpty {
                        loaded = ChannelDetail(
                            channel: loaded.channel,
                            videos: loaded.videos.filter { !result.blocked.contains($0.youtubeId) && !result.shorts.contains($0.youtubeId) },
                            nextPageToken: loaded.nextPageToken
                        )
                    }
                } catch {
                    print("[Polycast] Channel playability filter failed: \(error)")
                }
            }
            detail = loaded
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func loadMore() async {
        guard !loadingMore else { return }
        guard let targetLanguage = session.user?.targetLanguage else { return }
        guard let pageToken = detail?.nextPageToken, !pageToken.isEmpty else { return }

        loadingMore = true
        defer { loadingMore = false }

        do {
            var loaded = try await APIClient.shared.channelDetail(
                handle: handle,
                lang: targetLanguage,
                pageToken: pageToken
            )
            let ids = loaded.videos.map(\.youtubeId)
            if !ids.isEmpty {
                do {
                    let result = try await TranscriptWorkerClient.checkPlayability(videoIds: ids)
                    if !result.blocked.isEmpty || !result.shorts.isEmpty {
                        loaded = ChannelDetail(
                            channel: loaded.channel,
                            videos: loaded.videos.filter { !result.blocked.contains($0.youtubeId) && !result.shorts.contains($0.youtubeId) },
                            nextPageToken: loaded.nextPageToken
                        )
                    }
                } catch {
                    print("[Polycast] Channel load-more playability filter failed: \(error)")
                }
            }

            let existing = detail?.videos ?? []
            let existingIds = Set(existing.map(\.youtubeId))
            let newVideos = loaded.videos.filter { !existingIds.contains($0.youtubeId) }
            detail = ChannelDetail(
                channel: detail?.channel ?? loaded.channel,
                videos: existing + newVideos,
                nextPageToken: loaded.nextPageToken
            )
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func toggleSubscription() async {
        guard !subscriptionUpdating else { return }
        guard let targetLanguage = session.user?.targetLanguage else { return }
        let isSubscribed = subscription?.subscribed ?? false
        subscriptionUpdating = true
        defer { subscriptionUpdating = false }

        do {
            subscription = try await APIClient.shared.setChannelSubscription(
                handle: detail?.channel.handle ?? handle,
                lang: targetLanguage,
                subscribed: !isSubscribed
            )
            NotificationCenter.default.post(name: .channelSubscriptionsDidChange, object: nil)
        } catch {
            self.error = error.localizedDescription
        }
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

private struct ChannelVideoCard: View {
    let video: TrendingVideo
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                GeometryReader { proxy in
                    ZStack(alignment: .bottomTrailing) {
                        AsyncImage(url: URL(string: video.thumbnail)) { image in
                            image.resizable().scaledToFill()
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
                }
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .clipped()

                Text(video.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                if let metadata = metadataText {
                    Text(metadata)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
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

    private func formatPublishedDate(_ value: String?) -> String? {
        guard let value, let date = ISO8601DateFormatter().date(from: value) else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct LessonDetailView: View {
    let lessonID: String
    let title: String

    @EnvironmentObject private var session: SessionStore
    @State private var detail: LessonDetail?
    @State private var loading = true
    @State private var error = ""
    @State private var watchTarget: WatchTarget?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if loading {
                    LoadingStateView(title: "Loading lesson…")
                } else if let detail {
                    ForEach(detail.videos) { video in
                        VideoCard(video: video) {
                            Task { await launch(video: video) }
                        }
                    }
                } else {
                    EmptyStateView(title: "Could not load lesson.", subtitle: error)
                }
            }
            .padding()
        }
        .navigationTitle(title)
        .task {
            guard detail == nil else { return }
            await load()
        }
        .fullScreenCover(item: $watchTarget) { target in
            NavigationStack {
                WatchView(videoID: target.id)
            }
        }
    }

    private func load() async {
        guard let targetLanguage = session.user?.targetLanguage else {
            loading = false
            return
        }
        do {
            var loaded = try await APIClient.shared.lessonDetail(id: lessonID, lang: targetLanguage)
            let ids = loaded.videos.map(\.youtubeId)
            if !ids.isEmpty {
                do {
                    let result = try await TranscriptWorkerClient.checkPlayability(videoIds: ids)
                    if !result.blocked.isEmpty || !result.shorts.isEmpty {
                        loaded = LessonDetail(
                            lesson: loaded.lesson,
                            videos: loaded.videos.filter { !result.blocked.contains($0.youtubeId) && !result.shorts.contains($0.youtubeId) }
                        )
                    }
                } catch {
                    print("[Polycast] Lesson playability filter failed: \(error)")
                }
            }
            detail = loaded
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
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
