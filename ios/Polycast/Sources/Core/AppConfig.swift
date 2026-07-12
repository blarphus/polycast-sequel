import Foundation

enum AppConfig {
    static let defaultBaseURL = URL(string: "https://polycast-sequel.onrender.com")!
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
