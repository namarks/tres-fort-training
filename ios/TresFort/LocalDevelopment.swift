#if DEBUG && targetEnvironment(simulator)
import CryptoKit
import Foundation

/// Opt-in launch configuration, compiled out of Release and physical-device builds.
struct LocalDevelopmentConfiguration {
    let baseURL: URL
    let secret: String

    enum ConfigurationError: Error, LocalizedError {
        case missingValues, invalidURL, fixtureConflict

        var errorDescription: String? {
            switch self {
            case .missingValues:
                return "Set both TRESFORT_LOCAL_API_URL and TRESFORT_DEV_AUTH_SECRET in the Run scheme."
            case .invalidURL:
                return "TRESFORT_LOCAL_API_URL must be an HTTP loopback origin, such as http://127.0.0.1:8787, without a path, credentials, query, or fragment."
            case .fixtureConflict:
                return "Disable TRESFORT_UI_FIXTURE before enabling the local backend."
            }
        }
    }

    static let current: Self? = {
        do { return try parse(ProcessInfo.processInfo.environment) }
        catch { fatalError(error.localizedDescription) } // Never fall back to live credentials/API.
    }()

    static func parse(_ environment: [String: String]) throws -> Self? {
        let rawURL = environment["TRESFORT_LOCAL_API_URL"]
        let secret = environment["TRESFORT_DEV_AUTH_SECRET"]
        guard rawURL != nil || secret != nil else { return nil }
        guard environment["TRESFORT_UI_FIXTURE"] == nil else {
            throw ConfigurationError.fixtureConflict
        }
        guard let rawURL, !rawURL.isEmpty, let secret,
              !secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ConfigurationError.missingValues
        }
        guard var parts = URLComponents(string: rawURL), parts.scheme == "http",
              ["localhost", "127.0.0.1", "[::1]"].contains(parts.host?.lowercased() ?? ""),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              (1...65535).contains(parts.port ?? 80) else {
            throw ConfigurationError.invalidURL
        }
        parts.path = ""
        parts.host = parts.host?.lowercased()
        guard let url = parts.url else { throw ConfigurationError.invalidURL }
        return Self(baseURL: url, secret: secret)
    }

    /// The origin, never the secret, scopes both training state and Keychain items.
    var storageNamespace: String {
        let digest = SHA256.hash(data: Data(baseURL.absoluteString.utf8))
            .map { String(format: "%02x", $0) }.joined()
        return "com.nmarkspdx.tresfort.local.\(digest)"
    }

    func signInError(_ error: Error) -> String {
        if let status = (error as? APIError)?.httpStatus {
            if status == 401 {
                return "Local login was rejected. Match TRESFORT_DEV_AUTH_SECRET to DEV_AUTH_SECRET in .dev.vars, then relaunch."
            }
            if status == 404 {
                return "Local login is disabled. Set DEV_AUTH_SECRET in .dev.vars and restart the local Worker."
            }
            return "Local sign-in failed (HTTP \(status)). Check the local Worker terminal."
        }
        if let error = error as? URLError, error.code == .appTransportSecurityRequiresSecureConnection {
            return "Local HTTP is blocked. Regenerate the Xcode project and select a Debug simulator build."
        }
        if error is URLError {
            return "Couldn’t reach the local server at \(baseURL.absoluteString). Start npm run dev and check the port."
        }
        return "The local server returned an invalid sign-in response. Check the local Worker terminal."
    }
}

/// A redirect must not forward a development secret or local bearer elsewhere.
final class LocalDevelopmentTransport: NSObject, URLSessionTaskDelegate {
    static let session = URLSession(configuration: configuration(),
                                    delegate: LocalDevelopmentTransport(), delegateQueue: nil)

    private static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        configuration.timeoutIntervalForRequest = 10
        return configuration
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
#endif
