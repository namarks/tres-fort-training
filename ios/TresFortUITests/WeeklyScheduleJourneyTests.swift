import XCTest

final class WeeklyScheduleJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            let hierarchy = XCTAttachment(string: XCUIApplication().debugDescription)
            hierarchy.name = "weekly-schedule-failure-accessibility"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "weekly-schedule-failure"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
    }

    private func launch(fixture: String = "app-store", failure: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = fixture
        if let failure { app.launchEnvironment["TRESFORT_UI_SCHEDULE_FAILURE"] = failure }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Today"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    /// The day sheet lists saved workouts below its New tiles, so one just
    /// made can sit below the fold; scroll until it's on screen.
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<4 where !(element.exists && element.isHittable) { app.swipeUp() }
    }

    /// The calendar link heads Today's Coming up list.
    private func openCalendar(in app: XCUIApplication) {
        app.tabBars.buttons["Today"].tap()
        let calendar = app.buttons["today.calendar"]
        XCTAssertTrue(calendar.waitForExistence(timeout: UITestWait.screen))
        for _ in 0..<6 where !calendar.isHittable { app.swipeUp() }
        calendar.tap()
    }

    private func openSchedule(in app: XCUIApplication) {
        openCalendar(in: app)
        let schedule = app.buttons["calendar.weeklySchedule"]
        XCTAssertTrue(schedule.waitForExistence(timeout: UITestWait.screen))
        schedule.tap()
        XCTAssertTrue(app.buttons["weeklySchedule.mon"].waitForExistence(timeout: UITestWait.screen))
    }

    private func choose(_ workout: String, on weekday: String, in app: XCUIApplication) {
        app.buttons["weeklySchedule.\(weekday)"].tap()
        let option = app.buttons[workout]
        XCTAssertTrue(option.waitForExistence(timeout: UITestWait.screen))
        option.tap()
    }

    private func assertChoice(_ workout: String, on weekday: String, in app: XCUIApplication,
                              file: StaticString = #filePath, line: UInt = #line) {
        let picker = app.buttons["weeklySchedule.\(weekday)"]
        XCTAssertTrue(picker.waitForExistence(timeout: UITestWait.screen), file: file, line: line)
        XCTAssertTrue(picker.label.contains(workout) || (picker.value as? String)?.contains(workout) == true,
                      "Expected \(workout), got label=\(picker.label), value=\(String(describing: picker.value))",
                      file: file, line: line)
    }

    private func assertClosed(in app: XCUIApplication) {
        expectation(for: NSPredicate(format: "exists == false"),
                    evaluatedWith: app.navigationBars["Weekly schedule"])
        waitForExpectations(timeout: UITestWait.screen)
    }

    func testSaveClosesAfterPersistenceAndReopeningShowsNewSchedule() {
        let app = launch()
        openSchedule(in: app)
        XCTAssertFalse(app.buttons["weeklySchedule.save"].isEnabled)
        assertChoice("Rest", on: "mon", in: app)
        choose("Strength B", on: "mon", in: app)
        app.buttons["weeklySchedule.save"].tap()
        assertClosed(in: app)
        openSchedule(in: app)
        assertChoice("Strength B", on: "mon", in: app)
        assertChoice("Strength A", on: "tue", in: app)
        XCTAssertFalse(app.buttons["weeklySchedule.save"].isEnabled)
    }

    func testDirtyDraftSurvivesSwipeAndKeepEditingUntilExplicitDiscard() {
        let app = launch()
        openSchedule(in: app)
        choose("Strength B", on: "mon", in: app)
        app.navigationBars["Weekly schedule"].swipeDown()
        assertChoice("Strength B", on: "mon", in: app)
        app.buttons["weeklySchedule.cancel"].tap()
        let confirmation = app.alerts["Discard schedule changes?"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: UITestWait.screen))
        confirmation.buttons["Keep editing"].tap()
        assertChoice("Strength B", on: "mon", in: app)
        XCTAssertTrue(app.buttons["weeklySchedule.save"].isEnabled)
        app.buttons["weeklySchedule.cancel"].tap()
        confirmation.buttons["Discard changes"].tap()
        assertClosed(in: app)
        openSchedule(in: app)
        assertChoice("Rest", on: "mon", in: app)
        assertChoice("Strength A", on: "tue", in: app)
        app.buttons["weeklySchedule.cancel"].tap()
        assertClosed(in: app)
        XCTAssertFalse(confirmation.exists, "An unchanged schedule should close directly")
    }

    /// Tapping a day on the Plan tab changes only that day, and an activity
    /// that isn't a workout yet (soccer every Monday) is made right there.
    func testTappingADayAddsANewActivityToThatWeekdayAndCanRestAgain() {
        let app = launch()
        app.tabBars.buttons["Plan"].tap()
        let monday = app.buttons["plan.week.mon"]
        XCTAssertTrue(monday.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(monday.label.contains("Rest"), monday.label)
        monday.tap()
        let sheet = app.navigationBars["Monday"]
        XCTAssertTrue(sheet.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["weekday.choice.rest"].isSelected)
        app.buttons["weekday.newActivity"].tap()
        let idea = app.buttons["composer.idea.Soccer"]
        XCTAssertTrue(idea.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["composer.kind.sport"].isSelected)
        XCTAssertTrue(sheet.exists, "The composer opens in place on the day")
        app.openComposerWhen()
        XCTAssertTrue(app.buttons["composer.day.mon"].isSelected, "The day it came from is chosen")
        idea.tap()
        let save = app.buttons["composer.save"]
        XCTAssertEqual(save.label, "Add to Mondays")
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "plan-new-activity"; screenshot.lifetime = .keepAlways; add(screenshot)
        save.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: sheet)
        waitForExpectations(timeout: UITestWait.screen)
        expectation(for: NSPredicate(format: "label CONTAINS 'Soccer'"), evaluatedWith: monday)
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertTrue(app.buttons["plan.week.thu"].label.contains("Strength B"), "Other days stay as they were")

        // The same day goes back to rest; the activity stays saved for later.
        monday.tap()
        XCTAssertTrue(sheet.waitForExistence(timeout: UITestWait.screen))
        let soccer = app.buttons["weekday.choice.created-workout"]
        reveal(soccer, in: app)
        XCTAssertTrue(soccer.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(soccer.isSelected)
        XCTAssertTrue(soccer.label.contains("Activity"), soccer.label)
        app.buttons["weekday.choice.rest"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: sheet)
        waitForExpectations(timeout: UITestWait.screen)
        expectation(for: NSPredicate(format: "label CONTAINS 'Rest'"), evaluatedWith: monday)
        waitForExpectations(timeout: UITestWait.screen)
    }

    /// A planned run is made from the day itself: name it, and its step
    /// editor opens next, so intervals need neither the coach nor a trip
    /// through the workout editor.
    func testTappingADayMakesANewRunAndOpensItsSteps() {
        let app = launch()
        app.tabBars.buttons["Plan"].tap()
        let monday = app.buttons["plan.week.mon"]
        XCTAssertTrue(monday.waitForExistence(timeout: UITestWait.screen))
        monday.tap()
        let sheet = app.navigationBars["Monday"]
        XCTAssertTrue(sheet.waitForExistence(timeout: UITestWait.screen))
        app.buttons["weekday.newRun"].tap()
        let measure = app.segmentedControls["composer.run.measure"]
        XCTAssertTrue(measure.waitForExistence(timeout: UITestWait.screen))
        measure.buttons["Steps"].tap()
        let idea = app.buttons["composer.idea.Intervals"]
        XCTAssertTrue(idea.waitForExistence(timeout: UITestWait.screen))
        idea.tap()
        let save = app.buttons["composer.save"]
        XCTAssertEqual(save.label, "Add and plan steps")
        save.tap()

        XCTAssertTrue(app.navigationBars["Plan run"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["runPlan.cancel"].label.contains("Not now"))
        app.buttons["runPlan.addRepeat"].tap()
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "plan-new-run-steps"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.buttons["runPlan.save"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.navigationBars["Plan run"])
        waitForExpectations(timeout: UITestWait.screen)
        expectation(for: NSPredicate(format: "label CONTAINS 'Intervals'"), evaluatedWith: monday)
        waitForExpectations(timeout: UITestWait.screen)

        monday.tap()
        XCTAssertTrue(sheet.waitForExistence(timeout: UITestWait.screen))
        let run = app.buttons["weekday.choice.created-workout"]
        reveal(run, in: app)
        XCTAssertTrue(run.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(run.isSelected)
        XCTAssertTrue(run.label.contains("Run"), run.label)
    }

    /// "A 3-mile run every Wednesday" is four taps from the Plan tab: Add,
    /// Wednesday, the default 3 mi, and Add to Wednesdays. The week then says
    /// what the day holds.
    func testAddToYourWeekPutsAThreeMileRunOnWednesdays() {
        let app = launch()
        app.tabBars.buttons["Plan"].tap()
        let addButton = app.buttons["plan.add"]
        XCTAssertTrue(addButton.waitForExistence(timeout: UITestWait.screen))
        addButton.tap()
        let save = app.buttons["composer.save"]
        XCTAssertTrue(save.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["composer.kind.run"].isSelected)
        XCTAssertFalse(save.isEnabled, "A day comes first")
        app.buttons["composer.day.wed"].tap()
        XCTAssertEqual(save.label, "Add to Wednesdays")
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "plan-add-to-week"; screenshot.lifetime = .keepAlways; add(screenshot)
        save.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: save)
        waitForExpectations(timeout: UITestWait.screen)
        let wednesday = app.buttons["plan.week.wed"]
        expectation(for: NSPredicate(format: "label CONTAINS '3 mi run' AND label CONTAINS 'Run, 3 mi'"),
                    evaluatedWith: wednesday)
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertTrue(app.buttons["plan.week.thu"].label.contains("Strength B"), "Other days stay as they were")
    }

    /// A day with a workout can hold an activity beside it (stretching on a
    /// kettlebell day): the workout stays, the week shows both, and the
    /// activity comes off again from the day.
    func testADayKeepsItsWorkoutAndGetsAnActivityAlongside() {
        let app = launch()
        app.tabBars.buttons["Plan"].tap()
        let thursday = app.buttons["plan.week.thu"]
        XCTAssertTrue(thursday.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(thursday.label.contains("Strength B"), thursday.label)
        thursday.tap()
        let sheet = app.navigationBars["Thursday"]
        XCTAssertTrue(sheet.waitForExistence(timeout: UITestWait.screen))
        let addExtra = app.buttons["weekday.addExtra"]
        XCTAssertTrue(addExtra.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(addExtra.isHittable, "Adding alongside sits near the top of the day, without scrolling")
        // The arrows move to the next and previous day without closing.
        app.buttons["weekday.next"].tap()
        XCTAssertTrue(app.navigationBars["Friday"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["weekday.previous"].tap()
        XCTAssertTrue(sheet.waitForExistence(timeout: UITestWait.screen))
        // The week's letters show where you are and jump to a day.
        XCTAssertTrue(app.buttons["weekday.strip.thu"].isSelected)
        app.buttons["weekday.strip.sat"].tap()
        XCTAssertTrue(app.navigationBars["Saturday"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["weekday.strip.thu"].tap()
        XCTAssertTrue(sheet.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(addExtra.waitForExistence(timeout: UITestWait.screen))
        addExtra.tap()
        XCTAssertTrue(app.buttons["composer.kind.home"].isSelected)
        // Change folds the composer back into the day's tiles.
        app.buttons["composer.kind.home"].tap(until: app.buttons["weekday.newActivity"])
        app.buttons["weekday.newActivity"].tapWhenReady()
        let idea = app.buttons["composer.idea.Stretching"]
        XCTAssertTrue(idea.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["composer.kind.sport"].isSelected)
        app.openComposerWhen()
        XCTAssertTrue(app.buttons["composer.day.thu"].isSelected)
        idea.tap()
        app.buttons["composer.core.logOnly"].tap()
        let alongside = app.switches["composer.alongside"]
        XCTAssertTrue(alongside.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(alongside.value as? String, "1", "Keeping the day's workout is the default")
        let save = app.buttons["composer.save"]
        XCTAssertEqual(save.label, "Add to Thursdays")
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "plan-add-alongside"; screenshot.lifetime = .keepAlways; add(screenshot)
        save.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: sheet)
        waitForExpectations(timeout: UITestWait.screen)
        expectation(for: NSPredicate(format: "label CONTAINS 'Strength B' AND label CONTAINS 'Also Stretching'"),
                    evaluatedWith: thursday)
        waitForExpectations(timeout: UITestWait.screen)

        thursday.tap()
        XCTAssertTrue(sheet.waitForExistence(timeout: UITestWait.screen))
        // A time is optional; one set here shows on the week.
        let time = app.buttons["weekday.time.created-workout"]
        XCTAssertTrue(time.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(time.label, "Set a time for Stretching")
        time.tap()
        let saveTime = app.buttons["scheduleTime.save"]
        XCTAssertTrue(saveTime.waitForExistence(timeout: UITestWait.screen))
        saveTime.tap()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        expectation(for: NSPredicate(format: "label BEGINSWITH 'Stretching at '"), evaluatedWith: time)
        waitForExpectations(timeout: UITestWait.screen)

        let remove = app.buttons["weekday.extra.remove.created-workout"]
        XCTAssertTrue(remove.waitForExistence(timeout: UITestWait.screen))
        remove.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: remove)
        waitForExpectations(timeout: UITestWait.screen)
        app.buttons["weekday.done"].tap()
        expectation(for: NSPredicate(format: "NOT (label CONTAINS 'Also')"), evaluatedWith: thursday)
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertTrue(thursday.label.contains("Strength B"), thursday.label)
    }

    func testFailedSaveRetainsDraftAndAllowsExplicitRetry() {
        assertFailedSaveCanRetry(failure: "request")
    }

    func testConflictedSaveRetainsDraftAndRequiresExplicitRetry() {
        assertFailedSaveCanRetry(failure: "conflict")
    }

    private func assertFailedSaveCanRetry(failure: String) {
        let app = launch(failure: failure)
        openSchedule(in: app)
        choose("Strength B", on: "mon", in: app)
        app.buttons["weeklySchedule.save"].tap()
        XCTAssertTrue(app.staticTexts["weeklySchedule.error"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.navigationBars["Weekly schedule"].exists)
        assertChoice("Strength B", on: "mon", in: app)
        assertChoice("Strength A", on: "tue", in: app)
        if failure == "conflict" {
            XCTAssertTrue(app.staticTexts["weeklySchedule.conflict"].exists)
        }
        XCTAssertTrue(app.buttons["weeklySchedule.save"].isEnabled)
        app.buttons["weeklySchedule.save"].tap()
        assertClosed(in: app)
        openSchedule(in: app)
        assertChoice("Strength B", on: "mon", in: app)
    }

    func testWorkoutStartStaysVisibleWhilePreviewScrolls() {
        let app = launch(fixture: "app-store")
        app.todayChoice("today.viewWorkout").tap()
        assertPinnedAction("workoutDetails.start", in: app)
    }

    func testDateAssignmentStaysVisibleWhilePreviewScrolls() {
        let app = launch(fixture: "app-store")
        openCalendar(in: app)
        app.buttons["calendar.date.2026-09-09"].tap()
        let actions = app.buttons["calendar.dateActions"]
        XCTAssertTrue(actions.waitForExistence(timeout: UITestWait.screen))
        actions.tap()
        app.buttons["calendar.chooseWorkout"].tap()
        let lifts = app.buttons["dayChange.kind.lift"]
        XCTAssertTrue(lifts.waitForExistence(timeout: UITestWait.screen))
        lifts.tap()
        let workout = app.buttons["workoutPicker.workout.synthetic-day"]
        XCTAssertTrue(workout.waitForExistence(timeout: UITestWait.screen))
        workout.tap()
        app.buttons["workoutPicker.preview"].tap()
        assertPinnedAction("workoutPicker.schedule", in: app, scrolling: app.collectionViews.firstMatch)
    }

    private func assertPinnedAction(_ identifier: String, in app: XCUIApplication,
                                    scrolling: XCUIElement? = nil) {
        let action = app.buttons[identifier]
        XCTAssertTrue(action.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(action.isHittable, "The primary action must be visible without scrolling")
        let originalY = action.frame.minY
        (scrolling ?? app.scrollViews.firstMatch).swipeUp()
        XCTAssertTrue(action.isHittable)
        XCTAssertEqual(action.frame.minY, originalY, accuracy: 1,
                       "The primary action must stay fixed while the workout scrolls")
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = identifier
        capture.lifetime = .keepAlways
        add(capture)
    }
}
