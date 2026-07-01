import Foundation
import WidgetKit

@MainActor
final class SessionStore: ObservableObject {
    @Published var user: AuthUser?
    @Published var isLoading = true
    @Published var authError: String?

    private let tokenStore = KeychainTokenStore()
    private let api = APIClient.shared

    var needsOnboarding: Bool {
        user?.nativeLanguage == nil || user?.targetLanguage == nil
    }

    init() {
        api.token = tokenStore.load()
        if api.token != nil {
            reloadTodayWordsWidget()
        }
        Task {
            await restoreSession()
        }
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
            print("[Polycast] Login error: \(error)")
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
            print("[Polycast] Session token refresh failed: \(error)")
        }
    }

    private func reloadTodayWordsWidget() {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
