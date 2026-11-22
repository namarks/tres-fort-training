import XCTest

final class TodayNavigationJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            print(XCUIApplication().debugDescription)
            capture("today-navigation-failure")
        }
    }
    private func launch(unassignedDate: Bool = false, createRefreshFailure: Bool = false, moveConflict: Bool = false, creationFailure: String? = nil, restCues: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        if unassignedDate { app.launchEnvironment["TRESFORT_UI_UNASSIGNED_DATE"] = "1" }
        if createRefreshFailure { app.launchEnvironment["TRESFORT_UI_CREATE_REFRESH_FAILURE"] = "1" }
        if createRefreshFailure || creationFailure != nil { app.launchEnvironment["TRESFORT_UI_CAPTURE_LINKS"] = "1" }
        if moveConflict { app.launchEnvironment["TRESFORT_UI_MOVE_CONFLICT"] = "1" }
        if let creationFailure { app.launchEnvironment["TRESFORT_UI_CREATE_FAILURE"] = creationFailure }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-restAudioCuesEnabled", restCues ? "YES" : "NO"]
        app.launch()
        XCTAssertTrue(app.todayUpNext.waitForExistence(timeout: UITestWait.screen))
        return app
    }
    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: UITestWait.screen))
        for _ in 0..<6 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable); element.tap()
    }
    /// The calendar link heads Today's Coming up list.
    private func openCalendar(in app: XCUIApplication) {
        tap(app.tabBars.buttons["Today"], in: app)
        tap(app.buttons["today.calendar"], in: app)
    }
    /// A tap that lands while the review screen is still animating in can
    /// leave the name field without keyboard focus. Retry the tap until it
    /// has focus, then type.
    private func type(_ text: String, into field: XCUIElement, in app: XCUIApplication) {
        let focused = NSPredicate(format: "hasKeyboardFocus == true")
        for _ in 0..<3 {
            tap(field, in: app)
            let wait = XCTNSPredicateExpectation(predicate: focused, object: field)
            if XCTWaiter.wait(for: [wait], timeout: 2) == .completed { break }
        }
        field.typeText(text)
    }
    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
    }

    /// Drags sideways across the screen at `element`'s height, as a finger
    /// swiping a day.
    private func swipeDay(at element: XCUIElement, later: Bool, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: UITestWait.screen))
        let width = app.windows.firstMatch.frame.width
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let y = element.frame.midY
        let (from, to) = later ? (width * 0.85, width * 0.15) : (width * 0.15, width * 0.85)
        origin.withOffset(CGVector(dx: from, dy: y))
            .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: to, dy: y)))
    }

    /// A sideways swipe on Today's up-next row shows the days around it, and
    /// one tap comes back (app-design-pass P20, P30).
    func testSwipingTodaysCardShowsOtherDaysAndComesBack() {
        let app = launch()
        swipeDay(at: app.todayUpNext, later: true, in: app)
        let relative = app.staticTexts["today.otherDay.relative"]
        XCTAssertTrue(relative.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(relative.label, "Tomorrow")
        XCTAssertFalse(app.buttons["dayChange.cancel"].exists,
                       "Swiping across Swap must not also activate that button")
        swipeDay(at: relative, later: false, in: app)
        XCTAssertTrue(app.todayUpNext.waitForExistence(timeout: UITestWait.screen))
        swipeDay(at: app.todayUpNext, later: false, in: app)
        XCTAssertTrue(relative.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(relative.label, "Yesterday")
        XCTAssertFalse(app.navigationBars["Strength A"].exists,
                       "Swiping across the up-next row must not also open the workout")
        XCTAssertFalse(app.buttons["today.viewWorkout"].exists,
                       "Swiping across the up-next row must not also open its choices")
        tap(app.buttons["today.backToToday"], in: app)
        XCTAssertTrue(app.todayUpNext.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(relative.exists)
    }

    /// This week's fort opens the Activity tab, and the calendar sits with
    /// Coming up.
    func testThisWeekOpensActivityAndCalendarSitsWithComingUp() {
        let app = launch()
        tap(app.buttons["today.weekActivity"], in: app)
        XCTAssertTrue(app.descendants(matching: .any)["activity.week.total"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.tabBars.buttons["Activity"].isSelected)
        openCalendar(in: app)
        XCTAssertTrue(app.buttons["calendar.weeklySchedule"].waitForExistence(timeout: UITestWait.screen))
    }

    func testTodayButtonsOpenNamedDetailsLibraryCreatorAndActivity() {
        let app = launch()
        XCTAssertFalse(app.buttons["Workout options"].exists)
        XCTAssertFalse(app.buttons["today.createWorkout"].exists)
        // Unplanned training waits in Add to today, as does the iPad
        // display until one is turned on. Details, Change for today and Not
        // today are the up-next row's choices (app-design-pass P30).
        XCTAssertTrue(app.buttons["today.addAnotherWorkout"].exists)
        XCTAssertFalse(app.buttons["today.activity.run"].exists)
        XCTAssertFalse(app.navigationBars["Today"].buttons["today.ipadDisplay"].exists)
        capture("today-navigation")
        let details = app.todayChoice("today.viewWorkout")
        XCTAssertTrue(app.buttons["today.changeWorkout"].exists)
        XCTAssertTrue(app.buttons["today.skipWorkout"].exists)
        tap(details, in: app)
        XCTAssertTrue(app.navigationBars["Strength A"].waitForExistence(timeout: UITestWait.screen))
        // Edit on a date's workout asks: this day only, or the saved one.
        tap(app.buttons["workoutDetails.edit"], in: app)
        // A confirmation dialog can exist before its presentation finishes.
        // Wait for its action instead of scrolling the underlying screen,
        // which dismisses the dialog on iOS 26.
        app.buttons.matching(identifier: "workoutDetails.editSaved").firstMatch.tapWhenReady()
        XCTAssertTrue(app.navigationBars["Edit Strength A"].waitForExistence(timeout: UITestWait.screen))
        tap(app.navigationBars["Edit Strength A"].buttons["Done"], in: app)
        tap(app.navigationBars["Strength A"].buttons["Done"], in: app)
        app.openSavedWorkoutsFromToday()
        tap(app.buttons["library.workout.strength-b"], in: app)
        XCTAssertTrue(app.navigationBars["Strength B"].waitForExistence(timeout: UITestWait.screen))
        capture("chosen-workout-details")
        tap(app.navigationBars["Strength B"].backButton, in: app)
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["Add workout"], in: app)
        XCTAssertFalse(app.textFields["createWorkout.name"].exists)
        let selection = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "exercisePicker.exercise.")).firstMatch
        XCTAssertTrue(selection.waitForExistence(timeout: UITestWait.screen)); selection.tap()
        app.buttons["createWorkout.review"].tap()
        let name = app.textFields["createWorkout.name"]
        type("Hotel session", into: name, in: app)
        tap(app.buttons["createWorkout.create"], in: app)
        XCTAssertTrue(app.navigationBars["Hotel session"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.navigationBars["Hotel session"].waitForExistence(timeout: UITestWait.screen))
        tap(app.navigationBars["Hotel session"].buttons["Done"], in: app)
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "library.workout.", "Hotel session")).count, 1)
        tap(app.navigationBars["Workouts"].buttons["Done"], in: app)
        XCTAssertTrue(app.staticTexts["Strength A"].exists, "Creation must not replace today's scheduled workout")
        tap(app.buttons["today.moreWaysToTrain"], in: app)
        XCTAssertTrue(app.buttons["today.ipadDisplay"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["today.logActivity"], in: app)
        XCTAssertTrue(app.navigationBars["Log activity"].waitForExistence(timeout: UITestWait.screen))
        capture("activity-destination")
        tap(app.navigationBars["Log activity"].buttons["Cancel"], in: app)
    }

    private func launchRestDay(largeText: Bool = false, captureWrites: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        app.launchEnvironment["TRESFORT_UI_REST_DAY"] = "1"
        if captureWrites { app.launchEnvironment["TRESFORT_UI_CAPTURE_LINKS"] = "1" }
        if largeText { app.launchEnvironment["TRESFORT_UI_LARGE_TEXT"] = "1" }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Rest day"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    func testRestDayRunCanBePlannedWithoutStarting() {
        let app = launchRestDay()
        XCTAssertTrue(app.buttons["today.activity.swim"].isHittable, "Swimming is visible on Today")
        capture("rest-day-activity-choices")
        tap(app.buttons["today.activity.run"], in: app)
        XCTAssertTrue(app.buttons["todayActivity.plan"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["todayActivity.start"].exists)
        XCTAssertTrue(app.buttons["todayActivity.log"].exists)
        XCTAssertFalse(app.buttons["runRecorder.close"].exists, "Choosing Run does not open a recorder")
        capture("run-intent-choices")
        tap(app.buttons["Cancel"], in: app)
        XCTAssertTrue(app.staticTexts["Rest day"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["today.activity.run"], in: app)
        tap(app.buttons["todayActivity.plan"], in: app)
        XCTAssertTrue(app.buttons["dayRun.save"].waitForExistence(timeout: UITestWait.screen))
        capture("plan-run-for-today")
        tap(app.buttons["dayRun.save"], in: app)
        XCTAssertTrue(app.buttons["today.startRun"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Easy run"].exists)
        XCTAssertFalse(app.buttons["runRecorder.close"].exists, "Saving the plan does not start the run")
        capture("planned-run-awaits-start")
    }

    func testRunStepEditingCanBeCancelledWithoutPlanningTheDay() {
        let app = launchRestDay(captureWrites: true)
        tap(app.buttons["today.activity.run"], in: app)
        tap(app.buttons["todayActivity.plan"], in: app)
        tap(app.buttons["dayRun.kind.intervals"], in: app)
        let original = app.staticTexts["dayRun.summary"].label
        tap(app.buttons["dayRun.editSteps"], in: app)
        XCTAssertTrue(app.navigationBars["Plan run"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.buttons["runPlan.cancel"].label, "Cancel")
        app.steppers["runPlan.repeats.1"].buttons["Increment"].tapWhenReady()
        tap(app.buttons["runPlan.cancel"], in: app)
        XCTAssertTrue(app.buttons["dayRun.save"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["dayRun.summary"].label, original)

        // Accepting detailed steps still only changes the local draft.
        tap(app.buttons["dayRun.editSteps"], in: app)
        app.steppers["runPlan.repeats.1"].buttons["Increment"].tapWhenReady()
        XCTAssertEqual(app.buttons["runPlan.save"].label, "Done")
        tap(app.buttons["runPlan.save"], in: app)
        XCTAssertTrue(app.buttons["dayRun.save"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["dayRun.summary"].label.contains("3 ×"))
        tap(app.navigationBars["Tuesday's run"].backButton, in: app)
        tap(app.buttons["Cancel"], in: app)
        XCTAssertTrue(app.staticTexts["Rest day"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["fixture.plan-writes"].value as? String, "0",
                       "Opening, editing and leaving the planner must send no plan writes")
        XCTAssertFalse(app.buttons["today.startRun"].exists)
    }

    func testDetailedRunIsSavedOnlyByTheDayConfirmation() {
        let app = launchRestDay(captureWrites: true)
        tap(app.buttons["today.activity.run"], in: app)
        tap(app.buttons["todayActivity.plan"], in: app)
        tap(app.buttons["dayRun.kind.intervals"], in: app)
        tap(app.buttons["dayRun.editSteps"], in: app)
        app.steppers["runPlan.repeats.1"].buttons["Increment"].tapWhenReady()
        tap(app.buttons["3 min"], in: app)
        tap(app.segmentedControls["runStep.target"].buttons["Heart rate"], in: app)
        tap(app.buttons["runStep.done"], in: app)
        tap(app.buttons["runPlan.save"], in: app)
        XCTAssertTrue(app.buttons["dayRun.save"].waitForExistence(timeout: UITestWait.screen))
        let summary = app.staticTexts["dayRun.summary"].label
        XCTAssertTrue(summary.contains("3 ×"))
        XCTAssertTrue(summary.contains("bpm"))
        XCTAssertEqual(app.staticTexts["dayRun.customAmount"].label, "35 min")

        // Reopening and dismissing keeps the accepted draft intact.
        tap(app.buttons["dayRun.editSteps"], in: app)
        tap(app.buttons["runPlan.cancel"], in: app)
        XCTAssertTrue(app.buttons["dayRun.save"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["dayRun.summary"].label, summary)
        tap(app.buttons["dayRun.save"], in: app)
        XCTAssertTrue(app.buttons["today.startRun"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["fixture.plan-writes"].value as? String, "2",
                       "One run creation and one exact steps update, only after Save for Tuesday")
        XCTAssertFalse(app.buttons["runRecorder.close"].exists)

        tap(app.todayChoice("today.viewWorkout"), in: app)
        tap(app.buttons["workoutDetails.edit"], in: app)
        XCTAssertTrue(app.buttons["dayRun.editSteps"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["dayRun.editSteps"], in: app)
        XCTAssertTrue(app.steppers["runPlan.repeats.1"].label.contains("3 times"))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@",
                                                       "3 min", "bpm")).firstMatch.exists,
                      "The saved workout must contain the exact edited target")
    }

    func testRestDayRunCanOpenRecorderWithoutPlanning() {
        let app = launchRestDay()
        tap(app.buttons["today.activity.run"], in: app)
        tap(app.buttons["todayActivity.start"], in: app)
        XCTAssertTrue(app.buttons["runRecorder.close"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["dayRun.save"].exists)
        capture("run-start-now")
    }

    func testRestDaySwimCanBePlannedWithoutLogging() {
        let app = launchRestDay()
        tap(app.buttons["today.activity.swim"], in: app)
        XCTAssertTrue(app.buttons["todayActivity.plan"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["todayActivity.log"].exists)
        XCTAssertFalse(app.buttons["todayActivity.start"].exists, "The app does not record live swims")
        tap(app.buttons["todayActivity.plan"], in: app)
        XCTAssertTrue(app.buttons["dayEndurance.save"].waitForExistence(timeout: UITestWait.screen))
        capture("plan-swim-for-today")
        tap(app.buttons["dayEndurance.save"], in: app)
        XCTAssertTrue(app.buttons["today.logPlannedActivity"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["1000 yd swim"].exists)
        XCTAssertFalse(app.navigationBars["Log activity"].exists, "Saving the swim only plans it")
        capture("planned-swim-awaits-log")
        tap(app.buttons["today.logPlannedActivity"], in: app)
        XCTAssertTrue(app.navigationBars["Log activity"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.textFields["activity.title"].value as? String, "1000 yd swim")
    }

    func testRestDaySwimCanBeLoggedWithoutAConnection() {
        let app = launchRestDay()
        tap(app.buttons["today.activity.swim"], in: app)
        tap(app.buttons["todayActivity.log"], in: app)
        XCTAssertTrue(app.navigationBars["Log activity"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.textFields["activity.title"].value as? String, "Swim")
        XCTAssertTrue(app.buttons["activity.save"].isEnabled)
        capture("log-completed-swim")
        tap(app.buttons["activity.save"], in: app)
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: UITestWait.screen))
        tap(app.tabBars.buttons["Activity"], in: app)
        let swimEntry = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH 'activity.recent.' AND label CONTAINS %@", "Swim")).firstMatch
        XCTAssertTrue(swimEntry.waitForExistence(timeout: UITestWait.screen), "The swim reaches activity history")
    }

    func testMoreActivitiesCanBeSearchedAndPlannedAtLargeText() {
        let app = launchRestDay(largeText: true)
        let more = app.buttons["today.activity.all"]
        UITestScrolling.reveal(more, in: app, maxAttempts: 8, surface: app.scrollViews.firstMatch)
        more.tap()
        XCTAssertTrue(app.navigationBars["Choose activity"].waitForExistence(timeout: UITestWait.screen))
        let search = app.searchFields.firstMatch
        tap(search, in: app)
        search.typeText("Tennis")
        tap(app.buttons["todayActivity.sport.tennis"], in: app)
        tap(app.buttons["todayActivity.plan"], in: app)
        XCTAssertEqual(app.textFields["dayPick.name"].value as? String, "Tennis")
        tap(app.buttons["workoutPicker.schedule"], in: app)
        XCTAssertTrue(app.buttons["today.logPlannedActivity"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Tennis"].exists)
        capture("planned-tennis-large-text")
    }

    func testCalendarMovesAndRemovesOneDateWithoutChangingWeeklySchedule() {
        let app = launch()
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-08"], in: app)
        tap(app.buttons["calendar.dateActions"], in: app)
        tap(app.buttons["calendar.moveWorkout"], in: app)
        let date = app.datePickers["calendar.moveDate"]
        tap(date.buttons.matching(NSPredicate(format: "label CONTAINS 'September 9'")).firstMatch, in: app)
        tap(app.buttons["calendar.confirmMove"], in: app)
        // Moving/removing a workout writes an explicit skipped session; the
        // agenda preserves that distinction from an unscheduled rest day.
        XCTAssertTrue(app.staticTexts["SKIPPED"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["calendar.startWorkout"].exists,
                       "A skipped date must be assigned again before it can start")
        tap(app.buttons["calendar.dateActions"], in: app)
        XCTAssertTrue(app.buttons["calendar.chooseWorkout"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["calendar.moveWorkout"].exists)
        app.staticTexts["SKIPPED"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        tap(app.navigationBars["Workout date"].buttons["Done"], in: app)
        tap(app.buttons["calendar.date.2026-09-09"], in: app)
        XCTAssertTrue(app.buttons["calendar.dateActions"].waitForExistence(timeout: UITestWait.screen))
        capture("moved-workout-date")
        tap(app.buttons["calendar.dateActions"], in: app)
        tap(app.buttons["calendar.removeWorkout"], in: app)
        // Native confirmation popovers omit the cancel row; tapping their
        // dismissal region cancels without changing the planned workout.
        let dismissRegion = app.otherElements["PopoverDismissRegion"]
        XCTAssertTrue(dismissRegion.waitForExistence(timeout: UITestWait.screen))
        dismissRegion.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()
        XCTAssertTrue(app.staticTexts["STRENGTH A"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["calendar.dateActions"], in: app)
        tap(app.buttons["calendar.removeWorkout"], in: app)
        tap(app.buttons["Remove workout"], in: app)
        XCTAssertTrue(app.staticTexts["SKIPPED"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["calendar.dateActions"], in: app)
        XCTAssertTrue(app.buttons["calendar.chooseWorkout"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["calendar.removeWorkout"].exists)
        app.staticTexts["SKIPPED"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        tap(app.navigationBars["Workout date"].buttons["Done"], in: app)
        tap(app.buttons["calendar.weeklySchedule"], in: app)
        XCTAssertTrue(app.navigationBars["Weekly schedule"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Tuesday' AND label CONTAINS 'Strength A'")).firstMatch.exists)
        capture("unchanged-weekly-schedule")
    }

    private func launchGroupedPreview() throws -> XCUIApplication {
        let contractURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ExerciseGroups", withExtension: "json"))
        var contract = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: contractURL)) as? [String: Any])
        var slots = try XCTUnwrap(contract["slots"] as? [[String: Any]])
        let groups = try XCTUnwrap(contract["groups"] as? [[String: Any]])
        for (index, group) in groups.enumerated() {
            for member in try XCTUnwrap(group["member_indices"] as? [Int]) {
                slots[member]["group_id"] = "preview-\(index)"
                slots[member]["group_rest_seconds"] = group["round_rest"]
                slots[member]["group_transition_seconds"] = group["transition_rest"]
            }
        }
        slots[0]["cues"] = "Keep a steady tempo."
        slots[2]["exercise_name"] = "Dumbbell Push Press"
        slots[2]["exercise_modality"] = "dumbbell"
        slots[2]["exercise_load_mode"] = "per_hand"
        slots[2]["target_weight"] = 25
        contract["slots"] = slots
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        app.launchEnvironment["TRESFORT_UI_GROUP_CONTRACT"] = String(
            decoding: try JSONSerialization.data(withJSONObject: contract), as: UTF8.self)
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-com.nmarkspdx.tresfort.weight-entry-unit", "lb"]
        app.launch()
        XCTAssertTrue(app.todayUpNext.waitForExistence(timeout: UITestWait.screen))
        return app
    }

    func testPrescribedWeightsAppearInLibraryAndCalendar() throws {
        let app = try launchGroupedPreview()
        app.openSavedWorkoutsFromToday()
        tap(app.buttons["library.workout.synthetic-day"], in: app)
        XCTAssertTrue(app.navigationBars["Strength A"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["2×8 · 25 lb each hand"].exists)
        XCTAssertTrue(app.staticTexts["2×8 · 45 lb"].exists)
        capture("library-prescribed-weights")
        tap(app.navigationBars["Strength A"].backButton, in: app)
        tap(app.navigationBars["Workouts"].buttons["Done"], in: app)
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-08"], in: app)
        XCTAssertTrue(app.staticTexts["2×8 · 25 lb each hand"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["2×8 · 45 lb"].exists)
        capture("calendar-prescribed-weights")
    }

    func testCalendarPrioritizesGroupedWorkoutAndMatchesLibraryPreview() throws {
        let app = try launchGroupedPreview()
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-08"], in: app)
        XCTAssertTrue(app.staticTexts["Superset A"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["STRENGTH A"].exists)
        XCTAssertFalse(app.staticTexts["STRENGTH A · STRENGTH A"].exists)
        XCTAssertLessThan(app.staticTexts["Superset A"].frame.maxY, app.frame.height * 0.5,
                          "The workout should be visible in the top half without scrolling")
        XCTAssertFalse(app.buttons["calendar.moveWorkout"].exists)
        XCTAssertFalse(app.buttons["calendar.removeWorkout"].exists)
        let actions = app.buttons["calendar.dateActions"]
        XCTAssertGreaterThanOrEqual(actions.frame.width, 44)
        XCTAssertGreaterThanOrEqual(actions.frame.height, 44)
        XCTAssertTrue(actions.isHittable)

        func assertGroupedPreview() {
            let warmup = app.descendants(matching: .any)["workoutPreview.group:preview-0"].firstMatch
            XCTAssertTrue(warmup.waitForExistence(timeout: UITestWait.screen))
            XCTAssertTrue(warmup.staticTexts["Push-Up"].exists)
            XCTAssertTrue(warmup.staticTexts["Bodyweight Squat"].exists)
            XCTAssertEqual(warmup.staticTexts.matching(identifier: "WARM-UP").count, 2)
            XCTAssertTrue(warmup.staticTexts["2 rounds · 30s round rest"].exists)
            XCTAssertTrue(warmup.staticTexts["Keep a steady tempo."].exists)
            let working = app.descendants(matching: .any)["workoutPreview.group:preview-1"].firstMatch
            XCTAssertTrue(working.staticTexts["Dumbbell Push Press"].exists)
            XCTAssertTrue(working.staticTexts["Barbell Row"].exists)
            XCTAssertTrue(working.staticTexts["2 rounds · 60s round rest"].exists)
            XCTAssertTrue(working.staticTexts["15s between exercises"].exists)
            XCTAssertTrue(working.staticTexts["2×8 · 25 lb each hand"].exists)
            XCTAssertTrue(working.staticTexts["2×8 · 45 lb"].exists)
        }

        assertGroupedPreview()
        capture("calendar-grouped-workout")
        tap(app.buttons["Exercise information for Push-Up"], in: app)
        let demoTitle = app.staticTexts["PUSH-UP"]
        XCTAssertTrue(demoTitle.waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["exerciseInfo.done"], in: app)
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: demoTitle)
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertTrue(actions.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(actions.isHittable)
        // A large accessibility frame alone does not prove the full target
        // receives touches. Exercise the bottom edge of the 44pt area.
        actions.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .withOffset(CGVector(dx: 0, dy: 21)).tap()
        XCTAssertTrue(app.buttons["calendar.moveWorkout"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["calendar.removeWorkout"].exists)
        tap(app.buttons["calendar.chooseWorkout"], in: app)
        // Swap opens on what instead; saved lifts are under Lift.
        XCTAssertTrue(app.buttons["dayChange.kind.lift"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["dayChange.kind.lift"], in: app)
        tap(app.buttons["workoutPicker.workout.synthetic-day"], in: app)
        tap(app.buttons["workoutPicker.preview"], in: app)
        XCTAssertFalse(app.buttons["workoutDetails.edit"].exists)
        assertGroupedPreview()
        capture("picker-matching-grouped-workout")
    }

    func testCalendarPickerSchedulesOnlySelectedDateWithoutManagementTools() {
        let app = launch()
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-09"], in: app)
        XCTAssertFalse(app.buttons["calendar.startWorkout"].exists, "Future workouts cannot be started")
        tap(app.buttons["calendar.dateActions"], in: app)
        tap(app.buttons["calendar.chooseWorkout"], in: app)
        XCTAssertTrue(app.buttons["dayChange.kind.lift"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.navigationBars["Plan Wednesday"].exists)
        tap(app.buttons["dayChange.kind.lift"], in: app)
        XCTAssertFalse(app.buttons["workoutPicker.schedule"].isEnabled)
        XCTAssertFalse(app.buttons["library.scope"].exists)
        XCTAssertFalse(app.buttons["library.tagFilter"].exists)
        XCTAssertFalse(app.buttons["Actions for Strength B"].exists)
        XCTAssertFalse(app.buttons["Add workout"].exists)
        XCTAssertFalse(app.staticTexts["Changes"].exists)
        tap(app.buttons["workoutPicker.workout.strength-b"], in: app)
        XCTAssertTrue(app.buttons["workoutPicker.schedule"].isEnabled)
        capture("date-workout-picker")
        tap(app.buttons["workoutPicker.schedule"], in: app)
        XCTAssertTrue(app.navigationBars["Workout date"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["STRENGTH B"].exists)
        tap(app.navigationBars["Workout date"].buttons["Done"], in: app)
        tap(app.buttons["calendar.date.2026-09-08"], in: app)
        XCTAssertTrue(app.staticTexts["STRENGTH A"].waitForExistence(timeout: UITestWait.screen))
        tap(app.navigationBars["Workout date"].buttons["Done"], in: app)
        tap(app.buttons["calendar.date.2026-09-05"], in: app)
        XCTAssertFalse(app.buttons["calendar.startWorkout"].exists, "Historical records cannot be started")
    }

    func testChangeTodayUsesDatePickerAndPreservesLibraryManagementRoute() {
        let app = launch()
        tap(app.todayChoice("today.changeWorkout"), in: app)
        XCTAssertTrue(app.navigationBars["Swap Tuesday's lift"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["dayChange.rest"].exists, "Swap also offers a rest day")
        XCTAssertFalse(app.buttons["Actions for Strength A"].exists)
        XCTAssertFalse(app.buttons["Add workout"].exists)
        XCTAssertFalse(app.staticTexts["Changes"].exists)
        tap(app.buttons["dayChange.kind.lift"], in: app)
        tap(app.buttons["workoutPicker.workout.strength-b"], in: app)
        tap(app.buttons["workoutPicker.schedule"], in: app)
        XCTAssertTrue(app.buttons["today.startWorkout"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Strength B"].exists)
        XCTAssertFalse(app.buttons["LOG SET 1"].exists, "Changing the date must not start a workout")
        app.openSavedWorkoutsFromToday()
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["Actions for Strength B"].exists)
        XCTAssertTrue(app.buttons["Add workout"].exists)
    }

    func testCompletedExercisesExpandToCorrectionControls() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "WorkoutSummaryPresentation", withExtension: "json"))
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "workout-summary"
        app.launchEnvironment["TRESFORT_UI_SUMMARY_CONTRACT"] = try String(contentsOf: url)
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.staticTexts["workoutSummary.duration"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["edit-set-squat-1"].exists)
        // Tap the header text itself. The native DisclosureGroup button's
        // accessibility frame includes expanded content on some iOS versions.
        let exercise = app.staticTexts["calendar.exercise.squat"]
        tap(exercise, in: app)
        let edit = app.buttons["edit-set-squat-1"]
        tap(edit, in: app)
        XCTAssertTrue(app.navigationBars["Correct set"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.textFields["Weight"].exists)
        XCTAssertTrue(app.buttons["Delete set 1 of Goblet Squat"].exists)
        tap(app.navigationBars["Correct set"].buttons["Cancel"], in: app)
        tap(exercise, in: app)
        XCTAssertFalse(edit.exists)
        XCTAssertTrue(app.staticTexts["calendar.exercise.pushup"].exists)
        capture("completed-exercise-disclosures")
    }

    func testCalendarStartsAndContinuesTheSameTodaysWorkout() {
        let app = launch()
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-08"], in: app)
        let start = app.buttons["calendar.startWorkout"]
        XCTAssertEqual(start.label, "Start workout")
        tap(start, in: app)
        XCTAssertTrue(app.buttons["LOG SET 1"].waitForExistence(timeout: UITestWait.screen))
        let exerciseName = app.staticTexts["runner.exerciseTitle"].label
        tap(app.buttons["LOG SET 1"], in: app)
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["runner.minimize"], in: app)
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-08"], in: app)
        XCTAssertEqual(app.buttons["calendar.startWorkout"].label, "Continue workout")
        tap(app.buttons["calendar.startWorkout"], in: app)
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["runner.exerciseTitle"].label, exerciseName)
        XCTAssertFalse(app.tabBars.buttons["Today"].isHittable)
        capture("calendar-continued-workout")
    }

    /// The Plan tab holds the library, and details, the editor and the
    /// calendar push onto its one stack instead of stacking sheets. The tab
    /// bar exists only under RootView, so this runs on the app-store fixture.
    func testPlanTabKeepsWorkoutDetailsEditorAndCalendarOnOneStack() {
        let app = launch()
        tap(app.tabBars.buttons["Plan"], in: app)
        let plan = app.navigationBars["Plan"]
        XCTAssertTrue(plan.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(plan.buttons["Done"].exists)
        // The tab opens on its Schedule side: the repeating week and the one
        // action that changes it. Saved workouts live on the Workouts side.
        XCTAssertTrue(app.segmentedControls["plan.side"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.segmentedControls["plan.side"].buttons["Schedule"].isSelected)
        XCTAssertTrue(app.buttons["plan.week.thu"].exists)
        XCTAssertTrue(app.buttons["plan.week.mon"].exists, "A rest day opens too, to put something on it")
        XCTAssertFalse(app.buttons["plan.changes"].exists, "Plan changes stay off the Plan tab")
        XCTAssertFalse(app.buttons["library.workout.strength-b"].exists)
        XCTAssertFalse(app.buttons["Add workout"].exists)
        capture("plan-tab")
        let editAllDays = app.buttons["library.weeklySchedule"]
        XCTAssertTrue(app.scroll(toReveal: editAllDays))
        XCTAssertEqual(editAllDays.label, "Edit all days")
        editAllDays.tapWhenReady()
        XCTAssertTrue(app.navigationBars["Weekly schedule"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["weeklySchedule.cancel"], in: app)
        XCTAssertTrue(plan.waitForExistence(timeout: UITestWait.screen))

        // A day opens to change it; its workout is one tap further.
        let thursday = app.buttons["plan.week.thu"]
        XCTAssertTrue(app.scroll(toReveal: thursday, searchingUp: true))
        thursday.tapWhenReady()
        XCTAssertTrue(app.navigationBars["Thursday"].waitForExistence(timeout: UITestWait.screen))
        // The day opens on what it holds: its workout, one tap from details.
        let viewWorkout = app.buttons["weekday.viewWorkout"]
        XCTAssertTrue(viewWorkout.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(viewWorkout.isHittable)
        XCTAssertTrue(app.buttons["weekday.newActivity"].exists)
        capture("plan-weekday")
        // The saved choices follow; the chosen one is ticked.
        let chosen = app.buttons["weekday.choice.strength-b"]
        for _ in 0..<4 where !(chosen.exists && chosen.isHittable) { app.swipeUp() }
        XCTAssertTrue(chosen.isSelected)
        for _ in 0..<6 where !(viewWorkout.exists && viewWorkout.isHittable) { app.swipeDown() }
        tap(viewWorkout, in: app)
        XCTAssertTrue(app.navigationBars["Strength B"].waitForExistence(timeout: UITestWait.screen))
        tap(app.navigationBars["Strength B"].backButton, in: app)
        XCTAssertTrue(plan.waitForExistence(timeout: UITestWait.screen))

        // The week, its Add button and the links below it are taller than a
        // phone, so reaching "Edit all days" scrolled the list and the Plan
        // tab keeps that place. The side switch is its first row: scroll back
        // up to it, since a row scrolled away leaves the accessibility tree.
        let sides = app.segmentedControls["plan.side"]
        for _ in 0..<6 where !(sides.exists && sides.isHittable) { app.swipeDown() }
        tap(sides.buttons["Workouts"], in: app)
        XCTAssertTrue(app.buttons["Add workout"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["library.weeklySchedule"].exists)
        XCTAssertFalse(app.buttons["library.archived"].exists)
        capture("plan-tab-workouts")
        tap(app.buttons["library.workout.strength-b"], in: app)
        let details = app.navigationBars["Strength B"]
        XCTAssertTrue(details.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(details.buttons["Done"].exists)
        tap(app.buttons["workoutDetails.edit"], in: app)
        let editor = app.navigationBars["Edit Strength B"]
        XCTAssertTrue(editor.waitForExistence(timeout: UITestWait.screen))
        tap(editor.buttons["Done"], in: app)
        XCTAssertTrue(details.waitForExistence(timeout: UITestWait.screen))
        tap(details.backButton, in: app)
        XCTAssertTrue(plan.waitForExistence(timeout: UITestWait.screen))
        for _ in 0..<6 where !(sides.exists && sides.isHittable) { app.swipeDown() }
        XCTAssertTrue(sides.buttons["Workouts"].isSelected)
        tap(sides.buttons["Schedule"], in: app)
        // Back at the top of Schedule, the Calendar row sits below the week
        // and its Add button, off screen, and a list row off screen is not
        // in the accessibility tree yet: scroll down to it before tapping.
        let calendar = app.buttons["plan.calendar"]
        XCTAssertTrue(app.scroll(toReveal: calendar))
        calendar.tapWhenReady()
        XCTAssertTrue(app.buttons["calendar.weeklySchedule"].waitForExistence(timeout: UITestWait.screen))
        tap(app.navigationBars["Calendar"].backButton, in: app)
        XCTAssertTrue(plan.waitForExistence(timeout: UITestWait.screen))
    }

    func testPlanTabContinuesTheRunningWorkoutAndBlocksAnother() {
        let app = launch()
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-08"], in: app)
        tap(app.buttons["calendar.startWorkout"], in: app)
        XCTAssertTrue(app.buttons["LOG SET 1"].waitForExistence(timeout: UITestWait.screen))
        let exerciseName = app.staticTexts["runner.exerciseTitle"].label
        tap(app.buttons["LOG SET 1"], in: app)
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["runner.minimize"], in: app)

        tap(app.tabBars.buttons["Plan"], in: app)
        tap(app.segmentedControls["plan.side"].buttons["Workouts"], in: app)
        tap(app.buttons["library.workout.strength-b"], in: app)
        XCTAssertTrue(app.navigationBars["Strength B"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["workoutDetails.start"].isEnabled,
                       "Another workout must not replace the one in progress")
        tap(app.navigationBars["Strength B"].backButton, in: app)

        tap(app.buttons["library.workout.synthetic-day"], in: app)
        let start = app.buttons["workoutDetails.start"]
        XCTAssertTrue(start.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(start.label, "Continue workout")
        tap(start, in: app)
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["runner.exerciseTitle"].label, exerciseName)
    }

    func testCalendarStartPreparesRestNotificationsBeforeLogging() {
        let app = launch(restCues: true)
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-08"], in: app)
        tap(app.buttons["calendar.startWorkout"], in: app)
        // The OS prompts only once per installation. A fresh simulator must
        // finish this permission boundary before the first set can be logged.
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 3) {
            XCTAssertFalse(app.buttons["LOG SET 1"].exists)
            allow.tap()
        }
        tap(app.buttons["LOG SET 1"], in: app)
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(allow.exists, "Logging must not trigger a permission prompt")
    }

    func testCalendarCanRemoveAPlannedDateWithoutASavedWorkoutIdentity() {
        let app = launch(unassignedDate: true)
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-09"], in: app)
        tap(app.buttons["calendar.dateActions"], in: app)
        XCTAssertFalse(app.buttons["calendar.moveWorkout"].exists)
        tap(app.buttons["calendar.removeWorkout"], in: app)
        tap(app.buttons["Remove workout"], in: app)
        XCTAssertTrue(app.staticTexts["SKIPPED"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["calendar.dateActions"], in: app)
        XCTAssertTrue(app.buttons["calendar.chooseWorkout"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["calendar.removeWorkout"].exists)
    }

    func testCalendarMoveConflictRefreshesAndAllowsARevisedRequest() {
        let app = launch(moveConflict: true)
        openCalendar(in: app)
        tap(app.buttons["calendar.date.2026-09-08"], in: app)
        tap(app.buttons["calendar.dateActions"], in: app)
        tap(app.buttons["calendar.moveWorkout"], in: app)
        let picker = app.datePickers["calendar.moveDate"]
        tap(picker.buttons.matching(NSPredicate(format: "label CONTAINS 'September 9'")).firstMatch, in: app)
        tap(app.buttons["calendar.confirmMove"], in: app)
        XCTAssertTrue(app.buttons["Refresh calendar"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(picker.isEnabled)
        XCTAssertEqual(app.buttons["calendar.confirmMove"].label, "Move workout")
        tap(app.buttons["calendar.confirmMove"], in: app)
        XCTAssertTrue(app.staticTexts["SKIPPED"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["calendar.dateActions"], in: app)
        XCTAssertTrue(app.buttons["calendar.chooseWorkout"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["calendar.moveWorkout"].exists)
    }

    func testAcknowledgedCreationRecoversThroughRefreshWithoutCreatingAgain() {
        let app = launch(createRefreshFailure: true)
        app.openSavedWorkoutsFromToday()
        tap(app.buttons["Add workout"], in: app)
        XCTAssertFalse(app.textFields["createWorkout.name"].exists)
        let selection = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "exercisePicker.exercise.")).firstMatch
        XCTAssertTrue(selection.waitForExistence(timeout: UITestWait.screen)); selection.tap()
        app.buttons["createWorkout.review"].tap()
        let name = app.textFields["createWorkout.name"]
        type("Hotel session", into: name, in: app)
        tap(app.buttons["createWorkout.create"], in: app)
        XCTAssertTrue(app.navigationBars["Workout unavailable"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["createWorkout.create"].exists)
        XCTAssertEqual(app.staticTexts["fixture.plan-writes"].value as? String, "1")
        tap(app.buttons["Refresh workout"], in: app)
        XCTAssertTrue(app.navigationBars["Hotel session"].waitForExistence(timeout: UITestWait.screen))
        tap(app.navigationBars["Hotel session"].buttons["Done"], in: app)
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["fixture.plan-writes"].value as? String, "1", "Refreshing an ACK must not resubmit creation")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "library.workout.", "Hotel session")).count, 1)
        tap(app.navigationBars["Workouts"].buttons["Done"], in: app)
        XCTAssertTrue(app.staticTexts["Strength A"].exists, "Creation must preserve today's scheduled workout")
    }

    func testCreationConflictAllowsFreshAuthorityWithoutDuplicatingAnUncertainCreation() {
        for failure in ["conflict", "lost-response"] {
            let app = launch(creationFailure: failure)
            app.openSavedWorkoutsFromToday()
            tap(app.buttons["Add workout"], in: app)
            XCTAssertFalse(app.textFields["createWorkout.name"].exists)
            let selection = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "exercisePicker.exercise.")).firstMatch
            XCTAssertTrue(selection.waitForExistence(timeout: UITestWait.screen)); selection.tap()
            app.buttons["createWorkout.review"].tap()
            let name = app.textFields["createWorkout.name"]
            type("Hotel session", into: name, in: app)
            let create = app.buttons["createWorkout.create"]
            tap(create, in: app)
            if failure == "conflict" {
                let refresh = app.buttons["createWorkout.reviewCurrentPlan"]
                XCTAssertTrue(refresh.waitForExistence(timeout: UITestWait.screen))
                XCTAssertFalse(create.isEnabled, "A conflict needs explicit review before another submission")
                XCTAssertTrue(name.isEnabled)
                XCTAssertEqual(name.value as? String, "Hotel session")
                tap(refresh, in: app)
            } else {
                expectation(for: NSPredicate(format: "label == %@ AND enabled == true", "Retry save"), evaluatedWith: create)
                waitForExpectations(timeout: UITestWait.screen)
                XCTAssertFalse(name.isEnabled, "Uncertain requests must keep the exact payload frozen")
                XCTAssertEqual(name.value as? String, "Hotel session")
            }
            XCTAssertEqual(app.staticTexts["fixture.plan-writes"].value as? String, "1")
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: create)
            waitForExpectations(timeout: UITestWait.screen)
            tap(create, in: app)
            XCTAssertTrue(app.navigationBars["Hotel session"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertFalse(app.buttons["createWorkout.create"].exists)
            tap(app.navigationBars["Hotel session"].buttons["Done"], in: app)
            XCTAssertEqual(app.staticTexts["fixture.plan-writes"].value as? String, "2")
            XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "library.workout.", "Hotel session")).count, 1)
            tap(app.navigationBars["Workouts"].buttons["Done"], in: app)
            XCTAssertTrue(app.staticTexts["Strength A"].exists, "Creation must preserve today's scheduled workout")
            app.terminate()
        }
    }

    func testDiscardRemainsReachableAfterFinishFails() {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "ready-to-finish"
        app.launchEnvironment["TRESFORT_UI_FINISH_FAILURE"] = "1"
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-restAudioCuesEnabled", "NO"]
        app.launch()
        tap(app.buttons["FINISH"], in: app)
        XCTAssertTrue(app.staticTexts["WORKOUT FINISH WAITING TO SYNC"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["today.workoutActions"], in: app)
        let discard = app.buttons["today.discardWorkout"]
        XCTAssertTrue(discard.isEnabled)
        tap(discard, in: app)
        XCTAssertTrue(app.buttons["Discard — don't save"].waitForExistence(timeout: UITestWait.screen))
    }

    func testFirstWorkoutCreationRetainsTheFormThroughPlanRecovery() {
        for failure in ["conflict", "lost-response"] {
            let app = XCUIApplication()
            app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "empty"
            app.launchEnvironment["TRESFORT_UI_CREATE_FAILURE"] = failure
            app.launchEnvironment["TRESFORT_UI_CAPTURE_LINKS"] = "1"
            app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            app.launch()
            // Prove telemetry observes this empty fixture before trusting zero writes.
            let observingRequests = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                (self.creationCounts(in: app)["state"] ?? 0) > 0
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [observingRequests], timeout: UITestWait.screen), .completed)
            assertCreationWrites(in: app, expected: 0)
            tap(app.buttons["today.createWorkout"], in: app)
            XCTAssertFalse(app.textFields["createWorkout.name"].exists)
            let selection = app.buttons["exercisePicker.exercise.synthetic-exercise"]
            tap(selection, in: app)
            expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: selection)
            waitForExpectations(timeout: UITestWait.screen)
            let review = app.buttons["createWorkout.review"]
            expectation(for: NSPredicate(format: "enabled == true AND label == %@", "Review workout (1)"), evaluatedWith: review)
            waitForExpectations(timeout: UITestWait.screen)
            tap(review, in: app)
            let name = app.textFields["createWorkout.name"]
            type("First workout", into: name, in: app)
            let target = app.buttons["createWorkout.targets.synthetic-exercise"]
            XCTAssertTrue(target.waitForExistence(timeout: UITestWait.screen))
            let reviewedTarget = target.label
            assertCreationWrites(in: app, expected: 0)
            let create = app.buttons["createWorkout.create"]
            tap(create, in: app)
            let refresh = app.buttons[failure == "conflict" ? "createWorkout.reviewCurrentPlan" : "createWorkout.refreshPlan"]
            XCTAssertTrue(refresh.waitForExistence(timeout: UITestWait.screen))
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: refresh)
            waitForExpectations(timeout: UITestWait.screen)
            XCTAssertFalse(create.isEnabled, "An absent or changed plan requires recovery before another save")
            XCTAssertEqual(name.isEnabled, failure == "conflict", "An uncertain request keeps its draft frozen")
            XCTAssertEqual(name.value as? String, "First workout")
            XCTAssertEqual(target.label, reviewedTarget)
            assertCreationWrites(in: app, expected: 1)
            // A lost reply leaves the local plan absent even though the server
            // committed it. Refresh must retain the original request for retry.
            let readsBeforeRecovery = creationCounts(in: app)["state"] ?? 0
            tap(refresh, in: app)
            let recovered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                create.isEnabled && (self.creationCounts(in: app)["state"] ?? 0) > readsBeforeRecovery
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [recovered], timeout: UITestWait.screen), .completed)
            XCTAssertEqual(name.isEnabled, failure == "conflict")
            XCTAssertEqual(name.value as? String, "First workout")
            XCTAssertEqual(target.label, reviewedTarget)
            assertCreationWrites(in: app, expected: 1)
            tap(create, in: app)
            XCTAssertTrue(app.navigationBars["First workout"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertFalse(app.navigationBars["Edit First workout"].exists)
            XCTAssertFalse(create.exists)
            XCTAssertTrue(app.staticTexts["Barbell Squat"].exists)
            tap(app.navigationBars["First workout"].buttons["Done"], in: app)
            app.openSavedWorkoutsFromToday()
            XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
            // Counters include the failed attempt; two requests must still
            // leave exactly one committed workout in the initially empty account.
            assertCreationWrites(in: app, expected: 2)
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "library.workout.")).count, 1)
            XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "library.workout.", "First workout")).count, 1)
            app.terminate()
        }
    }

    func testFirstWeekPlanningRecoversBeforeOpeningComposer() {
        for failure in ["request", "refresh"] {
            let app = XCUIApplication()
            app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "empty"
            app.launchEnvironment["TRESFORT_UI_ENSURE_FAILURE"] = failure
            app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            app.launch()
            tap(app.buttons["today.planWeek"], in: app)
            XCTAssertTrue(app.staticTexts["today.load-error"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertFalse(app.navigationBars["Add to your week"].exists)
            XCTAssertFalse(app.buttons["today.createWorkout"].exists)
            tap(app.buttons["Try again"], in: app)
            tap(app.buttons["today.planWeek"], in: app)
            XCTAssertTrue(app.navigationBars["Add to your week"].waitForExistence(timeout: UITestWait.screen))

            // Home routines are built in the composer only after this public
            // entry has recovered the plan; lifting creates its plan atomically.
            tap(app.revealComposerKind("home"), in: app)
            XCTAssertTrue(app.scroll(toReveal: app.buttons["composer.day.tue"]))
            tap(app.buttons["composer.day.tue"], in: app)
            XCTAssertTrue(app.scroll(toReveal: app.buttons["composer.home.add"]))
            tap(app.buttons["composer.home.add"], in: app)
            tap(app.buttons["homePicker.exercise.synthetic-core"], in: app)
            tap(app.buttons["homePicker.done"], in: app)
            XCTAssertTrue(app.scroll(toReveal: app.buttons["composer.home.exercise.synthetic-core"]))
            let name = app.textFields["composer.name"]
            XCTAssertTrue(app.scroll(toReveal: name))
            XCTAssertEqual(name.placeholderValue, "Core routine")
            XCTAssertEqual(app.buttons["composer.save"].label, "Add to Tuesdays")
            XCTAssertTrue(app.buttons["composer.save"].isEnabled)
            app.terminate()
        }
    }

    private func creationCounts(in app: XCUIApplication) -> [String: Int] {
        let evidence = app.staticTexts["fixture.scenario"].value as? String ?? ""
        return Dictionary(uniqueKeysWithValues: evidence.split(separator: ";").compactMap { item -> (String, Int)? in
            let pair = item.split(separator: ":", maxSplits: 1)
            guard pair.count == 2, let value = Int(pair[1]) else { return nil }
            return (String(pair[0]), value)
        })
    }

    private func assertCreationWrites(in app: XCUIApplication, expected: Int,
                                      file: StaticString = #filePath, line: UInt = #line) {
        let counts = creationCounts(in: app)
        XCTAssertGreaterThan(counts["state"] ?? 0, 0, "Request telemetry must observe state reads", file: file, line: line)
        XCTAssertEqual(counts["workoutWrites"], expected, "Workout write attempts", file: file, line: line)
        XCTAssertEqual(counts["planWrites"], expected, "All plan write attempts", file: file, line: line)
        for counter in ["profileWrites", "starterWrites", "scheduleWrites"] {
            XCTAssertEqual(counts[counter], 0, counter, file: file, line: line)
        }
    }

    func testUnresolvedRealWorkoutRemainsVisibleWithItsRecord() {
        for (status, emptyLibrary) in [("planned", false), ("in_progress", false), ("planned", true), ("in_progress", true)] {
            let app = XCUIApplication()
            app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
            app.launchEnvironment["TRESFORT_UI_UNRESOLVED_TODAY"] = status
            if emptyLibrary { app.launchEnvironment["TRESFORT_UI_EMPTY_WORKOUT_LIBRARY"] = "1" }
            app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            app.launch()
            XCTAssertTrue(app.staticTexts["Workout needs review"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertFalse(app.staticTexts["Nothing scheduled"].exists)
            XCTAssertFalse(app.buttons["today.starterWorkout"].exists)
            XCTAssertFalse(app.buttons["today.startWorkout"].exists)
            let record = app.navigationBars["Workout record"]
            app.buttons["today.viewUnresolvedWorkout"].tap(until: record)
            if status == "in_progress" {
                XCTAssertTrue(app.staticTexts["IN PROGRESS"].waitForExistence(timeout: UITestWait.screen))
                let exercise = app.staticTexts["calendar.exercise.squat"]
                XCTAssertTrue(exercise.waitForExistence(timeout: UITestWait.screen))
                XCTAssertEqual(exercise.label, "Barbell Squat")
                XCTAssertTrue(app.staticTexts["1 working set · 5 reps"].waitForExistence(timeout: UITestWait.screen))
                XCTAssertFalse(app.staticTexts["Set 1"].exists)
                let edit = app.buttons["edit-set-unresolved-set"]
                XCTAssertFalse(edit.exists)
                tap(exercise, in: app)
                XCTAssertTrue(app.staticTexts["Set 1"].waitForExistence(timeout: UITestWait.screen))
                let correction = app.navigationBars["Correct set"]
                edit.tap(until: correction)
                let reps = app.textFields["Reps"]
                XCTAssertTrue(reps.waitForExistence(timeout: UITestWait.screen))
                XCTAssertEqual(reps.value as? String, "5")
                XCTAssertTrue(app.buttons["Delete set 1 of Barbell Squat"].waitForExistence(timeout: UITestWait.screen))
                correction.buttons["Cancel"].tapWhenReady()
                // The record remains in the tree behind the correction sheet.
                // Wait for dismissal before toggling its disclosure, then wait
                // for that single state-changing tap to finish collapsing it.
                expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: correction)
                waitForExpectations(timeout: UITestWait.screen)
                exercise.tapWhenReady()
                expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: edit)
                waitForExpectations(timeout: UITestWait.screen)
                XCTAssertTrue(app.staticTexts["1 working set · 5 reps"].exists)
                XCTAssertFalse(app.staticTexts["No sets logged."].exists)
            } else {
                tap(app.buttons["calendar.dateActions"], in: app)
                XCTAssertTrue(app.buttons["calendar.removeWorkout"].waitForExistence(timeout: UITestWait.screen))
            }
            app.terminate()
        }
    }
}
