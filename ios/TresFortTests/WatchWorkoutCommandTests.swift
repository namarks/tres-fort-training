import XCTest
@testable import TresFort

private final class WatchCommandTokenStore: AppTokenStore {
    var token: String?
    init(_ token: String) { self.token = token }
    func save(_ token: String) { self.token = token }
    func load() -> String? { token }
    func clear() { token = nil }
}

private final class WatchCommandClock {
    var now = Date(timeIntervalSince1970: 2_000_000_000)
}

/// A gym without signal: every set waits in the iPhone's queue.
@MainActor
private final class WatchOfflineSetWrites: SetWriteAPI {
    func createSession(date: String, workoutID: String?, jwt: String) async throws -> SessionRow {
        throw URLError(.notConnectedToInternet)
    }

    func logSet(sessionId: String, body: SetRequestBody, jwt: String) async throws -> APIClient.SetLogResult {
        throw URLError(.notConnectedToInternet)
    }

    func deleteSet(setId: String, jwt: String) async throws {
        throw URLError(.notConnectedToInternet)
    }

    func getState(jwt: String) async throws -> StateResponse {
        throw URLError(.notConnectedToInternet)
    }
}

@MainActor
private final class WatchWorkoutRecorder: WatchWorkoutPublishing {
    private(set) var published: [WatchWorkoutState?] = []
    var onWorkoutCommand: ((WatchWorkoutCommand) async -> WatchWorkoutReceipt)?
    func publishWorkout(_ state: WatchWorkoutState?) { published.append(state) }
}

/// Taps on the Apple Watch reach the iPhone's own runner through the
/// guarded commands a linked iPad uses, and only for the set the Watch
/// showed (docs/plans/apple-watch P5). The iPhone logs every set.
@MainActor
final class WatchWorkoutCommandTests: XCTestCase {
    private let clock = WatchCommandClock()
    private var retainedAuth: [AuthModel] = []

