import Foundation

// Garmin (docs/plans/garmin): the iOS half of "Connect Garmin". Same shape as
// WHOOP: POST /auth/garmin/start → Garmin's consent URL → the shared web auth
// sheet → the Worker exchanges the code (with PKCE and its client secret) and
// sends the browser back to `tresfort://garmin-connected?completion=…` → this
// app session posts that secret to /auth/garmin/finish. Garmin tokens never
// reach the app.
//
// What arrives: each workout the member syncs to Garmin Connect from now on
// (Garmin's access has no history), with its heart rate, power and pace,
// labeled with the Garmin device that recorded it. It stays private to the
// member: never in group views or AI apps.

extension APIClient {
    func startGarminOAuth(jwt: String) async throws -> URL {
        struct Resp: Decodable { let authorize_url: String }
        let r: Resp = try await post("auth/garmin/start", body: [:], jwt: jwt)
        guard let url = URL(string: r.authorize_url) else {
            throw APIError.decoding("malformed authorize_url")
        }
        return url
    }

    func finishGarminOAuth(completion: String, jwt: String) async throws -> GarminFinish {
        try await post("auth/garmin/finish", body: ["completion": completion], jwt: jwt)
    }

    func garminStatus(jwt: String) async throws -> GarminStatus {
        try await get("api/me/garmin", jwt: jwt)
    }

    func disconnectGarmin(jwt: String) async throws {
        let _: EmptyResponse = try await delete("api/me/garmin", jwt: jwt)
    }
}

struct GarminFinish: Decodable, Equatable {
    let connected: Bool
    let activity_permission: Bool
}

struct GarminStatus: Decodable, Equatable {
    let configured: Bool
    let connected: Bool
    /// False when the member turned off sharing activities on Garmin's
    /// consent screen: connected, but no workouts will arrive.
    let activity_permission: Bool
    let needs_reauth: Bool
    let connected_at: Int?
    let last_synced_at: Int?
}

enum GarminCallback {
    /// The completion secret from `tresfort://garmin-connected?completion=…`.
    /// A declined or failed connect comes back as `?error=…` and throws with
    /// the reason so the screen can say what happened.
    static func completion(from url: URL) throws -> String {
        guard url.scheme == "tresfort", url.host == "garmin-connected" else {
            throw APIError.decoding("invalid Garmin callback")
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if items.count == 1, items[0].name == "error" {
            throw GarminConnectError.provider(items[0].value ?? "unknown")
        }
        guard items.count == 1, items[0].name == "completion", let secret = items[0].value,
              secret.count == 43,
              secret.allSatisfy({ "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-".contains($0) }) else {
            throw APIError.decoding("invalid Garmin completion")
        }
        return secret
    }
}

enum GarminConnectError: Error, Equatable, LocalizedError {
    case provider(String)

    var errorDescription: String? {
        switch self {
        case .provider("access_denied"): return "Garmin wasn’t connected because access was declined."
        case .provider("account_in_use"): return "That Garmin account is already connected to another Très Fort member."
        case .provider: return "Garmin couldn’t be connected. Try again."
        }
    }
}

@MainActor
final class GarminModel: ObservableObject {
    @Published private(set) var status: GarminStatus?
    @Published private(set) var statusUnavailable = false
    @Published private(set) var isWorking = false
    @Published var message: String?

    private let jwt: () -> String?
    private let api: APIClient
    private let authorizer: ((URL) async throws -> URL?)?
    private let onUnauthorized: (String) -> Void

    init(jwt: @escaping () -> String?,
         api: APIClient = APIClient(),
         authorizer: ((URL) async throws -> URL?)? = nil,
         onUnauthorized: @escaping (String) -> Void = { _ in }) {
        self.jwt = jwt
        self.api = api
        self.authorizer = authorizer
        self.onUnauthorized = onUnauthorized
    }

    /// Scoped to the signed-in account that opened the screen.
    convenience init(auth: AuthModel) {
        let accountID = auth.userID
        self.init(
            jwt: { [weak auth] in
                guard let auth, auth.userID == accountID else { return nil }
                return auth.featureJWT
            },
            onUnauthorized: { [weak auth] refused in
                guard let auth, auth.userID == accountID, auth.featureJWT == refused else { return }
                auth.requireReauthentication()
            })
    }

    var connected: Bool { status?.connected == true }

    func loadStatus() async {
        guard let token = jwt() else { return }
        do {
            status = try await api.garminStatus(jwt: token)
            statusUnavailable = false
        } catch {
            statusUnavailable = true
            handle(error, token: token, report: false)
        }
    }

    func connect() async {
        guard !isWorking, let token = jwt() else { return }
        isWorking = true
        defer { isWorking = false }
        message = nil
        do {
            let url = try await api.startGarminOAuth(jwt: token)
            let callback: URL?
            if let authorizer { callback = try await authorizer(url) }
            else { callback = try await IntervalsWebAuth().callbackURL(for: url) }
            guard let callback else { return } // dismissed
            let completion = try GarminCallback.completion(from: callback)
            guard let current = jwt() else { return }
            let finished = try await api.finishGarminOAuth(completion: completion, jwt: current)
            message = finished.activity_permission
                ? "Connected. Workouts you sync to Garmin Connect from now on will appear here."
                : "Connected, but Garmin isn’t sharing your activities. Reconnect and allow Activities to bring in your workouts."
            await loadStatus()
        } catch let error as GarminConnectError {
            message = error.localizedDescription
        } catch {
            if case APIError.http(409, _) = error {
                message = GarminConnectError.provider("account_in_use").localizedDescription
            } else if case APIError.http(503, _) = error {
                message = "Garmin isn’t set up on the server yet."
            } else {
                handle(error, token: token, report: true)
            }
        }
    }

    func disconnect() async {
        guard !isWorking, let token = jwt() else { return }
        isWorking = true
        defer { isWorking = false }
        message = nil
        do {
            try await api.disconnectGarmin(jwt: token)
            message = "Disconnected. Your Garmin workouts were removed from Très Fort."
        } catch {
            handle(error, token: token, report: true)
        }
        await loadStatus()
    }

    private func handle(_ error: Error, token: String, report: Bool) {
        if case APIError.http(401, _) = error {
            onUnauthorized(token)
        } else if report {
            message = error.localizedDescription
        }
    }
}
