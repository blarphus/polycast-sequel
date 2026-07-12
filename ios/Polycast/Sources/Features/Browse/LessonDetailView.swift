import SwiftUI

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
                    reportFallback(
                        code: "lesson_playability_filter_fallback",
                        title: "Lesson playability filter fallback used",
                        message: "Polycast could not pre-filter unavailable lesson videos, so the unfiltered lesson list remains visible.",
                        source: "ios.lesson",
                        operation: "filter-playability",
                        error: error
                    )
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
