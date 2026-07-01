import Foundation
import Security

final class KeychainTokenStore {
    private let service = "com.patron.polycast"
    private let account = "auth-token"

    func save(token: String) {
        let data = Data(token.utf8)
        save(data: data, accessGroup: nil)
        if let accessGroup = Self.sharedAccessGroup {
            save(data: data, accessGroup: accessGroup)
        }
    }

    func load() -> String? {
        if let accessGroup = Self.sharedAccessGroup,
           let token = load(accessGroup: accessGroup) {
            return token
        }

        guard let token = load(accessGroup: nil) else { return nil }
        save(token: token)
        return token
    }

    func clear() {
        delete(accessGroup: nil)
        if let accessGroup = Self.sharedAccessGroup {
            delete(accessGroup: accessGroup)
        }
    }

    private func save(data: Data, accessGroup: String?) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ].withAccessGroup(accessGroup)

        SecItemDelete(query as CFDictionary)

        let attrs: [String: Any] = query.merging([
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]) { _, new in new }

        let status = SecItemAdd(attrs as CFDictionary, nil)
        if status != errSecSuccess {
            print("[Polycast] Failed to save auth token\(accessGroup.map { " for access group \($0)" } ?? ""): \(status)")
        }
    }

    private func load(accessGroup: String?) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ].withAccessGroup(accessGroup)

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func delete(accessGroup: String?) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ].withAccessGroup(accessGroup)
        SecItemDelete(query as CFDictionary)
    }

    private static var sharedAccessGroup: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "PolycastSharedKeychainAccessGroup") as? String,
              !value.isEmpty,
              !value.contains("$")
        else { return nil }
        return value
    }
}

private extension Dictionary where Key == String, Value == Any {
    func withAccessGroup(_ accessGroup: String?) -> [String: Any] {
        guard let accessGroup else { return self }
        var copy = self
        copy[kSecAttrAccessGroup as String] = accessGroup
        return copy
    }
}
