import XCTest

final class WorkoutFeedbackJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 { print(XCUIApplication().debugDescription) }
    }
    struct Fixture: Decodable { let recognized: String; let edited: String; let perceived_fatigue: Int }
    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "WorkoutFeedback", withExtension: "json"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }
    private func launch(_ speech: String = "available", reuse: Bool = false, conflict: Bool = false, scenario: String = "ready-to-finish", completedExtra: Bool = false, completedConflict: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = scenario
        app.launchEnvironment["TRESFORT_FEEDBACK_SPEECH"] = speech
        app.launchEnvironment["TRESFORT_FEEDBACK_TRANSCRIPT"] = (try? fixture())?.recognized
        if reuse { app.launchEnvironment["TRESFORT_UI_REUSE_FEEDBACK"] = "1" }
        if conflict { app.launchEnvironment["TRESFORT_UI_FEEDBACK_CONFLICT"] = "1" }
        if completedExtra { app.launchEnvironment["TRESFORT_UI_COMPLETED_FEEDBACK_EXTRA"] = "1" }
        if completedConflict { app.launchEnvironment["TRESFORT_UI_COMPLETED_FEEDBACK_CONFLICT"] = "1" }
        // Feedback journeys use synthetic speech and keep unrelated rest-cue
        // notification permission out of the workout Resume boundary.
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-restAudioCuesEnabled", "NO"]
        app.launch()
        XCTAssertTrue(app.staticTexts["fixture.scenario"].waitForExistence(timeout: UITestWait.screen))
        return app
    }
    private func reveal(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<6 { if element.isHittable { return }; app.swipeUp() }
        XCTAssertTrue(element.isHittable)
    }
    /// XCTest can mark a clipped summary control hittable while its centre
    /// lies beneath the pinned Finish button. Reveal its full hit area first.
    private func revealSummaryControl(_ element: XCUIElement, app: XCUIApplication,
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
    private func openFeedback(_ app: XCUIApplication) {
        let open = app.buttons["feedback.open"]
        XCTAssertTrue(open.waitForExistence(timeout: UITestWait.screen))
        revealSummaryControl(open, app: app); open.tapWhenReady()
        XCTAssertTrue(app.buttons["feedback.talk"].waitForExistence(timeout: UITestWait.screen))
    }
    private func type(_ text: String, app: XCUIApplication, replacing: Bool = false) {
        let note = app.textViews["feedback.note"]
        reveal(note, app: app); note.tap()
        if replacing {
            // Command-A was ignored intermittently by the simulator. Use the
            // native editing menu, and require full deletion before typing.
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: UITestWait.screen))
            note.press(forDuration: 1.2)
            let selectAll = app.menuItems["Select All"]
            XCTAssertTrue(selectAll.waitForExistence(timeout: UITestWait.screen))
            selectAll.tap()
            note.typeText(XCUIKeyboardKey.delete.rawValue)
            XCTAssertEqual(note.value as? String, "", "Replacement must clear the entire transcript")
        }
        note.typeText(text)
        XCTAssertEqual(note.value as? String, text)
        if app.buttons["feedback.keyboardDone"].isHittable { app.buttons["feedback.keyboardDone"].tap() }
    }
    private func finish(_ app: XCUIApplication) {
        let finish = app.buttons["FINISH"]
        reveal(finish, app: app); finish.tap()
        openCompletedWorkout(app)
    }
    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    /// Finishing early opens the same finish screen the last set leads to.
    private func openFinishSummary(_ app: XCUIApplication) {
        let actions = app.buttons["today.workoutActions"]
        XCTAssertTrue(actions.waitForExistence(timeout: UITestWait.screen)); actions.tap()
        app.buttons["Finish workout"].tap()
        XCTAssertTrue(app.buttons["FINISH"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["Keep working"].exists)
    }
    private func openCompletedWorkout(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["WORKOUT COMPLETE"].waitForExistence(timeout: UITestWait.screen))
        let record = app.buttons["today.viewCompletedWorkout"]
        reveal(record, app: app)
        record.tap(until: app.navigationBars["Workout record"])
    }

    private func openCompletedFeedback(_ app: XCUIApplication, slot: Int = 0) {
        let button = app.buttons["feedback.completed.open.\(slot)"]
        guard button.waitForExistence(timeout: UITestWait.screen) else {
            XCTFail("Completed feedback control is missing for workout slot \(slot)")
            return
        }
        XCTAssertTrue(app.scroll(toReveal: button))
        button.tapWhenReady()
        XCTAssertTrue(app.navigationBars["Workout feedback"].waitForExistence(timeout: UITestWait.screen))
    }

    private func replaceCompletedNote(_ text: String, in app: XCUIApplication) {
        let note = app.textViews["feedback.note"]
        if !note.isHittable { XCTAssertTrue(app.scroll(toReveal: note)) }
        let old = note.value as? String ?? ""
        note.tapWhenReady()
        let focused = NSPredicate(format: "hasKeyboardFocus == true")
        let keyboard = app.keyboards.firstMatch
        let keyboardDone = app.buttons["feedback.keyboardDone"]
        let appFrame = app.frame
        var previousFrames: [CGRect] = []
        let inputReady = NSPredicate { _, _ in
            guard focused.evaluate(with: note), keyboard.exists, keyboardDone.exists else { return false }
            let frames = [note.frame, keyboard.frame, keyboardDone.frame]
            defer { previousFrames = frames }
            return frames.allSatisfy {
                $0.minX.isFinite && $0.minY.isFinite && $0.width.isFinite && $0.height.isFinite
                    && $0.width > 0 && $0.height > 0 && $0.intersects(appFrame)
            } && frames == previousFrames
        }
        // A tappable editor can still be acquiring focus as the sheet settles.
        // Retap at most once before selecting or typing, within one screen wait.
        var ready = false
        for attempt in 0..<2 {
            if attempt > 0 && !(focused.evaluate(with: note) && keyboard.exists) {
                previousFrames = []
                if note.exists && note.isEnabled && note.isHittable { note.tap() }
            }
            // Keep the first frame observation when input is already ready;
            // the second half of the same budget can confirm it is stable.
            let wait = XCTNSPredicateExpectation(predicate: inputReady, object: nil)
            if XCTWaiter.wait(for: [wait], timeout: UITestWait.screen / 2) == .completed {
                ready = true
                break
            }
        }
        guard ready else {
            XCTFail("The note must have focus and a visible keyboard before editing")
            return
        }
        XCTAssertEqual(note.value as? String, old, "Focusing the editor must not change its text")
        if !old.isEmpty {
            // Focus scrolls the editor above the keyboard. Press the first
            // visible text line after it settles, not its blank centre.
            let frame = note.frame.intersection(app.frame)
            let top = max(frame.minY, app.navigationBars["Workout feedback"].frame.maxY) + 8
            let bottom = min(frame.maxY, min(keyboard.frame.minY, keyboardDone.frame.minY)) - 8
            guard bottom > top else {
                XCTFail("The editor needs a visible text-selection area")
                return
            }
            let x = frame.minX + min(24, frame.width / 2)
            let y = top + min(8, (bottom - top) / 2)
            app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: x - app.frame.minX, dy: y - app.frame.minY))
                .press(forDuration: 1.2)
            let all = app.menuItems["Select All"], cut = app.menuItems["Cut"]
            let selection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                all.exists || cut.exists
            }, object: nil)
            guard XCTWaiter.wait(for: [selection], timeout: UITestWait.screen) == .completed else {
                XCTFail("The text selection menu must appear before clearing the note")
                return
            }
            if all.exists { all.tapWhenReady() }
            else { XCTAssertTrue(cut.exists) }
            note.typeText(XCUIKeyboardKey.delete.rawValue)
            let cleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", ""), object: note)
            XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: UITestWait.screen), .completed)
        }
        if !text.isEmpty { note.typeText(text) }
        let entered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", text), object: note)
        XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: UITestWait.screen), .completed)
        app.buttons["feedback.keyboardDone"].tapWhenReady()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
                                                 object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: UITestWait.screen), .completed)
        let retained = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", text), object: note)
        XCTAssertEqual(XCTWaiter.wait(for: [retained], timeout: UITestWait.screen), .completed,
                       "Dismissing the keyboard must preserve the note")
    }

    private func saveCompletedFeedback(_ app: XCUIApplication) {
        app.buttons["feedback.completed.save"].tapWhenReady()
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
                                              object: app.navigationBars["Workout feedback"])
        XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: UITestWait.screen), .completed)
        XCTAssertFalse(app.buttons["LOG SET 1"].exists)
        XCTAssertFalse(app.buttons["FINISH"].exists)
    }

    func testCompletedRecordCanAddCorrectAndClearOptionalFeedback() {
        let app = launch()
        finish(app)
        XCTAssertFalse(app.staticTexts["feedback.saved-note"].exists)
        openCompletedFeedback(app)
        replaceCompletedNote("Unapproved draft", in: app)
        app.buttons["feedback.completed.cancel"].tapWhenReady()
        XCTAssertFalse(app.staticTexts["feedback.saved-note"].exists)
        openCompletedFeedback(app)
        replaceCompletedNote("Felt good", in: app)
        let fatigue = app.buttons["feedback.fatigue.6"]
        XCTAssertTrue(app.scroll(toReveal: fatigue))
        fatigue.tapWhenReady()
        let retained = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Felt good"),
                                                object: app.textViews["feedback.note"])
        XCTAssertEqual(XCTWaiter.wait(for: [retained], timeout: UITestWait.screen), .completed,
                       "Choosing fatigue must preserve the typed note")
        saveCompletedFeedback(app)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "Felt good")
        XCTAssertEqual(app.staticTexts["feedback.saved-fatigue"].label, "Fatigue: 6/10")
        openCompletedFeedback(app)
        replaceCompletedNote("More rest next time", in: app)
        saveCompletedFeedback(app)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "More rest next time")
        openCompletedFeedback(app)
        replaceCompletedNote("", in: app)
        let notRated = app.buttons["feedback.fatigue.none"]
        XCTAssertTrue(app.scroll(toReveal: notRated))
        notRated.tapWhenReady()
        saveCompletedFeedback(app)
        XCTAssertFalse(app.staticTexts["feedback.saved-note"].exists)
        XCTAssertFalse(app.staticTexts["feedback.saved-fatigue"].exists)
        XCTAssertEqual(app.buttons["feedback.completed.open.0"].label, "Add workout feedback")
    }

    func testCompletedFeedbackConflictShowsBothVersionsAndRequiresAnExplicitChoice() {
        let app = launch(completedConflict: true)
        finish(app)
        openCompletedFeedback(app)
        replaceCompletedNote("Reviewed version", in: app)
        app.buttons["feedback.completed.save"].tapWhenReady()
        XCTAssertTrue(app.navigationBars["Review feedback"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Reviewed version"].exists)
        XCTAssertTrue(app.staticTexts["Competing saved note"].exists)
        let mine = app.buttons["feedback.completed.useMine"]
        if !mine.isHittable { XCTAssertTrue(app.scroll(toReveal: mine)) }
        mine.tapWhenReady()
        let resolved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
                                                object: app.navigationBars["Review feedback"])
        XCTAssertEqual(XCTWaiter.wait(for: [resolved], timeout: UITestWait.screen), .completed)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "Reviewed version")
        openCompletedFeedback(app)
        replaceCompletedNote("Discard this replacement", in: app)
        app.buttons["feedback.completed.save"].tapWhenReady()
        XCTAssertTrue(app.navigationBars["Review feedback"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Discard this replacement"].exists)
        XCTAssertTrue(app.staticTexts["Another saved note"].exists)
        let saved = app.buttons["feedback.completed.keepSaved"]
        if !saved.isHittable { XCTAssertTrue(app.scroll(toReveal: saved)) }
        saved.tapWhenReady()
        let kept = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
                                            object: app.navigationBars["Review feedback"])
        XCTAssertEqual(XCTWaiter.wait(for: [kept], timeout: UITestWait.screen), .completed)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "Another saved note")
        XCTAssertEqual(app.staticTexts["feedback.saved-fatigue"].label, "Fatigue: 5/10")
        XCTAssertFalse(app.buttons["LOG SET 1"].exists)
    }

    func testCompletedFeedbackAdditionalSessionKeepsPrimaryFeedbackEmpty() {
        let app = launch(completedExtra: true)
        finish(app)
        openCompletedFeedback(app, slot: 1)
        XCTAssertEqual(app.textViews["feedback.note"].value as? String, "Additional workout note")
        replaceCompletedNote("Extra session only", in: app)
        saveCompletedFeedback(app)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "Extra session only")
        XCTAssertTrue(app.scroll(toReveal: app.buttons["feedback.completed.open.0"], searchingUp: true))
        XCTAssertEqual(app.buttons["feedback.completed.open.0"].label, "Add workout feedback")
    }

    func testEarlyFinishStartsWithSummaryAndNeedsNoFeedback() {
        let app = launch(scenario: "workout-swap")
        openFinishSummary(app)
        XCTAssertTrue(app.staticTexts["feedback.earlyFinishNote"].exists)
        XCTAssertFalse(app.textViews["feedback.note"].exists)
        XCTAssertFalse(app.buttons["feedback.talk"].exists)
        XCTAssertTrue(app.buttons["FINISH"].isHittable)
        screenshot("feedback-optional-finish-summary")
        app.buttons["FINISH"].tap()
        openCompletedWorkout(app)
        XCTAssertFalse(app.staticTexts["feedback.saved-note"].exists)
        XCTAssertFalse(app.staticTexts["feedback.saved-fatigue"].exists)
    }

    func testEarlyFinishSavesOnlyReviewedFeedback() {
        let app = launch(scenario: "workout-swap")
        openFinishSummary(app)
        openFeedback(app)
        type("Finished early after one set", app: app)
        app.buttons["Save feedback"].tap()
        XCTAssertTrue(app.staticTexts["feedback.saved-note"].waitForExistence(timeout: UITestWait.screen))
        finish(app)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "Finished early after one set")
    }

    func testEarlyFinishDoesNotSaveACanceledDraft() {
        let app = launch(scenario: "workout-swap")
        openFinishSummary(app)
        openFeedback(app)
        type("Unapproved draft", app: app)
        app.buttons["Cancel"].tap()
        finish(app)
        XCTAssertFalse(app.staticTexts["feedback.saved-note"].exists)
    }

    func testFinishSummaryPreservesPreviouslySavedFeedback() {
        let app = launch()
        openFeedback(app); type("Previously saved feedback", app: app)
        app.buttons["Save feedback"].tap()
        let returnToExercises = app.buttons["Return to exercises"]
        XCTAssertTrue(returnToExercises.waitForExistence(timeout: UITestWait.screen))
        revealSummaryControl(returnToExercises, app: app); returnToExercises.tapWhenReady()
        openFinishSummary(app)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "Previously saved feedback")
        XCTAssertFalse(app.textViews["feedback.note"].exists)
        openFeedback(app)
        type("Unapproved replacement", app: app, replacing: true)
        app.buttons["Cancel"].tap()
        finish(app)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "Previously saved feedback")
    }

    func testVoiceEditedTranscriptAndFatigueReachAcknowledgedWorkout() throws {
        let values = try fixture()
        let app = launch()
        openFeedback(app)
        app.buttons["feedback.talk"].tap()
        XCTAssertTrue(app.buttons["feedback.stop"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["feedback.stop"].tap()
        XCTAssertEqual(app.textViews["feedback.note"].value as? String, values.recognized)
        type(values.edited, app: app, replacing: true)
        let fatigue = app.buttons["feedback.fatigue"]
        reveal(fatigue, app: app); fatigue.tap()
        app.buttons["\(values.perceived_fatigue) / 10"].tap()
        screenshot("feedback-reviewed-transcript")
        app.buttons["Save feedback"].tap()
        XCTAssertTrue(app.staticTexts["feedback.saved-note"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, values.edited)
        finish(app)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, values.edited)
        XCTAssertEqual(app.staticTexts["feedback.saved-fatigue"].label, "Fatigue: 7/10")
        screenshot("feedback-acknowledged")
    }

    func testDeniedPermissionPreservesTypingAndExplicitSave() {
        let app = launch("denied")
        openFeedback(app)
        type("Typed before asking to record", app: app)
        let talk = app.buttons["feedback.talk"]
        // Swiping down while the form is already at its top dismisses the
        // sheet. Scroll back up only when typing left the button off-screen.
        if !talk.isHittable { app.swipeDown() }
        reveal(talk, app: app); talk.tap()
        XCTAssertTrue(app.staticTexts["Recording permission is off. You can type instead or skip."].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.textViews["feedback.note"].value as? String, "Typed before asking to record")
        app.buttons["Save feedback"].tap()
        finish(app)
        XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, "Typed before asking to record")
        XCTAssertFalse(app.staticTexts["feedback.saved-fatigue"].exists)
    }

    func testCanceledOrEmptyRecordingAndUnavailableRecognitionCanSkip() {
        for mode in ["available", "empty", "unavailable"] {
            let app = launch(mode)
            openFeedback(app); app.buttons["feedback.talk"].tap()
            if mode == "unavailable" {
                XCTAssertTrue(app.staticTexts["On-device transcription is unavailable. You can type instead or skip."].waitForExistence(timeout: UITestWait.screen))
            } else {
                XCTAssertTrue(app.buttons["Cancel recording"].waitForExistence(timeout: UITestWait.screen))
                app.buttons["Cancel recording"].tap()
                XCTAssertEqual(app.textViews["feedback.note"].value as? String, "")
            }
            app.buttons["Cancel"].tap()
            finish(app)
            XCTAssertFalse(app.staticTexts["feedback.saved-note"].exists)
            app.terminate()
        }
    }

    func testApprovedFeedbackSurvivesRelaunchBeforeFinish() {
        let app = launch()
        openFeedback(app); type("Saved before relaunch", app: app)
        app.buttons["Save feedback"].tap()
        XCTAssertTrue(app.staticTexts["feedback.saved-note"].waitForExistence(timeout: UITestWait.screen))
        app.terminate()
        let reopened = launch(reuse: true)
        let resume = reopened.buttons["today.startWorkout"]
        XCTAssertTrue(resume.waitForExistence(timeout: UITestWait.screen)); resume.tap()
        XCTAssertTrue(reopened.staticTexts["feedback.saved-note"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(reopened.staticTexts["feedback.saved-note"].label, "Saved before relaunch")
        finish(reopened)
        XCTAssertEqual(reopened.staticTexts["feedback.saved-note"].label, "Saved before relaunch")
    }

    func testFeedbackConflictReviewsBothVersionsAndCompletesExplicitChoice() {
        for useMine in [false, true] {
            let app = launch(conflict: true)
            openFeedback(app); type("My approved feedback", app: app)
            app.buttons["Save feedback"].tap()
            let finish = app.buttons["FINISH"]
            reveal(finish, app: app); finish.tap()
            let review = app.buttons["Review feedback"]
            XCTAssertTrue(review.waitForExistence(timeout: UITestWait.screen)); review.tap()
            XCTAssertTrue(app.staticTexts["My approved feedback"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertTrue(app.staticTexts["Newer saved feedback"].exists)
            screenshot("feedback-conflict-review")
            let choice = app.buttons[useMine ? "Use my feedback" : "Keep saved feedback"]
            reveal(choice, app: app); choice.tap()
            XCTAssertTrue(app.staticTexts["WORKOUT COMPLETE"].waitForExistence(timeout: UITestWait.screen))
        let record = app.buttons["today.viewCompletedWorkout"]
        reveal(record, app: app); record.tap()
            XCTAssertEqual(app.staticTexts["feedback.saved-note"].label, useMine ? "My approved feedback" : "Newer saved feedback")
            app.terminate()
        }
    }
}
