import Foundation
import UIKit

extension APIClient {
    func conversations() async throws -> [Conversation] {
        try await request("/conversations")
    }

    func messages(friendId: String, before: String? = nil) async throws -> MessagesPage {
        var items: [URLQueryItem] = []
        if let before { items.append(.init(name: "before", value: before)) }
        return try await request("/messages/\(friendId)", queryItems: items)
    }

    func sendMessage(friendId: String, body: String) async throws -> ChatMessage {
        try await request("/messages/\(friendId)", method: "POST", body: ["body": body])
    }

    func markMessagesRead(friendId: String) async throws {
        struct ReadResult: Codable { let updated: Int }
        let _: ReadResult = try await request("/messages/\(friendId)/read", method: "POST")
    }

    func friends() async throws -> [Friend] {
        try await request("/friends")
    }

    func friendRequests() async throws -> [FriendRequest] {
        try await request("/friends/requests")
    }

    func sendFriendRequest(userId: String) async throws {
        struct Result: Codable { let id: String }
        let _: Result = try await request("/friends/request", method: "POST", body: ["userId": userId])
    }

    func acceptFriendRequest(id: String) async throws {
        let components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/friends/\(id)/accept"),
            resolvingAgainstBaseURL: false
        )
        guard let url = components?.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 {
            invalidateSessionAfterUnauthorizedResponse(path: "/friends/\(id)/accept")
            throw APIError.unauthorized
        }
        guard (200...299).contains(http.statusCode) else {
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = payload["error"] as? String ?? payload["message"] as? String {
                throw APIError.server(message)
            }
            throw APIError.server("Request failed with status \(http.statusCode).")
        }
    }

    func rejectFriendRequest(id: String) async throws {
        let components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/friends/\(id)/reject"),
            resolvingAgainstBaseURL: false
        )
        guard let url = components?.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 {
            invalidateSessionAfterUnauthorizedResponse(path: "/friends/\(id)/reject")
            throw APIError.unauthorized
        }
        guard (200...299).contains(http.statusCode) else {
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = payload["error"] as? String ?? payload["message"] as? String {
                throw APIError.server(message)
            }
            throw APIError.server("Request failed with status \(http.statusCode).")
        }
    }

    func searchUsers(query: String) async throws -> [UserSearchResult] {
        try await request("/users/search", queryItems: [.init(name: "q", value: query)])
    }

    // MARK: - Students

    func getClassroomStudents(classroomId: String) async throws -> [ClassroomStudent] {
        try await request("/classrooms/\(classroomId)/students")
    }

    func addClassroomStudent(classroomId: String, studentId: String) async throws {
        struct Result: Codable { let classroomId: String }
        let _: Result = try await request("/classrooms/\(classroomId)/students", method: "POST", body: [
            "studentId": studentId,
        ])
    }

    func removeClassroomStudent(classroomId: String, studentId: String) async throws {
        let components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/classrooms/\(classroomId)/students/\(studentId)"),
            resolvingAgainstBaseURL: false
        )
        guard let url = components?.url else { throw APIError.invalidResponse }

        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 {
            invalidateSessionAfterUnauthorizedResponse(path: "/classrooms/\(classroomId)/students/\(studentId)")
            throw APIError.unauthorized
        }
        guard (200...299).contains(http.statusCode) else {
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = payload["error"] as? String ?? payload["message"] as? String {
                throw APIError.server(message)
            }
            throw APIError.server("Request failed with status \(http.statusCode).")
        }
    }

    func getStudentStats(classroomId: String, studentId: String) async throws -> StudentDetailResponse {
        try await request("/classrooms/\(classroomId)/students/\(studentId)/stats")
    }

    // MARK: - Video Calling


}
