import XCTest

/// Run with verify-ios.sh --content-size at ordinary, XXXL and AX5 sizes.
/// Uses the simulator's setting, including navigation bars and system sheets.
final class LargeTextJourneyTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            print(XCUIApplication().debugDescription)
            capture("failure")
        }
    }

    private func launch(coach: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        if coach { app.launchEnvironment["TRESFORT_UI_PENDING_COACH_SETUP"] = "1" }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-restAudioCuesEnabled", "NO"]
        app.launch()
        XCTAssertTrue(app.navigationBars[coach ? "Connect your coach" : "Today"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication,
                        searchingUp: Bool = false, above bottomBar: XCUIElement? = nil,
                        file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.scroll(toReveal: element, searchingUp: searchingUp, maxDrags: 30, above: bottomBar),
                      "Content must remain reachable", file: file, line: line)
        XCTAssertGreaterThanOrEqual(element.frame.minX, app.frame.minX, file: file, line: line)
        XCTAssertLessThanOrEqual(element.frame.maxX, app.frame.maxX, file: file, line: line)
    }

    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "large-text-" + name
        image.lifetime = .keepAlways
        add(image)
    }

    func testCoachChoicesDisclosureAndConsentStayReachable() {
        let app = launch(coach: true)
        let allow = app.buttons["coach.consent-allow"]
        capture("coach-claude")
        for name in ["other", "claude", "chatgpt"] {
            let choice = app.buttons["coach.app." + name]
            reveal(choice, in: app, searchingUp: true, above: allow)
            choice.tapWhenReady()
            XCTAssertTrue(choice.isSelected)
        }
        let disclosure = app.staticTexts["coach.data-sharing"]
        reveal(disclosure, in: app, above: allow)
        XCTAssertTrue(disclosure.label.contains("OpenAI"))
        let setupSteps = app.descendants(matching: .any).matching(identifier: "coach.chatgpt-steps").firstMatch
        XCTAssertFalse(setupSteps.exists,
                       "Choosing an app does not authorize sharing")
        capture("coach-chatgpt")
        let details = app.buttons["coach.full-details"]
        reveal(details, in: app, above: allow)
        details.tapWhenReady()
        XCTAssertFalse(setupSteps.exists, "Reading the disclosure must not authorize sharing")
        let shared = app.staticTexts["What is shared"]
        reveal(shared, in: app, above: allow)
        capture("coach-details")
        reveal(details, in: app, searchingUp: true, above: allow)
        details.tapWhenReady()
        reveal(allow, in: app)
        capture("coach-decision")
        allow.tapWhenReady()
        reveal(setupSteps, in: app)
        XCTAssertTrue(setupSteps.label.contains("Continue with Apple"))
        XCTAssertFalse(app.buttons["coach.generate-code"].exists)
        capture("coach-setup")
    }

    func testTodayCalendarPlanAndActivityNavigation() {
        let app = launch()
        capture("today")
        let calendar = app.buttons["today.calendar"]
        reveal(calendar, in: app)
        capture("coming-up")
        calendar.tapWhenReady()
        XCTAssertTrue(app.buttons["calendar.weeklySchedule"].waitForExistence(timeout: UITestWait.screen))
        capture("calendar")
        let day = app.buttons["calendar.date.2026-09-08"]
        reveal(day, in: app)
        XCTAssertGreaterThan(day.frame.width, 0)
        day.tapWhenReady()
        XCTAssertTrue(app.navigationBars["Workout date"].waitForExistence(timeout: UITestWait.screen))
        capture("calendar-day")
        app.navigationBars["Workout date"].buttons["Done"].tapWhenReady()
        app.navigationBars["Calendar"].backButton.tapWhenReady()
        app.tabBars.buttons["Plan"].tapWhenReady()
        capture("plan")
        app.tabBars.buttons["Activity"].tapWhenReady()
        XCTAssertTrue(app.descendants(matching: .any)["activity.week"].waitForExistence(timeout: UITestWait.screen))
        capture("activity")
        let history = app.buttons["activity.allHistory"]
        reveal(history, in: app)
        capture("activity-recent")
        history.tapWhenReady()
        XCTAssertTrue(app.navigationBars["All history"].waitForExistence(timeout: UITestWait.screen))
        capture("history")
    }

    func testWorkoutInputsLoggingAndRestStayReachable() {
        let app = launch()
        let start = app.buttons["today.startWorkout"]
        reveal(start, in: app)
        start.tapWhenReady()
        XCTAssertTrue(app.staticTexts["runner.exerciseTitle"].waitForExistence(timeout: UITestWait.screen))
        capture("runner-title")
        let weight = app.buttons["runner.weight"]
        reveal(weight, in: app)
        capture("runner-load")
        weight.tapWhenReady()
        XCTAssertTrue(app.textFields["weight.entry"].waitForExistence(timeout: UITestWait.screen))
        capture("runner-weight-entry")
        app.buttons["Cancel"].tapWhenReady()
        let log = app.buttons["LOG SET 1"]
        reveal(log, in: app)
        capture("runner-log")
        log.tapWhenReady()
        let rest = app.buttons["rest.done"]
        reveal(rest, in: app)
        capture("runner-rest")
        rest.tapWhenReady()
        reveal(app.buttons["LOG SET 2"], in: app)
    }
}
