import XCTest
@testable import TresFort

final class GarminTests: XCTestCase {
    private let secret = String(repeating: "b", count: 40) + "_-Z"

    func testCallbackCarriesOnlyAWellFormedCompletion() throws {
        XCTAssertEqual(try GarminCallback.completion(
            from: URL(string: "tresfort://garmin-connected?completion=\(secret)")!), secret)
        for bad in ["tresfort://whoop-connected?completion=\(secret)",
                    "https://garmin-connected?completion=\(secret)",
                    "tresfort://garmin-connected?completion=short",
                    "tresfort://garmin-connected?completion=\(secret)&x=1",
                    "tresfort://garmin-connected"] {
            XCTAssertThrowsError(try GarminCallback.completion(from: URL(string: bad)!), bad)
        }
        XCTAssertThrowsError(try GarminCallback.completion(
            from: URL(string: "tresfort://garmin-connected?error=access_denied")!)) { error in
            XCTAssertEqual(error as? GarminConnectError, .provider("access_denied"))
        }
    }

    func testDecodesTheStatus() throws {
        let status = try JSONDecoder().decode(GarminStatus.self, from: Data(
            #"{"configured":true,"connected":true,"activity_permission":false,"needs_reauth":false,"connected_at":1,"last_synced_at":null}"#.utf8))
        XCTAssertTrue(status.connected)
        XCTAssertFalse(status.activity_permission)
        XCTAssertNil(status.last_synced_at)
    }

    func testAGarminWorkoutWithHeartRateHasCharts() throws {
        let json = #"""
        {"id":"garmin:u:1","source":"garmin","external_id":"1","date":"2026-11-07","kind":"ride","name":"Ride",
         "moving_time_sec":3600,"elapsed_time_sec":3600,"distance_m":30000,"average_watts":200,
         "weighted_avg_watts":210,"average_hr":140,"max_hr":170,"training_load":null,"intensity":null,
         "calories":800,"elevation_gain_m":100,"synced_at":1,"deleted_at":null,
         "source_attribution":"Garmin Edge 530"}
        """#
        let activity = try JSONDecoder().decode(ExternalActivity.self, from: Data(json.utf8))
        XCTAssertTrue(activity.mayHaveStreams)
        XCTAssertEqual(activity.source_attribution, "Garmin Edge 530")
    }

    @MainActor
    func testConnectPostsTheCompletionFromTheSameSession() async throws {
        let api = Self.stubbedAPI()
        GarminProtocol.reset([
            "/auth/garmin/start": (200, #"{"authorize_url":"https://connect.garmin.com/oauth2Confirm?x=1"}"#),
            "/auth/garmin/finish": (200, #"{"connected":true,"activity_permission":true}"#),
            "/api/me/garmin": (200, #"{"configured":true,"connected":true,"activity_permission":true,"needs_reauth":false,"connected_at":1,"last_synced_at":null}"#),
        ])
        var opened: URL?
        let model = GarminModel(jwt: { "token" }, api: api, authorizer: { [secret] url in
            opened = url
            return URL(string: "tresfort://garmin-connected?completion=\(secret)")
        })
        await model.connect()
        XCTAssertEqual(opened?.host, "connect.garmin.com")
        XCTAssertEqual(GarminProtocol.paths(), ["/auth/garmin/start", "/auth/garmin/finish", "/api/me/garmin"])
        XCTAssertTrue(model.connected)
        XCTAssertNotNil(model.message)
    }

    @MainActor
    func testADismissedOrDeclinedConnectFinishesNothing() async throws {
        let api = Self.stubbedAPI()
        GarminProtocol.reset(["/auth/garmin/start": (200, #"{"authorize_url":"https://connect.garmin.com/x"}"#)])
        let dismissed = GarminModel(jwt: { "token" }, api: api, authorizer: { _ in nil })
        await dismissed.connect()
        XCTAssertEqual(GarminProtocol.paths(), ["/auth/garmin/start"])
        XCTAssertNil(dismissed.message)

        GarminProtocol.reset(["/auth/garmin/start": (200, #"{"authorize_url":"https://connect.garmin.com/x"}"#)])
        let declined = GarminModel(jwt: { "token" }, api: api, authorizer: { _ in
            URL(string: "tresfort://garmin-connected?error=access_denied")
        })
        await declined.connect()
        XCTAssertEqual(GarminProtocol.paths(), ["/auth/garmin/start"])
        XCTAssertEqual(declined.message, GarminConnectError.provider("access_denied").localizedDescription)
    }

    @MainActor
    func testDisconnectRereadsTheStatus() async throws {
        let api = Self.stubbedAPI()
        GarminProtocol.reset([
            "/api/me/garmin": (200, #"{"configured":true,"connected":false,"activity_permission":false,"needs_reauth":false,"connected_at":null,"last_synced_at":null}"#),
        ])
        let model = GarminModel(jwt: { "token" }, api: api)
        await model.disconnect()
        XCTAssertEqual(GarminProtocol.paths(), ["/api/me/garmin", "/api/me/garmin"])
        XCTAssertEqual(GarminProtocol.methods(), ["DELETE", "GET"])
        XCTAssertFalse(model.connected)
    }

    private static func stubbedAPI() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [GarminProtocol.self]
        return APIClient(baseURL: URL(string: "https://garmin.test")!, transport: URLSession(configuration: config))
    }
}

private final class GarminProtocol: URLProtocol {
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
    static func methods() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.httpMethod }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        Self.requests.append(request)
        let path = request.url?.path ?? ""
        let (status, body) = request.httpMethod == "DELETE"
            ? (200, #"{"disconnected":true,"garmin_notified":true}"#)
            : Self.responses[path] ?? (404, #"{"error":"not_found"}"#)
        Self.lock.unlock()
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
