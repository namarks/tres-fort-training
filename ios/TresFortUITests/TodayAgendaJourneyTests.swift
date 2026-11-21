import XCTest

final class TodayAgendaJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            print(XCUIApplication().debugDescription)
            let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            image.name = "today-agenda-failure"; image.lifetime = .keepAlways; add(image)
        }
    }

    private func launch(completedRun: Bool = false, largeText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        app.launchEnvironment["TRESFORT_UI_MIXED_AGENDA"] = completedRun ? "completed-run" : "planned"
        app.launchEnvironment["TRESFORT_UI_TICKING_CLOCK"] = "1"
        if largeText { app.launchEnvironment["TRESFORT_UI_LARGE_TEXT"] = "1" }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-restAudioCuesEnabled", "NO"]
        app.launch()
        XCTAssertTrue(dayList(app).waitForExistence(timeout: UITestWait.screen))
        return app
    }

    /// Today's day as one list (app-design-pass P30).
    private func dayList(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["today.dayList"]
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: UITestWait.screen))
        for _ in 0..<8 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable); element.tap()
    }

    func testRunCoreAndLogOnlyActivityShareOneAgendaWithTimes() {
        let app = launch()
        let run = app.staticTexts["today.agenda.status.primary"]
        let core = app.staticTexts["today.agenda.status.scheduled:agenda-core"]
        let walk = app.staticTexts["today.agenda.status.scheduled:agenda-walk"]
        // The run leads on navy, its time in its Up next line.
        XCTAssertTrue(app.todayUpNext.staticTexts["today.agenda.status.primary"].exists)
        XCTAssertGreaterThan(app.todayUpNext.staticTexts.matching(NSPredicate(format: "label CONTAINS '7:00'")).count, 0)
        XCTAssertTrue(core.label.contains("6:00"))
        XCTAssertTrue(walk.label.contains("8:00"))
        XCTAssertLessThan(run.frame.minY, core.frame.minY)
        XCTAssertLessThan(core.frame.minY, walk.frame.minY)
        XCTAssertTrue(app.buttons["today.scheduledAdditional.agenda-core"].exists)
        XCTAssertEqual(app.buttons.matching(identifier: "today.extra.log.agenda-walk").count, 1)
        tap(app.buttons["today.extra.log.agenda-walk"], in: app)
        XCTAssertTrue(app.navigationBars["Log activity"].waitForExistence(timeout: UITestWait.screen))
    }

    func testCoreStartsAndCompletesIndependentlyAfterRun() {
        let app = launch(completedRun: true)
        let runStatus = app.staticTexts["today.agenda.status.session:agenda-run-session"]
        XCTAssertTrue(runStatus.label.hasPrefix("Done"))
        // With the run done, core leads.
        XCTAssertTrue(app.todayUpNext.staticTexts["today.agenda.status.scheduled:agenda-core"].exists)
        tap(app.buttons["today.scheduledAdditional.agenda-core"], in: app)
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 5) { allow.tap() }
        let start = app.buttons["START SET 1"]
        XCTAssertTrue(start.waitForExistence(timeout: UITestWait.screen)); start.tap()
        let finish = app.buttons["FINISH"]
        XCTAssertTrue(finish.waitForExistence(timeout: UITestWait.screen)); finish.tap()
        XCTAssertTrue(dayList(app).waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(runStatus.label.hasPrefix("Done"))
        XCTAssertFalse(app.buttons["today.scheduledAdditional.agenda-core"].exists)
        let coreDone = app.staticTexts.matching(NSPredicate(
            format: "identifier BEGINSWITH 'today.agenda.status.session:' AND label == 'Done · 1 exercise'"))
        XCTAssertEqual(coreDone.count, 1, "Core shrinks to a check and what was done")
        // The walk is all that's left, so it leads.
        XCTAssertTrue(app.todayUpNext.buttons["today.extra.log.agenda-walk"].exists)
    }

    func testAgendaActionsRemainReachableAtLargestTextSize() {
        let app = launch(largeText: true)
        tap(app.buttons["today.extra.log.agenda-walk"], in: app)
        XCTAssertTrue(app.navigationBars["Log activity"].waitForExistence(timeout: UITestWait.screen))
    }
}
