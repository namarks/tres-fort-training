import XCTest

final class ProgrammingDraftJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testNewBlockCancelKeepsChoicesUntilExplicitDiscard() {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        app.launchEnvironment["TRESFORT_UI_CAPTURE_LINKS"] = "1"
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        app.tabBars.buttons["Plan"].tapWhenReady()
        let block = app.buttons["plan.planBlock"]
        XCTAssertTrue(app.scroll(toReveal: block)); block.tap()
        app.buttons["plan.blockSetup"].tapWhenReady()
        let name = app.textFields["plan.blockSetup.name"]
        name.tapWhenReady(); name.typeText("Next strength block")
        app.navigationBars["Plan a block"].buttons["Cancel"].tap()
        let alert = app.alerts["Discard block draft?"]
        alert.buttons["Keep editing"].tapWhenReady()
        XCTAssertEqual(name.value as? String, "Next strength block")
        app.navigationBars["Plan a block"].buttons["Cancel"].tap()
        alert.buttons["Discard draft"].tapWhenReady()
        XCTAssertFalse(app.buttons["plan.blockSetup.save"].exists)
        let writes = app.staticTexts["fixture.plan-writes"]
        XCTAssertTrue(writes.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(writes.value as? String, "0")
    }

    func testTagsCancelKeepsTextUntilExplicitDiscard() {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "library"
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch(); app.openSavedWorkoutsFromToday()
        app.buttons["Actions for Gym"].tapWhenReady()
        app.buttons["Edit tags"].tapWhenReady()
        let textView = app.textViews["workoutTags.input"]
        let field = textView.waitForExistence(timeout: 3) ? textView : app.textFields["workoutTags.input"]
        XCTAssertTrue(field.waitForExistence(timeout: UITestWait.screen))
        let originalValue = field.value as? String
        field.tapWhenReady(); field.typeText("quick, travel")
        app.navigationBars["Workout tags"].buttons["Cancel"].tap()
        let alert = app.alerts["Discard tag changes?"]
        alert.buttons["Keep editing"].tapWhenReady()
        XCTAssertEqual(field.value as? String, "quick, travel")
        app.navigationBars["Workout tags"].buttons["Cancel"].tap()
        alert.buttons["Discard changes"].tapWhenReady()
        XCTAssertFalse(app.buttons["workoutTags.save"].exists)
        app.buttons["Actions for Gym"].tapWhenReady()
        app.buttons["Edit tags"].tapWhenReady()
        let reopenedTextView = app.textViews["workoutTags.input"]
        let reopened = reopenedTextView.waitForExistence(timeout: 3) ? reopenedTextView : app.textFields["workoutTags.input"]
        XCTAssertTrue(reopened.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(reopened.value as? String, originalValue)
    }
}
