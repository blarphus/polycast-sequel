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

struct ChannelDetailView: View {
    let handle: String
    let title: String

    @EnvironmentObject private var session: SessionStore
    @State private var detail: ChannelDetail?
    @State private var loading = true
    @State private var error = ""
    @State private var watchTarget: WatchTarget?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if loading {
                    LoadingStateView(title: "Loading channel…")
                } else if let detail {
                    ForEach(detail.videos) { video in
                        VideoCard(video: video) {
                            Task { await launch(video: video) }
                        }
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

    private func load() async {
        guard let targetLanguage = session.user?.targetLanguage else {
            loading = false
            return
        }
        do {
            var loaded = try await APIClient.shared.channelDetail(handle: handle, lang: targetLanguage)
            let ids = loaded.videos.map(\.youtubeId)
            if !ids.isEmpty {
                do {
                    let result = try await TranscriptWorkerClient.checkPlayability(videoIds: ids)
                    if !result.blocked.isEmpty || !result.shorts.isEmpty {
                        loaded = ChannelDetail(
                            channel: loaded.channel,
                            videos: loaded.videos.filter { !result.blocked.contains($0.youtubeId) && !result.shorts.contains($0.youtubeId) }
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
