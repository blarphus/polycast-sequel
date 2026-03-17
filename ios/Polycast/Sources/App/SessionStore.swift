import Foundation

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
            let response = try await api.login(username: username, password: password)
            api.token = response.token
            tokenStore.save(token: response.token)
            user = response.user
            authError = nil
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
            let response = try await api.signup(username: username, password: password, displayName: displayName)
            api.token = response.token
            tokenStore.save(token: response.token)
            user = response.user
            authError = nil
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
    }
}
