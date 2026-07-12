import Foundation
import WidgetKit

@MainActor
final class SessionStore: ObservableObject {
    @Published var user: AuthUser?
    @Published var isLoading = true
    @Published var authError: String?

    private let tokenStore = KeychainTokenStore()
    private let api = APIClient.shared
    private var lastWidgetSnapshotRefresh: Date?
    nonisolated(unsafe) private var sessionExpirationObserver: NSObjectProtocol?

    var needsOnboarding: Bool {
        user?.nativeLanguage == nil || user?.targetLanguage == nil
    }

    init() {
        api.token = tokenStore.load()
        sessionExpirationObserver = NotificationCenter.default.addObserver(
            forName: APIClient.sessionExpiredNotification,
            object: api,
            queue: .main
        ) { [weak self] notification in
            let path = notification.userInfo?["path"] as? String ?? "unknown"
            let correlationID = notification.userInfo?["correlationId"] as? String ?? "missing"
            Task { @MainActor [weak self] in
                self?.handleExpiredSession(path: path, correlationID: correlationID)
            }
        }
        if api.token != nil {
            reloadTodayWordsWidget()
        }
        Task {
            await restoreSession()
        }
    }

    deinit {
        if let sessionExpirationObserver {
            NotificationCenter.default.removeObserver(sessionExpirationObserver)
        }
    }

    private func handleExpiredSession(path: String, correlationID: String) {
        tokenStore.clear()
        api.token = nil
        SocketClient.shared.disconnect()
        user = nil
        authError = "Your session expired. Please log in again."
        TodayWordsWidgetStore.clearSnapshot()
        WidgetCenter.shared.reloadAllTimelines()
        PolycastLog.runtime.error(
            "[Polycast] Session invalidated source=ios.api operation=invalidate-session path=\(path, privacy: .public) correlation=\(correlationID, privacy: .public)"
        )
    }

    func restoreSession() async {
        isLoading = true
        authError = nil

        guard tokenStore.load() != nil else {
            user = nil
            isLoading = false
            return
        }

        do {
            user = try await api.getMe()
            await renewSessionToken()
            reloadTodayWordsWidget()
            SocketClient.shared.connect()
            VoIPPushManager.shared.refreshRegistration()
        } catch {
            tokenStore.clear()
            api.token = nil
            user = nil
            authError = error.localizedDescription
        }

        isLoading = false
    }

    func login(username: String, password: String) async -> Bool {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.login(
                username: username.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password
            )
            api.token = response.token
            tokenStore.save(token: response.token)
            user = response.user
            authError = nil
            reloadTodayWordsWidget()
            SocketClient.shared.connect()
            VoIPPushManager.shared.refreshRegistration()
            return true
        } catch {
            PolycastLog.runtime.error("[Polycast] Login error: \(error)")
            authError = error.localizedDescription
            return false
        }
    }

    func signup(username: String, password: String, displayName: String) async -> Bool {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.signup(
                username: username.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password,
                displayName: displayName.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            api.token = response.token
            tokenStore.save(token: response.token)
            user = response.user
            authError = nil
            reloadTodayWordsWidget()
            SocketClient.shared.connect()
            VoIPPushManager.shared.refreshRegistration()
            return true
        } catch {
            authError = error.localizedDescription
            return false
        }
    }

    func updateSettings(nativeLanguage: String?, targetLanguage: String?, dailyNewLimit: Int, accountType: String, cefrLevel: String?) async -> Bool {
        do {
            user = try await api.updateSettings(
                nativeLanguage: nativeLanguage,
                targetLanguage: targetLanguage,
                dailyNewLimit: dailyNewLimit,
                accountType: accountType,
                cefrLevel: cefrLevel
            )
            authError = nil
            return true
        } catch {
            authError = error.localizedDescription
            return false
        }
    }

    func logout() {
        VoIPPushManager.shared.unregisterCurrentToken()
        SocketClient.shared.disconnect()
        tokenStore.clear()
        api.token = nil
        user = nil
        authError = nil
        reloadTodayWordsWidget()
    }

    private func renewSessionToken() async {
        do {
            let token = try await api.exportSessionToken()
            api.token = token
            tokenStore.save(token: token)
            reloadTodayWordsWidget()
        } catch {
            reportFallback(
                code: "session_token_refresh_fallback",
                title: "Session refresh fallback used",
                message: "Polycast could not rotate the session token, so the current short-lived session remains active.",
                source: "ios.session",
                operation: "renew-session-token",
                error: error
            )
        }
    }

    private func reloadTodayWordsWidget() {
        WidgetCenter.shared.reloadAllTimelines()
        refreshTodayWordsWidgetSnapshot()
    }

    private func refreshTodayWordsWidgetSnapshot() {
        guard api.token != nil else {
            TodayWordsWidgetStore.clearSnapshot()
            WidgetCenter.shared.reloadAllTimelines()
            return
        }

        let now = Date()
        if let lastWidgetSnapshotRefresh, now.timeIntervalSince(lastWidgetSnapshotRefresh) < 30 {
            return
        }
        lastWidgetSnapshotRefresh = now

        Task {
            do {
                let snapshot = try await api.todayWordsWidgetSnapshot()
                TodayWordsWidgetStore.saveSnapshot(snapshot)
                await api.cacheTodayWordsWidgetImages(for: snapshot)
                WidgetCenter.shared.reloadAllTimelines()
            } catch {
                reportFallback(
                    code: "widget_cached_snapshot_fallback",
                    title: "Cached widget snapshot used",
                    message: "The latest widget data could not be loaded, so the widget will keep its last saved snapshot.",
                    source: "ios.session",
                    operation: "refresh-widget-snapshot",
                    error: error
                )
            }
        }
    }
}
