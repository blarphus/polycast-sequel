import Foundation
import UIKit

extension APIClient {
    func login(username: String, password: String) async throws -> AuthResponse {
        try await request("/login", method: "POST", body: [
            "username": username,
            "password": password,
        ])
    }

    func signup(username: String, password: String, displayName: String) async throws -> AuthResponse {
        try await request("/signup", method: "POST", body: [
            "username": username,
            "password": password,
            "display_name": displayName,
        ])
    }

    func getMe() async throws -> AuthUser {
        try await request("/me")
    }

    func exportSessionToken() async throws -> String {
        struct SessionTokenResponse: Codable {
            let token: String
        }

        let response: SessionTokenResponse = try await request("/session/export", method: "POST")
        return response.token
    }

    func updateSettings(
        nativeLanguage: String?,
        targetLanguage: String?,
        dailyNewLimit: Int,
        accountType: String,
        cefrLevel: String?
    ) async throws -> AuthUser {
        var body: [String: Any] = [
            "native_language": nativeLanguage as Any,
            "target_language": targetLanguage as Any,
            "daily_new_limit": dailyNewLimit,
        ]
        if let cefrLevel {
            body["cefr_level"] = cefrLevel
        }
        _ = accountType // privileged role is server-managed
        return try await request("/me/settings", method: "PATCH", body: body)
    }


}
