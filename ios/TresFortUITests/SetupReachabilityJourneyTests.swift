import XCTest

/// Planning stays reachable after skipping setup or saving an unscheduled
/// workout. These journeys use the normal entry, editor and schedule writes.
final class SetupReachabilityJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            print(XCUIApplication().debugDescription)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "setup-reachability-failure"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
    }

    func testEmptyScheduleOpensComposerWithoutDetouringThroughWorkouts() {
        let app = launchAfterSkippingSetup()
        app.tabBars.buttons["Plan"].tapWhenReady()
        XCTAssertTrue(app.buttons["plan.week.mon"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["plan.goToWorkouts"].exists)
        assertWrites(in: app, workouts: 0, schedules: 0)

        revealAndTap(app.buttons["plan.add"], in: app)
        XCTAssertTrue(app.navigationBars["Add to your week"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["composer.kind.run"].isSelected)
        app.buttons["composer.cancel"].tapWhenReady()
        XCTAssertTrue(app.navigationBars["Plan"].waitForExistence(timeout: UITestWait.screen))
        assertWrites(in: app, workouts: 0, schedules: 0)
    }

    func testEmptyWeekdayOpensComposerWithThatDaySelected() {
        let app = launchAfterSkippingSetup()
        app.tabBars.buttons["Plan"].tapWhenReady()
        revealAndTap(app.buttons["plan.week.mon"], in: app)
        XCTAssertTrue(app.navigationBars["Monday"].waitForExistence(timeout: UITestWait.screen))
        revealAndTap(app.buttons["weekday.newRun"], in: app)
        XCTAssertTrue(app.navigationBars["Add to your week"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.scroll(toReveal: app.buttons["composer.day.mon"]))
        XCTAssertTrue(app.buttons["composer.day.mon"].isSelected)
        XCTAssertFalse(app.buttons["composer.day.tue"].isSelected)
        app.navigationBars["Add to your week"].backButton.tapWhenReady()
        app.buttons["weekday.done"].tapWhenReady()
        XCTAssertTrue(app.navigationBars["Plan"].waitForExistence(timeout: UITestWait.screen))
        assertWrites(in: app, workouts: 0, schedules: 0)
    }

    func testSavedWorkoutCanBeScheduledFromTodayWithoutCreatingAnother() {
        let app = launchAfterSkippingSetup()
        app.buttons["today.createWorkout"].tapWhenReady()
        let exercise = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "exercisePicker.exercise.")).firstMatch
        XCTAssertTrue(exercise.waitForExistence(timeout: UITestWait.screen))
        let exerciseID = exercise.identifier
        XCTAssertFalse(exerciseID.isEmpty)
        app.buttons[exerciseID].tapWhenReady()
        app.buttons["createWorkout.review"].tapWhenReady()
        app.buttons["createWorkout.create"].tapWhenReady()
        app.navigationBars["Workout 1"].buttons["Done"].tapWhenReady()
        XCTAssertTrue(app.buttons["today.planWeek"].waitForExistence(timeout: UITestWait.screen))
        assertWrites(in: app, workouts: 1, schedules: 0)

        app.buttons["today.planWeek"].tapWhenReady()
        XCTAssertTrue(app.buttons["composer.kind.saved"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["composer.kind.saved"].isSelected)
        revealAndTap(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "composer.saved.")).firstMatch, in: app)
        revealAndTap(app.buttons["composer.day.tue"], in: app)
        app.buttons["composer.save"].tapWhenReady()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["today.planWeek"].exists, "A scheduled library no longer needs setup")
        assertWrites(in: app, workouts: 1, schedules: 1)

        app.tabBars.buttons["Plan"].tapWhenReady()
        let tuesday = app.buttons["plan.week.tue"]
        XCTAssertTrue(tuesday.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(tuesday.label.contains("Workout 1"), tuesday.label)
        app.segmentedControls["plan.side"].buttons["Workouts"].tapWhenReady()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "library.workout.")).firstMatch.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "library.workout.")).count, 1)
    }

    private func launchAfterSkippingSetup() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "activation-manual"
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.staticTexts["fixture.scenario"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["Sign in with Apple"].tapWhenReady()
        app.buttons["Get started"].tapWhenReady()
        app.buttons["setup.skip"].tapWhenReady()
        XCTAssertTrue(app.buttons["today.planWeek"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    private func revealAndTap(_ element: XCUIElement, in app: XCUIApplication,
                              file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.scroll(toReveal: element), "Control is not reachable: \(element.identifier)", file: file, line: line)
        element.tapWhenReady(file: file, line: line)
    }

    private func assertWrites(in app: XCUIApplication, workouts: Int, schedules: Int,
                             file: StaticString = #filePath, line: UInt = #line) {
        let value = app.staticTexts["fixture.scenario"].value as? String ?? ""
        let counts = Dictionary(uniqueKeysWithValues: value.split(separator: ";").compactMap { item -> (String, Int)? in
            let pair = item.split(separator: ":")
            guard pair.count == 2, let value = Int(pair[1]) else { return nil }
            return (String(pair[0]), value)
        })
        XCTAssertEqual(counts["workoutWrites"], workouts, file: file, line: line)
        XCTAssertEqual(counts["scheduleWrites"], schedules, file: file, line: line)
        XCTAssertEqual(counts["profileWrites"], 0, file: file, line: line)
        XCTAssertEqual(counts["starterWrites"], 0, file: file, line: line)
    }
}
