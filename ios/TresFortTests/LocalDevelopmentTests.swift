#if DEBUG && targetEnvironment(simulator)
import Foundation
import Network
import XCTest
@testable import TresFort

final class LocalDevelopmentTests: XCTestCase {
    private func configuration(_ url: String = "http://127.0.0.1:8787", secret: String = "local-test") throws -> LocalDevelopmentConfiguration {
        let parsed = try LocalDevelopmentConfiguration.parse([
            "TRESFORT_LOCAL_API_URL": url, "TRESFORT_DEV_AUTH_SECRET": secret])
        return try XCTUnwrap(parsed)
    }

    func testOptInRequiresBothValuesAndRejectsFixtures() throws {
        XCTAssertNil(try LocalDevelopmentConfiguration.parse([:]))
        for environment in [
            ["TRESFORT_LOCAL_API_URL": "http://localhost:8787"],
            ["TRESFORT_DEV_AUTH_SECRET": "secret"],
            ["TRESFORT_LOCAL_API_URL": "", "TRESFORT_DEV_AUTH_SECRET": "secret"],
            ["TRESFORT_LOCAL_API_URL": "http://localhost:8787", "TRESFORT_DEV_AUTH_SECRET": " "],
            ["TRESFORT_LOCAL_API_URL": "http://localhost:8787", "TRESFORT_DEV_AUTH_SECRET": "secret",
             "TRESFORT_UI_FIXTURE": "ordinary"]
        ] {
            XCTAssertThrowsError(try LocalDevelopmentConfiguration.parse(environment))
        }
    }

    func testOnlyLoopbackOriginsAreAccepted() throws {
        for host in ["localhost", "127.0.0.1", "[::1]"] {
            XCTAssertEqual(try configuration("http://\(host):8787/").baseURL.absoluteString,
                           "http://\(host):8787")
        }
        for url in ["https://localhost:8787", "http://192.168.1.2:8787",
                    "https://tres-fort.nmarkspdx.workers.dev", "http://localhost.example:8787",
                    "http://user:password@localhost:8787", "http://localhost:8787/api",
                    "http://localhost:8787?secret=x", "http://localhost:8787#x",
                    "http://localhost:0", "http://localhost:65536"] {
            XCTAssertThrowsError(try configuration(url), url)
        }
    }

    func testStorageIsScopedToOriginNotSecretAndPreservesOtherEnvironments() throws {
        let first = try configuration(), rotated = try configuration(secret: "rotated")
        let other = try configuration("http://127.0.0.1:8788")
        XCTAssertEqual(first.storageNamespace, rotated.storageNamespace)
        XCTAssertNotEqual(first.storageNamespace, other.storageNamespace)
        XCTAssertNotEqual(first.storageNamespace, "com.nmarkspdx.tresfort")
        let suffix = ".test.\(UUID().uuidString)"
        let local = try XCTUnwrap(LocalPersistence(suiteName: first.storageNamespace + suffix))
        let second = try XCTUnwrap(LocalPersistence(suiteName: other.storageNamespace + suffix))
        defer {
            local.removePersistentDomain(forName: first.storageNamespace + suffix)
            second.removePersistentDomain(forName: other.storageNamespace + suffix)
            try? FileManager.default.removeItem(at: local.trainingStore.directory)
            try? FileManager.default.removeItem(at: second.trainingStore.directory)
        }
        local.set(Data("queued local workout".utf8), forKey: "com.nmarkspdx.tresfort.local-test")
        XCTAssertNil(second.data(forKey: "com.nmarkspdx.tresfort.local-test"))
        let restored = try XCTUnwrap(LocalPersistence(suiteName: rotated.storageNamespace + suffix))
        XCTAssertEqual(restored.data(forKey: "com.nmarkspdx.tresfort.local-test"), Data("queued local workout".utf8))
    }

