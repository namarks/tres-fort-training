import XCTest

final class WorkoutLibraryJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(reviewedCreation: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "library"
        if reviewedCreation { app.launchEnvironment["TRESFORT_UI_LIFTING_CREATION"] = "1" }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        app.openSavedWorkoutsFromToday()
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    func testTagsArchiveCancelAndRestore() {
        let app = launch()
        app.buttons["Actions for Gym"].tap()
        app.buttons["Edit tags"].tap()
        let input = app.textViews["workoutTags.input"]
        if input.waitForExistence(timeout: 3) { input.tap(); input.typeText("quick, travel") }
        else {
            let field = app.textFields["workoutTags.input"]
            XCTAssertTrue(field.waitForExistence(timeout: UITestWait.screen)); field.tap(); field.typeText("quick, travel")
        }
        app.buttons["workoutTags.save"].tap()
        XCTAssertTrue(app.staticTexts["workoutTags-synthetic-day"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["workoutTags-synthetic-day"].label, "quick · travel")
        app.buttons["library.tagFilter"].tap()
        app.buttons["quick"].tap()
        XCTAssertTrue(app.buttons["library.workout.synthetic-day"].exists)
        XCTAssertFalse(app.buttons["library.workout.hotel"].exists)
        app.buttons["library.tagFilter"].tap()
        app.buttons["All tags"].tap()
        XCTAssertTrue(app.buttons["library.workout.hotel"].exists)
        app.buttons["Actions for Gym"].tap(); app.buttons["Archive workout"].tap()
        let confirm = app.alerts["Archive Gym?"]
        XCTAssertTrue(confirm.waitForExistence(timeout: UITestWait.screen))
        confirm.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["library.workout.synthetic-day"].exists)
        app.buttons["Actions for Gym"].tap(); app.buttons["Archive workout"].tap()
        confirm.buttons["Archive workout"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["library.workout.synthetic-day"])
        waitForExpectations(timeout: UITestWait.screen)
        // Archived workouts live on their own screen, not behind a toggle.
        XCTAssertFalse(app.segmentedControls.firstMatch.exists)
        XCTAssertTrue(app.buttons["library.archived"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["library.archived"].tap()
        XCTAssertTrue(app.navigationBars["Archived workouts"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["library.workout.synthetic-day"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["library.workout.hotel"].exists)
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "workout-archive"; image.lifetime = .keepAlways; add(image)
        app.buttons["Actions for Gym"].tap()
        XCTAssertFalse(app.buttons["Use on a date"].exists)
        app.buttons["Restore workout"].tap()
        XCTAssertTrue(app.staticTexts["archived.empty"].waitForExistence(timeout: UITestWait.screen))
        app.navigationBars["Archived workouts"].backButton.tap()
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["library.workout.synthetic-day"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["library.archived"].exists, "The archive row leaves once nothing is archived")
        XCTAssertEqual(app.staticTexts["workoutSchedule-synthetic-day"].label, "On demand")
        XCTAssertEqual(app.staticTexts["workoutTags-synthetic-day"].label, "quick · travel")
    }

    func testLibraryBadgesUnscheduleAndDateAssignment() {
        let app = launch()
        XCTAssertEqual(app.staticTexts["workoutSchedule-synthetic-day"].label, "Tue")
        XCTAssertEqual(app.staticTexts["workoutSchedule-hotel"].label, "On demand")
        app.buttons["Actions for Gym"].tap()
        app.buttons["Unschedule"].tap()
        let onDemand = NSPredicate(format: "label == %@", "On demand")
        expectation(for: onDemand, evaluatedWith: app.staticTexts["workoutSchedule-synthetic-day"])
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertTrue(app.buttons["Actions for Gym"].exists)
        app.buttons["Actions for Hotel"].tap()
        app.buttons["Use on a date"].tap()
        XCTAssertTrue(app.buttons["assignLibraryWorkout"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["assignLibraryWorkout"].tap()
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.staticTexts["workoutSchedule-hotel"].label, "On demand")
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "workout-library"; image.lifetime = .keepAlways; add(image)
        app.navigationBars["Workouts"].buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["Hotel"].waitForExistence(timeout: UITestWait.screen))
    }

    func testDeletingLastTaggedWorkoutClearsFilter() {
        let app = launch()
        app.buttons["Actions for Hotel"].tap()
        app.buttons["Edit tags"].tap()
        let input = app.textViews["workoutTags.input"]
        if input.waitForExistence(timeout: 3) { input.tap(); input.typeText("quick") }
        else {
            let field = app.textFields["workoutTags.input"]
            XCTAssertTrue(field.waitForExistence(timeout: UITestWait.screen)); field.tap(); field.typeText("quick")
        }
        app.buttons["workoutTags.save"].tap()
        XCTAssertTrue(app.buttons["library.tagFilter"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["library.tagFilter"].tap(); app.buttons["quick"].tap()
        XCTAssertFalse(app.buttons["library.workout.synthetic-day"].exists)
        app.buttons["Actions for Hotel"].tap(); app.buttons["Delete workout"].tap()
        let confirmation = app.alerts["Delete Hotel?"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: UITestWait.screen))
        confirmation.buttons["Delete workout"].tap()
        XCTAssertTrue(app.buttons["library.workout.synthetic-day"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["library.tagFilter"].exists)
    }

    func testDeleteIsExplicitAndSeparateFromUnschedule() {
        let app = launch()
        app.buttons["Actions for Hotel"].tap()
        XCTAssertFalse(app.buttons["Unschedule"].isEnabled)
        app.buttons["Delete workout"].tap()
        let confirmation = app.alerts["Delete Hotel?"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: UITestWait.screen))
        confirmation.buttons["Delete workout"].tap()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.buttons["Actions for Hotel"])
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertTrue(app.buttons["Actions for Gym"].exists)
        XCTAssertEqual(app.staticTexts["workoutSchedule-synthetic-day"].label, "Tue")
    }

    func testWorkoutOpensFromEmptyRowSpaceAndDisclosure() {
        let app = launch()
        let row = app.buttons["library.workout.hotel"]
        // Exercise blank horizontal space, vertical padding, and the chevron.
        // A label-center tap alone does not catch the original plain-button gap.
        for point in [CGVector(dx: 0.7, dy: 0.5), CGVector(dx: 0.5, dy: 0.08),
                      CGVector(dx: 0.96, dy: 0.5)] {
            XCTAssertTrue(row.waitForExistence(timeout: UITestWait.screen))
            row.coordinate(withNormalizedOffset: point).tap()
            let details = app.navigationBars["Hotel"]
            XCTAssertTrue(details.waitForExistence(timeout: UITestWait.screen))
            XCTAssertTrue(app.buttons["workoutDetails.edit"].exists)
            // Details push onto the library's stack: Back, not Done.
            details.backButton.tap()
            XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        }
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "workout-library-row-navigation"; image.lifetime = .keepAlways; add(image)
        let actions = app.buttons["Actions for Hotel"]
        XCTAssertGreaterThanOrEqual(actions.frame.width, 44)
        XCTAssertGreaterThanOrEqual(actions.frame.height, 44)
        actions.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.1)).tap()
        XCTAssertTrue(app.buttons["Use on a date"].waitForExistence(timeout: UITestWait.screen))
    }

    func testSwipeDeleteRequiresConfirmationAndCancelKeepsWorkout() {
        let app = launch()
        let row = app.buttons["library.workout.hotel"]
        row.swipeLeft()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(row.exists, "Swiping must not remove a workout")
        XCTAssertFalse(app.alerts["Delete Hotel?"].exists, "Full swipe must not execute Delete")
        app.buttons["Delete"].tap()
        let confirmation = app.alerts["Delete Hotel?"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: UITestWait.screen))
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "workout-library-delete-confirmation"; image.lifetime = .keepAlways; add(image)
        confirmation.buttons["Cancel"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: UITestWait.screen))
        row.tap()
        XCTAssertTrue(app.navigationBars["Hotel"].waitForExistence(timeout: UITestWait.screen))
        app.navigationBars["Hotel"].backButton.tap()
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        row.swipeLeft()
        app.buttons["Delete"].tap()
        XCTAssertTrue(confirmation.waitForExistence(timeout: UITestWait.screen))
        confirmation.buttons["Delete workout"].tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: row)
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertTrue(app.buttons["library.workout.synthetic-day"].exists)
        XCTAssertEqual(app.staticTexts["workoutSchedule-synthetic-day"].label, "Tue")
    }

    func testCreateStartsWithFilteredExercisesAndSavesWithoutNaming() {
        let app = launch()
        app.buttons["Add workout"].tap()
        XCTAssertTrue(app.navigationBars["Add exercises"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.textFields["createWorkout.name"].exists)
        XCTAssertFalse(app.buttons["createWorkout.review"].isEnabled)
        app.buttons["Lower body"].tap()
        app.buttons["exercisePicker.exercise.synthetic-exercise"].tap()
        app.buttons["Upper body"].tap()
        XCTAssertFalse(app.buttons["exercisePicker.exercise.synthetic-exercise"].exists)
        let search = app.textFields["exercisePicker.search"]
        search.tap(); search.typeText("bp")
        app.buttons["exercisePicker.exercise.synthetic-upper"].tap()
        search.tap(); search.typeText("zzzzz")
        XCTAssertTrue(app.staticTexts["No matching exercises"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["Clear search and filters"].tap()
        app.buttons["Core"].tap()
        app.buttons["exercisePicker.exercise.synthetic-core"].tap()
        XCTAssertEqual(app.buttons["createWorkout.review"].label, "Review workout (3)")
        let picker = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        picker.name = "exercise-first-filtered-picker"; picker.lifetime = .keepAlways; add(picker)
        app.buttons["createWorkout.review"].tap()
        XCTAssertTrue(app.textFields["createWorkout.name"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Barbell Squat"].exists)
        XCTAssertTrue(app.staticTexts["Bench Press"].exists)
        XCTAssertTrue(app.staticTexts["Plank"].exists)
        let review = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        review.name = "exercise-first-review"; review.lifetime = .keepAlways; add(review)
        let create = app.buttons["createWorkout.create"]
        for _ in 0..<4 where !create.isHittable { app.swipeUp() }
        create.tap()
        XCTAssertTrue(app.navigationBars["Workout 1"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Barbell Squat"].exists)
        XCTAssertTrue(app.staticTexts["Bench Press"].exists)
        XCTAssertTrue(app.staticTexts["Plank"].exists)
    }

    func testCancelSelectionLeavesLibraryUnchangedAndExistingEditorUsesFilters() {
        let app = launch()
        app.buttons["Add workout"].tap()
        let squat = app.buttons["exercisePicker.exercise.synthetic-exercise"]
        XCTAssertTrue(squat.waitForExistence(timeout: UITestWait.screen)); squat.tap()
        app.navigationBars["Add exercises"].buttons["Cancel"].tap()
        let discard = app.alerts["Discard workout draft?"]
        XCTAssertTrue(discard.waitForExistence(timeout: UITestWait.screen))
        discard.buttons["Keep editing"].tap()
        XCTAssertTrue(squat.isSelected)
        app.navigationBars["Add exercises"].buttons["Cancel"].tap()
        discard.buttons["Discard workout"].tap()
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "library.workout.")).count, 2)
        app.buttons["Actions for Gym"].tap()
        app.buttons["Edit exercises"].tap()
        app.buttons["editor.actions"].tap()
        app.buttons["Add exercise"].tap()
        XCTAssertTrue(app.navigationBars["Add exercise"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["Core"].tap()
        XCTAssertFalse(app.staticTexts["Barbell Squat"].exists)
        app.staticTexts["Plank"].tap()
        XCTAssertTrue(app.navigationBars["Plank"].waitForExistence(timeout: UITestWait.screen))
        // A target weight can be set while adding, not only afterwards.
        let weight = app.textFields["slot.targetWeight"]
        for _ in 0..<3 where !weight.exists { app.swipeUp() }
        XCTAssertTrue(weight.exists)
        XCTAssertTrue(app.buttons["Add to workout"].exists)
    }

    func testSixExerciseTargetsAreReviewedBeforeSingleSaveAndSurviveBackAndOrder() {
        let app = launch(reviewedCreation: true)
        // A positive read count proves request telemetry is wired for this
        // fixture; an unwired all-zero counter cannot prove no writes.
        let observingRequests = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (self.creationCounts(in: app)["state"] ?? 0) > 0
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [observingRequests], timeout: UITestWait.screen), .completed)
        assertNoDraftWrites(in: app)
        app.buttons["Add workout"].tap()
        XCTAssertTrue(app.navigationBars["Add exercises"].waitForExistence(timeout: UITestWait.screen))
        // Search/filter behavior has its own journey. Select this fixture's
        // six exercises directly, in the order the prescription must retain.
        for id in ["synthetic-exercise", "synthetic-upper", "synthetic-core",
                   "creation-dumbbell", "creation-pullup", "creation-bike"] {
            tapPickerExercise(app.buttons["exercisePicker.exercise.\(id)"], in: app)
        }
        XCTAssertEqual(app.buttons["createWorkout.review"].label, "Review workout (6)")
        app.buttons["createWorkout.review"].tapWhenReady()
        replaceCreationText(app.textFields["createWorkout.name"], with: "Reviewed lift", in: app)
        tapCreation(app.buttons["createWorkout.targets.synthetic-exercise"], in: app, destination: "Barbell Squat")
        replaceCreationText(app.textFields["createWorkout.target.sets"], with: "4", in: app)
        replaceCreationText(app.textFields["createWorkout.target.reps"], with: "5", in: app)
        replaceCreationText(app.textFields["createWorkout.target.rest"], with: "135", in: app)
        XCTAssertEqual(app.textFields["slot.targetWeight"].value as? String, "No target")
        app.navigationBars["Barbell Squat"].backButton.tap()
        tapCreation(app.buttons["createWorkout.targets.creation-dumbbell"], in: app, destination: "Dumbbell Row")
        replaceCreationText(app.textFields["createWorkout.target.repsMax"], with: "12", in: app)
        let kg = app.segmentedControls["slot.weightUnit"].buttons["kg"]
        // Editing the rep range leaves the number pad over the lower Weight
        // section. This editor has no pinned footer; the shared helper keeps
        // the unit control above that keyboard before the single tap.
        if !kg.isHittable { XCTAssertTrue(app.scroll(toReveal: kg)) }
        kg.tapWhenReady()
        let selectedKilograms = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: kg)
        XCTAssertEqual(XCTWaiter.wait(for: [selectedKilograms], timeout: UITestWait.screen), .completed)
        replaceCreationText(app.textFields["slot.targetWeight"], with: "22.5", in: app)
        app.navigationBars["Dumbbell Row"].backButton.tap()
        tapCreation(app.buttons["createWorkout.targets.synthetic-core"], in: app, destination: "Plank")
        replaceCreationText(app.textFields["createWorkout.target.seconds"], with: "40", in: app)
        app.navigationBars["Plank"].backButton.tap()
        tapCreation(app.buttons["createWorkout.order.creation-dumbbell"], in: app)
        app.buttons["Move up"].tapWhenReady()
        app.navigationBars["Review workout"].backButton.tap()
        app.buttons["createWorkout.review"].tapWhenReady()
        tapCreation(app.buttons["createWorkout.targets.creation-dumbbell"], in: app, destination: "Dumbbell Row")
        XCTAssertEqual(app.textFields["createWorkout.target.repsMax"].value as? String, "12")
        XCTAssertEqual(app.textFields["slot.targetWeight"].value as? String, "22.5")
        XCTAssertTrue(app.segmentedControls["slot.weightUnit"].buttons["kg"].isSelected)
        app.navigationBars["Dumbbell Row"].backButton.tap()
        app.navigationBars["Review workout"].buttons["Cancel"].tap()
        app.alerts["Discard workout draft?"].buttons["Keep editing"].tapWhenReady()
        assertNoDraftWrites(in: app)
        app.buttons["createWorkout.create"].tapWhenReady()
        XCTAssertTrue(app.navigationBars["Reviewed lift"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.navigationBars["Edit Reviewed lift"].exists)
        let savedOnce = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let counts = self.creationCounts(in: app)
            return counts["workoutWrites"] == 1 && counts["planWrites"] == 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [savedOnce], timeout: UITestWait.screen), .completed,
                       "Saving the reviewed prescription must issue exactly one workout/plan write")
        assertCreationWrites(in: app, expected: 1)
    }

    private func tapPickerExercise(_ element: XCUIElement, in app: XCUIApplication) {
        let regions = app.descendants(matching: .any)["exercisePicker.regions"].firstMatch
        let top = regions.frame.maxY + 8
        let bottom = app.buttons["createWorkout.review"].frame.minY - 16
        for _ in 0..<6 {
            let frame = element.exists ? element.frame : .zero
            if !frame.isEmpty, frame.minY >= top, frame.maxY <= bottom, element.isHittable {
                element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: element)
                XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: UITestWait.screen), .completed)
                return
            }
            guard bottom - top > 80 else { break }
            let above = !frame.isEmpty && frame.minY < top
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let high = top - app.frame.minY + (bottom - top) * 0.25
            let low = top - app.frame.minY + (bottom - top) * 0.75
            origin.withOffset(CGVector(dx: 44, dy: above ? high : low))
                .press(forDuration: 0.1,
                       thenDragTo: origin.withOffset(CGVector(dx: 44, dy: above ? low : high)),
                       withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTFail("Exercise is not fully above Review workout: \(element.identifier)")
    }

    /// A Form can report a partly covered row as hittable. Keep its entire
    /// frame between this screen's known navigation bar and pinned Save,
    /// without scanning every navigation bar in the stacked sheet hierarchy.
    private func tapCreation(_ element: XCUIElement, in app: XCUIApplication, destination: String? = nil) {
        let navigation = app.navigationBars["Review workout"]
        XCTAssertTrue(navigation.waitForExistence(timeout: UITestWait.screen))
        let save = app.buttons["createWorkout.create"]
        XCTAssertTrue(save.waitForExistence(timeout: UITestWait.screen))
        for _ in 0..<8 {
            let top = navigation.frame.maxY + 8
            var bottom = save.frame.minY - 16
            let keyboard = app.keyboards.firstMatch
            if keyboard.exists { bottom = min(bottom, keyboard.frame.minY - 8) }
            let frame = element.exists ? element.frame : .zero
            if !frame.isEmpty, frame.minY >= top, frame.maxY <= bottom, element.isHittable {
                assertNoDraftWrites(in: app)
                element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                assertNoDraftWrites(in: app)
                if let destination {
                    XCTAssertTrue(app.navigationBars[destination].waitForExistence(timeout: UITestWait.screen),
                                  "The target editor must open before editing its fields")
                }
                return
            }
            guard bottom - top > 80 else { break }
            let above = !frame.isEmpty && frame.minY < top
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let high = top - app.frame.minY + (bottom - top) * 0.25
            let low = top - app.frame.minY + (bottom - top) * 0.75
            origin.withOffset(CGVector(dx: 44, dy: above ? high : low))
                .press(forDuration: 0.1,
                       thenDragTo: origin.withOffset(CGVector(dx: 44, dy: above ? low : high)),
                       withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTFail("Review control is not fully above Save: \(element.identifier)")
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
        XCTAssertGreaterThan(counts["state"] ?? 0, 0, "Request telemetry must observe real state reads", file: file, line: line)
        XCTAssertEqual(counts["workoutWrites"], expected, "Workout write attempts", file: file, line: line)
        XCTAssertEqual(counts["planWrites"], expected, "All plan write attempts", file: file, line: line)
        for counter in ["profileWrites", "starterWrites", "scheduleWrites"] {
            XCTAssertEqual(counts[counter], 0, counter, file: file, line: line)
        }
    }

    private func assertNoDraftWrites(in app: XCUIApplication,
                                     file: StaticString = #filePath, line: UInt = #line) {
        assertCreationWrites(in: app, expected: 0, file: file, line: line)
    }

    private func replaceCreationText(_ field: XCUIElement, with text: String, in app: XCUIApplication) {
        // Search and most target fields are already visible. Avoid a full
        // navigation-bar/keyboard scan unless scrolling is actually needed.
        if !field.isHittable { XCTAssertTrue(app.scroll(toReveal: field)) }
        XCTAssertTrue(field.waitForExistence(timeout: UITestWait.screen))
        let displayed = field.value as? String ?? ""
        let previous = displayed == field.placeholderValue ? "" : displayed
        let trailing = field.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5))
        trailing.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: UITestWait.screen))
        if !previous.isEmpty {
            if !field.isHittable { XCTAssertTrue(app.scroll(toReveal: field)) }
            trailing.press(forDuration: 1.2)
            let selectAll = app.menuItems["Select All"]
            let cut = app.menuItems["Cut"]
            let selection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in selectAll.exists || cut.exists }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [selection], timeout: UITestWait.screen), .completed)
            if selectAll.exists { selectAll.tapWhenReady() }
            field.typeText(XCUIKeyboardKey.delete.rawValue)
            let placeholder = field.placeholderValue ?? ""
            let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let value = field.value as? String ?? ""
                return value.isEmpty || value == placeholder
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: UITestWait.screen), .completed,
                           "Replacement must clear the entire previous value")
        }
        field.typeText(text)
        let entered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", text), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: UITestWait.screen), .completed)
    }

}
