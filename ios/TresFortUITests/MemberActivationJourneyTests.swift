import XCTest

final class MemberActivationJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            print(XCUIApplication().debugDescription)
            let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            image.name = "activation-failure"; image.lifetime = .keepAlways; add(image)
        }
    }

    private func launch(_ fixture: String, retry: Bool = false, pendingSetup: Bool = false, starterUsed: Bool = false, pendingStage: String? = nil, captureLinks: Bool = false, returnWithSetupOpen: Bool = false, pendingCoachSetup: Bool = false, pendingInvite: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = fixture
        if pendingInvite { app.launchEnvironment["TRESFORT_UI_PENDING_INVITE"] = "1" }
        if captureLinks { app.launchEnvironment["TRESFORT_UI_CAPTURE_LINKS"] = "1" }
        if returnWithSetupOpen { app.launchEnvironment["TRESFORT_UI_RETURN_WITH_SETUP_OPEN"] = "1" }
        if pendingCoachSetup { app.launchEnvironment["TRESFORT_UI_PENDING_COACH_SETUP"] = "1" }
        if let pendingStage { app.launchEnvironment["TRESFORT_UI_PENDING_TRAINING_STAGE"] = pendingStage }
        if pendingSetup { app.launchEnvironment["TRESFORT_UI_PENDING_TRAINING_PROFILE"] = "1" }
        if starterUsed { app.launchEnvironment["TRESFORT_UI_STARTER_ALREADY_USED"] = "1" }
        if retry {
            app.launchEnvironment["TRESFORT_UI_AUTH_RETRY"] = "1"
            app.launchEnvironment["TRESFORT_UI_INVITE_RETRY"] = "1"
        }
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.staticTexts["fixture.scenario"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication,
                     file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: UITestWait.screen), element.description, file: file, line: line)
        for _ in 0..<12 {
            if element.isHittable { element.tap(); return }
            app.swipeUp()
        }
        XCTFail("Control is not reachable: \(element.description)", file: file, line: line)
    }

    // Form rows below the viewport are not materialized in the accessibility
    // tree yet. Scroll before requiring existence for the longer coach setup.
    // Short drags, not swipes: a fling can carry a mid-form row such as
    // "Manage AI access" past the visible area between two checks.
    private func scrollAndTap(_ element: XCUIElement, in app: XCUIApplication,
                              above bottomBar: XCUIElement? = nil,
                              file: StaticString = #filePath, line: UInt = #line) {
        guard app.scroll(toReveal: element, above: bottomBar) else {
            XCTFail("Control is not reachable after scrolling: \(element.description)", file: file, line: line)
            return
        }
        element.tap()
    }

    func testMobileCoachApprovalRequiresExplicitDecision() {
        let app = launch("coach-approval", pendingCoachSetup: true)
        XCTAssertTrue(app.staticTexts["Review AI access"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["coach-approval.client"].label.contains("“Synthetic AI app”"))
        XCTAssertTrue(app.staticTexts["coach-approval.client"].label.contains("client.example"))
        XCTAssertFalse(app.buttons["coach-approval.continue"].exists)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "mobile-coach-consent"; image.lifetime = .keepAlways; add(image)
        scrollAndTap(app.buttons["coach-approval.allow"], in: app)
        XCTAssertTrue(app.staticTexts["Access allowed"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["coach-approval.continue"].exists)
        // Leave before the AI app exchanges its code. Cancellation must still
        // be reachable when the profile reports no connected grant.
        tap(app.buttons["Done"], in: app)
        XCTAssertFalse(app.navigationBars["Connect your coach"].exists)
        tap(app.buttons["profile.open"].firstMatch, in: app)
        scrollAndTap(app.buttons["coach.manageAccess"], in: app)
        scrollAndTap(app.buttons["Disconnect all AI apps"], in: app)
        let confirmation = app.sheets["Disconnect all AI apps?"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(confirmation.buttons["Disconnect all AI apps"].isHittable)
    }

    /// Get started, then skip setup: Today with nothing planned yet.
    private func onboard(_ app: XCUIApplication) {
        tap(app.buttons["Get started"], in: app)
        tap(app.buttons["setup.skip"], in: app)
        XCTAssertTrue(app.buttons["today.planWeek"].waitForExistence(timeout: UITestWait.screen))
    }

    private func completeFirstWorkout(_ app: XCUIApplication) {
        if app.buttons["workoutDetails.start"].exists {
            tap(app.buttons["workoutDetails.start"], in: app)
        } else if app.buttons["today.startWorkout"].exists {
            tap(app.buttons["today.startWorkout"], in: app)
        } else {
            app.openSavedWorkoutsFromToday()
            XCTAssertTrue(app.navigationBars["Workouts"].waitForExistence(timeout: UITestWait.screen))
            tap(app.buttons["library.workout.synthetic-day"], in: app)
            tap(app.buttons["workoutDetails.start"], in: app)
        }
        // Real entry asks for rest-notification permission before starting.
        // Exercise that prompt on this disposable simulator; existence waits
        // alone do not trigger XCTest's default interruption handler.
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        // A newly authored lift has no prescribed load or previous session.
        // The member chooses the load before the first set can be logged.
        // Returning from the system permission prompt can precede the runner's
        // first render. Wait for that surface before inspecting its load state.
        XCTAssertTrue(app.buttons["runner.logSet"].waitForExistence(timeout: UITestWait.screen))
        if app.buttons["runner.chooseWeight"].waitForExistence(timeout: 3) {
            XCTAssertFalse(app.buttons["LOG SET 1"].isEnabled)
            tap(app.buttons["runner.chooseWeight"], in: app)
            let entry = app.textFields["weight.entry"]
            XCTAssertTrue(entry.waitForExistence(timeout: UITestWait.screen))
            entry.tap(); entry.typeText("45")
            let entered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "45"), object: entry)
            XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: UITestWait.screen), .completed)
            tap(app.buttons["Save"], in: app)
        }
        XCTAssertTrue(app.buttons["LOG SET 1"].isEnabled, "A chosen or prescribed load is required before logging")
        tap(app.buttons["LOG SET 1"], in: app)
        if app.buttons["rest.done"].waitForExistence(timeout: 3) {
            tap(app.buttons["rest.done"], in: app)
        }
        let finish = app.buttons["FINISH"]
        XCTAssertTrue(finish.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(finish.isEnabled)
        XCTAssertTrue(app.frame.contains(finish.frame))
        XCTAssertGreaterThanOrEqual(finish.frame.height, 44)
        // After rest restores the app chrome, XCTest can misreport this pinned
        // button's hittability. A physical tap must complete the workout below.
        finish.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts["WORKOUT COMPLETE"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["today.moreWaysToTrain"].exists)
        XCTAssertFalse(app.buttons["today.createWorkout"].exists)
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "activation-first-completion"; image.lifetime = .keepAlways; add(image)
    }

    func testOwnerEntryRestoresTrainingWithoutRepeatingSetup() {
        let app = launch("activation-owner")
        XCTAssertTrue(app.buttons["app.privacy-policy"].isHittable)
        XCTAssertTrue(app.buttons["Contact support"].isHittable)
        tap(app.buttons["Sign in with Apple"], in: app)
        assertExistingTraining(app)
        completeFirstWorkout(app)
    }

    func testFreshDeviceSignInRestoresExistingTrainingAndStation() {
        let app = launch("activation-returning")
        tap(app.buttons["Sign in with Apple"], in: app)
        assertExistingTraining(app)
        assertReturningRequestsDidNotMutateSetup(app)

        if UIDevice.current.userInterfaceIdiom == .pad {
            tap(app.buttons["today.station"], in: app)
            #if APP_STORE_BUILD
            XCTAssertTrue(app.staticTexts["station.manualSetup"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertFalse(app.buttons["station.enableCamera"].exists)
            #else
            XCTAssertTrue(app.buttons["station.enableCamera"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertEqual(app.staticTexts["station.repCount"].label, "MediaPipe: 0 reps")
            #endif
            tap(app.buttons["station.done"], in: app)
            assertExistingTraining(app)
            assertReturningRequestsDidNotMutateSetup(app)
        }
    }

    func testFreshDeviceStateFailureRetriesWithoutOfferingNewAccountSetup() {
        let app = launch("activation-returning-retry")
        tap(app.buttons["Sign in with Apple"], in: app)
        let retry = app.buttons["onboarding.resolve.retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["onboarding.resolve.error"].exists)
        XCTAssertTrue(app.buttons["onboarding.resolve.signOut"].isHittable)
        XCTAssertFalse(app.buttons["Get started"].exists)
        XCTAssertFalse(app.buttons["setup.next"].exists)
        XCTAssertFalse(app.buttons["today.createWorkout"].exists)
        XCTAssertFalse(app.navigationBars["Today"].exists)
        assertReturningRequestsDidNotMutateSetup(app, minimumStateReads: 1)
        tap(retry, in: app)
        assertExistingTraining(app)
        assertReturningRequestsDidNotMutateSetup(app, minimumStateReads: 2)
    }

    func testFreshDeviceConfirmedEmptyAccountStillOffersSetup() {
        let app = launch("activation-manual")
        tap(app.buttons["Sign in with Apple"], in: app)
        XCTAssertTrue(app.buttons["Get started"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.navigationBars["Today"].exists)
        assertReturningRequestsDidNotMutateSetup(app)
        tap(app.buttons["Get started"], in: app)
        XCTAssertTrue(app.buttons["setup.next"].waitForExistence(timeout: UITestWait.screen))
    }

    private func assertExistingTraining(_ app: XCUIApplication,
                                        file: StaticString = #filePath, line: UInt = #line) {
        // iPadOS renders the tab strip outside an XCUI TabBar. The actual Today
        // navigation surface and server workout prove restoration on both sizes.
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: UITestWait.screen), file: file, line: line)
        XCTAssertTrue(app.staticTexts["Workout A"].waitForExistence(timeout: UITestWait.screen), file: file, line: line)
        XCTAssertFalse(app.buttons["Get started"].exists, file: file, line: line)
        XCTAssertFalse(app.buttons["setup.next"].exists, file: file, line: line)
        XCTAssertFalse(app.buttons["today.createWorkout"].exists, file: file, line: line)
    }

    private func assertReturningRequestsDidNotMutateSetup(_ app: XCUIApplication, minimumStateReads: Int = 1,
                                                          file: StaticString = #filePath, line: UInt = #line) {
        let evidence = app.staticTexts["fixture.scenario"]
        let observed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let counters = self.requestCounts(evidence)
            return counters["signIn"] == 1 && (counters["state"] ?? 0) >= minimumStateReads
        }, object: evidence)
        XCTAssertEqual(XCTWaiter.wait(for: [observed], timeout: UITestWait.screen), .completed, file: file, line: line)
        let counters = requestCounts(evidence)
        XCTAssertEqual(counters["profileWrites"], 0, file: file, line: line)
        XCTAssertEqual(counters["starterWrites"], 0, file: file, line: line)
        XCTAssertEqual(counters["workoutWrites"], 0, file: file, line: line)
    }

    private func requestCounts(_ evidence: XCUIElement) -> [String: Int] {
        Dictionary(uniqueKeysWithValues: (evidence.value as? String ?? "").split(separator: ";").compactMap { item in
            let pair = item.split(separator: ":")
            guard pair.count == 2, let value = Int(pair[1]) else { return nil }
            return (String(pair[0]), value)
        })
    }

    /// Setup is the member's own week, then their apps, and it ends on
    /// Today: no questionnaire, no ready-made workout, nothing started.
    func testSetupPlansTheWeekThenAppsAndLandsOnToday() {
        let app = launch("activation-manual")
        tap(app.buttons["Sign in with Apple"], in: app)
        tap(app.buttons["Get started"], in: app)
        XCTAssertTrue(app.staticTexts["Your usual week"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["trainingSetup.next"].exists, "No questionnaire")
        XCTAssertEqual(app.buttons["setup.next"].label, "Next, plan later")
        let monday = app.buttons["plan.week.mon"]
        XCTAssertTrue(monday.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(monday.label.contains("Rest"), monday.label)
        tap(monday, in: app)
        XCTAssertTrue(app.navigationBars["Monday"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["weekday.newActivity"], in: app)
        tap(app.buttons["composer.idea.Soccer"], in: app)
        XCTAssertTrue(app.navigationBars["Monday"].exists, "The composer opens in place on the day")
        app.openComposerWhen()
        XCTAssertTrue(app.buttons["composer.day.mon"].isSelected)
        tap(app.buttons["composer.save"], in: app)
        expectation(for: NSPredicate(format: "label CONTAINS 'Soccer'"), evaluatedWith: monday)
        waitForExpectations(timeout: UITestWait.screen)
        XCTAssertEqual(app.buttons["setup.next"].label, "Next")
        let week = XCTAttachment(screenshot: app.screenshot())
        week.name = "setup-usual-week"; week.lifetime = .keepAlways; add(week)

        // Review what was just scheduled without leaving setup or starting it.
        // The day sheet must finish dismissing before details pushes; its old
        // callback only dismissed the sheet and never opened this workout.
        tap(monday, in: app)
        tap(app.buttons["weekday.viewWorkout"], in: app)
        let details = app.navigationBars["Soccer"]
        XCTAssertTrue(details.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["workoutDetails.start"].exists)
        XCTAssertFalse(app.buttons["workoutDetails.schedule"].exists)
        tap(app.buttons["workoutDetails.edit"], in: app)
        let editor = app.navigationBars["Edit Soccer"]
        XCTAssertTrue(editor.waitForExistence(timeout: UITestWait.screen))
        tap(editor.buttons["Done"], in: app)
        XCTAssertTrue(details.waitForExistence(timeout: UITestWait.screen))
        tap(details.backButton, in: app)
        XCTAssertTrue(app.staticTexts["Your usual week"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(monday.label.contains("Soccer"), monday.label)
        tap(app.buttons["setup.next"], in: app)
        XCTAssertTrue(app.staticTexts["Connect your apps"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["connections.intervals"].exists)
        XCTAssertTrue(app.buttons["setup.coach"].exists)
        let apps = XCTAttachment(screenshot: app.screenshot())
        apps.name = "setup-connect-apps"; apps.lifetime = .keepAlways; add(apps)
        tap(app.buttons["setup.done"], in: app)
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["setup.next"].exists)
        XCTAssertFalse(app.buttons["LOG SET 1"].exists, "Setup never starts a workout")
        let counters = requestCounts(app.staticTexts["fixture.scenario"])
        XCTAssertEqual(counters["profileWrites"], 0)
        XCTAssertEqual(counters["starterWrites"], 0)
        XCTAssertEqual(counters["workoutWrites"], 1)
    }

    func testSetupKeepsPendingInviteAndCoachAheadOfIt() {
        let app = launch("activation-manual", pendingInvite: true)
        tap(app.buttons["Set up my coach"], in: app)
        tap(app.buttons["Sign in with Apple"], in: app)
        tap(app.buttons["Get started"], in: app)
        tap(app.buttons["Join Synthetic Crew"], in: app)
        XCTAssertTrue(app.navigationBars["Connect your coach"].waitForExistence(timeout: UITestWait.screen))
        tap(app.navigationBars["Connect your coach"].buttons["Done"], in: app)
        XCTAssertTrue(app.staticTexts["Your usual week"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["setup.skip"], in: app)
        // Joining showed the group; Today waits with the week still to plan.
        tap(app.tabBars.buttons["Today"], in: app)
        XCTAssertTrue(app.buttons["today.planWeek"].waitForExistence(timeout: UITestWait.screen))
    }

    func testCoachChosenDuringSetupOpensAfterSetupCloses() {
        let app = launch("activation-manual")
        tap(app.buttons["Sign in with Apple"], in: app)
        tap(app.buttons["Get started"], in: app)
        tap(app.buttons["setup.next"], in: app)
        // The Form can report this row as hittable behind the fixed footer.
        // Reveal it above Go to Today before testing the coach handoff.
        scrollAndTap(app.buttons["setup.coach"], in: app, above: app.buttons["setup.done"])
        XCTAssertTrue(app.navigationBars["Connect your coach"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.staticTexts["Connect your apps"].exists)
        tap(app.navigationBars["Connect your coach"].buttons["Done"], in: app)
        XCTAssertTrue(app.buttons["today.planWeek"].waitForExistence(timeout: UITestWait.screen))
    }

    func testEmptyTodayOpensComposerAndCancellingCreatesNoWorkout() {
        let app = launch("activation-manual")
        tap(app.buttons["Sign in with Apple"], in: app)
        onboard(app)
        tap(app.buttons["today.planWeek"], in: app)
        XCTAssertTrue(app.navigationBars["Add to your week"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["composer.kind.run"].isSelected)
        XCTAssertFalse(app.buttons["setup.next"].exists)
        tap(app.buttons["composer.cancel"], in: app)
        XCTAssertTrue(app.buttons["today.planWeek"].waitForExistence(timeout: UITestWait.screen))
        let counters = requestCounts(app.staticTexts["fixture.scenario"])
        XCTAssertEqual(counters["workoutWrites"], 0)
        XCTAssertEqual(counters["scheduleWrites"], 0)
    }

    func testEmptyLibraryOffersPlanningWithoutAReadyMadeWorkout() {
        for (fixture, starterUsed) in [("empty", false), ("empty-plan", false), ("empty-plan", true)] {
            let app = launch(fixture, starterUsed: starterUsed)
            XCTAssertTrue(app.buttons["today.planWeek"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertTrue(app.buttons["today.createWorkout"].isHittable)
            XCTAssertFalse(app.buttons["today.starterWorkout"].exists)
            app.terminate()
        }
    }

    func testOptionalWorkingSetCanBeSavedAndProfileRemainsEditable() {
        let app = launch("activation-manual")
        tap(app.buttons["Sign in with Apple"], in: app)
        onboard(app)
        tap(app.buttons["profile.open"].firstMatch, in: app)
        tap(app.buttons["profile.trainingProfile"], in: app)
        tap(app.buttons["trainingSetup.next"], in: app)
        tap(app.buttons["trainingSetup.next"], in: app)
        tap(app.buttons["trainingSetup.addBaseline"], in: app)
        tap(app.textFields["trainingSetup.baselineWeight"], in: app)
        app.textFields["trainingSetup.baselineWeight"].typeText("20")
        tap(app.buttons["trainingSetup.saveBaseline"], in: app)
        XCTAssertTrue(app.staticTexts["Goblet Squat"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["trainingSetup.next"], in: app)
        tap(app.buttons["profile.trainingProfile"], in: app)
        tap(app.buttons["trainingSetup.next"], in: app)
        tap(app.buttons["trainingSetup.next"], in: app)
        XCTAssertTrue(app.staticTexts["Goblet Squat"].waitForExistence(timeout: UITestWait.screen))
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "optional-working-set"; image.lifetime = .keepAlways; add(image)
    }

    func testInvitedEntrySurvivesSignInAndPreviewRetryThenCompletesWorkout() {
        let app = launch("activation-invite", retry: true)
        XCTAssertTrue(app.staticTexts["Your group invite is saved. Sign in to review it."].exists)
        tap(app.buttons["Sign in with Apple"], in: app)
        XCTAssertTrue(app.buttons["Sign in with Apple"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["Sign in with Apple"], in: app)
        let retry = app.buttons["Try again"]
        XCTAssertTrue(retry.waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["Get started"].exists)
        XCTAssertGreaterThanOrEqual(retry.frame.height, 44, "The retry button itself must own its full touch target")
        // Tap below the text, inside the button's expanded touch target.
        XCTAssertTrue(retry.isHittable)
        retry.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)).tap()
        tap(app.buttons["Join Synthetic Crew"], in: app)
        XCTAssertTrue(app.tabBars.buttons["Group"].isSelected)
        tap(app.tabBars.buttons["Today"], in: app)
        completeFirstWorkout(app)
    }

    func testReturningCoachIntentReachesCoachThenExistingWorkout() {
        let app = launch("activation-coach")
        tap(app.buttons["Set up my coach"], in: app)
        XCTAssertTrue(app.staticTexts["Sign in to continue setting up your coach."].exists)
        tap(app.buttons["Sign in with Apple"], in: app)
        XCTAssertTrue(app.navigationBars["Connect your coach"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["Get started"].exists)
        XCTAssertTrue(app.staticTexts["coach.connected-status"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["coach.data-sharing"].exists)
        tap(app.navigationBars["Connect your coach"].buttons["Done"], in: app)
        // Profile is behind the avatar; connecting another app from there
        // closes Profile so the setup sheet can show.
        tap(app.buttons["profile.open"].firstMatch, in: app)
        scrollAndTap(app.buttons["Connect another AI app"], in: app)
        XCTAssertTrue(app.navigationBars["Connect your coach"].waitForExistence(timeout: UITestWait.screen))
        tap(app.navigationBars["Connect your coach"].buttons["Done"], in: app)
        tap(app.tabBars.buttons["Today"], in: app)
        completeFirstWorkout(app)
    }

    func testInviteAndCoachChoicesAreDeliveredOnceInOrder() {
        let app = launch("activation-manual", pendingInvite: true)
        tap(app.buttons["Sign in with Apple"], in: app)
        tap(app.buttons["Get started"], in: app)
        tap(app.buttons["Join Synthetic Crew"], in: app)
        tap(app.buttons["setup.skip"], in: app)
        tap(app.tabBars.buttons["Today"], in: app)
        tap(app.buttons["Set up my coach"], in: app)
        XCTAssertTrue(app.navigationBars["Connect your coach"].waitForExistence(timeout: UITestWait.screen))
        tap(app.navigationBars["Connect your coach"].buttons["Done"], in: app)
        tap(app.tabBars.buttons["Group"], in: app)
        XCTAssertTrue(app.staticTexts["SYNTHETIC CREW"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["Join Synthetic Crew"].exists)
    }

    func testManualOnlyMemberBuildsAndCompletesFirstWorkout() {
        let app = launch("activation-manual")
        tap(app.buttons["Sign in with Apple"], in: app)
        onboard(app)
        tap(app.buttons["Create a workout"], in: app)
        XCTAssertTrue(app.navigationBars["Add exercises"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.textFields["createWorkout.name"].exists)
        tap(app.buttons["exercisePicker.exercise.synthetic-exercise"], in: app)
        tap(app.buttons["createWorkout.review"], in: app)
        tap(app.buttons["createWorkout.targets.synthetic-exercise"], in: app)
        let sets = app.textFields["createWorkout.target.sets"]
        XCTAssertTrue(sets.waitForExistence(timeout: UITestWait.screen))
        sets.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5)).tap()
        sets.typeText(XCUIKeyboardKey.delete.rawValue + "1")
        let enteredSets = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "1"), object: sets)
        XCTAssertEqual(XCTWaiter.wait(for: [enteredSets], timeout: UITestWait.screen), .completed,
                       "The complete set count must be applied before leaving the draft")
        tap(app.navigationBars["Barbell Squat"].backButton, in: app)
        tap(app.buttons["createWorkout.create"], in: app)
        XCTAssertTrue(app.navigationBars["Workout 1"].waitForExistence(timeout: UITestWait.screen))
        completeFirstWorkout(app)
        tap(app.buttons["profile.open"].firstMatch, in: app)
        tap(app.buttons.containing(.staticText, identifier: "Set up your AI coach").firstMatch, in: app)
        XCTAssertTrue(app.navigationBars["Connect your coach"].waitForExistence(timeout: UITestWait.screen))
    }

    func testCoachSetupConnectsClaudeAndReturnsToApproval() {
        let app = launch("activation-manual", captureLinks: true)
        tap(app.buttons["Sign in with Apple"], in: app)
        onboard(app)
        tap(app.buttons["Set up my coach"], in: app)
        XCTAssertTrue(app.staticTexts["coach.data-sharing"].label.contains("Anthropic"))
        XCTAssertTrue(app.staticTexts["coach.connection-title"].label.contains("Claude"))
        XCTAssertTrue(app.buttons["coach.app.claude"].isSelected)
        // Nothing that shares data is offered before explicit permission.
        XCTAssertFalse(app.buttons["coach.connect-claude"].exists)
        XCTAssertFalse(app.buttons["Use a connect code"].exists)
        let consentImage = XCTAttachment(screenshot: app.screenshot())
        consentImage.name = "coach-sharing-consent"; consentImage.lifetime = .keepAlways; add(consentImage)
        // The decision stays pinned on screen: Allow is reachable without scrolling.
        XCTAssertTrue(app.buttons["coach.consent-allow"].isHittable)
        // Claude's steps are listed before the member leaves for Claude.
        let firstStep = app.descendants(matching: .any).matching(identifier: "coach.next-step-1").firstMatch
        XCTAssertTrue(app.scroll(toReveal: firstStep))
        XCTAssertTrue(firstStep.label.contains("tap Add, then Connect"))
        // One tap allows sharing and opens Claude with a one-time connect link;
        // there is no second Connect step and no second approval.
        tap(app.buttons["coach.consent-allow"], in: app)
        let opened = app.staticTexts["fixture.opened-url"]
        XCTAssertTrue(opened.waitForExistence(timeout: UITestWait.screen))
        let parts = URLComponents(string: opened.label)!
        XCTAssertEqual(parts.host, "claude.ai")
        XCTAssertEqual(parts.path, "/customize/connectors")
        XCTAssertEqual(parts.queryItems?.first { $0.name == "connectorUrl" }?.value,
                       "https://ui-fixture.invalid/mcp/c/" + String(repeating: "C", count: 43))
        XCTAssertEqual(parts.queryItems?.first { $0.name == "connectorName" }?.value, "Très Fort")
        // Setup stays open and turns into the connected screen once Claude
        // has connected with the link.
        let connected = app.descendants(matching: .any).matching(identifier: "coach.connected-success").firstMatch
        XCTAssertTrue(connected.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["coach.connection-title"].label.contains("is connected"))
        let connectedImage = XCTAttachment(screenshot: app.screenshot())
        connectedImage.name = "coach-claude-connected"; connectedImage.lifetime = .keepAlways; add(connectedImage)
        // A spent or refused link falls back to the approval Claude sends back
        // through the real intent/presentation path. Close the connected setup
        // first: the simulated return sits underneath it. Approval replacing an
        // open setup is covered by the return-with-setup-open journey.
        tap(app.navigationBars["Connect your coach"].buttons["Done"], in: app)
        tap(app.buttons["fixture.coach-return"], in: app)
        XCTAssertTrue(app.staticTexts["Review AI access"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["coach-approval.continue"].exists)
        scrollAndTap(app.buttons["coach-approval.allow"], in: app)
        XCTAssertTrue(app.staticTexts["Access allowed"].waitForExistence(timeout: UITestWait.screen))
        // Allowing returns to the AI app without another tap.
        XCTAssertTrue(app.staticTexts["fixture.opened-url"].label.hasPrefix("https://client.example/callback"))
        tap(app.buttons["Done"], in: app)
    }

    func testCoachSetupSharesChatGPTAndKeepsDirectCodexAdvanced() {
        let app = launch("activation-manual")
        tap(app.buttons["Sign in with Apple"], in: app)
        onboard(app)
        tap(app.buttons["Set up my coach"], in: app)
        XCTAssertTrue(app.buttons["coach.app.claude"].exists)
        XCTAssertTrue(app.buttons["coach.app.chatgpt"].exists)
        XCTAssertTrue(app.buttons["coach.app.other"].exists)
        XCTAssertFalse(app.buttons["coach.app.codex"].exists)

        tap(app.buttons["coach.app.other"], in: app)
        XCTAssertTrue(app.staticTexts["coach.data-sharing"].label.contains("configured model provider"))
        tap(app.buttons["coach.app.chatgpt"], in: app)
        XCTAssertTrue(app.staticTexts["coach.connection-title"].label.contains("ChatGPT"))
        XCTAssertTrue(app.staticTexts["coach.chatgpt-shared-connection"].label.contains("ChatGPT and Codex"))
        XCTAssertTrue(app.staticTexts["coach.data-sharing"].label.contains("OpenAI"))
        let chatGPTImage = XCTAttachment(screenshot: app.screenshot())
        chatGPTImage.name = "coach-shared-chatgpt-connection"; chatGPTImage.lifetime = .keepAlways; add(chatGPTImage)
        // ChatGPT setup stays behind consent. The direct connection is hidden
        // until Advanced is expanded, even after sharing is allowed.
        let chatGPTSteps = app.descendants(matching: .any).matching(identifier: "coach.chatgpt-steps").firstMatch
        XCTAssertFalse(chatGPTSteps.exists)
        XCTAssertFalse(app.buttons["coach.direct-codex"].exists)
        scrollAndTap(app.buttons["coach.consent-allow"], in: app)
        XCTAssertTrue(chatGPTSteps.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(chatGPTSteps.label.contains("Continue with Apple"))
        XCTAssertFalse(app.buttons["coach.direct-codex"].exists)
        scrollAndTap(app.buttons["Advanced"], in: app)
        scrollAndTap(app.buttons["coach.direct-codex"], in: app)
        // ChatGPT consent must not authorize a separately configured model
        // provider in the direct Codex route.
        let codexDisclosure = app.staticTexts["coach.data-sharing"]
        XCTAssertTrue(codexDisclosure.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(codexDisclosure.label.contains("other model provider"))
        XCTAssertTrue(app.buttons["coach.consent-allow"].isHittable)
        XCTAssertFalse(app.buttons["coach.codex-setup"].exists)
        scrollAndTap(app.buttons["coach.consent-allow"], in: app)
        XCTAssertFalse(app.buttons["coach.generate-code"].exists)
        tap(app.buttons["coach.codex-setup"], in: app)
        XCTAssertTrue(app.buttons["coach.codex-setup"].label.contains("Copied"))
        XCTAssertTrue(app.staticTexts["coach.codex-mobile-limit"].label.contains("computer"))
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "codex-guided-coach-setup"; image.lifetime = .keepAlways; add(image)
        scrollAndTap(app.buttons["Manual setup"], in: app)
        scrollAndTap(app.buttons.containing(.staticText, identifier: "URL").firstMatch, in: app)
        XCTAssertTrue(app.staticTexts["https://ui-fixture.invalid/mcp"].exists)
        XCTAssertFalse(app.staticTexts["codex mcp login tres-fort"].exists)
        scrollAndTap(app.buttons["Command-line setup"], in: app)
        scrollAndTap(app.buttons.containing(.staticText, identifier: "Sign in").firstMatch, in: app)
        XCTAssertTrue(app.staticTexts["codex mcp login tres-fort"].exists)

        // The normal setup still presents one ChatGPT choice on reopening.
        tap(app.navigationBars["Connect your coach"].buttons["Done"], in: app)
        tap(app.tabBars.buttons["Today"], in: app)
        tap(app.buttons["Set up my coach"], in: app)
        XCTAssertTrue(app.navigationBars["Connect your coach"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["coach.app.chatgpt"], in: app)
        XCTAssertTrue(app.staticTexts["coach.connection-title"].label.contains("ChatGPT"))
        XCTAssertTrue(app.staticTexts["coach.data-sharing"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts["coach.data-sharing"].label.contains("OpenAI"))
        XCTAssertFalse(app.buttons["coach.app.codex"].exists)
        XCTAssertFalse(chatGPTSteps.exists)
        scrollAndTap(app.buttons["coach.consent-allow"], in: app)
        XCTAssertTrue(chatGPTSteps.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(chatGPTSteps.label.contains("Continue with Apple"))
    }

    func testIncomingCoachApprovalReplacesOpenSetup() {
        for entry in ["Today", "Profile"] {
            let app = launch("activation-manual", returnWithSetupOpen: true)
            tap(app.buttons["Sign in with Apple"], in: app)
            onboard(app)
            if entry == "Profile" {
                tap(app.buttons["profile.open"].firstMatch, in: app)
                scrollAndTap(app.buttons.containing(.staticText, identifier: "Set up your AI coach").firstMatch, in: app)
            } else {
                tap(app.buttons["Set up my coach"], in: app)
            }
            XCTAssertTrue(app.navigationBars["Connect your coach"].waitForExistence(timeout: UITestWait.screen))
            // Pressing and holding Allow copies the setup link instead of
            // opening Claude, and keeps setup open with Connect with Claude.
            XCTAssertTrue(app.buttons["coach.consent-allow"].waitForExistence(timeout: UITestWait.screen))
            app.buttons["coach.consent-allow"].press(forDuration: 1.2)
            tap(app.buttons["Allow and copy setup link"], in: app)
            XCTAssertTrue(app.buttons["coach.connect-claude"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertTrue(app.navigationBars["Connect your coach"].exists)
            let claudeImage = XCTAttachment(screenshot: app.screenshot())
            claudeImage.name = "claude-direct-coach-setup"; claudeImage.lifetime = .keepAlways; add(claudeImage)
            // The fixture uses this action to deliver an incoming approval without
            // accepting the outbound URL, preserving the copied-link setup state.
            tap(app.buttons["coach.connect-claude"], in: app)
            XCTAssertTrue(app.staticTexts["Review AI access"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertFalse(app.navigationBars["Connect your coach"].exists)
            XCTAssertFalse(app.buttons["coach-approval.continue"].exists)
            scrollAndTap(app.buttons["coach-approval.allow"], in: app)
            XCTAssertTrue(app.staticTexts["Access allowed"].waitForExistence(timeout: UITestWait.screen))
            tap(app.buttons["Done"], in: app)
            XCTAssertFalse(app.navigationBars["Connect your coach"].exists)
            app.terminate()
        }
    }

    func testEmptyTodayOffersCoachSetupDirectly() {
        let app = launch("activation-manual")
        tap(app.buttons["Sign in with Apple"], in: app)
        onboard(app)
        XCTAssertTrue(app.buttons["Create a workout"].waitForExistence(timeout: UITestWait.screen))
        tap(app.buttons["Set up my coach"], in: app)
        XCTAssertTrue(app.navigationBars["Connect your coach"].waitForExistence(timeout: UITestWait.screen))
        scrollAndTap(app.buttons["coach.consent-allow"], in: app)
        XCTAssertTrue(app.buttons["coach.connect-claude"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.buttons["coach.connect-claude"].isHittable)
        scrollAndTap(app.buttons["Use a connect code"], in: app)
        scrollAndTap(app.buttons["coach.generate-code"], in: app)
        let regenerate = app.buttons["coach.generate-code"]
        // The generated-code row pushes this control below the viewport.
        for _ in 0..<5 where !regenerate.exists || !regenerate.isHittable { app.swipeUp() }
        XCTAssertTrue(regenerate.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(regenerate.label.contains("Generate a new code"))
    }

    func testColdAndCachedEmptyFailuresOfferRecoveryWithoutCreation() {
        for fixture in ["load-failure", "cached-empty"] {
            let app = launch(fixture)
            XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: UITestWait.screen))
            XCTAssertFalse(app.staticTexts["Your first workout"].exists)
            XCTAssertFalse(app.buttons["Create a workout"].exists)
            tap(app.buttons["Try again"], in: app)
            XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: UITestWait.screen))
            if fixture == "load-failure" {
                XCTAssertTrue(app.staticTexts["Couldn’t load your plan"].waitForExistence(timeout: UITestWait.screen))
            }
            app.terminate()
        }
        let cached = launch("cached-plan")
        XCTAssertFalse(cached.staticTexts["NO PLAN YET"].exists)
        XCTAssertFalse(cached.buttons["Create a workout"].exists)
    }

    func testServerFailureRetryCanVerifyAnEmptyAccount() {
        let app = launch("server-failure")
        XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: UITestWait.screen))
        XCTAssertFalse(app.buttons["Create a workout"].exists)
        tap(app.buttons["Try again"], in: app)
        XCTAssertTrue(app.buttons["Create a workout"].waitForExistence(timeout: UITestWait.screen))
    }

}
