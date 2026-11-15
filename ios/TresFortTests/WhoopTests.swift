import XCTest
@testable import TresFort

final class WhoopTests: XCTestCase {
    private let secret = String(repeating: "a", count: 40) + "_-Z"

    func testCallbackCarriesOnlyAWellFormedCompletion() throws {
        XCTAssertEqual(try WhoopCallback.completion(
            from: URL(string: "tresfort://whoop-connected?completion=\(secret)")!), secret)
        for bad in ["tresfort://intervals-connected?completion=\(secret)",
                    "https://whoop-connected?completion=\(secret)",
                    "tresfort://whoop-connected?completion=short",
                    "tresfort://whoop-connected?completion=\(secret)&x=1",
                    "tresfort://whoop-connected"] {
            XCTAssertThrowsError(try WhoopCallback.completion(from: URL(string: bad)!), bad)
        }
        XCTAssertThrowsError(try WhoopCallback.completion(
            from: URL(string: "tresfort://whoop-connected?error=access_denied")!)) { error in
            XCTAssertEqual(error as? WhoopConnectError, .provider("access_denied"))
        }
    }

    func testDecodesTheWorkerShapes() throws {
        let status = try JSONDecoder().decode(WhoopStatus.self, from: Data(
            #"{"configured":true,"connected":true,"needs_reauth":false,"connected_at":1,"last_synced_at":null}"#.utf8))
        XCTAssertTrue(status.connected)
        XCTAssertNil(status.last_synced_at)
        let day = try JSONDecoder().decode(RecoveryDay.self, from: Data(#"""
        {"date":"2026-11-08","recovery_score":72,"hrv_rmssd_ms":58.4,"resting_hr":52,"spo2_pct":null,
         "skin_temp_c":null,"calibrating":false,"sleep_start_utc_ms":1,"sleep_end_utc_ms":2,
         "sleep_ms":27120000,"in_bed_ms":28800000,"sleep_performance_pct":88,"sleep_efficiency_pct":94,
         "respiratory_rate":15.2,"day_strain":null,"source":"whoop"}
        """#.utf8))
        XCTAssertEqual(day.recovery_score, 72)
        XCTAssertTrue(day.hasValues)
    }

    func testAWhoopWorkoutCarriesWhoopsStrain() throws {
        let json = #"""
        {"id":"whoop:u:w1","source":"whoop","external_id":"w1","date":"2026-11-07","kind":"run","name":"Run",
         "moving_time_sec":3600,"elapsed_time_sec":3600,"distance_m":10000,"average_watts":null,
         "weighted_avg_watts":null,"average_hr":150,"max_hr":182,"training_load":null,"intensity":null,
         "calories":500,"elevation_gain_m":40,"synced_at":1,"deleted_at":null,"effective_load":72,
         "load_method":"heart_rate_average","sport":"run","strain":12.34}
        """#
        let activity = try JSONDecoder().decode(ExternalActivity.self, from: Data(json.utf8))
        XCTAssertEqual(activity.strainLabel, "12.3")
        XCTAssertEqual(activity.shownLoad, 72, "strain is shown beside the load, never as it")
        let other = try JSONDecoder().decode(ExternalActivity.self, from: Data(
            json.replacingOccurrences(of: #","strain":12.34"#, with: "").utf8))
        XCTAssertNil(other.strainLabel)
    }

    func testFormatsAndPicksOnlyTodaysScoredDay() {
        XCTAssertEqual(WhoopFormat.percent(71.6), "72%")
        XCTAssertEqual(WhoopFormat.whole(58.4, unit: "ms"), "58 ms")
        XCTAssertEqual(WhoopFormat.duration(27_120_000), "7h 32m")
        XCTAssertEqual(WhoopFormat.duration(2_700_000), "45m")
        XCTAssertNil(WhoopFormat.duration(nil))
        XCTAssertNil(WhoopFormat.percent(nil))
        let yesterday = Self.day("2026-11-07", score: 40)
        let empty = Self.day("2026-11-08", score: nil)
        XCTAssertNil(WhoopFormat.today([yesterday], today: "2026-11-08"), "yesterday is never today's recovery")
        XCTAssertNil(WhoopFormat.today([yesterday, empty], today: "2026-11-08"), "an unscored day shows nothing")
        XCTAssertEqual(WhoopFormat.today([yesterday, Self.day("2026-11-08", score: 80)], today: "2026-11-08")?.recovery_score, 80)
    }

    @MainActor
    func testConnectPostsTheCompletionFromTheSameSession() async throws {
        let api = Self.stubbedAPI()
        WhoopProtocol.reset([
            "/auth/whoop/start": (200, #"{"authorize_url":"https://api.prod.whoop.com/oauth/oauth2/auth?x=1"}"#),
            "/auth/whoop/finish": (200, #"{"connected":true}"#),
            "/api/me/whoop": (200, #"{"configured":true,"connected":true,"needs_reauth":false,"connected_at":1,"last_synced_at":null}"#),
        ])
        var opened: URL?
        let model = WhoopModel(jwt: { "token" }, api: api, authorizer: { [secret] url in
            opened = url
            return URL(string: "tresfort://whoop-connected?completion=\(secret)")
        })
        await model.connect()
        XCTAssertEqual(opened?.host, "api.prod.whoop.com")
        XCTAssertEqual(WhoopProtocol.paths(), ["/auth/whoop/start", "/auth/whoop/finish", "/api/me/whoop"])
        XCTAssertTrue(model.connected)
        XCTAssertNotNil(model.message)
    }

    @MainActor
    func testADismissedOrDeclinedConnectFinishesNothing() async throws {
        let api = Self.stubbedAPI()
        WhoopProtocol.reset(["/auth/whoop/start": (200, #"{"authorize_url":"https://api.prod.whoop.com/x"}"#)])
        let dismissed = WhoopModel(jwt: { "token" }, api: api, authorizer: { _ in nil })
        await dismissed.connect()
        XCTAssertEqual(WhoopProtocol.paths(), ["/auth/whoop/start"])
        XCTAssertNil(dismissed.message)

        WhoopProtocol.reset(["/auth/whoop/start": (200, #"{"authorize_url":"https://api.prod.whoop.com/x"}"#)])
        let declined = WhoopModel(jwt: { "token" }, api: api, authorizer: { _ in
            URL(string: "tresfort://whoop-connected?error=access_denied")
        })
        await declined.connect()
        XCTAssertEqual(WhoopProtocol.paths(), ["/auth/whoop/start"])
        XCTAssertEqual(declined.message, WhoopConnectError.provider("access_denied").localizedDescription)
    }

    @MainActor
    func testTodayReadsRecoveryOnlyWhenConnected() async throws {
        let api = Self.stubbedAPI()
        WhoopProtocol.reset([
            "/api/me/whoop": (200, #"{"configured":true,"connected":false,"needs_reauth":false,"connected_at":null,"last_synced_at":null}"#),
        ])
        let off = WhoopModel(jwt: { "token" }, api: api)
        await off.loadToday(date: CalendarProjection.date(from: "2026-11-08")!)
        XCTAssertNil(off.today)
        XCTAssertEqual(WhoopProtocol.paths(), ["/api/me/whoop"])

        WhoopProtocol.reset([
            "/api/me/whoop": (200, #"{"configured":true,"connected":true,"needs_reauth":false,"connected_at":1,"last_synced_at":2}"#),
            "/api/me/recovery": (200, #"{"days":[{"date":"2026-11-08","recovery_score":64,"hrv_rmssd_ms":50,"resting_hr":55,"calibrating":false,"sleep_ms":25200000,"source":"whoop"}]}"#),
        ])
        // The same Today model sees a connection made on the settings screen.
        await off.loadToday(date: CalendarProjection.date(from: "2026-11-08")!)
        XCTAssertEqual(off.today?.recovery_score, 64)
        let on = WhoopModel(jwt: { "token" }, api: api)
        await on.loadToday(date: CalendarProjection.date(from: "2026-11-08")!)
        XCTAssertEqual(on.today?.recovery_score, 64)
        XCTAssertEqual(WhoopProtocol.queries().last, "from=2026-11-07&to=2026-11-08")

        // The next morning a failed read shows nothing, never yesterday's score.
        WhoopProtocol.reset([
            "/api/me/whoop": (200, #"{"configured":true,"connected":true,"needs_reauth":false,"connected_at":1,"last_synced_at":2}"#),
            "/api/me/recovery": (500, #"{"error":"internal"}"#),
        ])
        await on.loadToday(date: CalendarProjection.date(from: "2026-11-09")!)
        XCTAssertNil(on.today)
    }

    @MainActor
    func testARefusedBearerIsReportedOnce() async throws {
        let api = Self.stubbedAPI()
        WhoopProtocol.reset(["/api/me/whoop": (401, #"{"error":"unauthorized"}"#)])
        var refused: [String] = []
        let model = WhoopModel(jwt: { "token" }, api: api, onUnauthorized: { refused.append($0) })
        await model.loadStatus()
        XCTAssertEqual(refused, ["token"])
        XCTAssertTrue(model.statusUnavailable)
    }

    private static func day(_ date: String, score: Double?) -> RecoveryDay {
        RecoveryDay(date: date, recovery_score: score, hrv_rmssd_ms: nil, resting_hr: nil, spo2_pct: nil,
                    skin_temp_c: nil, calibrating: nil, sleep_ms: nil, in_bed_ms: nil,
                    sleep_performance_pct: nil, sleep_efficiency_pct: nil, respiratory_rate: nil, day_strain: nil)
    }

    private static func stubbedAPI() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [WhoopProtocol.self]
        return APIClient(baseURL: URL(string: "https://whoop.test")!, transport: URLSession(configuration: config))
    }
}

private final class WhoopProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var responses: [String: (Int, String)] = [:]
    private static var requests: [URLRequest] = []

    static func reset(_ responses: [String: (Int, String)]) {
        lock.lock(); defer { lock.unlock() }
        self.responses = responses
        requests = []
    }
    static func paths() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.url?.path }
    }
    static func queries() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.url?.query }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        Self.requests.append(request)
        let (status, body) = Self.responses[request.url?.path ?? ""] ?? (404, #"{"error":"not_found"}"#)
        Self.lock.unlock()
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
