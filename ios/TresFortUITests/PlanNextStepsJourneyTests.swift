import XCTest

final class PlanNextStepsJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testEstablishedWeekLeadsToBlockReviewAndSavedTargetsWithoutSaving() {
        let app = launchPlan()
        let block = app.buttons["plan.planBlock"]
        XCTAssertTrue(app.scroll(toReveal: block))
        XCTAssertEqual(block.label, "Explore a training block")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "plan-next-steps"; screenshot.lifetime = .keepAlways; add(screenshot)
        block.tap()
        let ownWeek = app.buttons["plan.blockSetup"]
        XCTAssertTrue(ownWeek.waitForExistence(timeout: UITestWait.screen))
        ownWeek.tap()
        XCTAssertTrue(app.buttons["plan.blockSetup.save"].waitForExistence(timeout: UITestWait.screen))
        app.navigationBars["Plan a block"].buttons["Cancel"].tap()
        let help = app.staticTexts["plan.block.targets.help"]
        XCTAssertTrue(app.scroll(toReveal: help))
        XCTAssertTrue(help.label.contains("same Apple account"))
        XCTAssertTrue(help.label.contains("Targets by week"))
        XCTAssertTrue(help.label.contains("Your saved workout stays unchanged"))
        openTargetsOnWeb(app)
        assertHandoff(app)
        let targets = app.buttons["plan.nextSteps.workouts"]
        XCTAssertTrue(app.scroll(toReveal: targets))
        XCTAssertFalse(app.staticTexts["plan.block.heading"].exists,
                       "Exploring and cancelling a block must preserve the repeating week.")
        targets.tap()
        XCTAssertTrue(app.buttons["library.workout.synthetic-day"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["fixture.plan-writes"].value as? String, "0")
    }

    func testExistingBlockWeekTwoOffersWebTargetsWithoutChangingWorkout() {
        let app = launchPlan(existingBlock: true)
        let weekTwo = app.buttons["plan.block.week.2"]
        XCTAssertTrue(app.scroll(toReveal: weekTwo))
        weekTwo.tap()
        // SwiftUI exposes the combined heading and its child label with the
        // same identifier. Either carries the selected week; query one node.
        let heading = app.staticTexts.matching(identifier: "plan.block.heading").firstMatch
        XCTAssertTrue(heading.label.contains("Week 2 of 3"))
        let tuesday = app.buttons["plan.block.day.tue"]
        XCTAssertTrue(app.scroll(toReveal: tuesday))
        tuesday.tap()
        let currentWorkout = app.buttons["plan.blockDay.workout.synthetic-day"]
        XCTAssertTrue(currentWorkout.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(currentWorkout.isSelected)
        let help = app.staticTexts["plan.block.targets.help"]
        XCTAssertTrue(app.scroll(toReveal: help))
        XCTAssertTrue(help.label.contains("edit Week 2"))
        XCTAssertTrue(help.label.contains("wherever that workout appears in that block week"))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "week-two-targets-web-handoff"; screenshot.lifetime = .keepAlways; add(screenshot)
        openTargetsOnWeb(app)
        // The browser launch is captured locally; return from this sheet as a
        // member would after editing on web, without selecting another workout.
        app.navigationBars["Tuesday"].buttons["Cancel"].tap()
        assertHandoff(app)
        XCTAssertTrue(app.scroll(toReveal: heading))
        XCTAssertTrue(heading.label.contains("Week 2 of 3"))
        XCTAssertTrue(app.buttons["plan.block.day.tue"].label.contains("Strength A"))
        XCTAssertEqual(app.staticTexts["fixture.plan-writes"].value as? String, "0")
    }

    private func launchPlan(existingBlock: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        app.launchEnvironment["TRESFORT_UI_CAPTURE_LINKS"] = "1"
        if existingBlock { app.launchEnvironment["TRESFORT_UI_BLOCK_HANDOFF"] = "1" }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Plan"].waitForExistence(timeout: UITestWait.screen))
        app.tabBars.buttons["Plan"].tap()
        return app
    }

    private func openTargetsOnWeb(_ app: XCUIApplication) {
        let link = app.descendants(matching: .any).matching(identifier: "plan.block.targets.web").firstMatch
        XCTAssertTrue(app.scroll(toReveal: link))
        XCTAssertEqual(link.label, "Edit week targets on web")
        link.tap()
    }

    private func assertHandoff(_ app: XCUIApplication) {
        let opened = app.staticTexts["fixture.opened-url"]
        XCTAssertTrue(opened.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(opened.label, "https://app.tresfort.app/#block")
        XCTAssertEqual(app.staticTexts["fixture.plan-writes"].value as? String, "0",
                       "Opening the web editor must not change the native plan.")
    }
}
