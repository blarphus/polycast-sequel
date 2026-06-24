import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    @EnvironmentObject private var library: BookLibrary
    @State private var showImporter = false
    @State private var importError = ""

    /// Audiobook linking: which book the picked audio attaches to, and whether
    /// the picker should select a single file (m4a) or a folder (mp3s).
    @State private var audioLinkBookID: String?
    @State private var audioLinkPicksFolder = false
    @State private var showAudioImporter = false

    private let grid = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        ScrollView {
            if library.books.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "books.vertical")
                        .font(.system(size: 52))
                        .foregroundStyle(.secondary)
                    Text("No books yet")
                        .font(.headline)
                    Text("Import an EPUB to read it with tap-to-translate, explanations, and saved-word highlighting.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button {
                        showImporter = true
                    } label: {
                        Label("Import EPUB", systemImage: "square.and.arrow.down")
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 4)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 80)
                .padding(.horizontal, 32)
            } else {
                LazyVGrid(columns: grid, spacing: 18) {
                    ForEach(library.books) { book in
                        NavigationLink {
                            ReaderView(meta: book)
                        } label: {
                            BookCard(book: book, coverURL: library.coverURL(for: book.id))
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button {
                                audioLinkBookID = book.id
                                audioLinkPicksFolder = false
                                showAudioImporter = true
                            } label: {
                                Label("Link Audiobook (M4A)", systemImage: "headphones")
                            }
                            Button {
                                audioLinkBookID = book.id
                                audioLinkPicksFolder = true
                                showAudioImporter = true
                            } label: {
                                Label("Link MP3 Folder", systemImage: "folder.badge.plus")
                            }
                            if library.hasAudio(for: book.id) {
                                Button(role: .destructive) {
                                    library.removeAudio(for: book.id)
                                } label: {
                                    Label("Remove Audiobook", systemImage: "speaker.slash")
                                }
                            }
                            Button(role: .destructive) {
                                library.delete(book.id)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
                .padding()
            }

            if !importError.isEmpty {
                Text(importError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal)
            }
        }
        .texturedBackground()
        .navigationTitle("Books")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showImporter = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: [.epub],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                do {
                    try library.importEpub(from: url)
                    importError = ""
                } catch {
                    importError = "Import failed: \(error.localizedDescription)"
                }
            case .failure(let error):
                importError = "Import failed: \(error.localizedDescription)"
            }
        }
        .fileImporter(
            isPresented: $showAudioImporter,
            allowedContentTypes: audioLinkPicksFolder ? [.folder] : [.audio],
            allowsMultipleSelection: false
        ) { result in
            defer { audioLinkBookID = nil }
            switch result {
            case .success(let urls):
                guard let url = urls.first, let bookID = audioLinkBookID else { return }
                do {
                    if audioLinkPicksFolder {
                        try library.linkAudioFolder(from: url, to: bookID)
                    } else {
                        try library.linkAudioFile(from: url, to: bookID)
                    }
                    importError = ""
                } catch {
                    importError = "Audiobook link failed: \(error.localizedDescription)"
                }
            case .failure(let error):
                importError = "Audiobook link failed: \(error.localizedDescription)"
            }
        }
    }
}

private struct BookCard: View {
    let book: BookMeta
    let coverURL: URL

    @State private var cover: UIImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.white.opacity(0.08))
                if let cover {
                    Image(uiImage: cover)
                        .resizable()
                        .scaledToFill()
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: "book.closed.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(.secondary)
                        Text(book.title)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 8)
                    }
                }
            }
            .frame(height: 200)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            Text(book.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
            if !book.author.isEmpty {
                Text(book.author)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .task {
            guard cover == nil, book.hasCover else { return }
            if let data = try? Data(contentsOf: coverURL) {
                cover = UIImage(data: data)
            }
        }
    }
}
