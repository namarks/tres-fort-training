import XCTest
@testable import TresFort

final class ConnectionRowStatusTests: XCTestCase {
    func testUnknownStatusIsChecking() {
        XCTAssertEqual(ConnectionRowStatus.from(configured: nil, connected: false, needsReauth: false), .checking)
    }

    func testDescriptionOnlyWhenAvailableAndNotConnected() {
        XCTAssertEqual(ConnectionRowStatus.from(configured: true, connected: false, needsReauth: false), .description)
        XCTAssertEqual(ConnectionRowStatus.from(configured: false, connected: false, needsReauth: false), .notConfigured)
        // A server without the provider's credentials never claims a connection.
        XCTAssertEqual(ConnectionRowStatus.from(configured: false, connected: true, needsReauth: false), .notConfigured)
    }

    func testFailedReadWinsOverMissingOrCachedStatus() {
        for configured: Bool? in [nil, false, true] {
            for connected in [false, true] {
                XCTAssertEqual(ConnectionRowStatus.from(configured: configured, connected: connected,
                    needsReauth: false, statusUnavailable: true), .unavailable)
            }
        }
        XCTAssertEqual(ConnectionRowStatus.from(configured: true, connected: true,
            needsReauth: true, sharing: false, statusUnavailable: true), .unavailable)
    }

    func testConnected() {
        XCTAssertEqual(ConnectionRowStatus.from(configured: true, connected: true, needsReauth: false), .connected)
        XCTAssertEqual(ConnectionRowStatus.from(configured: true, connected: true, needsReauth: false, sharing: true), .connected)
    }

    func testReconnectWinsOverSharing() {
        XCTAssertEqual(ConnectionRowStatus.from(configured: true, connected: true, needsReauth: true), .reconnect)
        XCTAssertEqual(ConnectionRowStatus.from(configured: true, connected: true, needsReauth: true, sharing: false), .reconnect)
    }

    func testNotSharing() {
        XCTAssertEqual(ConnectionRowStatus.from(configured: true, connected: true, needsReauth: false, sharing: false), .notSharing)
    }
}
