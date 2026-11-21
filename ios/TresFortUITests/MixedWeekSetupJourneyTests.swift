import XCTest

/// A new member can plan a run and a separate timed routine, then review
/// both from setup without starting either workout.
final class MixedWeekSetupJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            print(XCUIApplication().debugDescription)
            capture("mixed-week-setup-failure")
        }
    }

    func testSetupSchedulesMorningRunAndSeparateEveningTimedCore() {
        let app = launch()
        beginSetup(in: app)
        addRun(in: app, withReminder: true)
        reviewCore(in: app, alsoThursday: true, withReminder: true)
        closeTiming(in: app)

        let save = app.buttons["composer.save"]
        XCTAssertEqual(save.label, "Add to Tue, Thu")
        save.tapWhenReady()
        assertWeek(in: app, coreOnThursday: true)
        assertCounts(in: app, workouts: 2, schedules: 2)
        capture("setup-run-and-core-week")

        let coreID = openTuesday(in: app, withReminders: true)
        openCorePreview(in: app)
        capture("setup-timed-core-preview")
        app.navigationBars["Core routine"].backButton.tapWhenReady()
        XCTAssertTrue(app.staticTexts["Your usual week"].waitForExistence(timeout: UITestWait.screen))

        // Both weekdays reference the same core workout, while the run keeps
        // its own saved 30-minute prescription and morning time.
        revealAndTap(app.buttons["plan.week.thu"], in: app)
        XCTAssertTrue(app.navigationBars["Thursday"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.buttons["weekday.viewWorkout"].label, "View Morning run")
        XCTAssertTrue(app.buttons[coreID].exists)
        assertReminderTimes(in: app)
        app.buttons["weekday.viewWorkout"].tapWhenReady()
        let run = app.navigationBars["Morning run"]
        XCTAssertTrue(run.waitForExistence(timeout: UITestWait.screen))
        let steps = app.descendants(matching: .any)["runPlan.steps"].firstMatch
        XCTAssertTrue(steps.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(steps.label.contains("30 min"), steps.label)
        assertPreviewDoesNotStartWorkout(in: app)
        run.backButton.tapWhenReady()
        finishSetup(in: app)
        assertCounts(in: app, workouts: 2, schedules: 2)
    }

    func testCoreScheduleFailureRetriesSavedPrescriptionWithoutCreatingAnotherWorkout() {
        let app = launch(failCoreSchedule: true)
        beginSetup(in: app)
        addRun(in: app, withReminder: false)
        reviewCore(in: app, alsoThursday: false, withReminder: false)
        closeTiming(in: app)

        let save = app.buttons["composer.save"]
        XCTAssertEqual(save.label, "Add to Tuesdays")
        save.tapWhenReady()
        XCTAssertTrue(app.staticTexts["composer.error"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.navigationBars["Review workout"].exists)
        XCTAssertFalse(app.navigationBars["Edit Core routine"].exists)
        XCTAssertFalse(app.navigationBars["Core routine"].exists)
        let retry = app.buttons["composer.save"]
        XCTAssertEqual(retry.label, "Try again")
        app.openComposerWhen()
        XCTAssertTrue(app.scroll(toReveal: app.buttons["composer.day.tue"]))
        XCTAssertTrue(app.buttons["composer.day.tue"].isSelected)
        XCTAssertFalse(app.buttons["composer.day.thu"].isSelected)
        XCTAssertTrue(app.scroll(toReveal: app.switches["composer.alongside"]))
        XCTAssertEqual(app.switches["composer.alongside"].value as? String, "1")
        assertCounts(in: app, workouts: 2, schedules: 2)

        // The core was already saved atomically. Retry schedules that same
        // workout; it must not reopen the exercise editor or create a copy.
        retry.tapWhenReady()
        assertWeek(in: app, coreOnThursday: false)
        assertCounts(in: app, workouts: 2, schedules: 3)
        _ = openTuesday(in: app, withReminders: false)
        openCorePreview(in: app)
        app.navigationBars["Core routine"].backButton.tapWhenReady()
        finishSetup(in: app)
        assertCounts(in: app, workouts: 2, schedules: 3)
    }

    func testTimerPreviewFollowsReviewedCircuitWithoutStartingOrSaving() {
        let app = launch()
        beginSetup(in: app)
        addRun(in: app, withReminder: false)
        reviewCore(in: app, alsoThursday: false, withReminder: false)
        let duration = app.staticTexts["routinePreview.duration"]
        revealFormControl(duration, in: app)
        XCTAssertEqual(duration.label, "10 min 20 sec of planned timers")
        let target = app.staticTexts["routinePreview.stepTarget"]
        revealFormControl(target, in: app)
        XCTAssertEqual(app.staticTexts["routinePreview.stepTitle"].label, "Plank")
        XCTAssertEqual(target.label, "40 sec timer")
        let next = app.buttons["routinePreview.next"]
        revealFormControl(next, in: app)
        next.tapWhenReady()
        XCTAssertEqual(app.staticTexts["routinePreview.stepTitle"].label, "Between exercises")
        XCTAssertEqual(target.label, "20 sec rest")
        for _ in 2..<10 { next.tapWhenReady() }
        XCTAssertEqual(app.staticTexts["routinePreview.stepTitle"].label, "Between rounds")
        XCTAssertEqual(target.label, "1 min rest")
        for _ in 10..<19 { next.tapWhenReady() }
        XCTAssertFalse(next.isEnabled, "The final work set has no following rest")
        XCTAssertEqual(target.label, "40 sec timer")
        assertCounts(in: app, workouts: 1, schedules: 1)
        assertPreviewDoesNotStartWorkout(in: app)
        capture("reviewed-timer-sequence")

        // The long preview has scrolled this earlier Form row out of the
        // accessibility tree. Materialize it upward before the field helper
        // checks its position against the pinned action and keyboard.
        let seconds = app.textFields["composer.home.timing.seconds"]
        XCTAssertTrue(app.scroll(toReveal: seconds, searchingUp: true))
        replaceText(in: seconds, with: "30", app: app)
        revealFormControl(duration, in: app)
        XCTAssertEqual(duration.label, "8 min 40 sec of planned timers")
        revealFormControl(target, in: app)
        XCTAssertEqual(app.staticTexts["routinePreview.stepTitle"].label, "Plank")
        XCTAssertEqual(target.label, "30 sec timer")
        assertCounts(in: app, workouts: 1, schedules: 1)
    }

    func testDeniedRemindersKeepSavedTimeAndOfferSettingsFromTheDay() {
        let app = launch(permission: "denied")
        beginSetup(in: app)
        addRun(in: app, withReminder: true, permissionAllowed: false)
        revealAndTap(app.buttons["plan.week.tue"], in: app)
        let time = revealAndTap(app.buttons.matching(NSPredicate(format:
            "identifier BEGINSWITH 'weekday.time.'")).firstMatch, in: app)
        let message = app.staticTexts["scheduleReminder.status"]
        waitForLabel("Notifications are off", on: message)
        let settings = app.buttons["scheduleReminder.settings"]
        XCTAssertTrue(message.isHittable, "Permission feedback must be visible when the time sheet opens")
        XCTAssertTrue(settings.waitUntilTappable(), "Settings must be reachable without scrolling the time sheet")
        revealAndTap(settings, in: app)
        XCTAssertTrue(app.staticTexts["fixture.opened-url"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["fixture.opened-url"].label.contains("app-settings"))
        app.buttons["scheduleTime.save"].tapWhenReady()
        XCTAssertTrue(app.navigationBars["Tuesday"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(time.label.contains("7:00"), time.label)
        assertCounts(in: app, workouts: 1, schedules: 2)
        capture("denied-reminders-saved-time")
    }

    private func launch(failCoreSchedule: Bool = false, permission: String = "granted") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "activation-manual"
        app.launchEnvironment["TRESFORT_UI_REMINDER_PERMISSION"] = permission
        if permission == "denied" { app.launchEnvironment["TRESFORT_UI_CAPTURE_LINKS"] = "1" }
        if failCoreSchedule {
            app.launchEnvironment["TRESFORT_UI_SCHEDULE_FAILURE"] = "request"
            app.launchEnvironment["TRESFORT_UI_SCHEDULE_FAILURE_AT"] = "2"
        }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.staticTexts["fixture.scenario"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    private func beginSetup(in app: XCUIApplication) {
        app.buttons["Sign in with Apple"].tapWhenReady()
        app.buttons["Get started"].tapWhenReady()
        XCTAssertTrue(app.staticTexts["Your usual week"].waitForExistence(timeout: UITestWait.screen))
    }

    private func addRun(in app: XCUIApplication, withReminder: Bool, permissionAllowed: Bool = true) {
        revealAndTap(app.buttons["setup.addToWeek"], in: app)
        XCTAssertTrue(app.buttons["composer.kind.run"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["composer.kind.run"].isSelected)
        let time = app.segmentedControls["composer.run.measure"].buttons["Time"]
        revealFormControl(time, in: app)
        // Selecting Time is idempotent. Observe the resulting controls before
        // scrolling for a chip that does not exist while Distance is selected.
        time.tap(until: app.buttons["composer.chip.30"])
        XCTAssertTrue(time.isSelected)
        revealAndTap(app.buttons["composer.chip.30"], in: app)
        replaceText(in: app.textFields["composer.name"], with: "Morning run", app: app)
        app.textFields["composer.name"].typeText("\n")
        revealAndTap(app.buttons["composer.day.tue"], in: app)
        revealAndTap(app.buttons["composer.day.thu"], in: app)
        if withReminder {
            enable("composer.time.toggle", in: app)
            revealAndTap(app.buttons["scheduleReminder.enable"], in: app)
            waitForLabel(permissionAllowed ? "Notifications are allowed" : "Notifications are off",
                         on: app.staticTexts["scheduleReminder.status"])
        }
        let save = app.buttons["composer.save"]
        XCTAssertEqual(save.label, "Add to Tue, Thu")
        save.tapWhenReady()
        waitForLabel("Morning run", on: app.buttons["plan.week.tue"])
        waitForLabel("Morning run", on: app.buttons["plan.week.thu"])
        assertCounts(in: app, workouts: 1, schedules: 1)
    }

    private func reviewCore(in app: XCUIApplication, alsoThursday: Bool, withReminder: Bool) {
        revealAndTap(app.buttons["plan.week.tue"], in: app)
        XCTAssertTrue(app.navigationBars["Tuesday"].waitForExistence(timeout: UITestWait.screen))
        revealAndTap(app.buttons["weekday.addExtra"], in: app)
        XCTAssertTrue(app.buttons["composer.kind.home"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["composer.kind.home"].isSelected)
        XCTAssertTrue(app.scroll(toReveal: app.buttons["composer.home.core"]))
        XCTAssertTrue(app.buttons["composer.home.core"].isSelected)
        XCTAssertTrue(app.navigationBars["Tuesday"].exists, "The composer opens in place on the day")
        app.openComposerWhen()
        XCTAssertTrue(app.scroll(toReveal: app.buttons["composer.day.tue"]))
        XCTAssertTrue(app.buttons["composer.day.tue"].isSelected)
        if alsoThursday { revealAndTap(app.buttons["composer.day.thu"], in: app) }
        let alongside = app.switches["composer.alongside"]
        XCTAssertTrue(app.scroll(toReveal: alongside))
        XCTAssertEqual(alongside.value as? String, "1", "A separate core routine keeps the run")
        if withReminder { enable("composer.time.toggle", in: app) }
        // The suggestion is the member's to change right in its list, with
        // its shared sets and rest; a circuit and its timers open in their
        // own sheet.
        XCTAssertEqual(app.buttons["composer.save"].label, alsoThursday ? "Add to Tue, Thu" : "Add to Tuesdays")
        // The days, time and alongside rows above scrolled the list down, so
        // the exercise list sits above; a lazy list drops it from the tree.
        XCTAssertTrue(app.scroll(toReveal: app.buttons["composer.home.add"], searchingUp: true))
        revealAndTap(app.buttons["composer.home.timing"], in: app)
        XCTAssertTrue(app.navigationBars[timingSheet].waitForExistence(timeout: UITestWait.screen))
        enable("composer.home.circuit", in: app)
        enable("composer.home.timeEveryExercise", in: app)
        for (field, value) in [("sets", "2"), ("seconds", "40"), ("transition", "20"), ("roundRest", "60")] {
            replaceText(in: app.textFields["composer.home.timing.\(field)"], with: value, app: app)
        }
    }

    /// Closes the timing sheet and checks the routine's optional name,
    /// which comes last and is filled in for the member.
    private func closeTiming(in app: XCUIApplication) {
        app.buttons["composer.home.timingDone"].tapWhenReady()
        let name = app.textFields["composer.name"]
        XCTAssertTrue(app.scroll(toReveal: name))
        XCTAssertEqual(name.placeholderValue, "Core routine")
        XCTAssertTrue(app.buttons["composer.save"].isEnabled)
    }

    private func assertWeek(in app: XCUIApplication, coreOnThursday: Bool) {
        waitForLabel("Also Core routine", on: app.buttons["plan.week.tue"])
        XCTAssertFalse(app.navigationBars["Review workout"].exists)
        XCTAssertFalse(app.navigationBars["Edit Core routine"].exists)
        XCTAssertFalse(app.navigationBars["Core routine"].exists)
        XCTAssertTrue(app.buttons["plan.week.tue"].label.contains("Morning run"))
        let thursday = app.buttons["plan.week.thu"]
        if coreOnThursday { waitForLabel("Also Core routine", on: thursday) }
        XCTAssertTrue(thursday.label.contains("Morning run"), thursday.label)
        XCTAssertEqual(thursday.label.contains("Core routine"), coreOnThursday, thursday.label)
    }

    /// Returns the generated extra button identifier, not a fixture-only ID.
    private func openTuesday(in app: XCUIApplication, withReminders: Bool) -> String {
        revealAndTap(app.buttons["plan.week.tue"], in: app)
        XCTAssertTrue(app.navigationBars["Tuesday"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.buttons["weekday.viewWorkout"].label, "View Morning run")
        let extras = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'weekday.viewExtra.'"))
        XCTAssertTrue(extras.firstMatch.waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(extras.count, 1, "Retry must not add a second core routine")
        let extra = identified(extras.firstMatch, in: app.buttons)
        XCTAssertEqual(extra.label, "View Core routine")
        if withReminders { assertReminderTimes(in: app) }
        return extra.identifier
    }

    private func assertReminderTimes(in app: XCUIApplication) {
        for (name, clock, period) in [("Morning run", "7:00", "AM"), ("Core routine", "8:00", "PM")] {
            let time = app.buttons.matching(NSPredicate(format:
                "identifier BEGINSWITH 'weekday.time.' AND label BEGINSWITH %@", "\(name) at ")).firstMatch
            XCTAssertTrue(time.waitForExistence(timeout: UITestWait.screen))
            let label = identified(time, in: app.buttons).label
            XCTAssertTrue(label.contains(clock) && label.contains(period), label)
        }
    }

    private func openCorePreview(in app: XCUIApplication) {
        let extra = app.buttons.matching(NSPredicate(format:
            "identifier BEGINSWITH 'weekday.viewExtra.' AND label == 'View Core routine'")).firstMatch
        revealAndTap(extra, in: app)
        XCTAssertTrue(app.navigationBars["Core routine"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Circuit A"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["2 rounds · 60s round rest"].exists)
        XCTAssertTrue(app.staticTexts["20s between exercises"].exists)
        XCTAssertTrue(app.staticTexts["2×40s"].firstMatch.exists)
        // Dead Bug normally uses reps. Time every exercise must persist a
        // duration on it too, rather than timing only the preset's holds.
        var deadBug = app.otherElements.matching(NSPredicate(format:
            "identifier BEGINSWITH 'workoutPreview.exercise.'"))
            .containing(.staticText, identifier: "Dead Bug").firstMatch
        if deadBug.exists { deadBug = identified(deadBug, in: app.otherElements) }
        XCTAssertTrue(app.scroll(toReveal: deadBug))
        deadBug = identified(deadBug, in: app.otherElements)
        XCTAssertTrue(deadBug.staticTexts["Dead Bug"].exists)
        XCTAssertTrue(deadBug.staticTexts["2×40s"].exists)
        assertPreviewDoesNotStartWorkout(in: app)
    }

    private func assertPreviewDoesNotStartWorkout(in app: XCUIApplication) {
        XCTAssertFalse(app.buttons["workoutDetails.start"].exists)
        XCTAssertFalse(app.buttons["workoutDetails.schedule"].exists)
        XCTAssertFalse(app.buttons["LOG SET 1"].exists)
    }

    private func finishSetup(in app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["Your usual week"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["setup.next"].tapWhenReady()
        XCTAssertTrue(app.staticTexts["Connect your apps"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["setup.done"].tapWhenReady()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["setup.next"].exists)
        XCTAssertFalse(app.buttons["LOG SET 1"].exists, "Setup must not start the timed routine")
        XCTAssertFalse(app.buttons["runRecorder.start"].exists, "Setup must not open the run recorder")
    }

    private func enable(_ identifier: String, in app: XCUIApplication,
                        file: StaticString = #filePath, line: UInt = #line) {
        let toggle = app.switches[identifier]
        revealFormControl(toggle, in: app, file: file, line: line)
        // Every element query takes a fresh accessibility snapshot of the
        // whole Form, which can cost a second on a hosted runner. Checking
        // each bar, the pinned action and the keyboard on every poll made one
        // poll take 5 to 9 seconds there, so the two matching polls a
        // stationary row needs could not fit in the wait. Measure the
        // visible band once, re-measure it only when the row falls outside
        // it (a sheet still sliding in), and read the row from one snapshot.
        var band = visibleFormBand(in: app)
        var previousFrame: CGRect?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let row = try? toggle.snapshot(), row.isEnabled,
                  let value = row.value as? String, value == "0" || value == "1" else {
                previousFrame = nil
                return false
            }
            let frame = row.frame
            guard frame.minY >= band.top, frame.maxY <= band.bottom else {
                band = self.visibleFormBand(in: app)
                previousFrame = nil
                return false
            }
            let stationary = previousFrame == frame
            previousFrame = frame
            // Hit-testing is one more query, so ask only once the row is still.
            return stationary && toggle.isHittable
        }, object: nil)
        // Circuit changes and scrolling can relayout the Form between separate
        // visibility and tappability checks. Observe a stable, unobscured row
        // with a known state before the single state-changing tap.
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: UITestWait.screen * 2), .completed,
                       "\(identifier) never settled into a visible tappable state", file: file, line: line)
        let value = toggle.value as? String
        XCTAssertTrue(value == "0" || value == "1", "\(identifier) has no toggle state", file: file, line: line)
        if value == "0" {
            // Target the identified SwiftUI row: its nested UISwitch can
            // appear in snapshots without resolving as a tappable element.
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        }
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '1'"), object: toggle)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: UITestWait.screen), .completed,
                       "\(identifier) did not turn on after one tap", file: file, line: line)
    }

    /// Discover generated IDs once. Re-running a compound predicate for each
    /// readiness property can consume the wait before a visible button taps.
    private func identified(_ element: XCUIElement, in query: XCUIElementQuery) -> XCUIElement {
        let identifier = element.identifier
        return identifier.isEmpty ? element : query[identifier]
    }

    @discardableResult
    private func revealAndTap(_ element: XCUIElement, in app: XCUIApplication,
                              file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        var button = element
        if button.exists { button = identified(button, in: app.buttons) }
        XCTAssertTrue(app.scroll(toReveal: button), button.description, file: file, line: line)
        // A lazy row may only acquire an accessible ID after scrolling.
        button = identified(button, in: app.buttons)
        button.tapWhenReady(file: file, line: line)
        return button
    }

    private func replaceText(in field: XCUIElement, with text: String, app: XCUIApplication,
                             file: StaticString = #filePath, line: UInt = #line) {
        revealFormControl(field, in: app, file: file, line: line)
        let displayed = field.value as? String ?? ""
        let previous = displayed == field.placeholderValue ? "" : displayed
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: UITestWait.screen), file: file, line: line)
        if !previous.isEmpty {
            revealFormControl(field, in: app, file: file, line: line)
            // A right-aligned field may place its caret before the last
            // digit. Select the value and prove it is empty before typing.
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5)).press(forDuration: 1.2)
            let selectAll = app.menuItems["Select All"]
            let cut = app.menuItems["Cut"]
            let selection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                selectAll.exists || cut.exists
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [selection], timeout: UITestWait.screen), .completed,
                           "The text selection menu must be visible", file: file, line: line)
            if selectAll.exists { selectAll.tapWhenReady(file: file, line: line) }
            // A long press may already select the whole numeric word, in
            // which case iOS offers Cut instead of Select All.
            field.typeText(XCUIKeyboardKey.delete.rawValue)
            let cleared = field.value as? String ?? ""
            XCTAssertTrue(cleared.isEmpty || cleared == field.placeholderValue,
                          "Replacement must clear the entire value: \(cleared)", file: file, line: line)
        }
        field.typeText(text)
        // UIKit can finish applying the synthesized input after typeText
        // returns. Wait for that exact value; never type a second copy.
        let entered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", text), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: UITestWait.screen), .completed,
                       "The field did not receive the complete text", file: file, line: line)
        XCTAssertEqual(field.value as? String, text, file: file, line: line)
    }

    /// The routine's Circuit and timers sheet, opened from its list on Add
    /// to your week (app-design-pass P27, P28).
    private let timingSheet = "Circuit and timers"

    /// Where a form's visible rows end: above the pinned add button, or
    /// near the screen's bottom in the timing sheet, and above a keyboard.
    private func formBottom(in app: XCUIApplication) -> CGFloat {
        var bottom = app.navigationBars[timingSheet].exists
            ? app.frame.maxY - 40 : app.buttons["composer.save"].frame.minY - 16
        if app.keyboards.firstMatch.exists { bottom = min(bottom, app.keyboards.firstMatch.frame.minY - 16) }
        return bottom
    }

    /// Where a form's rows can be tapped: below the lowest navigation bar
    /// the member can touch, and above the pinned action or keyboard.
    private func visibleFormBand(in app: XCUIApplication) -> (top: CGFloat, bottom: CGFloat) {
        let bars = app.navigationBars.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        let top = (bars.map { $0.frame.maxY }.max() ?? app.frame.minY + 60) + 12
        return (top, formBottom(in: app))
    }

    /// XCTest can call a Form row hittable while the pinned bottom button
    /// covers its tap point. Scroll inside the form until the whole control
    /// sits between its navigation bar and its current action/keyboard.
    private func revealFormControl(_ element: XCUIElement, in app: XCUIApplication,
                                   file: StaticString = #filePath, line: UInt = #line) {
        if !app.navigationBars[timingSheet].exists {
            XCTAssertTrue(app.buttons["composer.save"].waitForExistence(timeout: UITestWait.screen), file: file, line: line)
        }
        for _ in 0..<16 {
            let (top, bottom) = visibleFormBand(in: app)
            if element.exists, element.isHittable, element.frame.minY >= top, element.frame.maxY <= bottom { return }
            guard bottom - top > 80 else { break }
            let above = element.exists && element.frame.midY < top
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let high = top - app.frame.minY + (bottom - top) * 0.25
            let low = top - app.frame.minY + (bottom - top) * 0.75
            // Stay inside an inset sheet, on labels instead of its switches.
            let start = origin.withOffset(CGVector(dx: 44, dy: above ? high : low))
            let end = origin.withOffset(CGVector(dx: 44, dy: above ? low : high))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTFail("Control is not above the pinned action: \(element.identifier)", file: file, line: line)
    }

    private func waitForLabel(_ text: String, on element: XCUIElement,
                              file: StaticString = #filePath, line: UInt = #line) {
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND label CONTAINS %@", text),
                                               object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: UITestWait.screen), .completed, file: file, line: line)
    }

    private func assertCounts(in app: XCUIApplication, workouts: Int, schedules: Int,
                              file: StaticString = #filePath, line: UInt = #line) {
        let evidence = app.staticTexts["fixture.scenario"]
        let counts = Dictionary(uniqueKeysWithValues: (evidence.value as? String ?? "").split(separator: ";").compactMap { item -> (String, Int)? in
            let pair = item.split(separator: ":")
            guard pair.count == 2, let value = Int(pair[1]) else { return nil }
            return (String(pair[0]), value)
        })
        XCTAssertEqual(counts["workoutWrites"], workouts, file: file, line: line)
        XCTAssertEqual(counts["scheduleWrites"], schedules, file: file, line: line)
        XCTAssertEqual(counts["profileWrites"], 0, file: file, line: line)
        XCTAssertEqual(counts["starterWrites"], 0, file: file, line: line)
    }

    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }
}
