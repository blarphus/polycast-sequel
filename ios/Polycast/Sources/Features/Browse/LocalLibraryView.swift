import SwiftUI

struct LocalLibraryView: View {
    @StateObject private var store = LocalMediaStore()
    @State private var showPicker = false
    @State private var watchItem: LocalMediaItem?

    private let grid = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if store.items.isEmpty && !store.hasFolder {
                    VStack(spacing: 16) {
                        Image(systemName: "folder.badge.plus")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text("Choose a folder containing video files and matching .srt subtitle files.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Choose Folder") {
                            showPicker = true
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(40)
                } else if store.items.isEmpty {
                    EmptyStateView(
                        title: "No videos found",
                        subtitle: "The selected folder has no supported video files (.mp4, .mkv, .m4v, .mov, .avi)."
                    )
                } else {
                    LazyVGrid(columns: grid, spacing: 14) {
                        ForEach(store.items) { item in
                            Button {
                                watchItem = item
                            } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    ZStack {
                                        Rectangle().fill(.white.opacity(0.08))
                                        Image(systemName: "play.fill")
                                            .font(.title)
                                            .foregroundStyle(.white.opacity(0.6))
                                    }
                                    .frame(height: 110)
                                    .clipShape(RoundedRectangle(cornerRadius: 18))

                                    Text(item.title)
                                        .font(.headline)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)

                                    if item.subtitleURL != nil {
                                        Text("Subtitles available")
                                            .font(.caption)
                                            .foregroundStyle(.green)
                                    } else {
                                        Text("No subtitles")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
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
        .navigationTitle("Local Videos")
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showPicker = true
                } label: {
                    Image(systemName: "folder")
                }
            }
        }
        .sheet(isPresented: $showPicker) {
            FolderPicker { url in
                store.saveBookmark(for: url)
                showPicker = false
            }
        }
        .fullScreenCover(item: $watchItem) { item in
            NavigationStack {
                LocalWatchView(item: item)
            }
        }
        .onAppear {
            store.loadItems()
        }
    }
}
