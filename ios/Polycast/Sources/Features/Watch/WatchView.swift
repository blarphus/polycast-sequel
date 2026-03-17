import SwiftUI
import WebKit

struct WatchView: View {
    let videoID: String

    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss

    @State private var video: VideoDetail?
    @State private var loading = true
    @State private var error = ""
    @State private var currentTime: Double = 0
    @State private var seekTime: Double?
    @State private var selectedLookup: LookupContext?
    @State private var quizPresented = false
    @State private var clientFetching = false
    @State private var pausedForLookup = false

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
        .background(Color.black.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Back") { dismiss() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Quiz") { quizPresented = true }
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
        .overlay {
            if let context = selectedLookup {
                WordPopupView(context: context, onDismiss: {
                    selectedLookup = nil
                    pausedForLookup = false
                })
                    .environmentObject(session)
            }
        }
        .sheet(isPresented: $quizPresented) {
            NavigationStack {
                QuizView(videoID: videoID)
            }
        }
    }

    @ViewBuilder
    private func content(for video: VideoDetail) -> some View {
        VStack(spacing: 0) {
            YouTubePlayerView(youtubeID: video.youtubeId, currentTime: $currentTime, seekTime: $seekTime, pausedForLookup: $pausedForLookup)
                .frame(height: 240)
                .clipShape(RoundedRectangle(cornerRadius: 24))

            // Title
            VStack(alignment: .leading, spacing: 4) {
                Text(video.title)
                    .font(.headline.weight(.bold))
                Text(video.channel)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .padding(.vertical, 10)

            // Transcript
            if clientFetching || video.transcriptStatus == "processing" {
                LoadingStateView(title: "Fetching captions...")
                    .frame(height: 120)
            } else if video.transcriptStatus != "ready" || (video.transcript ?? []).isEmpty {
                EmptyStateView(
                    title: "Transcript unavailable",
                    subtitle: video.transcriptError ?? video.transcriptLastError ?? "This video does not have a ready transcript yet."
                )
            } else {
                TranscriptScrollView(
                    segments: video.transcript ?? [],
                    currentTime: currentTime,
                    seekTime: $seekTime,
                    selectedLookup: $selectedLookup,
                    pausedForLookup: $pausedForLookup
                )
            }
        }
    }

    private func load() async {
        loading = true
        do {
            let detail = try await APIClient.shared.videoDetail(id: videoID)
            video = detail

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

}

private struct YouTubePlayerView: UIViewRepresentable {
    let youtubeID: String
    @Binding var currentTime: Double
    @Binding var seekTime: Double?
    @Binding var pausedForLookup: Bool

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "playerTime")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.loadHTMLString(html(videoID: youtubeID), baseURL: AppConfig.baseURL)
        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if let seekTime {
            let seconds = String(format: "%.2f", seekTime)
            webView.evaluateJavaScript("seekToSeconds(\(seconds));")
            DispatchQueue.main.async {
                self.seekTime = nil
            }
        }

        if pausedForLookup != context.coordinator.isPaused {
            context.coordinator.isPaused = pausedForLookup
            if pausedForLookup {
                webView.evaluateJavaScript("if (player && player.pauseVideo) player.pauseVideo();")
            } else {
                webView.evaluateJavaScript("if (player && player.playVideo) player.playVideo();")
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(currentTime: $currentTime)
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        @Binding var currentTime: Double
        weak var webView: WKWebView?
        var isPaused = false

        init(currentTime: Binding<Double>) {
            _currentTime = currentTime
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "playerTime" else { return }
            if let value = message.body as? Double {
                DispatchQueue.main.async {
                    self.currentTime = value
                }
            } else if let value = message.body as? NSNumber {
                DispatchQueue.main.async {
                    self.currentTime = value.doubleValue
                }
            }
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
                playerVars: { playsinline: 1, rel: 0 },
                events: {
                  onReady: () => {
                    setInterval(() => {
                      if (player && player.getCurrentTime) {
                        window.webkit.messageHandlers.playerTime.postMessage(player.getCurrentTime());
                      }
                    }, 500);
                  }
                }
              });
            }
            function seekToSeconds(value) {
              if (player && player.seekTo) {
                player.seekTo(value, true);
              }
            }
          </script>
        </body>
        </html>
        """
    }
}
