import Foundation

// WHOOP (docs/plans/whoop): the iOS half of "Connect WHOOP". Same shape as
// intervals.icu: POST /auth/whoop/start → authorize URL → the shared web auth
// sheet → the Worker exchanges the code with its client secret and sends the
// browser back to `tresfort://whoop-connected?completion=…` → this app session
// posts that secret to /auth/whoop/finish. WHOOP tokens never reach the app.
//
// What arrives: WHOOP workouts land with the member's other activities (with
// their heart-rate load and WHOOP strain), and each day's recovery, HRV,
// resting heart rate and sleep show on Today. Both stay private to the member.

extension APIClient {
    func startWhoopOAuth(jwt: String) async throws -> URL {
        struct Resp: Decodable { let authorize_url: String }
        let r: Resp = try await post("auth/whoop/start", body: [:], jwt: jwt)
        guard let url = URL(string: r.authorize_url) else {
            throw APIError.decoding("malformed authorize_url")
        }
        return url
    }

    func finishWhoopOAuth(completion: String, jwt: String) async throws -> Bool {
        struct Resp: Decodable { let connected: Bool }
        let r: Resp = try await post("auth/whoop/finish", body: ["completion": completion], jwt: jwt)
        return r.connected
    }

    func whoopStatus(jwt: String) async throws -> WhoopStatus {
        try await get("api/me/whoop", jwt: jwt)
    }

    func disconnectWhoop(jwt: String) async throws {
        let _: EmptyResponse = try await delete("api/me/whoop", jwt: jwt)
    }

    func syncWhoop(jwt: String) async throws {
        let _: EmptyResponse = try await post("api/me/whoop/sync", body: [:], jwt: jwt)
    }

    func recoveryDays(from: String, to: String, jwt: String) async throws -> [RecoveryDay] {
        struct Resp: Decodable { let days: [RecoveryDay] }
        let r: Resp = try await get("api/me/recovery?from=\(from)&to=\(to)", jwt: jwt)
        return r.days
    }
}

struct WhoopStatus: Decodable, Equatable {
    let configured: Bool
    let connected: Bool
    let needs_reauth: Bool
    let connected_at: Int?
    let last_synced_at: Int?
}

/// One day's recovery and the night of sleep before it, dated by the morning
/// the member woke up. Any value can be missing: WHOOP scores some days late
/// or not at all, and nothing here is ever filled in.
struct RecoveryDay: Decodable, Equatable, Identifiable {
    let date: String
    let recovery_score: Double?
    let hrv_rmssd_ms: Double?
    let resting_hr: Double?
    let spo2_pct: Double?
    let skin_temp_c: Double?
    let calibrating: Bool?
    let sleep_ms: Int?
    let in_bed_ms: Int?
    let sleep_performance_pct: Double?
    let sleep_efficiency_pct: Double?
    let respiratory_rate: Double?
    let day_strain: Double?

    var id: String { date }

    /// True when there is something to show.
    var hasValues: Bool {
        recovery_score != nil || hrv_rmssd_ms != nil || resting_hr != nil || sleep_ms != nil
    }
}

enum WhoopCallback {
    /// The completion secret from `tresfort://whoop-connected?completion=…`.
    /// A declined or failed connect comes back as `?error=…` and throws with
    /// WHOOP's reason so the screen can say what happened.
    static func completion(from url: URL) throws -> String {
        guard url.scheme == "tresfort", url.host == "whoop-connected" else {
            throw APIError.decoding("invalid WHOOP callback")
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if items.count == 1, items[0].name == "error" {
            throw WhoopConnectError.provider(items[0].value ?? "unknown")
        }
        guard items.count == 1, items[0].name == "completion", let secret = items[0].value,
              secret.count == 43,
              secret.allSatisfy({ "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-".contains($0) }) else {
            throw APIError.decoding("invalid WHOOP completion")
        }
        return secret
    }
}

enum WhoopConnectError: Error, Equatable, LocalizedError {
    case provider(String)

