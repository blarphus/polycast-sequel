import Foundation

enum AppConfig {
    static let defaultBaseURL = URL(string: "https://polycast-sequel.onrender.com")!
    static let transcriptWorkerURL = "https://polycast-transcript-worker.polycast-app.workers.dev"
    static let transcriptWorkerSecret = "fd5f4a711388f9dbdb54b0a97b0729ac8bc2b15cf10d8d576271046d118c6fbd"

    static var baseURL: URL {
        if let override = UserDefaults.standard.string(forKey: "polycast.baseURL"),
           let url = URL(string: override),
           let scheme = url.scheme,
           ["http", "https"].contains(scheme.lowercased()) {
            return url
        }
        return defaultBaseURL
    }
}
