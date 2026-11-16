import XCTest

final class ManualProgressionJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testWeekTargetsSaveOnlySelectedAndLaterWeeks() {
        let app = launch()
        openWeek(2, app: app)
        openTargets(app)
        let value = app.textFields["plan.targets.value"]
        XCTAssertTrue(app.scroll(toReveal: value))
        XCTAssertEqual(value.value as? String, "3")
        replace(value, with: "5", in: app)
        let later = app.switches["plan.targets.later"]
        XCTAssertTrue(app.scroll(toReveal: later, searchingUp: true))
        // The Switch accessibility frame includes its label; tap the visible
        // trailing switch, then verify the reviewed scope before saving.
        later.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(later.value as? String, "1")
        XCTAssertEqual(app.staticTexts["plan.targets.scopeExplanation"].label, "Weeks 2–3 of this block.")
        for week in [2, 3] {
            let preview = app.staticTexts.matching(NSPredicate(
                format: "identifier BEGINSWITH %@ AND label BEGINSWITH %@",
                "plan.targets.preview.", "Week \(week) · Strength A, Barbell Squat, Sets / rounds:")).firstMatch
            XCTAssertTrue(app.scroll(toReveal: preview))
            XCTAssertEqual(preview.label, "Week \(week) · Strength A, Barbell Squat, Sets / rounds: 3 → 5")
        }
        app.buttons["plan.targets.save"].tapWhenReady()
        assertEditorClosed(app)
        XCTAssertTrue(app.buttons["plan.block.menu"].waitForExistence(timeout: UITestWait.screen))
        openTargets(app)
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "5")
        closeTargets(app)
        openWeek(1, app: app); openTargets(app)
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "3")
        closeTargets(app)
        openWeek(3, app: app); openTargets(app)
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "5")
        closeTargets(app)
        assertPlanWrites("1", app: app)
    }

    func testUnfinishedTargetRequiresDiscardBeforeSwitchOrClose() {
        let app = launch()
        openTargets(app)
        let value = app.textFields["plan.targets.value"]
        XCTAssertTrue(app.scroll(toReveal: value)); replace(value, with: "4", in: app)
        let field = app.buttons["plan.targets.field"]
        XCTAssertTrue(app.scroll(toReveal: field, searchingUp: true))
        let originalField = field.label
        field.tap()
        app.buttons["Reps"].tapWhenReady()
        let switching = app.alerts["Discard the unfinished target before switching?"]
        XCTAssertTrue(switching.waitForExistence(timeout: UITestWait.screen))
        switching.buttons["Keep editing"].tapWhenReady()
        XCTAssertEqual(field.label, originalField)
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "4")
        app.navigationBars["Week targets"].buttons["Cancel"].tapWhenReady()
        let closing = app.alerts["Discard unfinished week changes?"]
        XCTAssertTrue(closing.waitForExistence(timeout: UITestWait.screen))
        closing.buttons["Keep editing"].tapWhenReady()
        XCTAssertEqual(field.label, originalField)
        XCTAssertEqual(value.value as? String, "4")
        app.navigationBars["Week targets"].buttons["Cancel"].tapWhenReady()
        closing.buttons["Discard changes"].tapWhenReady()
        assertEditorClosed(app)
        assertPlanWrites("0", app: app)
    }

    func testLighterWeekConflictRequiresReviewThenSaves() {
        let app = launch(conflict: true)
        let menu = app.buttons["plan.block.menu"]
        XCTAssertTrue(app.scroll(toReveal: menu)); menu.tap()
        app.buttons["plan.block.lighten"].tapWhenReady()
        let save = app.buttons["plan.targets.save"]
        XCTAssertTrue(save.waitForExistence(timeout: UITestWait.screen))
        let preview = app.staticTexts.matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label BEGINSWITH %@",
            "plan.targets.preview.", "Week 1 · Strength A, Barbell Squat, Sets / rounds:")).firstMatch
        XCTAssertTrue(app.scroll(toReveal: preview))
        XCTAssertEqual(preview.label, "Week 1 · Strength A, Barbell Squat, Sets / rounds: 3 → 2")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "review-lighter-week-targets"; screenshot.lifetime = .keepAlways; add(screenshot)
        save.tapWhenReady()
        let review = app.buttons["plan.targets.reviewLatest"]
        XCTAssertTrue(review.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(save.isEnabled)
        XCTAssertTrue(app.scroll(toReveal: review)); review.tap()
        save.tapWhenReady()
        assertEditorClosed(app)
        XCTAssertTrue(menu.waitForExistence(timeout: UITestWait.screen))
        openTargets(app)
        let value = app.textFields["plan.targets.value"]
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "2")
        closeTargets(app)
        assertPlanWrites("2", app: app)
    }

    private func launch(conflict: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        app.launchEnvironment["TRESFORT_UI_CAPTURE_LINKS"] = "1"
        app.launchEnvironment["TRESFORT_UI_BLOCK_HANDOFF"] = "1"
        if conflict { app.launchEnvironment["TRESFORT_UI_PROGRAM_CONFLICT"] = "1" }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Plan"].waitForExistence(timeout: UITestWait.screen))
        app.tabBars.buttons["Plan"].tap()
        return app
    }
    private func openWeek(_ week: Int, app: XCUIApplication) {
        let choice = app.buttons["plan.block.week.\(week)"]
        XCTAssertTrue(app.scroll(toReveal: choice, searchingUp: true)); choice.tap()
    }
    private func openTargets(_ app: XCUIApplication) {
        let menu = app.buttons["plan.block.menu"]
        XCTAssertTrue(app.scroll(toReveal: menu)); menu.tap()
        app.buttons["plan.block.editTargets"].tapWhenReady()
        XCTAssertTrue(app.buttons["plan.targets.save"].waitForExistence(timeout: UITestWait.screen))
    }
    private func closeTargets(_ app: XCUIApplication) {
        app.navigationBars["Week targets"].buttons["Cancel"].tapWhenReady()
        assertEditorClosed(app)
    }
    private func assertEditorClosed(_ app: XCUIApplication) {
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !app.navigationBars["Week targets"].exists && !app.navigationBars["Make week lighter"].exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: UITestWait.screen), .completed)
    }
    private func assertPlanWrites(_ expected: String, app: XCUIApplication) {
        let counter = app.staticTexts["fixture.plan-writes"]
        XCTAssertTrue(counter.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(counter.value as? String, expected)
    }
    private func replace(_ field: XCUIElement, with value: String, in app: XCUIApplication) {
        let old = field.value as? String ?? ""
        field.tap(); field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + value)
        XCTAssertEqual(field.value as? String, value)
        app.buttons["plan.targets.keyboardDone"].tapWhenReady()
        let keyboardGone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardGone], timeout: UITestWait.screen), .completed)
    }
}
