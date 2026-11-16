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
        replace(value, with: "5")
        let later = app.switches["plan.targets.later"]
        XCTAssertTrue(app.scroll(toReveal: later)); later.tap()
        app.buttons["plan.targets.save"].tapWhenReady()
        XCTAssertTrue(app.buttons["plan.block.menu"].waitForExistence(timeout: UITestWait.screen))
        openTargets(app)
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "5")
        app.navigationBars["Week targets"].buttons["Cancel"].tap()
        openWeek(1, app: app); openTargets(app)
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "3")
        app.navigationBars["Week targets"].buttons["Cancel"].tap()
        openWeek(3, app: app); openTargets(app)
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "5")
        app.navigationBars["Week targets"].buttons["Cancel"].tapWhenReady()
        assertPlanWrites("1", app: app)
    }

    func testUnfinishedTargetRequiresDiscardBeforeSwitchOrClose() {
        let app = launch()
        openTargets(app)
        let value = app.textFields["plan.targets.value"]
        XCTAssertTrue(app.scroll(toReveal: value)); replace(value, with: "4")
        let field = app.buttons["plan.targets.field"]
        XCTAssertTrue(app.scroll(toReveal: field)); field.tap()
        app.buttons["Reps"].tapWhenReady()
        app.buttons["Keep editing"].tapWhenReady()
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "4")
        app.navigationBars["Week targets"].buttons["Cancel"].tap()
        app.buttons["Keep editing"].tapWhenReady()
        XCTAssertEqual(value.value as? String, "4")
        app.navigationBars["Week targets"].buttons["Cancel"].tap()
        app.buttons["Discard changes"].tapWhenReady()
        assertPlanWrites("0", app: app)
    }

    func testLighterWeekConflictRequiresReviewThenSaves() {
        let app = launch(conflict: true)
        let menu = app.buttons["plan.block.menu"]
        XCTAssertTrue(app.scroll(toReveal: menu)); menu.tap()
        app.buttons["plan.block.lighten"].tapWhenReady()
        let save = app.buttons["plan.targets.save"]
        XCTAssertTrue(save.waitForExistence(timeout: UITestWait.screen))
        let preview = app.otherElements["plan.targets.preview"]
        _ = app.scroll(toReveal: preview)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "review-lighter-week-targets"; screenshot.lifetime = .keepAlways; add(screenshot)
        save.tapWhenReady()
        let review = app.buttons["plan.targets.reviewLatest"]
        XCTAssertTrue(review.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(save.isEnabled)
        XCTAssertTrue(app.scroll(toReveal: review)); review.tap()
        save.tapWhenReady()
        XCTAssertTrue(menu.waitForExistence(timeout: UITestWait.screen))
        openTargets(app)
        let value = app.textFields["plan.targets.value"]
        XCTAssertTrue(app.scroll(toReveal: value)); XCTAssertEqual(value.value as? String, "2")
        app.navigationBars["Week targets"].buttons["Cancel"].tapWhenReady()
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
        XCTAssertTrue(app.scroll(toReveal: choice)); choice.tap()
    }
    private func openTargets(_ app: XCUIApplication) {
        let menu = app.buttons["plan.block.menu"]
        XCTAssertTrue(app.scroll(toReveal: menu)); menu.tap()
        app.buttons["plan.block.editTargets"].tapWhenReady()
        XCTAssertTrue(app.buttons["plan.targets.save"].waitForExistence(timeout: UITestWait.screen))
    }
    private func assertPlanWrites(_ expected: String, app: XCUIApplication) {
        let counter = app.staticTexts["fixture.plan-writes"]
        XCTAssertTrue(counter.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(counter.value as? String, expected)
    }
    private func replace(_ field: XCUIElement, with value: String) {
        let old = field.value as? String ?? ""
        field.tap(); field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + value)
        XCTAssertEqual(field.value as? String, value)
    }
}
