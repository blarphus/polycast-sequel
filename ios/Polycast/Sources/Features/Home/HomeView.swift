import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var dashboard: StudentDashboard?
    @State private var trending: [TrendingVideo] = []
    @State private var news: [NewsArticle] = []
    @State private var channels: [ChannelSummary] = []
    @State private var lessons: [LessonSummary] = []
    @State private var classes: [UpcomingClass] = []
    @State private var classrooms: [Classroom] = []
    @State private var loading = true
    @State private var error = ""
    @State private var watchTarget: WatchTarget?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                banner

                if !error.isEmpty {
                    Text(error)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                if loading {
                    LoadingStateView(title: "Loading your dashboard…")
                        .frame(height: 220)
                } else {
                    dashboardSummarySection
                    newsSection
                    trendingSection
                    channelsSection
                    lessonsSection
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 16)
        }
        .background(Color.clear)
        .texturedBackground()
        .navigationTitle("Home")
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            guard dashboard == nil else { return }
            await load()
        }
        .refreshable {
            await load()
        }
        .fullScreenCover(item: $watchTarget) { target in
            NavigationStack {
                WatchView(videoID: target.id)
            }
        }
    }

    private static let languageBanners: [String: String] = [
        "en": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/London_Skyline_from_Waterloo_Bridge%2C_London%2C_UK_-_Diliff.jpg/960px-London_Skyline_from_Waterloo_Bridge%2C_London%2C_UK_-_Diliff.jpg",
        "es": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Amanecer_en_Barcelona_2012.JPG/960px-Amanecer_en_Barcelona_2012.JPG",
        "pt": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Sugarloaf_Mountain%2C_Rio_de_Janeiro%2C_Brazil.jpg/960px-Sugarloaf_Mountain%2C_Rio_de_Janeiro%2C_Brazil.jpg",
        "fr": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Eiffel_Tower_in_cityscape_of_Paris_at_night_light_%288210912882%29.jpg/960px-Eiffel_Tower_in_cityscape_of_Paris_at_night_light_%288210912882%29.jpg",
        "ja": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Lake_Kawaguchiko_Sakura_Mount_Fuji_4.JPG/960px-Lake_Kawaguchiko_Sakura_Mount_Fuji_4.JPG",
        "de": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Neuschwanstein_Castle_from_Marienbr%C3%BCcke%2C_2011_May.jpg/960px-Neuschwanstein_Castle_from_Marienbr%C3%BCcke%2C_2011_May.jpg",
    ]

    private static let languageNames: [String: String] = [
        "en": "English", "es": "Spanish", "pt": "Brazilian Portuguese",
        "fr": "French", "ja": "Japanese", "de": "German",
    ]

    private var banner: some View {
        let lang = session.user?.targetLanguage
        let bannerUrl = lang.flatMap { Self.languageBanners[$0] }.flatMap { URL(string: $0) }
        let langName = lang.flatMap { Self.languageNames[$0] }
        let firstName = session.user?.displayName ?? session.user?.username ?? "Polycast"

        return ZStack(alignment: .bottomLeading) {
            if let bannerUrl {
                AsyncImage(url: bannerUrl) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        LinearGradient(
                            colors: [.purple.opacity(0.9), .blue.opacity(0.7), .black.opacity(0.95)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    }
                }
            } else {
                LinearGradient(
                    colors: [.purple.opacity(0.9), .blue.opacity(0.7), .black.opacity(0.95)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }

            // Text overlay with gradient scrim
            LinearGradient(
                colors: [.black.opacity(0.6), .clear],
                startPoint: .bottomLeading,
                endPoint: .topTrailing
            )

            VStack(alignment: .leading, spacing: 6) {
                Text("Welcome back, \(firstName)")
                    .font(.title2.bold())
                if let langName {
                    Text("Exploring \(langName)")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.8))
                }
            }
            .foregroundStyle(.white)
            .padding(24)
        }
        .frame(height: 180)
        .clipShape(RoundedRectangle(cornerRadius: 28))
    }

    private var dashboardSummarySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Today", subtitle: "Your learning queue and class summaries")
            LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 12) {
                summaryCard(title: "New words", value: "\(dashboard?.newToday.count ?? 0)", subtitle: "Words added today")
                summaryCard(title: "Due now", value: "\(dashboard?.dueWords.count ?? 0)", subtitle: "Ready to review")
                summaryCard(title: "Pending classwork", value: "\(dashboard?.pendingClasswork.count ?? 0)", subtitle: "Assignments waiting")
                summaryCard(title: "Classes", value: "\(classes.count)", subtitle: "Scheduled today")
            }
        }
    }

    private func summaryCard(title: String, value: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            Text(value)
                .font(.system(size: 28, weight: .bold, design: .rounded))
            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22))
    }

    private var newsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("News for you")
            if news.isEmpty {
                EmptyStateView(title: "No news right now.", subtitle: "Set your target language to refresh this feed.")
            } else {
                ForEach(news.prefix(3)) { article in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(article.simplifiedTitle)
                            .font(.headline)
                        HStack {
                            Text(article.source)
                                .foregroundStyle(.secondary)
                            if let difficulty = article.difficulty {
                                Chip(text: difficulty, color: .orange)
                            }
                        }
                        if let preview = article.preview, !preview.isEmpty {
                            Text(preview)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                        Link("Open source article", destination: URL(string: article.link)!)
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding(16)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                }
            }
        }
    }

    private var trendingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Trending videos")
            if trending.isEmpty {
                EmptyStateView(title: "No videos available.", subtitle: nil)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) {
                        ForEach(trending.prefix(10)) { video in
                            VideoCard(video: video) {
                                Task { await launch(video: video) }
                            }
                        }
                    }
                }
            }
        }
    }

    private var channelsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Channels")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(channels.prefix(10)) { channel in
                        NavigationLink {
                            ChannelDetailView(handle: channel.handle, title: channel.name)
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                AsyncImage(url: URL(string: channel.thumbnails.first ?? "")) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: {
                                    Rectangle().fill(.white.opacity(0.08))
                                }
                                .frame(width: 180, height: 110)
                                .clipShape(RoundedRectangle(cornerRadius: 18))

                                Text(channel.name)
                                    .font(.headline)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                            }
                            .frame(width: 180, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var lessonsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Lesson playlists")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(lessons.prefix(10)) { lesson in
                        NavigationLink {
                            LessonDetailView(lessonID: lesson.id, title: lesson.title)
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                AsyncImage(url: URL(string: lesson.thumbnails.first ?? "")) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: {
                                    Rectangle().fill(.white.opacity(0.08))
                                }
                                .frame(width: 180, height: 110)
                                .clipShape(RoundedRectangle(cornerRadius: 18))

                                Text(lesson.title)
                                    .font(.headline)
                                    .lineLimit(2)
                                Text("\(lesson.videoCount) videos")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(width: 180, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func load() async {
        guard let user = session.user, let targetLanguage = user.targetLanguage else {
            loading = false
            return
        }
        loading = true
        error = ""
        do {
            async let dashboardValue = APIClient.shared.studentDashboard()
            async let trendingValue = APIClient.shared.trendingVideos(lang: targetLanguage)
            async let newsValue = APIClient.shared.news(lang: targetLanguage, level: user.cefrLevel)
            async let channelsValue = APIClient.shared.channels(lang: targetLanguage)
            async let lessonsValue = APIClient.shared.lessons(lang: targetLanguage)
            async let classesValue = APIClient.shared.classesToday()
            async let classroomsValue = APIClient.shared.classrooms()

            dashboard = try await dashboardValue
            trending = try await trendingValue
            news = try await newsValue
            channels = try await channelsValue
            lessons = try await lessonsValue
            classes = try await classesValue
            classrooms = try await classroomsValue

            // Filter unplayable/shorts from trending
            let ids = trending.map(\.youtubeId)
            if !ids.isEmpty {
                do {
                    let result = try await TranscriptWorkerClient.checkPlayability(videoIds: ids)
                    if !result.blocked.isEmpty || !result.shorts.isEmpty {
                        trending.removeAll { result.blocked.contains($0.youtubeId) || result.shorts.contains($0.youtubeId) }
                    }
                } catch {
                    print("[Polycast] Home playability filter failed: \(error)")
                }
            }
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

struct VideoCard: View {
    let video: TrendingVideo
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                AsyncImage(url: URL(string: video.thumbnail)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Rectangle().fill(.white.opacity(0.08))
                }
                .frame(width: 240, height: 140)
                .clipShape(RoundedRectangle(cornerRadius: 20))

                Text(video.title)
                    .font(.headline)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                Text(video.channel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(width: 240, alignment: .leading)
        }
        .buttonStyle(.plain)
    }
}
