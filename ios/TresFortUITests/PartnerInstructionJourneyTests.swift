import XCTest

final class PartnerInstructionJourneyTests: XCTestCase {
    private let slotID = "63333333-3333-4333-8333-333333333333"

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .phone, "Partner entry belongs to each iPhone")
    }
    override func tearDownWithError() throws {
        let app = XCUIApplication()
        if (testRun?.failureCount ?? 0) > 0 { print(app.debugDescription) }
        if app.state != .notRunning { app.terminate() }
    }

    private func launch(_ mode: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "ordinary"
        app.launchEnvironment["TRESFORT_UI_PARTNER_INSTRUCTIONS"] = mode
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-restAudioCuesEnabled", "NO"]
        app.launch()
        evidence("installed:true", in: app)
        return app
    }

    private func evidence(_ value: String, in app: XCUIApplication) {
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", value),
                                                 object: app.staticTexts["fixture.partnerInstructions"])
        XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: UITestWait.screen), .completed)
    }

    private func reveal(_ value: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(app.scroll(toReveal: value))
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testSetupPreservesUnknownWeightAcrossUnitsAndAcceptsSignedAssistance() {
        var app = launch("setup-unknown")
        let field = app.textFields["partner.setup.weight.\(slotID)"]
        reveal(field, in: app)
        XCTAssertEqual(field.value as? String, "Choose weight")
        XCTAssertEqual(field.label, "Weight (lb) · each hand")
        XCTAssertEqual(app.staticTexts["partner.setup.target.\(slotID)"].label, "2×8 per side")
        let kilograms = app.segmentedControls["partner.setup.unit.\(slotID)"].buttons["kg"]
        reveal(kilograms, in: app); kilograms.tapWhenReady()
        evidence("load:nil;unit:kg", in: app)
        XCTAssertEqual(field.value as? String, "Choose weight")
        XCTAssertEqual(field.label, "Weight (kg) · each hand")
        capture("partner-setup-unknown-per-hand")
        app.terminate()

        app = launch("setup-assistance")
        let assisted = app.textFields["partner.setup.weight.\(slotID)"]
        reveal(assisted, in: app)
        XCTAssertEqual(assisted.label, "Load / assistance (lb)")
        assisted.tapWhenReady(); assisted.typeText("-20")
        evidence("load:-20;unit:lb", in: app)
        let meaning = app.staticTexts["partner.setup.weight.\(slotID).meaning"]
        reveal(meaning, in: app)
        XCTAssertEqual(meaning.label, "20 lb assistance")
        evidence("sets:0", in: app)
        capture("partner-setup-signed-assistance")
    }

    func testRunnerExplainsPerHandAndPerSideAndRequiresAChosenWeight() {
        let app = launch("runner-unilateral")
        let field = app.textFields["partner.runner.weight"]
        reveal(field, in: app)
        XCTAssertEqual(field.value as? String, "Choose weight")
        XCTAssertEqual(field.label, "Weight (lb) · each hand")
        XCTAssertEqual(app.steppers["partner.runner.reps"].value as? String, "8")
        XCTAssertEqual(app.steppers["partner.runner.reps"].label, "8 reps per side")
        XCTAssertEqual(app.staticTexts["partner.runner.sideHint"].label, "Complete both sides, then log one set.")
        let log = app.buttons["partner.logSet"]
        reveal(log, in: app)
        XCTAssertFalse(log.isEnabled)
        XCTAssertTrue(app.scroll(toReveal: field, searchingUp: true))
        field.tapWhenReady(); field.typeText("20")
        let meaning = app.staticTexts["partner.runner.weight.meaning"]
        reveal(meaning, in: app)
        XCTAssertEqual(meaning.label, "20 lb each hand")
        reveal(log, in: app)
        XCTAssertTrue(log.isEnabled)
        evidence("sets:0", in: app)
        capture("partner-runner-per-hand-per-side")
    }

    func testTimedInstructionsUseSecondsAndCardioHasNoLoadInput() {
        var app = launch("runner-timed")
        let duration = app.steppers["partner.runner.duration"]
        XCTAssertTrue(duration.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(duration.value as? String, "45")
        XCTAssertEqual(duration.label, "45 seconds")
        XCTAssertFalse(app.steppers["partner.runner.reps"].exists)
        XCTAssertEqual(app.staticTexts["partner.runner.weight.meaning"].label, "Bodyweight")
        let start = app.buttons["partner.startTimedSet"]
        reveal(start, in: app)
        XCTAssertTrue(start.isEnabled)
        capture("partner-runner-timed-bodyweight")
        app.terminate()

        app = launch("runner-cardio")
        XCTAssertTrue(app.steppers["partner.runner.duration"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.steppers["partner.runner.duration"].value as? String, "45")
        XCTAssertEqual(app.steppers["partner.runner.duration"].label, "45 seconds")
        XCTAssertFalse(app.textFields["partner.runner.weight"].exists)
        XCTAssertFalse(app.steppers["partner.runner.reps"].exists)
        XCTAssertTrue(app.buttons["partner.startTimedSet"].isEnabled)
        evidence("sets:0", in: app)
        capture("partner-runner-cardio-seconds")
    }
}
