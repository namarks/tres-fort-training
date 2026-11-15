import Foundation
import Security

/// Minimal Keychain-backed store for the app JWT. The JWT is a bearer
/// credential — Keychain (not UserDefaults) is the right home for it.
enum Keychain {
    static let appTokenAccount = "app_jwt"
    /// The owner's own session while they try setup as a test member.
    static let parkedOwnerTokenAccount = "parked_owner_jwt"
    private static let service: String = {
#if DEBUG && targetEnvironment(simulator)
        if let local = LocalDevelopmentConfiguration.current { return local.storageNamespace }
#endif
        return "com.nmarkspdx.tresfort"
    }()

    static func save(_ token: String, account: String = appTokenAccount) {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load(account: String = appTokenAccount) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8)
        else { return nil }
        return token
    }

    static func clear(account: String = appTokenAccount) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ] as CFDictionary)
    }
}

protocol AppTokenStore {
    func save(_ token: String)
    func load() -> String?
    func clear()
}

struct KeychainTokenStore: AppTokenStore {
    var account = Keychain.appTokenAccount
    func save(_ token: String) { Keychain.save(token, account: account) }
    func load() -> String? { Keychain.load(account: account) }
    func clear() { Keychain.clear(account: account) }
}