    private var today: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: clock.now)
    }

    private func jwt(subject: String) -> String {
        func base64URL(_ data: Data) -> String {
            data.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        let header = try! JSONSerialization.data(withJSONObject: ["alg": "HS256"])
        let payload = try! JSONSerialization.data(withJSONObject: ["exp": 4_000_000_000, "sub": subject])
        return "\(base64URL(header)).\(base64URL(payload)).signature"
    }

    private func slot(_ id: String, order: Int = 0, timed: Bool = false, unit: String = "lb",
                      exerciseID: String? = nil) -> TemplateExercise {
        TemplateExercise(id: id, exercise_id: exerciseID ?? "exercise-\(id)", exercise_name: timed ? "Plank" : "Exercise \(id)",
            exercise_unit: "lb", order_index: order, target_sets: 3, target_reps: timed ? 30 : 5,
            target_reps_max: nil, target_rpe: nil, rest_seconds: 90, target_weight: timed ? 0 : 20,
            cues: nil, exercise_modality: timed ? "timed" : "barbell", exercise_laterality: "bilateral",
            exercise_load_mode: "total", exercise_demo_slug: nil, target_duration_s: timed ? 30 : nil,
            is_warmup: 0, target_weight_unit: unit, group_id: nil, group_rest_seconds: nil,
            group_transition_seconds: nil)
    }

    /// The iPhone's runner for today's workout, offline.
    private func runner(_ slots: [TemplateExercise], start: Bool = true) -> SyncModel {
        let suite = "WatchWorkoutCommandTests.\(UUID().uuidString)"
        let defaults = LocalPersistence(suiteName: suite)!
        addTeardownBlock { [preferences = defaults.preferences, directory = defaults.trainingStore.directory] in
            preferences.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        defaults.set("watch-user", forKey: AuthModel.userIDKey)
        let clock = self.clock
        let auth = AuthModel(tokenStore: WatchCommandTokenStore(jwt(subject: "watch-user")), defaults: defaults,
                             now: { clock.now })
        retainedAuth.append(auth)
        let sync = SyncModel(auth: auth, setWriteAPI: WatchOfflineSetWrites(), defaults: defaults,
                             now: { clock.now },
                             restActivityUpdater: { _, _ in }, restActivityEnder: {},
                             timedCuePlayer: { _, _ in false }, timedCueFinisher: { _, _ in true },
                             restNotificationCanceller: {})
        let workout = Workout(id: "day", name: "Strength", day_label: "A", order_index: 0, exercises: slots)
        sync.replaceState(with: StateResponse(
            plan: PlanTree(id: "plan", name: "Plan", version: 1, workouts: [workout], meta: nil),
            plan_version: 1,
            sessions: [SessionRow(id: "session", date: today, status: "in_progress", workout_id: "day", attempt: 0)],
            sets: [], external_events: [], external_activities: [], activities: [],
            server_time: 2_000_000_000_000, planGroupsVersion: 1))
        if start { sync.startWorkout() }
        return sync
    }

    /// What the Watch shows, with loads in the iPhone's display unit.
    private func shown(_ sync: SyncModel, in unit: WeightUnit = .lb) throws -> WatchWorkoutState {
        try XCTUnwrap(sync.watchWorkoutState(displayUnit: unit))
    }

    private func tap(_ action: WatchWorkoutCommand.Action, on state: WatchWorkoutState, weight: Double? = nil,
                     reps: Int? = nil, seconds: Int? = nil) -> WatchWorkoutCommand {
        WatchWorkoutCommand(id: UUID(), action: action, token: state.token, weight: weight, reps: reps,
                            durationSeconds: seconds)
    }

    private func apply(_ command: WatchWorkoutCommand, to sync: SyncModel,
                       in unit: WeightUnit = .lb) async -> WatchWorkoutReceipt {
        await WatchWorkoutCommandRunner.apply(command, to: sync, displayUnit: unit)
    }

    /// Waits until the queued set's background task releases its slot, so
    /// the next set can be logged.
    private func settle(_ sync: SyncModel) async {
        let deadline = Date().addingTimeInterval(10)
        while !sync.setSlotsInFlight.isEmpty, Date() < deadline {
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTAssertTrue(sync.setSlotsInFlight.isEmpty, "The queued set never released its slot")
    }

    func testATapLogsTheSetTheWatchShowedAndOnlyOnce() async throws {
        let sync = runner([slot("squat"), slot("row", order: 1)])
        let first = try shown(sync)
        XCTAssertEqual(first.phase, .ready)
        XCTAssertEqual(first.date, sync.todayString)
        XCTAssertEqual(first.set?.position, "Set 1 of 3")
        XCTAssertEqual(first.set?.weight, 20)

        let log = tap(.logSet, on: first)
        let logged = await apply(log, to: sync)
        XCTAssertTrue(logged.accepted)
        XCTAssertEqual(logged.id, log.id)
        XCTAssertEqual(sync.setOutbox.pending.map(\.body.set_index), [1], "the iPhone queued the set itself")
        XCTAssertNotNil(sync.restEndDate, "rest starts as after a tap on the iPhone")
        XCTAssertEqual(logged.state?.phase, .rest, "the answer says what the runner shows now")
        XCTAssertEqual(logged.state?.set?.position, "Set 2 of 3")
        XCTAssertEqual(logged.state?.restEndDate, sync.restEndDate)
        await settle(sync)

        // The same tap again, late: it names set 1, which is done.
        let repeated = await apply(log, to: sync)
        XCTAssertFalse(repeated.accepted)
        XCTAssertEqual(repeated.message, StationLinkCommandReceipt.movedOn)
        XCTAssertEqual(repeated.state?.set?.position, "Set 2 of 3", "a refusal brings the current set")
        XCTAssertEqual(sync.setOutbox.pending.count, 1, "a repeated tap never logs another set")
    }

    func testCrownChangesTravelWithTheLogInTheShownUnit() async throws {
        let sync = runner([slot("squat", unit: "kg")])
        // This iPhone shows pounds, so the Watch does too.
        let first = try shown(sync)
        XCTAssertEqual(first.set?.weightUnit, "lb")
        XCTAssertEqual(try XCTUnwrap(first.set?.weight), WeightUnit.kg.convert(20, to: .lb), accuracy: 0.000_001)

        // Only the reps changed: the load stays exactly 20 kg.
        let more = await apply(tap(.logSet, on: first, reps: 8), to: sync)
        XCTAssertTrue(more.accepted)
        var body = try XCTUnwrap(sync.setOutbox.pending.last?.body)
        XCTAssertEqual(body.weight, 20)
        XCTAssertEqual(body.weight_unit, "kg")
        XCTAssertEqual(body.reps, 8)
        await settle(sync)

        // A heavier load from the crown, in pounds, is logged in the slot's unit.
        let second = try shown(sync)
        let heavier = await apply(tap(.logSet, on: second, weight: 50), to: sync)
        XCTAssertTrue(heavier.accepted)
        body = try XCTUnwrap(sync.setOutbox.pending.last?.body)
        XCTAssertEqual(body.set_index, 2)
        XCTAssertEqual(body.weight, WeightUnit.lb.convert(50, to: .kg), accuracy: 0.000_001)
        XCTAssertEqual(body.weight_unit, "kg")
    }

    func testEndRestEndsTheRestAndKeepsTheSetInPlace() async throws {
        let sync = runner([slot("squat")])
        _ = await apply(tap(.logSet, on: try shown(sync)), to: sync)
        await settle(sync)
        let resting = try shown(sync)
        XCTAssertEqual(resting.phase, .rest)

        let ended = await apply(tap(.endRest, on: resting), to: sync)
        XCTAssertTrue(ended.accepted)
        XCTAssertNil(sync.restEndDate)
        XCTAssertEqual(ended.state?.phase, .ready)
        XCTAssertEqual(ended.state?.token, resting.token, "the rest and its set are one place")
        XCTAssertEqual(sync.setOutbox.pending.count, 1, "ending a rest logs nothing")

        let again = await apply(tap(.endRest, on: resting), to: sync)
        XCTAssertTrue(again.accepted, "a rest that already ended stays ended")
    }

    func testTheSetLogsAfterARestTheIPhoneHasNotEndedYet() async throws {
        let sync = runner([slot("squat")])
        _ = await apply(tap(.logSet, on: try shown(sync)), to: sync)
        await settle(sync)
        // The rest ran out on the Watch's clock while the iPhone slept: its
        // rest is still open when the tap for the next set arrives.
        let resting = try shown(sync)
        XCTAssertEqual(resting.phase, .rest)
        XCTAssertNotNil(sync.restEndDate)

        let next = await apply(tap(.logSet, on: resting, reps: 4), to: sync)
        XCTAssertTrue(next.accepted)
        XCTAssertEqual(sync.setOutbox.pending.map(\.body.set_index), [1, 2])
        XCTAssertEqual(sync.setOutbox.pending.last?.body.reps, 4)
        XCTAssertEqual(next.state?.set?.position, "Set 3 of 3")
    }

    func testATimedSetStartsWithTheCrownsTimeAndStopsOnceItHasRun() async throws {
        let sync = runner([slot("plank", timed: true), slot("row", order: 1)])
        let ready = try shown(sync)
        XCTAssertEqual(ready.set?.durationSeconds, 30)
        XCTAssertEqual(ready.set?.showsLoad, false)

        let started = await apply(tap(.startTimer, on: ready, seconds: 40), to: sync)
        XCTAssertTrue(started.accepted)
        XCTAssertTrue(sync.timedActive)
        let running = try XCTUnwrap(started.state)
        XCTAssertEqual(running.phase, .active)
        XCTAssertEqual(running.set?.durationSeconds, 40)
        XCTAssertNotNil(running.timedStartDate)

        let early = await apply(tap(.stopTimer, on: running), to: sync)
        XCTAssertEqual(early.message, "Let the timer run a few seconds before stopping it.")
        XCTAssertTrue(sync.timedActive)
        let stale = await apply(tap(.stopTimer, on: ready), to: sync)
        XCTAssertEqual(stale.message, StationLinkCommandReceipt.movedOn, "the Watch showed the set before it started")

        clock.now = clock.now.addingTimeInterval(10)
        let stopped = await apply(tap(.stopTimer, on: running), to: sync)
        XCTAssertTrue(stopped.accepted)
        XCTAssertFalse(sync.timedActive)
        XCTAssertEqual(sync.setOutbox.pending.map(\.body.duration_s), [10], "the hold logs as long as it ran")
    }

    func testStopForAHoldCancelledOnTheIPhoneNeverStopsTheNextOne() async throws {
        let sync = runner([slot("plank", timed: true)])
        let started = await apply(tap(.startTimer, on: try shown(sync)), to: sync)
        let first = try XCTUnwrap(started.state)
        XCTAssertEqual(first.phase, .active)

        // The member cancels that hold on the iPhone and starts it again a
        // little later, with the same values. The Watch still shows the
        // first one.
        _ = sync.cancelTimedSet(controlID: try XCTUnwrap(sync.timedControlID))
        XCTAssertFalse(sync.timedActive)
        clock.now = clock.now.addingTimeInterval(20)
        let again = await apply(tap(.startTimer, on: try shown(sync)), to: sync)
        let second = try XCTUnwrap(again.state)
        XCTAssertEqual(second.phase, .active)
        XCTAssertEqual(second.set, first.set)
        XCTAssertNotEqual(second.token, first.token)

        clock.now = clock.now.addingTimeInterval(10)
        let stale = await apply(tap(.stopTimer, on: first), to: sync)
        XCTAssertEqual(stale.message, StationLinkCommandReceipt.movedOn)
        XCTAssertTrue(sync.timedActive, "the hold the Watch never showed keeps running")
        XCTAssertTrue(sync.setOutbox.pending.isEmpty)

        let stopped = await apply(tap(.stopTimer, on: second), to: sync)
        XCTAssertTrue(stopped.accepted)
        XCTAssertEqual(sync.setOutbox.pending.map(\.body.duration_s), [10])
    }

    func testValuesChangedOnTheIPhoneRefuseTheTapAndComeBack() async throws {
        let sync = runner([slot("squat")])
        let onWatch = try shown(sync)
        // The member changes the set on the iPhone before the Watch hears.
        sync.setReps(8)
        sync.setWeight(25)

        let log = await apply(tap(.logSet, on: onWatch), to: sync)
        XCTAssertFalse(log.accepted)
        XCTAssertEqual(log.message, StationLinkCommandReceipt.movedOn)
        XCTAssertTrue(sync.setOutbox.pending.isEmpty, "nothing logs with values the Watch didn't show")
        XCTAssertEqual(log.state?.set?.reps, 8)
        XCTAssertEqual(log.state?.set?.weight, 25)

        let current = await apply(tap(.logSet, on: try XCTUnwrap(log.state)), to: sync)
        XCTAssertTrue(current.accepted)
        XCTAssertEqual(sync.setOutbox.pending.map(\.body.reps), [8])
        XCTAssertEqual(sync.setOutbox.pending.map(\.body.weight), [25])
    }

    func testATapForAnEarlierRunOfTheWorkoutIsRefused() async throws {
        let sync = runner([slot("squat")])
        let earlier = try shown(sync)
        // The member discards the workout on the iPhone and starts it again
        // a minute later: the same first set with the same values, in
        // another run. The Watch's tap was for the one that is gone.
        sync.workoutStart = clock.now.addingTimeInterval(60)
        let restarted = try shown(sync)
        XCTAssertEqual(restarted.set, earlier.set)
        XCTAssertNotEqual(restarted.token, earlier.token)

        let late = await apply(tap(.logSet, on: earlier), to: sync)
        XCTAssertFalse(late.accepted)
        XCTAssertEqual(late.message, StationLinkCommandReceipt.movedOn)
        XCTAssertTrue(sync.setOutbox.pending.isEmpty, "nothing logs into the run the Watch never showed")
        XCTAssertEqual(late.state?.token, restarted.token, "the refusal brings the new run")

        let current = await apply(tap(.logSet, on: restarted), to: sync)
        XCTAssertTrue(current.accepted)
        XCTAssertEqual(sync.setOutbox.pending.count, 1)
    }

    func testASetWhoseLoadIsNotChosenNeedsOneFromTheCrown() async throws {
        let sync = runner([slot("squat")])
        sync.clearWeightChoice()
        let unchosen = try shown(sync)
        XCTAssertEqual(unchosen.set?.needsWeight, true)
        XCTAssertNil(unchosen.set?.weight)

        let bare = await apply(tap(.logSet, on: unchosen), to: sync)
        XCTAssertEqual(bare.message, WatchWorkoutCommandRunner.chooseWeight)
        XCTAssertTrue(sync.setOutbox.pending.isEmpty)
        XCTAssertTrue(sync.runnerNeedsWeight, "a refused tap chooses nothing")

        let chosen = await apply(tap(.logSet, on: unchosen, weight: 45), to: sync)
        XCTAssertTrue(chosen.accepted)
        XCTAssertEqual(sync.setOutbox.pending.map(\.body.weight), [45])
    }

    // MARK: Start from the wrist

    /// Today as the Watch shows it.
    private func day(_ sync: SyncModel) -> WatchDaySnapshot {
        sync.watchDaySnapshot(agenda: TrainingAgendaSnapshot(days: []))
    }

    private func start(_ rowID: String, on date: String) -> WatchWorkoutCommand {
        WatchWorkoutCommand(id: UUID(), action: .start,
                            token: WatchWorkoutPresentation.startToken(date: date, rowID: rowID))
    }

    func testStartOnTheWristOpensTheDaysWorkoutOnTheRunner() async throws {
        let sync = runner([slot("squat")], start: false)
        let shownDay = day(sync)
        let lead = try XCTUnwrap(shownDay.rows.first { $0.state == .next })
        XCTAssertEqual(lead.title, "Strength")
        XCTAssertNotNil(lead.startTitle, "the leading lifting workout can start from the wrist")
        XCTAssertFalse(sync.running)

        let receipt = await apply(start(lead.id, on: shownDay.date), to: sync)
        XCTAssertTrue(receipt.accepted, receipt.message ?? "")
        XCTAssertTrue(sync.running)
        let first = try XCTUnwrap(receipt.state, "the answer brings the first set")
        XCTAssertEqual(first.phase, .ready)
        XCTAssertEqual(first.set?.exerciseName, "Exercise squat")
        XCTAssertEqual(first.set?.position, "Set 1 of 3")
        XCTAssertNil(day(sync).rows.first { $0.state == .next }?.startTitle,
                     "an open workout offers no Start")

        // The answer was lost and the wearer taps Start again: the runner is
        // already open, so the Watch gets what it shows and nothing restarts.
        let started = sync.workoutStart
        let again = await apply(start(lead.id, on: shownDay.date), to: sync)
        XCTAssertTrue(again.accepted)
        XCTAssertEqual(again.state?.token, first.token)
        XCTAssertEqual(sync.workoutStart, started)

        // The set then logs from the wrist as in any workout.
        let logged = await apply(tap(.logSet, on: first), to: sync)
        XCTAssertTrue(logged.accepted)
        XCTAssertEqual(sync.setOutbox.pending.count, 1)
    }

    func testStartForADayOrRowTheIPhoneNoLongerShowsIsRefused() async throws {
        let sync = runner([slot("squat")], start: false)
        let shownDay = day(sync)
        let lead = try XCTUnwrap(shownDay.rows.first { $0.state == .next })

        // Yesterday's list, still on the Watch after midnight.
        let stale = start(lead.id, on: "2000-01-01")
        let late = await apply(stale, to: sync)
        XCTAssertEqual(late, .refused(stale, WatchWorkoutCommandRunner.dayChanged))

        let gone = start("session:gone", on: shownDay.date)
        let missing = await apply(gone, to: sync)
        XCTAssertEqual(missing, .refused(gone, WatchWorkoutCommandRunner.dayChanged))
        XCTAssertFalse(sync.running, "a refused Start opens nothing")
    }

    func testARunOffersNoStartOnTheWristAndIsRefusedIfAsked() async throws {
        let sync = runner([slot("run", exerciseID: RunPlan.exerciseID)], start: false)
        let shownDay = day(sync)
        let lead = try XCTUnwrap(shownDay.rows.first { $0.state == .next })
        XCTAssertNil(lead.startTitle, "a run starts on the iPhone's recorder")

        let asked = start(lead.id, on: shownDay.date)
        let refused = await apply(asked, to: sync)
        XCTAssertEqual(refused, .refused(asked, WatchWorkoutCommandRunner.startOnPhone))
        XCTAssertFalse(sync.running)
    }

    func testAnIPhoneWithoutAnOpenWorkoutShowsNoneAndTakesNoTaps() async {
        let sync = runner([slot("squat")], start: false)
        XCTAssertNil(sync.watchWorkoutState(displayUnit: .lb))
        let command = WatchWorkoutCommand(id: UUID(), action: .logSet, token: "anything")
        let refused = await apply(command, to: sync)
        XCTAssertEqual(refused, .refused(command, StationLinkCommandReceipt.openWorkout))
        XCTAssertTrue(sync.setOutbox.pending.isEmpty)
    }

    func testThePublisherFollowsTheRunnerAnswersTapsAndStopsAtSignOut() async throws {
        let sync = runner([slot("squat")])
        let auth = try XCTUnwrap(retainedAuth.last)
        let watch = WatchWorkoutRecorder()
        let suite = "WatchWorkoutCommandTests.settings.\(UUID().uuidString)"
        let settings = try XCTUnwrap(UserDefaults(suiteName: suite))
        addTeardownBlock { settings.removePersistentDomain(forName: suite) }
        let publisher = WatchWorkoutPublisher(sync: sync, auth: auth, watch: watch, settings: settings)

        publisher.refresh()
        let first = try XCTUnwrap(watch.published.last ?? nil)
        XCTAssertEqual(first, try shown(sync))

        // A tap from the Watch reaches this account's runner.
        let answer = try XCTUnwrap(watch.onWorkoutCommand)
        let logged = await answer(tap(.logSet, on: first))
        XCTAssertTrue(logged.accepted)
        XCTAssertEqual(sync.setOutbox.pending.count, 1)
        XCTAssertEqual(watch.published.last ?? nil, logged.state, "the context carries the same state as the answer")

        auth.signOut()
        XCTAssertTrue(publisher.isRetired)
        XCTAssertEqual(watch.published.last, .some(nil), "the workout leaves the wrist with the account")
        let count = watch.published.count
        publisher.refresh()
        XCTAssertEqual(watch.published.count, count, "a retired publisher never sends again")
        let late = WatchWorkoutCommand(id: UUID(), action: .logSet, token: first.token)
        let refused = await answer(late)
        XCTAssertEqual(refused, .refused(late, StationLinkCommandReceipt.openWorkout))
        XCTAssertEqual(sync.setOutbox.pending.count, 1)
    }
}
