import Foundation
import UIKit

enum APIError: LocalizedError {
    case invalidResponse
    case server(String)
    case unauthorized
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The server returned an invalid response."
        case .server(let message):
            return message
        case .unauthorized:
            return "Your session has expired. Please log in again."
        case .encodingFailed:
            return "The request could not be encoded."
        }
    }
}
final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    static let sessionExpiredNotification = Notification.Name("PolycastAPISessionExpired")

    var token: String? {
        didSet {
            guard token != nil else { return }
            sessionExpirationLock.lock()
            sessionExpirationReported = false
            sessionExpirationLock.unlock()
        }
    }

    let decoder: JSONDecoder
    let session: URLSession
    let sessionExpirationLock = NSLock()
    var sessionExpirationReported = false

    private init() {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        session = URLSession(configuration: config)

        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    func invalidateSessionAfterUnauthorizedResponse(path: String) {
        sessionExpirationLock.lock()
        let shouldReport = token != nil && !sessionExpirationReported
        if shouldReport {
            sessionExpirationReported = true
            token = nil
        }
        sessionExpirationLock.unlock()
        guard shouldReport else { return }

        let correlationID = UUID().uuidString
        Task { @MainActor in
            FallbackNoticeCenter.shared.show(
                code: "session_expired",
                severity: "error",
                title: "Session expired",
                message: "Your signed-in session is no longer valid. Polycast signed this device out; please log in again.",
                detail: "status=401; path=\(path)",
                source: "ios.api",
                operation: "invalidate-session",
                correlationID: correlationID
            )
            NotificationCenter.default.post(
                name: Self.sessionExpiredNotification,
                object: self,
                userInfo: ["path": path, "correlationId": correlationID]
            )
        }
    }

    func regionCode() -> String? {
        Locale.current.region?.identifier
    }

    func surfaceFallbackNotices(from data: Data) {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let notices = object["fallback_notices"] as? [[String: Any]]
        else { return }

        for item in notices {
            let title = item["title"] as? String ?? "Fallback used"
            let message = item["message"] as? String ?? ""
            let detail = item["detail"] as? String ?? ""
            let occurredAt = (item["occurredAt"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) } ?? .now
            let code = item["code"] as? String ?? "fallback_used"
            let severity = item["severity"] as? String ?? "warning"
            let source = item["source"] as? String ?? "ios.api"
            let operation = item["operation"] as? String ?? "server-response"
            let correlationID = item["correlationId"] as? String ?? UUID().uuidString
            Task { @MainActor in
                FallbackNoticeCenter.shared.show(
                    code: code,
                    severity: severity,
                    title: title,
                    message: message.isEmpty ? "Polycast used a fallback path." : message,
                    detail: detail.isEmpty ? nil : detail,
                    source: source,
                    operation: operation,
                    correlationID: correlationID,
                    occurredAt: occurredAt
                )
            }
        }
    }

    func surfaceFallbackNotices(from response: HTTPURLResponse) {
        guard let encoded = response.value(forHTTPHeaderField: "X-Polycast-Fallback-Diagnostics") else { return }
        var base64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard
            let data = Data(base64Encoded: base64),
            let notices = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
            let wrapped = try? JSONSerialization.data(withJSONObject: ["fallback_notices": notices])
        else {
            Task { @MainActor in
                FallbackNoticeCenter.shared.show(
                    code: "fallback_header_invalid",
                    severity: "warning",
                    title: "Fallback details could not be read",
                    message: "The server reported an alternate path, but its diagnostic header was malformed.",
                    detail: "headerLength=\(encoded.count)",
                    source: "ios.api",
                    operation: "parse-response-header"
                )
            }
            return
        }
        surfaceFallbackNotices(from: wrapped)
    }

    func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        queryItems: [URLQueryItem] = [],
        body: [String: Any]? = nil,
        maxRetries: Int? = nil,
        idempotencyKey: String? = nil
    ) async throws -> T {
        var components = URLComponents(url: AppConfig.baseURL.appendingPathComponent("api\(path)"), resolvingAgainstBaseURL: false)
        if !queryItems.isEmpty {
            components?.queryItems = queryItems
        }
        guard let url = components?.url else { throw APIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            guard JSONSerialization.isValidJSONObject(body) else { throw APIError.encodingFailed }
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        // Mutations are never retried implicitly: a lost response could otherwise
        // duplicate the server-side effect. Callers that add an idempotency key may
        // opt in explicitly in a future endpoint-specific implementation.
        let isIdempotentRead = ["GET", "HEAD"].contains(method.uppercased())
        let retryBudget = maxRetries ?? (isIdempotentRead ? 1 : 0)
        if !isIdempotentRead && retryBudget > 0 && idempotencyKey == nil {
            throw APIError.encodingFailed
        }
        var lastError: Error = APIError.invalidResponse
        for attempt in 0...retryBudget {
            if attempt > 0 {
                let exponential = min(2_000, 500 * (1 << min(attempt - 1, 2)))
                let jitter = Int.random(in: 0...250)
                try await Task.sleep(for: .milliseconds(exponential + jitter))
            }

            let data: Data
            let response: URLResponse
            do {
                (data, response) = try await session.data(for: request)
            } catch {
                lastError = error
                guard attempt < retryBudget else { throw error }
                await MainActor.run {
                    FallbackNoticeCenter.shared.show(
                        code: "network_retry_used",
                        severity: "warning",
                        title: "Network retry used",
                        message: "The request lost its network response, so Polycast retried it with the same safety key.",
                        detail: "method=\(method.uppercased()); path=\(path); attempt=\(attempt + 2); idempotencyKey=\(idempotencyKey ?? "read-only")",
                        source: "ios.api",
                        operation: "request-retry"
                    )
                }
                continue
            }
            guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
            surfaceFallbackNotices(from: http)

            if http.statusCode == 401 {
                invalidateSessionAfterUnauthorizedResponse(path: path)
                throw APIError.unauthorized
            }

            if http.statusCode >= 500, attempt < retryBudget {
                await MainActor.run {
                    FallbackNoticeCenter.shared.show(
                        code: isIdempotentRead ? "network_read_retry_used" : "network_mutation_retry_used",
                        severity: "warning",
                        title: "Network retry used",
                        message: isIdempotentRead
                            ? "The server returned \(http.statusCode), so Polycast retried this read request."
                            : "The server returned \(http.statusCode), so Polycast retried this mutation with the same safety key.",
                        detail: "method=\(method.uppercased()); path=\(path); attempt=\(attempt + 2); idempotencyKey=\(idempotencyKey ?? "read-only")",
                        source: "ios.api",
                        operation: "request-retry"
                    )
                }
                lastError = APIError.server("Request failed with status \(http.statusCode).")
                continue
            }

            guard (200...299).contains(http.statusCode) else {
                if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let message = payload["error"] as? String ?? payload["message"] as? String {
                    throw APIError.server(message)
                }
                throw APIError.server("Request failed with status \(http.statusCode).")
            }

            surfaceFallbackNotices(from: data)
            return try decoder.decode(T.self, from: data)
        }

        throw lastError
    }

}
