import XCTest
@testable import TresFort

final class CoachConnectionTests: XCTestCase {
    func testClaudeInstallLinkPreservesTheEnvironmentAndEncodedURL() throws {
        for base in ["https://ui-fixture.invalid", "https://example.invalid/fitness%20app", "https://example.invalid/a&b"] {
            let url = CoachSetup.claudeInstallURL(baseURL: URL(string: base)!)
            let parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
            XCTAssertEqual(parts.scheme, "https")
            XCTAssertEqual(parts.host, "claude.ai")
            XCTAssertEqual(parts.path, "/customize/connectors")
            let fields = Dictionary(uniqueKeysWithValues: try XCTUnwrap(parts.queryItems).map { ($0.name, $0.value) })
            XCTAssertEqual(fields.count, 3, "Plain install links must not include a member code or credential")
            XCTAssertEqual(fields["modal"], "add-custom-connector")
            XCTAssertEqual(fields["connectorName"], "Très Fort")
            XCTAssertEqual(fields["connectorUrl"], base + "/mcp")
            XCTAssertNil(parts.fragment)
        }
    }

    func testConnectLinkCarriesOnlyAOneTimeCodeInTheServerAddress() throws {
        let code = String(repeating: "A", count: 21) + "-_" + String(repeating: "b", count: 20)
        let url = CoachSetup.claudeInstallURL(baseURL: URL(string: "https://example.invalid")!, link: code)
        let parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let fields = Dictionary(uniqueKeysWithValues: try XCTUnwrap(parts.queryItems).map { ($0.name, $0.value) })
        XCTAssertEqual(fields.count, 3)
        XCTAssertEqual(fields["connectorUrl"], "https://example.invalid/mcp/c/" + code)
        // Anything that isn't a server-made code falls back to the plain address.
        for bad in ["", "short", String(repeating: "A", count: 44), String(repeating: "A", count: 42) + "/"] {
            XCTAssertEqual(CoachSetup.serverURL(baseURL: URL(string: "https://example.invalid")!, link: bad).absoluteString,
                           "https://example.invalid/mcp")
        }
        XCTAssertEqual(CoachSetup.serverURL(baseURL: URL(string: "https://example.invalid")!, link: nil).absoluteString,
                       "https://example.invalid/mcp")
    }

    private func profile(_ fields: String) throws -> MeProfile {
        let data = Data("""
        {"intervals":{"connected":false},\(fields)}
        """.utf8)
        return try JSONDecoder().decode(MeProfile.self, from: data)
    }

    func testNewAppReadsLegacyServerCoachStatus() throws {
        let result = try profile("\"claude\":{\"is_owner\":false,\"connected\":true,\"last_active\":123}")
        XCTAssertTrue(result.coach.connected)
        XCTAssertFalse(result.coach.is_owner)
        XCTAssertEqual(result.coach.last_active, 123)
    }

    func testNeutralStatusTakesPrecedenceOverLegacyAlias() throws {
        let result = try profile("""
        "coach":{"is_owner":true,"connected":false},
        "claude":{"is_owner":true,"connected":true,"last_active":123}
        """)
        XCTAssertFalse(result.coach.connected)
        XCTAssertNil(result.coach.last_active)
    }

    func testNeutralOnlyServerCanDecodeWithoutLegacyField() throws {
        let result = try profile("\"coach\":{\"is_owner\":false,\"connected\":true}")
        XCTAssertTrue(result.coach.connected)
    }

    func testMissingOrMalformedConnectionIsAReadFailure() {
        XCTAssertThrowsError(try profile("\"display_name\":\"Example\""))
        XCTAssertThrowsError(try profile("""
        "coach":{"connected":"yes"},
        "claude":{"is_owner":false,"connected":true}
        """))
    }
}
