import XCTest

final class ExerciseGroupJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 { print(XCUIApplication().debugDescription) }
    }

    private func launch(exactGroupRests: Bool = false, maintenance: Bool = false, conflict: Bool = false) throws -> XCUIApplication {
        let app = XCUIApplication()
        let contract = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ExerciseGroups", withExtension: "json"))
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "groups"
        if maintenance {
            var fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: contract)) as? [String: Any])
            var slots = try XCTUnwrap(fixture["slots"] as? [[String: Any]])
            for index in 1...3 {
                slots[index]["group_id"] = "11111111-1111-4111-8111-111111111111"
                slots[index]["group_rest_seconds"] = 35
                slots[index]["group_transition_seconds"] = 20
            }
            for index in 0..<2 {
                var extra = slots[2]
                extra["id"] = "other-group-\(index)"
                extra["exercise_name"] = "Other group exercise \(index + 1)"
                extra["group_id"] = "22222222-2222-4222-8222-222222222222"
                extra["order_index"] = slots.count
                slots.append(extra)
            }
            fixture["slots"] = slots
            app.launchEnvironment["TRESFORT_UI_GROUP_CONTRACT"] = String(decoding:
                try JSONSerialization.data(withJSONObject: fixture), as: UTF8.self)
            if conflict { app.launchEnvironment["TRESFORT_UI_GROUP_CONFLICT"] = "1" }
        } else if exactGroupRests {
            var fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: contract)) as? [String: Any])
            var groups = try XCTUnwrap(fixture["groups"] as? [[String: Any]])
            groups[0]["round_rest"] = 35
            groups[0]["transition_rest"] = 20
            fixture["groups"] = groups
            app.launchEnvironment["TRESFORT_UI_GROUP_CONTRACT"] = String(decoding:
                try JSONSerialization.data(withJSONObject: fixture), as: UTF8.self)
        } else {
            app.launchEnvironment["TRESFORT_UI_GROUP_CONTRACT"] = try String(contentsOf: contract, encoding: .utf8)
        }
        // Notification permission is covered by the activation journeys.
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-restAudioCuesEnabled", "NO"]
        app.launch()
        app.openSavedWorkoutsFromToday()
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        let workout = app.buttons["library.workout.synthetic-day"]
        XCTAssertTrue(workout.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(workout.isHittable)
        workout.tap()
        XCTAssertTrue(app.buttons["workoutDetails.edit"].waitForExistence(timeout: UITestWait.screen))
        app.buttons["workoutDetails.edit"].tap()
        XCTAssertTrue(app.buttons["editor.actions"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        _ = element.waitForExistence(timeout: 5)
        for _ in 0..<12 {
            if element.exists && element.isHittable && element.frame.maxY < app.frame.maxY - 10 { return }
            app.swipeUp()
        }
        XCTFail("Control did not become reachable: \(element)")
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func author(_ app: XCUIApplication, slots: [String], roundRest: Int, transitionRest: Int) {
        app.buttons["editor.actions"].tap()
        app.buttons["Group exercises"].tap()
        for slot in slots {
            let select = app.buttons["editor.select.\(slot)"]
            reveal(select, in: app)
            select.tap()
            XCTAssertEqual(select.value as? String, "Selected")
        }
        let group = app.buttons["Group as superset"]
        XCTAssertTrue(group.isEnabled)
        group.tap()
        replaceNumber("group.roundRest", with: String(roundRest), in: app)
        replaceNumber("group.transitionRest", with: String(transitionRest), in: app)
        screenshot(transitionRest > 0 ? "working-group-prescription" : "warmup-group-prescription")
        let save = app.buttons["Save group"]
        XCTAssertTrue(app.scroll(toReveal: save))
        save.tapWhenReady()
        XCTAssertTrue(app.buttons["editor.actions"].waitUntilTappable())
    }

    func testAuthorWarmupAndWorkingSupersetThenRunAlternatingRounds() throws {
        let app = try launch()
        author(app, slots: ["group-pushup", "group-squat"], roundRest: 30, transitionRest: 0)
        XCTAssertTrue(app.staticTexts["Superset A"].exists)
        XCTAssertTrue(app.staticTexts["Round rest: 30s"].exists)
        author(app, slots: ["group-bench", "group-row"], roundRest: 60, transitionRest: 15)
        reveal(app.buttons["Edit Superset B"], in: app)
        XCTAssertTrue(app.staticTexts["Transition rest: 15s"].exists)
        screenshot("authored-two-groups")
        app.navigationBars["Edit Warm-up and strength"].buttons["Done"].tap()
        let details = app.navigationBars["Warm-up and strength"]
        XCTAssertTrue(details.waitForExistence(timeout: UITestWait.screen))
        details.backButton.tap()
        XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
        app.navigationBars["Workouts"].buttons["Done"].tap()
        let start = app.buttons["today.startWorkout"]
        reveal(start, in: app)
        screenshot("group-workout-preview")
        start.tap()
        let allowNotifications = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            .alerts.buttons["Allow"]
        if allowNotifications.waitForExistence(timeout: 5) { allowNotifications.tap() }

        let names = ["PUSH-UP", "BODYWEIGHT SQUAT", "PUSH-UP", "BODYWEIGHT SQUAT",
                     "BENCH PRESS", "BARBELL ROW", "BENCH PRESS", "BARBELL ROW"]
        let rounds = [1, 1, 2, 2, 1, 1, 2, 2]
        for index in names.indices {
            let name = app.staticTexts[names[index]]
            XCTAssertTrue(name.waitForExistence(timeout: UITestWait.screen))
            if index == 0 {
                screenshot("superset-runner-before-header-check")
                XCTAssertTrue(app.descendants(matching: .any)["runner.group"].waitForExistence(timeout: UITestWait.screen))
                XCTAssertTrue(app.descendants(matching: .any)["runner.group.member.group-pushup"].exists)
                XCTAssertTrue(app.descendants(matching: .any)["runner.group.member.group-squat"].exists)
                XCTAssertTrue(app.staticTexts["runner.group.next"].label.contains("Bodyweight Squat"))
                XCTAssertTrue(app.buttons["runner.addBodyweightLoad"].isHittable)
            }
            if index >= 4 {
                let weight = app.buttons["runner.weight"]
                for _ in 0..<5 where !weight.isHittable { app.swipeDown() }
                reveal(weight, in: app)
                if index < 6 {
                    weight.tap()
                    app.segmentedControls["weight.unit"].buttons["kg"].tap()
                    replaceWeight(with: index == 4 ? "20" : "15", in: app)
                    app.buttons["Save"].tap()
                }
                XCTAssertEqual(weight.value as? String, index % 2 == 0 ? "20" : "15")
                if index == 6 { screenshot("superset-second-round-retains-kilograms") }
            }
            let log = app.buttons["LOG SET \(rounds[index])"]
            XCTAssertTrue(log.waitForExistence(timeout: UITestWait.screen))
            XCTAssertTrue(log.isEnabled)
            XCTAssertTrue(app.frame.contains(log.frame))
            XCTAssertGreaterThanOrEqual(log.frame.height, 44)
            if index == 0 || index == 4 { screenshot("group-runner-member-\(index)") }
            // iOS can report isHittable=false after restoring the rest screen's
            // navigation chrome even though this visible footer receives taps.
            // Exercise its actual touch target; the exact next member/rest and
            // fixture sequence below prove the tap logged one physical set.
            log.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            if index + 1 == names.count {
                XCTAssertTrue(app.staticTexts["Ready to finish"].waitForExistence(timeout: UITestWait.screen))
                XCTAssertFalse(app.buttons["rest.done"].exists, "Final work must go directly to completion")
            } else if index == 0 || index == 2 {
                // A zero transition advances immediately without a rest cue.
                XCTAssertTrue(app.staticTexts[names[index + 1]].waitForExistence(timeout: UITestWait.screen))
                XCTAssertFalse(app.buttons["rest.done"].exists)
            } else {
                let done = app.buttons["rest.done"]
                XCTAssertTrue(done.waitForExistence(timeout: UITestWait.screen))
                XCTAssertEqual(app.staticTexts["runner.exerciseTitle"].label,
                               names[index + 1])
                if index == 4 { screenshot("transition-rest-next-member") }
                done.tap()
            }
        }
        XCTAssertTrue(app.staticTexts["Ready to finish"].waitForExistence(timeout: UITestWait.screen))
        let finish = app.buttons["FINISH"]
        XCTAssertTrue(finish.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(finish.isEnabled)
        XCTAssertTrue(app.frame.contains(finish.frame))
        XCTAssertGreaterThanOrEqual(finish.frame.height, 44)
        // Finish stays reachable immediately after the final logged member.
        // Verify a real touch and the acknowledged completion below.
        finish.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts["WORKOUT COMPLETE"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.staticTexts["Synthetic member sequence mismatch"].exists)
        screenshot("completed-alternating-workout")
    }

    func testGroupedTargetsAndUngroupKeepIndividualRests() throws {
        let app = try launch()
        author(app, slots: ["group-pushup", "group-squat"], roundRest: 30, transitionRest: 0)
        let slot = app.buttons["editor.slot.group-pushup"]
        reveal(slot, in: app)
        slot.tap()
        let ordinaryRest = app.textFields["slot.ordinaryRest"]
        reveal(ordinaryRest, in: app)
        XCTAssertFalse(ordinaryRest.isEnabled)
        XCTAssertTrue(app.staticTexts["Individual rest · inactive"].exists)
        screenshot("grouped-slot-inactive-rest")
        app.navigationBars.buttons["Cancel"].tap()
        let edit = app.buttons["Edit Superset A"]
        // Scroll back to the start of the card after returning from a long form.
        for _ in 0..<5 where !edit.isHittable { app.swipeDown() }
        XCTAssertTrue(edit.waitForExistence(timeout: UITestWait.screen))
        edit.tap()
        let ungroup = app.buttons["Ungroup"]
        reveal(ungroup, in: app)
        ungroup.tap()
        XCTAssertTrue(app.buttons["editor.actions"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.staticTexts["Superset A"].exists)
        let pushup = app.buttons["editor.slot.group-pushup"]
        for _ in 0..<5 where !pushup.isHittable { app.swipeDown() }
        XCTAssertTrue(pushup.staticTexts["2×10 · 45s rest"].exists)
        XCTAssertTrue(app.buttons["editor.slot.group-squat"].staticTexts["2×10 · 90s rest"].exists)
        screenshot("ungrouped-original-rests")
    }

    func testExactOrdinaryRestPersistsAndCancelPreservesSavedValue() throws {
        let app = try launch()
        openPushup(in: app)
        replaceNumber("slot.ordinaryRest", with: "35", in: app)
        saveTargets(in: app)
        assertPushupSummary("2×10 · 35s rest", in: app)

        openPushup(in: app)
        XCTAssertEqual(app.textFields["slot.ordinaryRest"].value as? String, "35")
        replaceNumber("slot.ordinaryRest", with: "20", in: app)
        app.navigationBars["Push-Up"].buttons["Cancel"].tapWhenReady()
        // Cancelling a dirty target draft now requires an explicit discard.
        let discard = app.alerts["Discard your changes?"].buttons["Discard changes"]
        XCTAssertTrue(discard.waitForExistence(timeout: UITestWait.screen))
        discard.tapWhenReady()
        assertPushupSummary("2×10 · 35s rest", in: app)

        openPushup(in: app)
        for invalid in ["", "3601"] {
            replaceNumber("slot.ordinaryRest", with: invalid, in: app)
            XCTAssertFalse(app.buttons["Save targets"].isEnabled)
            XCTAssertTrue(app.staticTexts["Enter a rest from 0 to 3,600 seconds."].exists)
        }
        replaceNumber("slot.ordinaryRest", with: "0", in: app)
        saveTargets(in: app)
        assertPushupSummary("2×10 · 0s rest", in: app)
        openPushup(in: app)
        XCTAssertEqual(app.textFields["slot.ordinaryRest"].value as? String, "0")
        app.navigationBars["Push-Up"].buttons["Cancel"].tapWhenReady()
    }

    func testExactGroupRestsAndMemberEditsPreserveInactiveOrdinaryRests() throws {
        let app = try launch(exactGroupRests: true)
        author(app, slots: ["group-pushup", "group-squat"], roundRest: 35, transitionRest: 20)
        XCTAssertTrue(app.staticTexts["Round rest: 35s"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Transition rest: 20s"].exists)

        let edit = app.buttons["Edit Superset A"]
        XCTAssertTrue(app.scroll(toReveal: edit, searchingUp: true))
        edit.tapWhenReady()
        XCTAssertTrue(app.textFields["group.roundRest"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertEqual(app.textFields["group.roundRest"].value as? String, "35")
        XCTAssertEqual(app.textFields["group.transitionRest"].value as? String, "20")
        replaceNumber("group.transitionRest", with: "3601", in: app)
        XCTAssertFalse(app.buttons["Save group"].isEnabled)
        replaceNumber("group.transitionRest", with: "40", in: app)
        replaceNumber("group.roundRest", with: "15", in: app)
        app.navigationBars["Edit group"].buttons["Cancel"].tapWhenReady()
        app.alerts["Discard your changes?"].buttons["Discard changes"].tapWhenReady()
        XCTAssertTrue(app.staticTexts["Round rest: 35s"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["Transition rest: 20s"].exists)

        openPushup(in: app)
        let ordinary = app.textFields["slot.ordinaryRest"]
        XCTAssertTrue(ordinary.exists)
        XCTAssertEqual(ordinary.value as? String, "45")
        XCTAssertFalse(ordinary.isEnabled)
        let reps = app.steppers["10 reps"]
        XCTAssertTrue(app.scroll(toReveal: reps, searchingUp: true))
        reps.buttons["Increment"].tapWhenReady()
        saveTargets(in: app)

        XCTAssertTrue(app.scroll(toReveal: edit, searchingUp: true))
        edit.tapWhenReady()
        let ungroup = app.buttons["Ungroup"]
        XCTAssertTrue(app.scroll(toReveal: ungroup))
        ungroup.tapWhenReady()
        assertPushupSummary("2×11 · 45s rest", in: app)
        XCTAssertTrue(app.buttons["editor.slot.group-squat"].staticTexts["2×10 · 90s rest"].exists)
        XCTAssertFalse(app.staticTexts["Superset A"].exists)
    }

    func testExistingGroupAddsRemovesAndReordersMembersWithoutDeletingSlots() throws {
        let app = try launch(maintenance: true)
        tapGroup(app.buttons["Edit Circuit A"], in: app)
        XCTAssertTrue(app.navigationBars["Edit group"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["group.add.other-group-0"].exists)
        tapGroup(app.buttons["group.remove.group-bench"], in: app)
        tapGroup(app.buttons["group.remove.group-row"], in: app)
        XCTAssertTrue(app.scroll(toReveal: app.buttons["group.save"]))
        XCTAssertFalse(app.buttons["group.save"].isEnabled, "A singleton needs another member or Ungroup")
        tapGroup(app.buttons["group.add.group-row"], in: app, searchingUp: true)
        tapGroup(app.buttons["group.add.group-pushup"], in: app, searchingUp: true)
        tapGroup(app.buttons["group.up.group-pushup"], in: app, searchingUp: true)
        tapGroup(app.buttons["group.up.group-pushup"], in: app, searchingUp: true)
        assertGroupMember("group-pushup", label: "1. Push-Up", in: app, searchingUp: true)
        let incrementRounds = app.buttons["group.rounds-Increment"]
        XCTAssertTrue(app.scroll(toReveal: incrementRounds))
        incrementRounds.tapWhenReady()
        replaceNumber("group.roundRest", with: "37", in: app)
        replaceNumber("group.transitionRest", with: "19", in: app)
        app.navigationBars["Edit group"].buttons["Cancel"].tapWhenReady()
        app.alerts["Discard your changes?"].buttons["Keep editing"].tapWhenReady()
        assertGroupRest("group.roundRest", value: "37", in: app, searchingUp: true)
        assertGroupRest("group.transitionRest", value: "19", in: app)
        tapGroup(app.buttons["group.save"], in: app)
        XCTAssertTrue(app.buttons["editor.actions"].waitUntilTappable())
        assertGroupEvidence("plan:2;planWrites:1;slots:group-pushup,group-squat,group-row,group-bench,other-group-0,other-group-1", in: app)
        assertGroupEvidence("group-bench=none,other-group-0=22222222-2222-4222-8222-222222222222,other-group-1=22222222-2222-4222-8222-222222222222", in: app)
        screenshot("group-maintenance-saved-order")
        tapWorkoutEditor(app.buttons["Edit Circuit A"], in: app, searchingUp: true)
        assertGroupMember("group-pushup", label: "1. Push-Up", in: app, searchingUp: true)
        assertGroupMember("group-squat", label: "2. Bodyweight Squat", in: app)
        assertGroupMember("group-row", label: "3. Barbell Row", in: app)
        XCTAssertFalse(app.staticTexts["group.member.group-bench"].exists)
        assertGroupRest("group.roundRest", value: "37", in: app)
        assertGroupRest("group.transitionRest", value: "19", in: app)
        screenshot("group-maintenance-exact-rests")
        app.navigationBars["Edit group"].buttons["Cancel"].tapWhenReady()
        tapWorkoutEditor(app.buttons["editor.slot.group-bench"], in: app)
        XCTAssertTrue(app.scroll(toReveal: app.textFields["slot.ordinaryRest"]))
        XCTAssertEqual(app.textFields["slot.ordinaryRest"].value as? String, "120")
        XCTAssertTrue(app.textFields["slot.ordinaryRest"].isEnabled)
        app.navigationBars["Bench Press"].buttons["Cancel"].tapWhenReady()
        assertGroupEvidence("planWrites:1", in: app)
    }

    func testGroupConflictKeepsMembershipOrderAndTargetsUntilExplicitReview() throws {
        let app = try launch(maintenance: true, conflict: true)
        tapGroup(app.buttons["Edit Circuit A"], in: app)
        tapGroup(app.buttons["group.remove.group-bench"], in: app)
        tapGroup(app.buttons["group.up.group-row"], in: app, searchingUp: true)
        let incrementRounds = app.buttons["group.rounds-Increment"]
        XCTAssertTrue(app.scroll(toReveal: incrementRounds))
        incrementRounds.tapWhenReady()
        tapGroup(app.buttons["group.save"], in: app)
        XCTAssertTrue(app.scroll(toReveal: app.buttons["group.reviewLatest"]))
        XCTAssertTrue(app.scroll(toReveal: app.buttons["group.save"]))
        XCTAssertFalse(app.buttons["group.save"].isEnabled)
        // At AX XXXL, the saved-group and selected-exercise conflict summaries
        // exceed the usual 16 drags between the bottom controls and members.
        assertGroupMember("group-row", label: "1. Barbell Row", in: app, searchingUp: true, maxDrags: 32)
        assertGroupMember("group-squat", label: "2. Bodyweight Squat", in: app)
        tapGroup(app.buttons["group.reviewLatest"], in: app, maxDrags: 32)
        XCTAssertTrue(app.scroll(toReveal: app.buttons["group.keepChanges"]))
        screenshot("group-conflict-preserved-proposal")
        tapGroup(app.buttons["group.keepChanges"], in: app)
        XCTAssertTrue(app.scroll(toReveal: incrementRounds, searchingUp: true))
        XCTAssertEqual(app.steppers["group.rounds"].value as? String, "3",
                       "Review must not replace proposed rounds with the server's four")
        assertGroupRest("group.roundRest", value: "35", in: app)
        tapGroup(app.buttons["group.save"], in: app)
        XCTAssertTrue(app.buttons["editor.actions"].waitUntilTappable())
        assertGroupEvidence("plan:3;planWrites:2;slots:group-pushup,group-row,group-squat,group-bench,other-group-0,other-group-1", in: app)
        tapWorkoutEditor(app.buttons["Edit Superset A"], in: app, searchingUp: true)
        tapGroup(app.buttons["group.remove.group-row"], in: app)
        app.navigationBars["Edit group"].buttons["Cancel"].tapWhenReady()
        app.alerts["Discard your changes?"].buttons["Discard changes"].tapWhenReady()
        assertGroupEvidence("plan:3;planWrites:2", in: app)
        tapWorkoutEditor(app.buttons["Edit Superset A"], in: app, searchingUp: true)
        assertGroupMember("group-row", label: "1. Barbell Row", in: app, searchingUp: true)
        app.navigationBars["Edit group"].buttons["Cancel"].tapWhenReady()
    }

    private func assertGroupMember(_ id: String, label: String, in app: XCUIApplication,
                                   searchingUp: Bool = false, maxDrags: Int = 16) {
        let member = app.staticTexts["group.member.\(id)"]
        XCTAssertTrue(app.scroll(toReveal: member, searchingUp: searchingUp, maxDrags: maxDrags))
        XCTAssertEqual(member.label, label)
    }

    private func assertGroupRest(_ id: String, value: String, in app: XCUIApplication,
                                 searchingUp: Bool = false) {
        let field = app.textFields[id]
        XCTAssertTrue(app.scroll(toReveal: field, searchingUp: searchingUp))
        XCTAssertEqual(field.value as? String, value)
    }

    private func tapGroup(_ element: XCUIElement, in app: XCUIApplication, searchingUp: Bool = false,
                          maxDrags: Int = 16) {
        XCTAssertTrue(app.scroll(toReveal: element, searchingUp: searchingUp, maxDrags: maxDrags))
        element.tapWhenReady()
    }

    private func tapWorkoutEditor(_ element: XCUIElement, in app: XCUIApplication,
                                  searchingUp: Bool = false) {
        XCTAssertTrue(app.buttons["editor.actions"].waitUntilTappable())
        // The editor's fixed explanatory header can fill the upper half of
        // the screen at accessibility sizes. Start every drag inside its List,
        // identified by editor slot descendants rather than an underlying view.
        let lists = app.collectionViews.containing(NSPredicate(format: "identifier BEGINSWITH %@", "editor.slot."))
        XCTAssertEqual(lists.count, 1)
        let list = lists.firstMatch
        for attempt in 0...16 {
            let band = list.frame.insetBy(dx: 8, dy: 12)
            guard band.height > 80 else { break }
            if element.exists {
                let frame = element.frame
                if band.contains(CGPoint(x: frame.midX, y: frame.midY)) && element.isHittable {
                    element.tapWhenReady()
                    return
                }
            }
            guard attempt < 16 else { break }
            let frame = element.exists ? element.frame : .zero
            let above = frame.isEmpty ? searchingUp : frame.midY < band.minY
            let high = list.coordinate(withNormalizedOffset: CGVector(dx: 0.06, dy: 0.25))
            let low = list.coordinate(withNormalizedOffset: CGVector(dx: 0.06, dy: 0.75))
            (above ? high : low).press(forDuration: 0.1, thenDragTo: above ? low : high,
                                      withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTFail("Workout editor control did not become visible: \(element)\n\(app.debugDescription)")
    }

    private func assertGroupEvidence(_ expected: String, in app: XCUIApplication) {
        let evidence = app.staticTexts["fixture.scenario"]
        let predicate = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", expected), object: evidence)
        XCTAssertEqual(XCTWaiter.wait(for: [predicate], timeout: UITestWait.screen), .completed)
    }

    private func openPushup(in app: XCUIApplication) {
        let slot = app.buttons["editor.slot.group-pushup"]
        XCTAssertTrue(app.scroll(toReveal: slot, searchingUp: true))
        slot.tapWhenReady()
        XCTAssertTrue(app.navigationBars["Push-Up"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.scroll(toReveal: app.textFields["slot.ordinaryRest"]))
    }

    private func saveTargets(in app: XCUIApplication) {
        let save = app.buttons["Save targets"]
        XCTAssertTrue(app.scroll(toReveal: save))
        save.tapWhenReady()
        XCTAssertTrue(app.buttons["editor.actions"].waitUntilTappable())
    }

    private func assertPushupSummary(_ expected: String, in app: XCUIApplication) {
        XCTAssertTrue(app.buttons["editor.actions"].waitUntilTappable())
        let slot = app.buttons["editor.slot.group-pushup"]
        XCTAssertTrue(app.scroll(toReveal: slot, searchingUp: true))
        XCTAssertTrue(slot.staticTexts[expected].waitForExistence(timeout: UITestWait.screen))
    }

    private func replaceWeight(with value: String, in app: XCUIApplication) {
        let field = app.textFields["weight.entry"]
        XCTAssertTrue(field.waitUntilTappable())
        // The dedicated weight journeys select this large centered field
        // with a double tap; a long press does not expose its selection menu.
        field.doubleTap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: UITestWait.screen))
        field.typeText(XCUIKeyboardKey.delete.rawValue)
        let cleared = field.value as? String ?? ""
        XCTAssertTrue(cleared.isEmpty || cleared == field.placeholderValue,
                      "Clear the complete weight before replacing it: \(cleared)")
        field.typeText(value)
        XCTAssertEqual(field.value as? String, value)
    }

    private func replaceNumber(_ identifier: String, with value: String, in app: XCUIApplication,
                               anchorX: CGFloat = 0.99) {
        let field = app.textFields[identifier]
        XCTAssertTrue(app.scroll(toReveal: field))
        let displayed = field.value as? String ?? ""
        let previous = displayed == field.placeholderValue ? "" : displayed
        field.coordinate(withNormalizedOffset: CGVector(dx: anchorX, dy: 0.5)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: UITestWait.screen))
        if !previous.isEmpty {
            XCTAssertTrue(app.scroll(toReveal: field))
            // Select the value explicitly: tapping a numeric field does not
            // guarantee that its caret sits after the final digit.
            field.coordinate(withNormalizedOffset: CGVector(dx: anchorX, dy: 0.5)).press(forDuration: 1.2)
            let selectAll = app.menuItems["Select All"], cut = app.menuItems["Cut"]
            let selectWord = app.menuItems["Select"]
            let selection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                selectAll.exists || cut.exists || selectWord.exists
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [selection], timeout: UITestWait.screen), .completed)
            if selectAll.exists { selectAll.tapWhenReady() }
            else if !cut.exists { selectWord.tapWhenReady() }
            field.typeText(XCUIKeyboardKey.delete.rawValue)
            let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let current = field.value as? String ?? ""
                return current.isEmpty || current == field.placeholderValue
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: UITestWait.screen), .completed)
        }
        if !value.isEmpty { field.typeText(value) }
        let entered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: UITestWait.screen), .completed)
    }
}
