import XCTest

final class HistoryReviewJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 { print(XCUIApplication().debugDescription) }
    }

    private func launch(link: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "history-review"
        if let link { app.launchEnvironment["TRESFORT_UI_HISTORY_RECORD_LINK"] = link }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-restAudioCuesEnabled", "NO"]
        app.launch()
        XCTAssertTrue(app.staticTexts["fixture.scenario"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    private func tap(_ control: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(app.scroll(toReveal: control))
        control.tapWhenReady()
    }

    private func replace(_ field: XCUIElement, with value: String, in app: XCUIApplication,
                         selectValue: Bool = false) {
        field.tapWhenReady()
        let old = field.value as? String ?? ""
        if !old.isEmpty && old != field.placeholderValue && selectValue {
            // A tap on a trailing numeric value can put the caret before it.
            // Accessibility text sizes stack the label above a leading value.
            // Select the visible value and prove clearing before entering once.
            let label = app.staticTexts[field.identifier].firstMatch
            let stacked = label.exists && label.frame.maxY < field.frame.minY
            let valuePosition = field.coordinate(withNormalizedOffset: CGVector(dx: stacked ? 0.08 : 0.99, dy: 0.5))
            let focused = NSPredicate(format: "hasKeyboardFocus == true")
            let inputReady = NSPredicate { _, _ in
                focused.evaluate(with: field) && app.keyboards.firstMatch.exists
            }
            // The first tap can leave the newly presented editor unfocused.
            // Keep the same wait budget and retap only the value, before any
            // selection or input, if the field has not acquired keyboard focus.
            var ready = false
            for attempt in 0..<2 {
                if attempt > 0 && field.exists && field.isEnabled && field.isHittable { valuePosition.tap() }
                let wait = XCTNSPredicateExpectation(predicate: inputReady, object: nil)
                if XCTWaiter.wait(for: [wait], timeout: UITestWait.screen / 2) == .completed {
                    ready = true
                    break
                }
            }
            XCTAssertTrue(ready, "The correction field must have focus and a visible keyboard before selection")
            valuePosition.press(forDuration: 1.2)
            let selectAll = app.menuItems["Select All"], cut = app.menuItems["Cut"]
            let selectWord = app.menuItems["Select"]
            let selection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                selectAll.exists || cut.exists || selectWord.exists
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [selection], timeout: UITestWait.screen), .completed)
            if selectAll.exists { selectAll.tapWhenReady() }
            // At the largest text size iOS shows Select on the first menu
            // page. The rep count is one word; clearing is still verified.
            else if !cut.exists { selectWord.tapWhenReady() }
            field.typeText(XCUIKeyboardKey.delete.rawValue)
            let cleared = field.value as? String ?? ""
            XCTAssertTrue(cleared.isEmpty || cleared == field.placeholderValue)
        } else if !old.isEmpty && old != field.placeholderValue {
            // Search is leading-aligned; tapping beyond its text places the
            // caret at the end without pressing the field's outer padding.
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
            let cleared = field.value as? String ?? ""
            XCTAssertTrue(cleared.isEmpty || cleared == field.placeholderValue)
        }
        field.typeText(value)
        let entered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: UITestWait.screen), .completed)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testSearchAndDailyBestOpenExactSameDaySetForCorrection() {
        let app = launch()
        app.tabBars.buttons["Activity"].tapWhenReady()
        tap(app.buttons["progress.strength"], in: app)
        XCTAssertTrue(app.staticTexts["In your current plan"].exists)
        let search = app.textFields["history.search"]
        replace(search, with: "OHP", in: app)
        XCTAssertTrue(app.buttons["history.exercise.history-press"].exists)
        XCTAssertFalse(app.buttons["history.exercise.history-squat"].exists)
        replace(search, with: "Squat", in: app)
        search.typeText("\n")
        tap(app.buttons["history.exercise.history-squat"], in: app)
        XCTAssertTrue(app.staticTexts["history.progress.explanation"].exists)
        let source = app.buttons["history.progress.source"]
        XCTAssertTrue(source.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(source.label.contains("Evening strength"))
        XCTAssertTrue(app.scroll(toReveal: source))
        capture("history-daily-best-source")
        source.tapWhenReady()
        XCTAssertTrue(app.navigationBars["Workout record"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["workoutRecord.title"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["workoutRecord.title"].label, "Evening strength")
        XCTAssertTrue(app.staticTexts["workoutRecord.identity"].label.contains("Workout 2"))
        XCTAssertFalse(app.buttons["edit-set-history-am-set"].exists)
        capture("history-exact-evening-record")
        tap(app.buttons["edit-set-history-pm-set"], in: app)
        XCTAssertTrue(app.navigationBars["Correct set"].waitForExistence(timeout: UITestWait.screen))
        replace(app.textFields["Reps"], with: "6", in: app, selectValue: true)
        app.navigationBars["Correct set"].buttons["Save"].tapWhenReady()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
            object: app.staticTexts["Edit pending — original retained until saved."])
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: UITestWait.screen), .completed)
        app.navigationBars["Workout record"].backButton.tapWhenReady()
        let revised = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS '120 lb'"), object: source)
        XCTAssertEqual(XCTWaiter.wait(for: [revised], timeout: UITestWait.screen), .completed)
        let morning = app.descendants(matching: .any).matching(identifier: "history.session.history-am").firstMatch
        tap(morning, in: app)
        tap(app.buttons["history.record.history-am"], in: app)
        XCTAssertTrue(app.staticTexts["workoutRecord.title"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["workoutRecord.title"].label, "Morning strength")
        XCTAssertTrue(app.staticTexts["workoutRecord.identity"].label.contains("Workout 1"))
        XCTAssertTrue(app.buttons["edit-set-history-am-set"].exists)
        XCTAssertFalse(app.buttons["edit-set-history-pm-set"].exists)
        tap(app.buttons["edit-set-history-am-set"], in: app)
        XCTAssertTrue(app.navigationBars["Correct set"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.textFields["Reps"].value as? String, "5", "Evening correction must preserve the morning set")
        app.navigationBars["Correct set"].buttons["Cancel"].tapWhenReady()
        XCTAssertFalse(app.buttons["FINISH"].exists)
    }

    func testWorkoutRecordHandoffChecksExactTargetAccountAttemptAndSet() {
        let cases: [(String, String, String, String)] = [
            ("synthetic-ui-user", "2", "history-pm-set", "edit-set-history-pm-set"),
            ("another-account", "2", "history-pm-set", "history.record.accountMismatch"),
            ("synthetic-ui-user", "1", "history-pm-set", "workoutRecord.unavailable"),
            ("synthetic-ui-user", "2", "history-am-set", "workoutRecord.setUnavailable")
        ]
        for (account, attempt, set, expected) in cases {
            let app = launch(link: "tresfort://workout-record?account=\(account)&session=history-pm&attempt=\(attempt)&set=\(set)")
            XCTAssertTrue(app.descendants(matching: .any).matching(identifier: expected).firstMatch
                .waitForExistence(timeout: UITestWait.screen))
            XCTAssertFalse(app.buttons["edit-set-history-am-set"].exists)
            if expected != "edit-set-history-pm-set" { XCTAssertFalse(app.buttons["edit-set-history-pm-set"].exists) }
            XCTAssertFalse(app.buttons["FINISH"].exists)
            app.terminate()
        }
    }
}
