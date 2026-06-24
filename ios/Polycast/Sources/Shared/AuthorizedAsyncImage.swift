import SwiftUI
import UIKit

/// In-memory cache for word images so expanding the same dictionary row (or
/// re-showing a flashcard) doesn't refetch. NSCache is thread-safe; the
/// annotation just tells Swift concurrency checking that.
private nonisolated(unsafe) let wordImageCache = NSCache<NSURL, UIImage>()

/// Warm the image cache ahead of time so upcoming slides/cards render instantly
/// (no load flash). Skips URLs already cached; failures are silent — the normal
/// on-appear load will retry and surface any error then.
func prefetchWordImages(_ urls: [URL]) {
    for url in urls where wordImageCache.object(forKey: url as NSURL) == nil {
        Task {
            let request = APIClient.shared.authorizedRequest(for: url)
            guard let (data, response) = try? await URLSession.shared.data(for: request),
                  let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode),
                  let image = UIImage(data: data) else { return }
            wordImageCache.setObject(image, forKey: url as NSURL)
        }
    }
}

/// Drop-in AsyncImage replacement that sends the session's Bearer token when
/// the image is served by our own API (e.g. /api/dictionary/image/<id>, which
/// requires auth — plain AsyncImage gets a 401 there).
struct AuthorizedAsyncImage<Content: View>: View {
    let url: URL?
    @ViewBuilder let content: (AsyncImagePhase) -> Content

    @State private var phase: AsyncImagePhase = .empty

    init(url: URL?, @ViewBuilder content: @escaping (AsyncImagePhase) -> Content) {
        self.url = url
        self.content = content
    }

    var body: some View {
        // The .task must hang off a view that always exists in the hierarchy.
        // Callers often return EmptyView() for the .empty phase, and a task
        // attached to EmptyView never runs — the image would never load.
        ZStack {
            content(phase)
        }
        .task(id: url) { await load() }
    }

    private func load() async {
        phase = .empty
        guard let url else {
            return
        }
        if let cached = wordImageCache.object(forKey: url as NSURL) {
            phase = .success(Image(uiImage: cached))
            return
        }

        let request = APIClient.shared.authorizedRequest(for: url)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let image = UIImage(data: data) else {
                throw URLError(.badServerResponse)
            }
            wordImageCache.setObject(image, forKey: url as NSURL)
            NSLog("[Polycast] Image loaded (%@)", url.absoluteString)
            phase = .success(Image(uiImage: image))
        } catch {
            NSLog("[Polycast] Image load failed (%@): %@", url.absoluteString, error.localizedDescription)
            phase = .failure(error)
        }
    }
}