    func testRealLoopbackHTTPLoginAndAuthenticatedRead() async throws {
        let server = try LocalHTTPServer { request in
            if request.hasPrefix("POST /auth/dev ") {
                XCTAssertTrue(request.contains("\"secret\":\"local-test\""))
                XCTAssertFalse(request.lowercased().contains("authorization:"))
                return (200, [], "{\"jwt\":\"local-bearer\",\"user\":{\"id\":\"local-user\"}}")
            }
            XCTAssertTrue(request.hasPrefix("GET /api/me "))
            XCTAssertTrue(request.lowercased().contains("authorization: bearer local-bearer"))
            return (200, [], "{\"ok\":true}")
        }
        defer { server.stop() }
        let local = try configuration(try await server.start().absoluteString)
        let client = APIClient(baseURL: local.baseURL, transport: LocalDevelopmentTransport.session)
        let response = try await client.authLocal(configuration: local)
        XCTAssertEqual(response.user.id, "local-user")
        struct Receipt: Decodable { let ok: Bool }
        let receipt: Receipt = try await client.get("api/me", jwt: response.jwt)
        XCTAssertTrue(receipt.ok)
        XCTAssertEqual(server.requestCount, 2)
        let ats = Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") as? [String: Any]
        XCTAssertEqual(ats?["NSAllowsLocalNetworking"] as? Bool, true)
        XCTAssertNil(ats?["NSAllowsArbitraryLoads"])
    }

    func testLocalSecretCannotGoToAnotherOriginOrFollowRedirects() async throws {
        let server = try LocalHTTPServer { _ in
            (307, ["Location: http://127.0.0.1:1/must-not-follow"], "")
        }
        defer { server.stop() }
        let local = try configuration(try await server.start().absoluteString)
        do {
            _ = try await APIClient().authLocal(configuration: local)
            XCTFail("A client for another origin must refuse the local secret")
        } catch { XCTAssertEqual((error as? URLError)?.code, .unsupportedURL) }
        XCTAssertEqual(server.requestCount, 0)
        do {
            _ = try await APIClient(baseURL: local.baseURL).authLocal(configuration: local)
            XCTFail("A redirect must be returned as an error")
        } catch { XCTAssertEqual((error as? APIError)?.httpStatus, 307) }
        XCTAssertEqual(server.requestCount, 1)
    }
}

/// Real HTTP exercises URLSession/ATS/redirect behavior, not a URLProtocol shortcut.
private final class LocalHTTPServer: @unchecked Sendable {
    private let listener: NWListener
    private let response: (String) -> (Int, [String], String)
    private let lock = NSLock()
    private var count = 0
    private var connections: [NWConnection] = []
    var requestCount: Int { lock.lock(); defer { lock.unlock() }; return count }

    init(response: @escaping (String) -> (Int, [String], String)) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
        self.response = response
    }

    func start() async throws -> URL {
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { return }
            self.lock.lock(); self.connections.append(connection); self.lock.unlock()
            connection.start(queue: .global())
            self.receive(connection, buffered: Data())
        }
        return try await withCheckedThrowingContinuation { continuation in
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    self.listener.stateUpdateHandler = nil
                    continuation.resume(returning: URL(string: "http://127.0.0.1:\(self.listener.port!.rawValue)")!)
                case .failed(let error):
                    self.listener.stateUpdateHandler = nil
                    continuation.resume(throwing: error)
                default: break
                }
            }
            listener.start(queue: .global())
        }
    }

    private func receive(_ connection: NWConnection, buffered: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
            guard let self, error == nil else { connection.cancel(); return }
            let bytes = buffered + (data ?? Data())
            let request = String(decoding: bytes, as: UTF8.self)
            if let boundary = request.range(of: "\r\n\r\n") {
                let headers = request[..<boundary.lowerBound].components(separatedBy: "\r\n")
                let length = headers.first { $0.lowercased().hasPrefix("content-length:") }
                    .flatMap { Int($0.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces)) } ?? 0
                if request[boundary.upperBound...].utf8.count >= length {
                    self.lock.lock(); self.count += 1; self.lock.unlock()
                    let (status, extra, body) = self.response(request)
                    let headers = ["HTTP/1.1 \(status) Test", "Content-Type: application/json",
                                   "Content-Length: \(body.utf8.count)", "Connection: close"] + extra
                    let payload = Data((headers.joined(separator: "\r\n") + "\r\n\r\n" + body).utf8)
                    connection.send(content: payload, completion: .contentProcessed { _ in connection.cancel() })
                    return
                }
            }
            if complete { connection.cancel() }
            else { self.receive(connection, buffered: bytes) }
        }
    }

    func stop() {
        listener.cancel()
        lock.lock(); let current = connections; lock.unlock()
        current.forEach { $0.cancel() }
    }
}
#endif
