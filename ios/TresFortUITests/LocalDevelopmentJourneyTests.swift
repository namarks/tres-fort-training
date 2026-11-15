import XCTest

final class LocalDevelopmentJourneyTests: XCTestCase {
    func testLocalModeShowsDestinationAndRecoversFromUnavailableServer() {
        continueAfterFailure = false
        let app = XCUIApplication()
        // A refused loopback port keeps this test independent of a running Worker.
        app.launchEnvironment["TRESFORT_LOCAL_API_URL"] = "http://127.0.0.1:1"
        app.launchEnvironment["TRESFORT_DEV_AUTH_SECRET"] = "local-ui-test-only"
        app.launch()
        let banner = app.staticTexts["local.server.banner"]
        XCTAssertTrue(banner.waitForExistence(timeout: 15))
        XCTAssertTrue(banner.label.contains("127.0.0.1:1"))
        XCTAssertFalse(app.buttons["Sign in with Apple"].exists)
        let signIn = app.buttons["local.server.signIn"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 15))
        signIn.tap()
        let failure = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Couldn’t reach the local server")).firstMatch
        XCTAssertTrue(failure.waitForExistence(timeout: 20))
        XCTAssertTrue(signIn.isEnabled)
        XCTAssertTrue(banner.exists)
        app.terminate()
    }
}