    var errorDescription: String? {
        switch self {
        case .provider("access_denied"): return "WHOOP wasn’t connected because access was declined."
        case .provider("account_in_use"): return "That WHOOP account is already connected to another Très Fort member."
        case .provider: return "WHOOP couldn’t be connected. Try again."
        }
    }
}

enum WhoopFormat {
    static func percent(_ value: Double?) -> String? {
        value.map { "\(Int($0.rounded()))%" }
    }

    static func whole(_ value: Double?, unit: String) -> String? {
        value.map { "\(Int($0.rounded())) \(unit)" }
    }

    /// "7h 32m".
    static func duration(_ ms: Int?) -> String? {
        guard let ms, ms > 0 else { return nil }
        let minutes = Int((Double(ms) / 60_000).rounded())
        return minutes >= 60 ? "\(minutes / 60)h \(String(format: "%02d", minutes % 60))m" : "\(minutes)m"
    }

    /// Today's row if WHOOP has scored it, else nil. A row from an earlier day
    /// is never shown as today's recovery.
    static func today(_ days: [RecoveryDay], today: String) -> RecoveryDay? {
        days.last { $0.date == today && $0.hasValues }
    }
}

@MainActor
final class WhoopModel: ObservableObject {
    @Published private(set) var status: WhoopStatus?
    @Published private(set) var statusUnavailable = false
    @Published private(set) var isWorking = false
    @Published private(set) var today: RecoveryDay?
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
            status = try await api.whoopStatus(jwt: token)
            statusUnavailable = false
        } catch {
            statusUnavailable = true
            handle(error, token: token, report: false)
        }
    }

    /// Today's recovery for the Today screen. Re-reads the connection each
    /// time, since connecting happens on another screen, reads recovery only
    /// when connected, and clears it when the member disconnects or WHOOP
    /// hasn't scored today. An earlier day's card is dropped before reading,
    /// so a failed read never shows yesterday's recovery as today's.
    func loadToday(date: Date = Date()) async {
        let day = CalendarProjection.dateString(date)
        if today?.date != day { today = nil }
        guard let token = jwt() else { return }
        await loadStatus()
        guard connected else { today = nil; return }
        let yesterday = CalendarProjection.dateString(date.addingTimeInterval(-86_400))
        do {
            today = WhoopFormat.today(try await api.recoveryDays(from: yesterday, to: day, jwt: token), today: day)
        } catch {
            handle(error, token: token, report: false)
        }
    }

    func connect() async {
        guard !isWorking, let token = jwt() else { return }
        isWorking = true
        defer { isWorking = false }
        message = nil
        do {
            let url = try await api.startWhoopOAuth(jwt: token)
            let callback: URL?
            if let authorizer { callback = try await authorizer(url) }
            else { callback = try await IntervalsWebAuth().callbackURL(for: url) }
            guard let callback else { return } // dismissed
            let completion = try WhoopCallback.completion(from: callback)
            guard let current = jwt() else { return }
            _ = try await api.finishWhoopOAuth(completion: completion, jwt: current)
            message = "Connected. Your WHOOP workouts and recovery are on their way."
            await loadStatus()
        } catch let error as WhoopConnectError {
            message = error.localizedDescription
        } catch {
            if case APIError.http(409, _) = error {
                message = WhoopConnectError.provider("account_in_use").localizedDescription
            } else if case APIError.http(503, _) = error {
                message = "WHOOP isn’t set up on the server yet."
            } else {
                handle(error, token: token, report: true)
            }
        }
    }

    func syncNow() async {
        guard !isWorking, let token = jwt() else { return }
        isWorking = true
        defer { isWorking = false }
        message = nil
        do {
            try await api.syncWhoop(jwt: token)
            message = "Synced."
        } catch {
            if case APIError.http(409, _) = error { message = "Reconnect WHOOP to sync." }
            else if case APIError.http(429, _) = error { message = "A sync is already running." }
            else { handle(error, token: token, report: true) }
        }
        await loadStatus()
    }

    func disconnect() async {
        guard !isWorking, let token = jwt() else { return }
        isWorking = true
        defer { isWorking = false }
        message = nil
        do {
            try await api.disconnectWhoop(jwt: token)
            today = nil
            message = "Disconnected. Your WHOOP workouts and recovery were removed from Très Fort."
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
