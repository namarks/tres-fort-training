import XCTest

final class PublicStationJourneyTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        #if !APP_STORE_BUILD
        throw XCTSkip("The manual Station entry belongs to the public build")
        #endif
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .pad, "Station is an iPad surface")
    }

    override func tearDownWithError() throws {
        let app = XCUIApplication()
        if (testRun?.failureCount ?? 0) > 0 { print(app.debugDescription) }
        if app.state != .notRunning { app.terminate() }
    }

    private func launch(largeText: Bool = false, partner: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        if largeText { app.launchEnvironment["TRESFORT_UI_LARGE_TEXT"] = "1" }
        if let partner { app.launchEnvironment["TRESFORT_UI_STATION_PARTNER"] = partner }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-restAudioCuesEnabled", "NO"]
        app.launch()
        orient(.landscapeLeft, in: app)
        app.buttons["today.station"].tap(until: app.buttons["station.done"])
        assertNoMovementCamera(in: app)
        return app
    }

    private func orient(_ orientation: UIDeviceOrientation, in app: XCUIApplication) {
        XCTAssertEqual(app.state, .runningForeground)
        if XCUIDevice.shared.orientation != orientation { XCUIDevice.shared.orientation = orientation }
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            orientation.isLandscape ? app.frame.width > app.frame.height : app.frame.height > app.frame.width
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: UITestWait.screen), .completed)
    }

    private func assertNoMovementCamera(in app: XCUIApplication) {
        for id in ["station.enableCamera", "station.recordTest", "station.savedTests", "station.trial", "station.catalog"] {
            XCTAssertFalse(app.buttons[id].exists, id)
        }
        XCTAssertFalse(app.staticTexts["station.repCount"].exists)
    }

    func testManualSetupIsOptInAndDoesNotStartAWorkout() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["station.manualSetup"].exists)
        let connect = app.switches["station.link"]
        XCTAssertTrue(connect.exists)
        XCTAssertEqual(connect.value as? String, "0")
        XCTAssertEqual(app.staticTexts["station.linkStatus"].label, "Connect when your iPhone is ready.")
        XCTAssertFalse(app.buttons["station.trainTogether"].isEnabled)
        app.buttons["station.done"].tap(until: app.buttons["today.startWorkout"])
        XCTAssertFalse(app.buttons["runner.logSet"].exists)
    }

    func testPortraitLargestTextKeepsManualSetupAndExitReachable() {
        let app = launch(largeText: true)
        XCUIDevice.shared.orientation = .portrait
        let connect = app.switches["station.link"]
        UITestScrolling.reveal(connect, in: app, maxAttempts: 12)
        XCTAssertEqual(connect.value as? String, "0")
        assertNoMovementCamera(in: app)
        XCTAssertTrue(app.buttons["station.done"].isHittable)
        app.buttons["station.done"].tap(until: app.buttons["today.station"])
    }

    func testManualPartnerPanelShowsSeparateLoadsAndClosesWithoutPhoneWrites() {
        let app = launch(partner: "active")
        XCTAssertTrue(app.staticTexts["partner.stationStep"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Jordan"].exists)
        XCTAssertTrue(app.staticTexts["Casey"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "20 kg")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts["partner.stationRest"].exists)
        app.buttons["partner.stationClose"].tap(until: app.staticTexts["station.manualSetup"])
        app.buttons["station.done"].tap(until: app.buttons["today.startWorkout"])
    }

    func testLargestTextSharedRestAdvancesThroughManualControl() {
        let app = launch(largeText: true, partner: "rest")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.staticTexts["partner.stationRest"].waitForExistence(timeout: UITestWait.screen))
        let previous = app.staticTexts["partner.stationStep"].label
        let skip = app.buttons["Skip rest"]
        UITestScrolling.reveal(skip, in: app, maxAttempts: 12)
        skip.tap()
        let advanced = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@", previous),
                                                 object: app.staticTexts["partner.stationStep"])
        XCTAssertEqual(XCTWaiter.wait(for: [advanced], timeout: UITestWait.screen), .completed)
        XCTAssertFalse(app.staticTexts["partner.stationRest"].exists)
        assertNoMovementCamera(in: app)
        XCTAssertTrue(app.buttons["station.done"].isHittable)
    }

    func testPartnerTimedTargetsUseEachPhonesCurrentDuration() {
        let app = launch(partner: "instructions-timed")
        assertPartnerTargets(host: "Bodyweight · 60 seconds", partner: "Bodyweight · 75 seconds", in: app)
        capture("partner-station-live-durations")
    }

    func testPartnerUnilateralTargetsKeepPerHandUnitsAndPerSideReps() {
        let app = launch(largeText: true, partner: "instructions-unilateral")
        orient(.portrait, in: app)
        assertPartnerTargets(host: "30 lb each hand · 9 reps per side",
                             partner: "22 kg each hand · 12 reps per side", in: app)
        capture("partner-station-per-hand-per-side")
    }

    func testPartnerBodyweightAndAssistanceRemainDistinct() {
        let app = launch(partner: "instructions-assistance")
        assertPartnerTargets(host: "Bodyweight · 8 reps", partner: "10 kg assistance · 8 reps", in: app)
        capture("partner-station-bodyweight-assistance")
    }

    private func assertPartnerTargets(host: String, partner: String, in app: XCUIApplication) {
        for (lane, label) in [("host", host), ("partner", partner)] {
            let target = app.staticTexts["partner.station.\(lane).target"]
            XCTAssertTrue(target.waitForExistence(timeout: UITestWait.screen))
            UITestScrolling.reveal(target, in: app, maxAttempts: 8)
            XCTAssertEqual(target.label, label)
            XCTAssertTrue(target.isHittable)
            XCTAssertTrue(app.frame.contains(target.frame))
        }
        assertNoMovementCamera(in: app)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
