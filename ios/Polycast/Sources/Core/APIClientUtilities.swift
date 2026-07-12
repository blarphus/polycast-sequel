import Foundation
import UIKit

extension APIClient {
    func iceServers() async throws -> IceServerResponse {
        try await request("/ice-servers")
    }

    // MARK: - Image Proxy

    func authorizedRequest(for url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        guard Self.isSameOrigin(url, AppConfig.baseURL), let token else {
            return request
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    static func proxyImageURL(_ urlString: String?) -> URL? {
        guard let urlString else { return nil }
        let normalizedURLString = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedURLString.isEmpty else { return nil }

        // Proxy Pixabay images to avoid hotlinking and rate-limiting issues.
        // We match both pixabay.com/get/... and cdn.pixabay.com/...
        // Support both http and https prefixes to be safe against older data.
        let isPixabay = normalizedURLString.hasPrefix("https://pixabay.com/") ||
                        normalizedURLString.hasPrefix("http://pixabay.com/") ||
                        normalizedURLString.hasPrefix("https://cdn.pixabay.com/") ||
                        normalizedURLString.hasPrefix("http://cdn.pixabay.com/")

        if isPixabay {
            var components = URLComponents(url: AppConfig.baseURL.appendingPathComponent("api/dictionary/image-proxy"), resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "url", value: normalizedURLString)]
            return components?.url
        }

        // Server-relative paths (e.g. /api/dictionary/image/<id>) resolve
        // against the API host.
        if normalizedURLString.hasPrefix("/") {
            return URL(string: normalizedURLString, relativeTo: AppConfig.baseURL)?.absoluteURL
        }

        return URL(string: normalizedURLString)
    }

    private static func isSameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && effectivePort(lhs) == effectivePort(rhs)
    }

    private static func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }

}
