import XCTest

/// Connections are discoverable during setup without making a plan or
/// authorizing a provider. Opening settings keeps the setup stack intact.
final class ConnectionSetupJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            print(XCUIApplication().debugDescription)
            capture("connection-setup-failure")
        }
    }

    func testSetupDiscoversDevicesAndReturnsFromSettingsWithoutConnecting() {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "activation-manual"
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        app.buttons["Sign in with Apple"].tapWhenReady()
        app.buttons["Get started"].tapWhenReady()
        let next = app.buttons["setup.next"]
        XCTAssertTrue(next.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(next.label, "Next, plan later")
        next.tapWhenReady()
        XCTAssertTrue(app.staticTexts["Connect your apps"].waitForExistence(timeout: UITestWait.screen))

        revealAndTap(app.buttons["Apple Watch or another device?"], in: app)
        XCTAssertTrue(app.staticTexts["connections.appleWatchGuidance"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.scroll(toReveal: app.staticTexts["connections.otherDevicesGuidance"]))
        XCTAssertTrue(app.scroll(toReveal: app.staticTexts["setup.connectLater"]))
        capture("setup-device-discovery")

        revealAndTap(app.buttons["connections.garmin"], in: app, searchingUp: true)
        let garmin = app.navigationBars["Garmin Connect"]
        XCTAssertTrue(garmin.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["garmin.connect"].waitForExistence(timeout: UITestWait.screen))
        garmin.backButton.tapWhenReady()
        assertAppsPage(in: app)

        revealAndTap(app.buttons["connections.intervals"], in: app, searchingUp: true)
        let intervals = app.navigationBars["Intervals.icu"]
        XCTAssertTrue(intervals.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["intervals.oauth"].waitForExistence(timeout: UITestWait.screen))
        intervals.backButton.tapWhenReady()
        assertAppsPage(in: app)

        let done = app.buttons["setup.done"]
        done.tapWhenReady()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: done)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: UITestWait.screen), .completed)
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["today.planWeek"].waitUntilTappable())
        let evidence = app.staticTexts["fixture.scenario"]
        let counts: [String: Int] = Dictionary(uniqueKeysWithValues: (evidence.value as? String ?? "").split(separator: ";").compactMap { item in
            let pair = item.split(separator: ":")
            guard pair.count == 2, let value = Int(pair[1]) else { return nil }
            return (String(pair[0]), value)
        })
        for key in ["profileWrites", "starterWrites", "workoutWrites", "scheduleWrites"] {
            XCTAssertEqual(counts[key], 0, "Discovery must not write \(key)")
        }
    }

    private func assertAppsPage(in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        // Back preserves the list's scroll position, so its header can be
        // outside the realized cells. The apps page owns this pinned action.
        XCTAssertTrue(app.navigationBars["Set up"].waitForExistence(timeout: UITestWait.screen), file: file, line: line)
        XCTAssertTrue(app.buttons["setup.done"].waitForExistence(timeout: UITestWait.screen), file: file, line: line)
    }

    private func revealAndTap(_ element: XCUIElement, in app: XCUIApplication, searchingUp: Bool = false,
                              file: StaticString = #filePath, line: UInt = #line) {
        guard app.scroll(toReveal: element, searchingUp: searchingUp) else {
            XCTFail("Control is not reachable: \(element.description)", file: file, line: line)
            return
        }
        element.tapWhenReady(file: file, line: line)
    }

    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }
}
