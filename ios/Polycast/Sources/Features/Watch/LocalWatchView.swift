import SwiftUI

struct LocalWatchView: View {
    let item: LocalMediaItem

    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss

    @State private var segments: [TranscriptSegment] = []
    @State private var currentTime: Double = 0
    @State private var seekTime: Double?
    @State private var selectedLookup: LookupContext?
    @State private var pausedForLookup = false
    @State private var loadError = ""

    var body: some View {
        VStack(spacing: 0) {
            LocalPlayerView(
                url: item.videoURL,
                currentTime: $currentTime,
                seekTime: $seekTime,
                pausedForLookup: $pausedForLookup
            )
            .frame(height: 240)
            .clipShape(RoundedRectangle(cornerRadius: 24))

            // Title
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.headline.weight(.bold))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .padding(.vertical, 10)

            // Transcript
            if !segments.isEmpty {
                TranscriptScrollView(
                    segments: segments,
                    currentTime: currentTime,
                    seekTime: $seekTime,
                    selectedLookup: $selectedLookup,
                    pausedForLookup: $pausedForLookup
                )
            } else if !loadError.isEmpty {
                EmptyStateView(title: "Subtitle error", subtitle: loadError)
            } else if item.subtitleURL == nil {
                EmptyStateView(title: "No subtitles", subtitle: "Place a .srt file with the same name as the video in the folder.")
            }
        }
        .background(Color.black.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Back") { dismiss() }
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
        .onAppear {
            loadSubtitles()
        }
    }

    private func loadSubtitles() {
        guard let srtURL = item.subtitleURL else { return }

        // Resolve the security-scoped bookmark to get a URL with access rights
        guard let bookmarkData = UserDefaults.standard.data(forKey: "polycast.localFolderBookmark") else {
            loadError = "Cannot access folder"
            return
        }
        var isStale = false
        guard let folder = try? URL(resolvingBookmarkData: bookmarkData, bookmarkDataIsStale: &isStale) else {
            loadError = "Cannot access folder"
            return
        }
        guard folder.startAccessingSecurityScopedResource() else {
            loadError = "Cannot access folder"
            return
        }
        defer { folder.stopAccessingSecurityScopedResource() }

        do {
            let contents = try String(contentsOf: srtURL, encoding: .utf8)
            segments = SRTParser.parse(contents)
        } catch {
            loadError = error.localizedDescription
        }
    }
}
