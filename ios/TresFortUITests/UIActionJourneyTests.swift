import XCTest

/// Exercise real controls in the full tab shell so the primary action cannot
/// pass merely because a standalone fixture omitted the tab bar.
final class UIActionJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(_ fixture: String = "app-store") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = fixture
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-restAudioCuesEnabled", "NO"]
        app.launch()
        return app
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: UITestWait.screen))
        for _ in 0..<6 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable)
        element.tap()
    }

    /// A summary control can be reported hittable below its pinned Finish
    /// action. Reveal its whole hit area before tapping the scroll content.
    private func revealSummaryControl(_ element: XCUIElement, in app: XCUIApplication,
                                      file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: UITestWait.screen), file: file, line: line)
        let finish = app.buttons["FINISH"]
        XCTAssertTrue(finish.exists, file: file, line: line)
        let identifier = element.identifier.isEmpty ? element.label : element.identifier
        let scroll = app.scrollViews.containing(.button, identifier: identifier).firstMatch
        XCTAssertTrue(scroll.exists, file: file, line: line)
        for _ in 0..<8 {
            let viewport = scroll.frame.intersection(app.frame)
            let top = viewport.minY + 8
            let bottom = min(viewport.maxY, finish.frame.minY - 12)
            let frame = element.frame
            if element.isHittable && frame.minY >= top && frame.maxY <= bottom { return }
            let height = bottom - top
            guard !viewport.isNull, height > 48 else { break }
            let offset = frame.midY - (top + bottom) / 2
            let down = offset < 0
            let distance = min(height * 0.4, max(24, abs(offset)))
            let startY = top + height * (down ? 0.25 : 0.75)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: viewport.minX + 12, dy: startY))
            let end = origin.withOffset(CGVector(dx: viewport.minX + 12,
                                                 dy: startY + (down ? distance : -distance)))
            start.press(forDuration: 0.1, thenDragTo: end,
                        withVelocity: .slow, thenHoldForDuration: 0.5)
        }
        XCTAssertTrue(element.isHittable, file: file, line: line)
        XCTAssertGreaterThanOrEqual(element.frame.minY, scroll.frame.minY + 8, file: file, line: line)
        XCTAssertLessThanOrEqual(element.frame.maxY, finish.frame.minY - 12, file: file, line: line)
    }

    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "ui-fix-" + name; image.lifetime = .keepAlways; add(image)
    }

    func testProfileKeepsAccountActionsInAccountAndNameRowIsTappable() {
        let app = launch()
        tap(app.buttons["profile.open"].firstMatch, in: app)
        XCTAssertTrue(app.buttons["profile.account"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["Download account data"].exists)
        XCTAssertFalse(app.buttons["Delete account"].exists)
        capture("profile")
        let name = app.buttons["profile.editName"]
        XCTAssertGreaterThanOrEqual(name.frame.height, 44)
        name.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["Edit Name"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["Cancel"], in: app)
        tap(app.buttons["profile.account"], in: app)
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["Download account data"].exists)
        capture("account")
        tap(app.buttons["Delete account"], in: app)
        let confirmation = app.alerts["Permanently delete your account?"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: UITestWait.screen))
        confirmation.buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars["Account"].exists)
    }

    func testLogSetStaysFixedAndFocusHidesTabsBeforeAndAfterRest() {
        let app = launch()
        tap(app.buttons["today.startWorkout"], in: app)
        let log = app.buttons["LOG SET 1"]
        XCTAssertTrue(log.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(log.isHittable)
        XCTAssertFalse(app.tabBars.firstMatch.exists)
        XCTAssertFalse(app.buttons["today.discardWorkout"].exists)
        capture("runner")
        let y = log.frame.minY
        app.swipeUp()
        XCTAssertEqual(log.frame.minY, y, accuracy: 2)
        XCTAssertTrue(log.isHittable)
        XCTAssertTrue(app.buttons["runner.reps"].exists)
        log.tap()
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["LOG SET 2"].isHittable)
        XCTAssertEqual(app.buttons["LOG SET 2"].frame.minY, y, accuracy: 2)
        app.buttons["rest.done"].tap()
        let next = app.buttons["LOG SET 2"]
        XCTAssertTrue(next.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(next.isEnabled)
        XCTAssertFalse(app.tabBars.firstMatch.exists)
        XCTAssertTrue(app.frame.contains(next.frame))
        next.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["rest.done"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["rest.done"].tap()
        XCTAssertTrue(app.buttons["LOG SET 3"].waitForExistence(timeout: UITestWait.screen),
                      "A physical tap after rest must log exactly one more set")
    }

    func testEditorUsesExplicitReorderingAndConfirmedRemoval() {
        let app = launch()
        tap(app.todayChoice("today.viewWorkout"), in: app)
        tap(app.buttons["workoutDetails.edit"], in: app)
        // Edit on today's workout asks: today only, or the saved workout.
        tap(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Edit your saved'")).firstMatch, in: app)
        let squat = app.buttons["editor.slot.a-squat"]
        XCTAssertTrue(squat.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["editor.doneReordering"].exists)
        XCTAssertTrue(squat.isEnabled)
        capture("editor")
        tap(app.buttons["editor.actions"], in: app)
        tap(app.buttons["Reorder exercises"], in: app)
        XCTAssertTrue(app.buttons["editor.doneReordering"].exists)
        XCTAssertFalse(app.buttons["Options for Barbell Squat"].exists)
        capture("reorder")
        let reorder = app.buttons["Reorder Barbell Squat"]
        XCTAssertTrue(reorder.isHittable)
        let row = app.buttons["editor.slot.a-row"]
        let dragStart = reorder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        // Cross the next row's midpoint, then hold while the native list settles its drop target.
        // The default fast drag released before the hosted simulator completed the move.
        let dragEnd = row.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.9))
        dragStart.press(forDuration: 1, thenDragTo: dragEnd,
                        withVelocity: .slow, thenHoldForDuration: 0.5)
        expectation(for: NSPredicate { _, _ in squat.frame.minY > row.frame.minY }, evaluatedWith: squat)
        waitForExpectations(timeout: UITestWait.screen)
        tap(app.buttons["editor.doneReordering"], in: app)
        XCTAssertGreaterThan(squat.frame.minY, row.frame.minY)
        squat.swipeLeft()
        tap(app.buttons["Remove"], in: app)
        let alert = app.alerts["Remove Barbell Squat?"]
        XCTAssertTrue(alert.waitForExistence(timeout: UITestWait.screen))
        capture("remove-exercise")
        alert.buttons["Cancel"].tap()
        XCTAssertTrue(squat.exists)
        tap(app.buttons["Options for Barbell Squat"], in: app)
        tap(app.buttons["Remove exercise"], in: app)
        XCTAssertTrue(alert.waitForExistence(timeout: UITestWait.screen))
        alert.buttons["Remove exercise"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: squat)
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertTrue(app.buttons["editor.slot.a-row"].exists)
    }

    func testSetDeletionRequiresConfirmationAndCancelPreservesValues() {
        let app = launch("ready-to-finish")
        let edit = app.buttons["edit-set-synthetic-set"]
        tap(edit, in: app)
        tap(app.buttons["Delete set 1 of Barbell Squat"], in: app)
        let alert = app.alerts["Delete set 1 of Barbell Squat?"]
        XCTAssertTrue(alert.waitForExistence(timeout: UITestWait.screen))
        capture("delete-set")
        alert.buttons["Cancel"].tap()
        XCTAssertEqual(app.textFields["Reps"].value as? String, "5")
        tap(app.buttons["Delete set 1 of Barbell Squat"], in: app)
        alert.buttons["Delete set"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: edit)
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertEqual(app.staticTexts["summary.value.Sets saved"].label, "0")
        XCTAssertFalse(app.buttons["FINISH"].exists, "An unresolved set must not leave a no-op Finish action")
        tap(app.buttons["finished.reviewExercises"], in: app)
        XCTAssertTrue(app.buttons["LOG SET 1"].waitForExistence(timeout: UITestWait.screen))
    }

    func testCompletedExerciseShowsCompletionInsteadOfANoOpLogAction() {
        let app = launch("ready-to-finish")
        let returnToExercises = app.buttons["Return to exercises"]
        revealSummaryControl(returnToExercises, in: app)
        returnToExercises.tapWhenReady()
        XCTAssertTrue(app.staticTexts["runner.exerciseComplete"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["LOG SET 2"].exists)
        tap(app.buttons["today.workoutActions"], in: app)
        tap(app.buttons["Finish workout"], in: app)
        tap(app.buttons["FINISH"], in: app)
        XCTAssertTrue(app.staticTexts["WORKOUT COMPLETE"].waitForExistence(timeout: UITestWait.screen))
    }

    func testFinishCanReturnToWorkoutOrExplicitlyFinishWithoutFeedback() {
        let app = launch()
        tap(app.buttons["today.startWorkout"], in: app)
        tap(app.buttons["today.workoutActions"], in: app)
        tap(app.buttons["Finish workout"], in: app)
        // Finishing early lands on the same finish screen as the last set.
        XCTAssertTrue(app.buttons["FINISH"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["Skip"].exists)
        XCTAssertTrue(app.staticTexts["feedback.earlyFinishNote"].exists)
        XCTAssertTrue(app.buttons["feedback.open"].exists)
        XCTAssertFalse(app.textViews["feedback.note"].exists)
        XCTAssertTrue(app.buttons["FINISH"].isHittable)
        capture("finish")
        tap(app.buttons["Keep working"], in: app)
        XCTAssertTrue(app.buttons["LOG SET 1"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.staticTexts["WORKOUT COMPLETE"].exists)
        tap(app.buttons["today.workoutActions"], in: app)
        tap(app.buttons["Finish workout"], in: app)
        tap(app.buttons["FINISH"], in: app)
        XCTAssertTrue(app.staticTexts["WORKOUT COMPLETE"].waitForExistence(timeout: UITestWait.screen))
    }

    func testSaveFeedbackAndFinishKeepsApprovedNote() {
        let app = launch()
        tap(app.buttons["today.startWorkout"], in: app)
        tap(app.buttons["today.workoutActions"], in: app)
        tap(app.buttons["Finish workout"], in: app)
        tap(app.buttons["feedback.open"], in: app)
        let note = app.textViews["feedback.note"]
        tap(note, in: app)
        note.typeText("Finished early today.")
        if app.buttons["Done"].isHittable { app.buttons["Done"].tap() }
        tap(app.buttons["Save feedback"], in: app)
        tap(app.buttons["FINISH"], in: app)
        XCTAssertTrue(app.staticTexts["WORKOUT COMPLETE"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["today.viewCompletedWorkout"], in: app)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "Finished early today.")
    }
}
