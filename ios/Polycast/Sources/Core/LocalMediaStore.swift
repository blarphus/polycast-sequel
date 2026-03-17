import SwiftUI
import UniformTypeIdentifiers
import CryptoKit

struct LocalMediaItem: Identifiable {
    let id: String
    let videoURL: URL
    let subtitleURL: URL?
    let title: String
}

@MainActor
class LocalMediaStore: ObservableObject {
    @Published var items: [LocalMediaItem] = []

    private static let bookmarkKey = "polycast.localFolderBookmark"
    private static let videoExtensions: Set<String> = ["mp4", "mkv", "m4v", "mov", "avi"]

    var hasFolder: Bool {
        UserDefaults.standard.data(forKey: Self.bookmarkKey) != nil
    }

    func loadItems() {
        guard let bookmarkData = UserDefaults.standard.data(forKey: Self.bookmarkKey) else {
            items = []
            return
        }

        var isStale = false
        guard let url = try? URL(resolvingBookmarkData: bookmarkData, bookmarkDataIsStale: &isStale) else {
            items = []
            return
        }

        if isStale {
            // Re-save bookmark
            if let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                UserDefaults.standard.set(fresh, forKey: Self.bookmarkKey)
            }
        }

        guard url.startAccessingSecurityScopedResource() else {
            items = []
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }

        scanFolder(url)
    }

    func saveBookmark(for url: URL) {
        guard url.startAccessingSecurityScopedResource() else { return }
        defer { url.stopAccessingSecurityScopedResource() }

        guard let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else { return }
        UserDefaults.standard.set(data, forKey: Self.bookmarkKey)
        scanFolder(url)
    }

    func clearFolder() {
        UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
        items = []
    }

    func folderURL() -> URL? {
        guard let bookmarkData = UserDefaults.standard.data(forKey: Self.bookmarkKey) else { return nil }
        var isStale = false
        return try? URL(resolvingBookmarkData: bookmarkData, bookmarkDataIsStale: &isStale)
    }

    private func scanFolder(_ folder: URL) {
        guard let contents = try? FileManager.default.contentsOfDirectory(
            at: folder,
            includingPropertiesForKeys: [.nameKey],
            options: [.skipsHiddenFiles]
        ) else {
            items = []
            return
        }

        let videoFiles = contents.filter { Self.videoExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }

        let srtFiles = Set(contents.filter { $0.pathExtension.lowercased() == "srt" }.map { $0.lastPathComponent.lowercased() })

        items = videoFiles.map { videoURL in
            let baseName = videoURL.deletingPathExtension().lastPathComponent
            // Try exact match first, then language-tagged (e.g. "video.pt.srt")
            let exactSrt = baseName + ".srt"
            let subtitleURL: URL? = if srtFiles.contains(exactSrt.lowercased()) {
                folder.appendingPathComponent(exactSrt)
            } else if let tagged = srtFiles.first(where: { $0.hasPrefix(baseName.lowercased() + ".") && $0.hasSuffix(".srt") }) {
                folder.appendingPathComponent(tagged)
            } else {
                nil
            }

            let hash = SHA256.hash(data: Data(videoURL.absoluteString.utf8))
            let id = hash.prefix(8).map { String(format: "%02x", $0) }.joined()

            return LocalMediaItem(
                id: id,
                videoURL: videoURL,
                subtitleURL: subtitleURL,
                title: baseName
            )
        }
    }
}

struct FolderPicker: UIViewControllerRepresentable {
    let onPick: (URL) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onPick: onPick)
    }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: (URL) -> Void

        init(onPick: @escaping (URL) -> Void) {
            self.onPick = onPick
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            onPick(url)
        }
    }
}
