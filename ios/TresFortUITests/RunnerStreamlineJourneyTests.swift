import XCTest

final class RunnerStreamlineJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 { print(XCUIApplication().debugDescription) }
    }

    private func launch(_ fixture: String = "app-store", largeText: Bool = false,
                        startWorkout: Bool = true, groupContract: String? = nil,
                        tickingClock: Bool = false, unknownLoad: Bool = false,
                        sessionControls: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = fixture
        app.launchEnvironment["TRESFORT_UI_TRACE_START"] = "1"
        app.launchEnvironment["TRESFORT_UI_ACCEPT_CORRECTIONS"] = "1"
        app.launchEnvironment["TRESFORT_UI_GROUP_CONTRACT"] = groupContract
        if unknownLoad { app.launchEnvironment["TRESFORT_UI_RUNNER_UNKNOWN_LOAD"] = "1" }
        if sessionControls { app.launchEnvironment["TRESFORT_UI_SESSION_CONTROLS"] = "1" }
        if tickingClock { app.launchEnvironment["TRESFORT_UI_TICKING_CLOCK"] = "1" }
        if largeText { app.launchEnvironment["TRESFORT_UI_LARGE_TEXT"] = "1" }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-restAudioCuesEnabled", "NO",
                               "-com.nmarkspdx.tresfort.weight-entry-unit", "lb"]
        app.launch()
        if fixture == "app-store" || fixture == "groups" {
            let start = app.buttons["today.startWorkout"]
            XCTAssertTrue(start.waitForExistence(timeout: UITestWait.screen))
            guard startWorkout else { return app }
            reveal(start, in: app)
            XCTAssertTrue(start.isEnabled)
            start.tap()
        }
        XCTAssertTrue(app.staticTexts["runner.exerciseTitle"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication,
                        file: StaticString = #filePath, line: UInt = #line) {
        // Drag in the 20 pt side margin that Today and the runner keep clear.
        // At accessibility sizes the runner's exercise options menu is a wide
        // text button mid-screen, and a press that starts on it opens the
        // menu instead of scrolling.
        UITestScrolling.reveal(element, in: app, maxAttempts: 10, leadingDragInset: 12, file: file, line: line)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testWarmupAndFinalReviewAdditionsKeepWorkingSetsSeparate() {
        let app = launch("ordinary", sessionControls: true)
        let menu = app.buttons["runner.exerciseMenu"]
        reveal(menu, in: app); menu.tap()
        app.buttons.matching(identifier: "runner.menu.logWarmup").firstMatch.tap()
        let warmup = app.navigationBars["Log warm-up"]
        XCTAssertTrue(warmup.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(warmup.buttons["Log warm-up"].isEnabled)
        let weight = app.textFields["Weight"]
        XCTAssertTrue(["", "Weight"].contains(weight.value as? String ?? ""))
        weight.tap(); weight.typeText("25")
        XCTAssertTrue(["", "—"].contains(app.textFields["—"].value as? String ?? ""))
        warmup.buttons["Log warm-up"].tap()
        let evidence = app.staticTexts["fixture.scenario"]
        expectation(for: NSPredicate(format: "value == %@", "working:0;warmups:1;plan:1"), evaluatedWith: evidence)
        waitForExpectations(timeout: UITestWait.screen)
        let outline = app.buttons["runner.outline"]
        reveal(outline, in: app); outline.tap()
        let warmupReview = app.staticTexts["runner.outline.warmups.synthetic-slot"]
        XCTAssertTrue(warmupReview.waitForExistence(timeout: UITestWait.screen))
        reveal(warmupReview, in: app)
        XCTAssertTrue(warmupReview.isHittable)
        app.buttons["runner.outline.done"].tap()
        let log = app.buttons["runner.logSet"]
        XCTAssertEqual(log.label, "LOG SET 1")
        reveal(log, in: app); log.tap()

        let addSet = app.buttons["finished.addSet"]
        XCTAssertTrue(addSet.waitForExistence(timeout: UITestWait.screen))
        reveal(addSet, in: app); addSet.tap()
        let squat = app.buttons["session.addSet.synthetic-slot"]
        XCTAssertTrue(squat.waitForExistence(timeout: UITestWait.screen)); squat.tap()
        XCTAssertTrue(log.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(log.label, "LOG SET 2")
        XCTAssertEqual(app.staticTexts["runner.sessionAddition"].label, "1 planned + 1 extra set for this workout")
        reveal(log, in: app); log.tap()
        let addExercise = app.buttons["finished.addExercise"]
        XCTAssertTrue(addExercise.waitForExistence(timeout: UITestWait.screen))
        reveal(addExercise, in: app); addExercise.tap()
        let press = app.buttons["session.exercise.synthetic-upper"]
        XCTAssertTrue(press.waitForExistence(timeout: UITestWait.screen))
        reveal(press, in: app); press.tap()
        XCTAssertTrue(app.staticTexts["runner.exerciseTitle"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["runner.exerciseTitle"].label, "ARNOLD PRESS")
        XCTAssertEqual(app.staticTexts["runner.sessionAddition"].label, "Added for this workout only")
        XCTAssertFalse(log.isEnabled, "A new movement needs an explicit load before logging")
        XCTAssertEqual(evidence.value as? String, "working:2;warmups:1;plan:1")
        capture("runner-session-only-additions")
    }

    func testPreviousSessionShortcutCueAndExactRemainingRest() throws {
        let app = launch(sessionControls: true)
        let previous = app.buttons["runner.previousSession"]
        XCTAssertTrue(previous.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(previous.label.contains("Last session"))
        XCTAssertEqual(app.staticTexts["runner.cue"].label, "Cue · Keep your heels down.")
        reveal(previous, in: app); previous.tap()
        let historyTab = app.segmentedControls["exerciseInfo.tabs"].buttons["History"]
        XCTAssertTrue(historyTab.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(historyTab.isSelected, "The previous-session shortcut opens History directly")
        XCTAssertTrue(app.staticTexts["exerciseInfo.history.date"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["exerciseInfo.done"].tap()

        let log = app.buttons["runner.logSet"]
        reveal(log, in: app); log.tap()
        let expand = app.buttons["Expand rest timer"]
        XCTAssertTrue(expand.waitForExistence(timeout: UITestWait.screen)); expand.tap()
        let change = app.buttons["rest.changeDuration"]
        XCTAssertTrue(change.waitForExistence(timeout: UITestWait.screen))
        reveal(change, in: app)
        XCTAssertGreaterThanOrEqual(change.frame.height, 44)
        try app.performAccessibilityAudit(for: [.hitRegion, .sufficientElementDescription])
        change.tap()
        let seconds = app.textFields["rest.duration.seconds"]
        XCTAssertTrue(seconds.waitForExistence(timeout: UITestWait.screen))
        let valueEnd = seconds.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5))
        valueEnd.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: UITestWait.screen))
        // Numeric fields are right-aligned; a normal tap can put the caret
        // before the value. Select all and verify clearing before typing once.
        valueEnd.press(forDuration: 1.2)
        let selectAll = app.menuItems["Select All"], cut = app.menuItems["Cut"]
        let selection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            selectAll.exists || cut.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [selection], timeout: UITestWait.screen), .completed)
        if selectAll.exists { selectAll.tapWhenReady() }
        seconds.typeText(XCUIKeyboardKey.delete.rawValue)
        let cleared = seconds.value as? String ?? ""
        XCTAssertTrue(cleared.isEmpty || cleared == seconds.placeholderValue,
                      "Clear the complete rest duration before replacing it: \(cleared)")
        seconds.typeText("37")
        XCTAssertEqual(seconds.value as? String, "37")
        app.buttons["rest.duration.scope"].tap()
        app.buttons["Remaining sets of this exercise"].tap()
        app.buttons["rest.duration.apply"].tap()
        XCTAssertTrue(app.buttons["rest.minimize"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["rest.minimize"].tap()
        let done = app.buttons["rest.done"]
        XCTAssertTrue(done.waitForExistence(timeout: UITestWait.screen)); done.tap()
        XCTAssertTrue(app.staticTexts["runner.restPrescription"].label.contains("37"))
        reveal(log, in: app); log.tap()
        XCTAssertTrue(expand.waitForExistence(timeout: UITestWait.screen)); expand.tap()
        reveal(change, in: app); change.tap()
        XCTAssertTrue(seconds.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(seconds.value as? String, "37", "The next rest uses the exact session duration")
        capture("runner-exact-remaining-rest")
    }

    func testTimedSetCanCancelWithoutLoggingOrAdvancing() throws {
        let app = launch("timed-navigation")
        let start = app.buttons["runner.startSet"]
        reveal(start, in: app); start.tap()
        let cancel = app.buttons["runner.cancelTimedSet"]
        XCTAssertTrue(cancel.waitForExistence(timeout: UITestWait.screen))
        reveal(cancel, in: app); cancel.tap()
        XCTAssertTrue(start.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(start.label, "START SET 1")
        XCTAssertFalse(app.buttons["runner.stopTimedSet"].exists)
        XCTAssertEqual(app.staticTexts["fixture.scenario"].value as? String, "bike:0;other:0;seconds:0;warmup:0")
        reveal(start, in: app); start.tap()
        XCTAssertTrue(cancel.waitForExistence(timeout: UITestWait.screen))
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: app.buttons["runner.stopTimedSet"])
        waitForExpectations(timeout: UITestWait.screen)
        reveal(cancel, in: app)
        XCTAssertGreaterThanOrEqual(cancel.frame.height, 44)
        try app.performAccessibilityAudit(for: [.hitRegion, .sufficientElementDescription])
        capture("runner-timer-cancel-and-restart")
    }

    func testUnknownLoadNeedsEntryAndTargetEffortNeverBecomesActualEffort() {
        let app = launch(unknownLoad: true)
        let choose = app.buttons["runner.chooseWeight"]
        XCTAssertTrue(choose.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["runner.logSet"].isEnabled)
        XCTAssertTrue(app.staticTexts["runner.target"].label.contains("RPE 7"))
        capture("runner-unknown-load-and-target-effort")

        // Editing another value must not accidentally accept the zero storage placeholder.
        let edit = app.buttons["runner.editValues"]
        reveal(edit, in: app); edit.tap()
        let next = app.navigationBars["Next set"]
        XCTAssertTrue(next.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(next.buttons["Save"].isEnabled)
        XCTAssertTrue(["", "—"].contains(app.textFields["—"].value as? String ?? ""))
        next.buttons["Cancel"].tap()

        reveal(choose, in: app); choose.tap()
        let entry = app.textFields["weight.entry"]
        XCTAssertTrue(entry.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["Save"].isEnabled)
        entry.tap(); entry.typeText("25")
        app.buttons["Save"].tap()
        let log = app.buttons["runner.logSet"]
        XCTAssertTrue(log.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(log.isEnabled)
        XCTAssertEqual(app.buttons["runner.weight"].value as? String, "25")
        log.tap()

        let last = app.buttons["rest.editLastSet"]
        XCTAssertTrue(last.waitForExistence(timeout: UITestWait.screen))
        reveal(last, in: app); last.tap()
        let correction = app.navigationBars["Correct set"]
        XCTAssertTrue(correction.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(["", "—"].contains(app.textFields["—"].value as? String ?? ""),
                      "The recorded set has no actual effort until the member assesses it")
        correction.buttons["Cancel"].tap()

        reveal(edit, in: app); edit.tap()
        XCTAssertTrue(next.waitForExistence(timeout: UITestWait.screen))
        let effort = app.textFields["—"]
        effort.tap(); effort.typeText("8.5")
        next.buttons["Save"].tap()
        reveal(log, in: app); log.tap()
        XCTAssertTrue(app.staticTexts["rest.lastValues"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["rest.lastValues"].label.contains("RPE 8.5"))
        reveal(edit, in: app); edit.tap()
        XCTAssertTrue(next.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(["", "—"].contains(app.textFields["—"].value as? String ?? ""),
                      "The following set needs its own effort assessment")
        next.buttons["Cancel"].tap()
        capture("runner-explicit-load-and-assessed-effort")
    }

    func testLargestTextSeparatesTodayActionsAndExerciseDemoFromTitle() {
        let app = launch(largeText: true, startWorkout: false)
        let view = app.buttons["today.viewWorkout"]
        let change = app.buttons["today.changeWorkout"]
        XCTAssertTrue(view.exists); XCTAssertTrue(change.exists)
        XCTAssertGreaterThanOrEqual(change.frame.minY, view.frame.maxY)
        capture("today-accessibility-actions-stacked")
        let start = app.buttons["today.startWorkout"]
        reveal(start, in: app)
        XCTAssertTrue(start.isEnabled)
        start.tap()
        let title = app.staticTexts["runner.exerciseTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: UITestWait.screen))
        let demo = app.buttons["Exercise information for Barbell Squat"]
        XCTAssertTrue(demo.exists)
        XCTAssertGreaterThanOrEqual(demo.frame.minY, title.frame.maxY)
        capture("runner-accessibility-title-and-demo")
        reveal(demo, in: app); demo.tap()
        XCTAssertTrue(app.staticTexts["MUSCLES"].waitForExistence(timeout: UITestWait.screen))
    }

    func testCompactRestKeepsEndEditAndLoggingReachableAtAccessibilitySize() {
        let app = launch(largeText: true)
        reveal(app.buttons["LOG SET 1"], in: app); app.buttons["LOG SET 1"].tap()
        let endRest = app.buttons["rest.done"]
        reveal(endRest, in: app)
        XCTAssertTrue(app.buttons["Expand rest timer"].exists)
        let edit = app.buttons["rest.editLastSet"]
        reveal(edit, in: app); edit.tap()
        let correction = app.navigationBars["Correct set"]
        XCTAssertTrue(correction.waitForExistence(timeout: UITestWait.screen))
        app.buttons["Cancel"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: correction)
        waitForExpectations(timeout: UITestWait.screen)
        // All primary actions share the scrolling surface at accessibility
        // sizes; the footer must never consume the entire input viewport.
        for _ in 0..<8 where !endRest.isHittable { app.scrollViews.firstMatch.swipeDown() }
        XCTAssertTrue(endRest.isHittable); endRest.tap()
        reveal(app.buttons["LOG SET 2"], in: app)
        capture("compact-rest-accessibility-size")
        app.buttons["LOG SET 2"].tap()
        XCTAssertTrue(app.buttons["LOG SET 3"].waitForExistence(timeout: UITestWait.screen))
    }

    func testLoadRepsAndLoggingStayInPlaceWhenRestStarts() {
        let app = launch()
        let weight = app.buttons["runner.weight"]
        let reps = app.buttons["Increase reps by 1"]
        let log = app.buttons["LOG SET 1"]
        let beforeWeight = weight.frame
        let beforeReps = reps.frame
        let beforeLog = log.frame
        XCTAssertTrue(weight.isHittable); XCTAssertTrue(reps.isHittable); XCTAssertTrue(log.isHittable)
        XCTAssertGreaterThanOrEqual(reps.frame.height, 44)
        XCTAssertTrue(app.buttons["runner.outline"].isHittable)
        XCTAssertFalse(app.tabBars.firstMatch.isHittable)
        XCTAssertFalse(app.segmentedControls["runner.weight.unit"].exists)
        reps.tap()
        XCTAssertEqual(app.buttons["runner.reps"].value as? String, "6")
        log.tap()
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["rest.editLastSet"].isHittable)
        XCTAssertTrue(reps.isHittable)
        XCTAssertEqual(weight.frame.minY, beforeWeight.minY, accuracy: 1)
        XCTAssertEqual(reps.frame.minY, beforeReps.minY, accuracy: 1)
        XCTAssertEqual(app.buttons["LOG SET 2"].frame.minY, beforeLog.minY, accuracy: 1)
        XCTAssertFalse(app.staticTexts["rest.status"].exists)
        capture("focus-rest-keeps-workspace-stable")
    }

    func testExerciseMenuOpensPlatesAndSkipsInOneTap() {
        let app = launch()
        let title = app.staticTexts["runner.exerciseTitle"]
        XCTAssertEqual(title.label, "BARBELL SQUAT")
        // Before the first set there is no rest or last-set row to reserve.
        XCTAssertFalse(app.buttons["rest.done"].exists)
        XCTAssertFalse(app.staticTexts["Ready when you are"].exists)
        let menu = app.buttons["runner.exerciseMenu"]
        XCTAssertTrue(menu.isHittable)
        menu.tap()
        let plates = app.buttons["runner.menu.plates"]
        XCTAssertTrue(plates.waitForExistence(timeout: UITestWait.screen)); plates.tap()
        let loading = app.navigationBars["Barbell loading"]
        XCTAssertTrue(loading.waitForExistence(timeout: UITestWait.screen))
        capture("runner-exercise-menu-plates")
        loading.buttons["Done"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: loading)
        waitForExpectations(timeout: UITestWait.screen)
        menu.tap()
        let skip = app.buttons["runner.menu.skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: UITestWait.screen)); skip.tap()
        expectation(for: NSPredicate(format: "label != %@", "BARBELL SQUAT"), evaluatedWith: title)
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertTrue(app.buttons["LOG SET 1"].isHittable)
    }

    func testCorrectionTargetsLastSetAfterAdvancingAndEndingRest() {
        let app = launch()
        for index in 1...3 {
            app.buttons["LOG SET \(index)"].tap()
            XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
            app.buttons["rest.done"].tap()
        }
        let edit = app.buttons["rest.editLastSet"]
        XCTAssertTrue(edit.isHittable)
        XCTAssertEqual(edit.label, "Edit last set of Barbell Squat")
        XCTAssertEqual(app.staticTexts["runner.exerciseTitle"].label, "DUMBBELL ROW")
        XCTAssertTrue(app.staticTexts["Last set · Barbell Squat"].exists)
        XCTAssertEqual(app.buttons["runner.weight"].value as? String, "40")
        edit.tap()
        let reps = app.textFields["Reps"]
        XCTAssertTrue(reps.waitForExistence(timeout: UITestWait.screen))
        let old = reps.value as? String ?? ""
        reps.tap()
        reps.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5))
            .withOffset(CGVector(dx: -1, dy: 0)).tap()
        reps.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + "6")
        XCTAssertEqual(reps.value as? String, "6")
        app.buttons["Save"].tap()
        let corrected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "135 × 6 · lb"),
            object: app.staticTexts["rest.lastValues"])
        XCTAssertEqual(XCTWaiter.wait(for: [corrected], timeout: UITestWait.screen), .completed)
        XCTAssertEqual(edit.label, "Edit last set of Barbell Squat")
        XCTAssertEqual(app.buttons["runner.weight"].value as? String, "40")
        XCTAssertEqual(app.buttons["runner.reps"].value as? String, "10")
        capture("last-set-corrected-after-advance-and-rest")
    }

    func testOutlineNavigationPreservesDraftsAndDoesNotSkipExercises() {
        let app = launch()
        app.buttons["Increase reps by 1"].tap()
        app.buttons["Increase weight in lb by 5"].tap()
        app.buttons["runner.outline"].tap()
        XCTAssertTrue(app.navigationBars["Workout outline"].waitForExistence(timeout: UITestWait.screen))
        let row = app.buttons["Dumbbell Row"]
        reveal(row, in: app); row.tap()
        expectation(for: NSPredicate(format: "exists == false"),
                    evaluatedWith: app.navigationBars["Workout outline"])
        waitForExpectations(timeout: UITestWait.screen)
        expectation(for: NSPredicate(format: "label == %@", "DUMBBELL ROW"),
                    evaluatedWith: app.staticTexts["runner.exerciseTitle"])
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertEqual(app.staticTexts["runner.exerciseTitle"].label, "DUMBBELL ROW")
        app.buttons["runner.outline"].tap()
        let squat = app.buttons["Barbell Squat"]
        XCTAssertTrue(squat.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(squat.staticTexts["Skipped"].exists)
        squat.tap()
        expectation(for: NSPredicate(format: "exists == false"),
                    evaluatedWith: app.navigationBars["Workout outline"])
        waitForExpectations(timeout: UITestWait.screen)
        expectation(for: NSPredicate(format: "label == %@", "BARBELL SQUAT"),
                    evaluatedWith: app.staticTexts["runner.exerciseTitle"])
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertEqual(app.buttons["runner.weight"].value as? String, "140")
        XCTAssertEqual(app.buttons["runner.reps"].value as? String, "6")
        XCTAssertTrue(app.buttons["LOG SET 1"].exists)
    }

    func testMinimizeAndResumeRetainsDraftAndRest() {
        let app = launch()
        app.buttons["LOG SET 1"].tap()
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["Increase reps by 1"].tap()
        app.buttons["runner.minimize"].tap()
        XCTAssertTrue(app.buttons["runner.resume"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.tabBars.firstMatch.isHittable)
        app.tabBars.buttons["Activity"].tap()
        let resume = app.buttons["workout.resume"]
        XCTAssertTrue(resume.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(resume.isHittable)
        resume.tap()
        XCTAssertTrue(app.buttons["LOG SET 2"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.buttons["runner.reps"].value as? String, "6")
        XCTAssertTrue(app.buttons["rest.done"].isHittable)
        XCTAssertTrue(app.buttons["rest.editLastSet"].isHittable)
        XCTAssertFalse(app.tabBars.firstMatch.isHittable)
    }

    func testMinimizeAndResumeDoesNotRestartTimedSet() {
        let app = launch("timed-navigation")
        app.buttons["START SET 1"].tap()
        let remaining = app.staticTexts["runner.timer.remaining"]
        XCTAssertTrue(remaining.waitForExistence(timeout: UITestWait.screen))
        let initial = Int(remaining.label.dropLast())!
        app.buttons["runner.minimize"].tap()
        XCTAssertTrue(app.buttons["runner.resume"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["runner.resume"].tap()
        XCTAssertTrue(remaining.waitForExistence(timeout: UITestWait.screen))
        XCTAssertLessThan(Int(remaining.label.dropLast())!, initial)
        XCTAssertTrue(app.buttons["STOP & LOG"].exists)
        XCTAssertFalse(app.buttons["START SET 1"].exists)
        XCTAssertEqual(app.staticTexts["fixture.scenario"].value as? String,
                       "bike:0;other:0;seconds:0;warmup:0")
    }

    func testMinimizedLastTimedSetKeepsReviewRouteOnAnotherTab() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ExerciseGroups", withExtension: "json"))
        var contract = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        var slot = try XCTUnwrap((contract["slots"] as? [[String: Any]])?.first)
        slot["exercise_name"] = "Timed hold"
        slot["exercise_modality"] = "timed"
        slot["target_sets"] = 1
        slot["target_reps"] = 15
        slot["is_warmup"] = 0
        slot["group_id"] = NSNull()
        contract["slots"] = [slot]
        let encoded = String(data: try JSONSerialization.data(withJSONObject: contract), encoding: .utf8)!
        let app = launch(groupContract: encoded, tickingClock: true)
        app.buttons["START SET 1"].tap()
        app.buttons["runner.minimize"].tap()
        XCTAssertTrue(app.buttons["runner.resume"].waitForExistence(timeout: UITestWait.screen))
        app.tabBars.buttons["Activity"].tap()
        let resume = app.buttons["workout.resume"]
        XCTAssertTrue(resume.waitForExistence(timeout: UITestWait.screen))
        expectation(for: NSPredicate(format: "label CONTAINS %@", "Review workout"), evaluatedWith: resume)
        waitForExpectations(timeout: 25)
        XCTAssertTrue(resume.isHittable)
        resume.tap()
        XCTAssertTrue(app.buttons["FINISH"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Ready to finish"].exists)
        XCTAssertFalse(app.staticTexts["WORKOUT COMPLETE"].exists)
    }

    func testBodyweightOffersCompactLoadDisclosureAndSignedEntry() {
        let app = launch("bodyweight")
        let add = app.buttons["runner.addBodyweightLoad"]
        XCTAssertTrue(add.isHittable)
        XCTAssertFalse(app.buttons["runner.weight"].exists)
        XCTAssertTrue(app.buttons["Increase reps by 1"].isHittable)
        add.tap()
        let weight = app.buttons["runner.weight"]
        XCTAssertTrue(weight.isHittable); weight.tap()
        let entry = app.textFields["weight.entry"]
        XCTAssertTrue(entry.waitForExistence(timeout: UITestWait.screen))
        entry.doubleTap()
        entry.typeText("-10")
        // UIKit may finish applying synthesized typing after typeText returns.
        let entered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "-10"), object: entry)
        XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: UITestWait.screen), .completed)
        XCTAssertEqual(entry.value as? String, "-10")
        app.buttons["Save"].tap()
        XCTAssertEqual(weight.value as? String, "-10")
        capture("bodyweight-assistance-entry")
    }

    func testCircuitRosterAndNextTargetStayAheadOfInputs() throws {
        let contractURL = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ExerciseGroups", withExtension: "json"))
        var contract = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: contractURL)) as? [String: Any])
        var slots = try XCTUnwrap(contract["slots"] as? [[String: Any]])
        for index in slots.indices {
            slots[index]["group_id"] = "focus-circuit"
            slots[index]["group_rest_seconds"] = 60
            slots[index]["group_transition_seconds"] = 15
            slots[index]["is_warmup"] = 0
        }
        contract["slots"] = slots
        let encoded = String(data: try JSONSerialization.data(withJSONObject: contract), encoding: .utf8)!
        let app = launch("groups", groupContract: encoded)
        XCTAssertTrue(app.staticTexts["runner.group"].label.contains("Round 1 of 2"))
        for id in ["group-pushup", "group-squat", "group-bench", "group-row"] {
            let member = app.descendants(matching: .any)["runner.group.member.\(id)"]
            XCTAssertTrue(member.exists)
            XCTAssertTrue(app.frame.contains(member.frame))
        }
        let next = app.staticTexts["runner.group.next"]
        XCTAssertTrue(next.label.contains("Bodyweight Squat"))
        XCTAssertTrue(next.label.contains("10"))
        XCTAssertLessThan(next.frame.maxY, app.buttons["runner.addBodyweightLoad"].frame.minY)
        XCTAssertTrue(app.buttons["Increase reps by 1"].isHittable)
        XCTAssertTrue(app.buttons["LOG SET 1"].isHittable)
        capture("focus-four-member-circuit")
    }

    func testExpandedRestIsExplicitAndEndRestNeverBecomesLog() {
        let app = launch()
        app.buttons["LOG SET 1"].tap()
        let expand = app.buttons["Expand rest timer"]
        XCTAssertTrue(expand.waitForExistence(timeout: UITestWait.screen)); expand.tap()
        XCTAssertTrue(app.staticTexts["rest.status"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["LOG SET 2"].isHittable)
        let minimize = app.buttons["rest.minimize"]
        minimize.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: minimize)
        waitForExpectations(timeout: UITestWait.screen)
        let end = app.buttons["rest.done"]
        XCTAssertTrue(end.isHittable)
        let endFrame = end.frame
        let endPoint = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: endFrame.midX, dy: endFrame.midY))
        end.tap()
        endPoint.tap()
        XCTAssertTrue(app.buttons["LOG SET 2"].exists)
        XCTAssertFalse(app.buttons["LOG SET 3"].exists)
    }

    func testOneSavedSetUsesSingularCompletionSummary() {
        let app = launch()
        app.buttons["LOG SET 1"].tap()
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["rest.done"].tap()
        app.buttons["today.workoutActions"].tap()
        app.buttons["Finish workout"].tap()
        let finish = app.buttons["FINISH"]
        XCTAssertTrue(finish.waitForExistence(timeout: UITestWait.screen)); finish.tap()
        let summary = app.staticTexts["today.completedSummary"]
        XCTAssertTrue(summary.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(summary.label, "1 working set · 1 exercise")
    }
}
