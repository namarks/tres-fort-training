import XCTest
@testable import TresFort

/// Lifting from the wrist (docs/plans/apple-watch P5): what the iPhone
/// words for the Watch, what the Watch shows and sends for it, and how the
/// workout travels beside the day.
@MainActor
final class WatchWorkoutTests: XCTestCase {
    private let today = "2026-11-22"
    private let now = Date(timeIntervalSince1970: 2_000_000_000)
    /// One run of one workout: its place in the day and when it started.
    private let run = "2026-11-22#0#2000000000"

    private func step(set: Int = 2, weight: Double? = 225, reps: Int? = 5, seconds: Int? = nil,
                      unit: WeightUnit = .lb, bodyweight: Bool = false, perHand: Bool = false,
                      unilateral: Bool = false, warmup: Bool = false, group: String? = nil,
                      needsWeight: Bool? = nil, targetRPE: Double? = nil) -> WorkoutDisplayState.Step {
        WorkoutDisplayState.Step(
            slotID: "squat", exerciseName: "Back squat", weight: weight, weightUnit: unit, reps: reps,
            durationSeconds: seconds, setNumber: set, totalSets: 3, exerciseNumber: 1, totalExercises: 2,
            isWarmup: warmup, isBodyweight: bodyweight, isUnilateral: unilateral, isPerHand: perHand,
            groupTitle: group, roundNumber: group == nil ? nil : 2, totalRounds: group == nil ? nil : 3,
            rpe: nil, targetRPE: targetRPE, needsWeight: needsWeight)
    }

    private func display(_ phase: WorkoutDisplayState.Phase, _ step: WorkoutDisplayState.Step?,
                         restEnd: Date? = nil, timedStart: Date? = nil, timedEnd: Date? = nil,
                         message: String? = nil) -> WorkoutDisplayState {
        WorkoutDisplayState(phase: phase, workoutName: "Lower Body", current: step, next: nil,
                            restEndDate: restEnd, timedEndDate: timedEnd, timedStartDate: timedStart,
                            workoutStartDate: nil, message: message, isFreestyle: false)
    }

    private func state(_ phase: WorkoutDisplayState.Phase = .ready, _ step: WorkoutDisplayState.Step? = nil,
                       restEnd: Date? = nil) -> WatchWorkoutState {
        WatchWorkoutBuilder.state(display(phase, step ?? self.step(), restEnd: restEnd), date: today, run: run)
    }

    private func day() -> WatchDaySnapshot {
        WatchDaySnapshot(date: today, rows: [], emptyTitle: "Rest day", emptyDetail: nil, upcoming: [])
    }

    // MARK: what the iPhone words for the wrist

    func testTheSetIsWordedAsTheRunnerShowsIt() throws {
        let shown = state(.ready, step(targetRPE: 8))
        XCTAssertEqual(shown.date, today)
        XCTAssertEqual(shown.phase, .ready)
        XCTAssertEqual(shown.workoutName, "Lower Body")
        let set = try XCTUnwrap(shown.set)
        XCTAssertEqual(set.exerciseName, "Back squat")
        XCTAssertEqual(set.position, "Set 2 of 3")
        XCTAssertTrue(set.showsLoad)
        XCTAssertEqual(set.weight, 225)
        XCTAssertEqual(set.weightUnit, "lb")
        XCTAssertEqual(set.weightStep, 5, "the runner's small step in pounds")
        XCTAssertEqual(set.reps, 5)
        XCTAssertEqual(set.effort, "Target RPE 8")
        XCTAssertFalse(set.isTimed)
        XCTAssertNil(shown.title)

        XCTAssertEqual(WatchWorkoutBuilder.set(step(unit: .kg)).weightStep, 2.5)
        XCTAssertEqual(WatchWorkoutBuilder.set(step(warmup: true)).position, "Warm-up · Set 2 of 3")
        XCTAssertEqual(WatchWorkoutBuilder.set(step(group: "Superset A")).position, "Superset A · Round 2 of 3")
    }

    func testALoadNotChosenYetAndASetWithNoLoadAreToldApart() {
        let unchosen = WatchWorkoutBuilder.set(step(weight: nil, needsWeight: true))
        XCTAssertTrue(unchosen.showsLoad)
        XCTAssertNil(unchosen.weight)
        XCTAssertTrue(unchosen.needsWeight)

        let row = WatchWorkoutBuilder.set(step(weight: nil, reps: nil, seconds: 300))
        XCTAssertFalse(row.showsLoad, "a set with no load control shows none")
        XCTAssertFalse(row.needsWeight)
        XCTAssertTrue(row.isTimed)

        let plank = WatchWorkoutBuilder.set(step(weight: 0, reps: nil, seconds: 45))
        XCTAssertFalse(plank.showsLoad, "a hold with no load shows its time alone")
        XCTAssertNil(plank.weight)
        let weighted = WatchWorkoutBuilder.set(step(weight: 25, reps: nil, seconds: 45))
        XCTAssertTrue(weighted.showsLoad)
        XCTAssertEqual(weighted.weight, 25)
    }

    func testPlacesBetweenSetsSendTheWearerToTheIPhone() {
        let review = WatchWorkoutBuilder.state(display(.review, nil, message: "Review your sets and finish the workout."),
                                               date: today, run: run)
        XCTAssertNil(review.set)
        XCTAssertEqual(review.title, "Sets complete")
        XCTAssertEqual(review.message, "Review and finish on your iPhone.")
        let chosen = WatchWorkoutBuilder.state(display(.exerciseComplete, nil), date: today, run: run)
        XCTAssertEqual(chosen.message, "Choose the next exercise on your iPhone.")
        let saving = WatchWorkoutBuilder.state(display(.blocked, nil, message: "Saving workout. Wait before continuing."),
                                               date: today, run: run)
        XCTAssertEqual(saving.title, "Check your iPhone")
        XCTAssertEqual(saving.message, "Saving workout. Wait before continuing.")
        XCTAssertNil(WatchWorkoutPresentation.primary(review, at: now), "nothing to tap between sets")
    }

    func testTheTokenNamesTheSetAndItsValuesAndIsSharedByARestAndItsSet() {
        func token(_ display: WorkoutDisplayState, run: String? = nil) -> String {
            WatchWorkoutBuilder.token(for: display, run: run ?? self.run)
        }
        let ready = token(display(.ready, step()))
        XCTAssertEqual(ready, token(display(.ready, step())), "the same set, the same token")
        XCTAssertEqual(ready, token(display(.rest, step(), restEnd: now)),
                       "a rest and the set it leads to are one place")
        XCTAssertNotEqual(ready, token(display(.ready, step(set: 3))))
        XCTAssertNotEqual(ready, token(display(.ready, step(weight: 230))))
        XCTAssertNotEqual(ready, token(display(.ready, step(reps: 6))))
        XCTAssertNotEqual(ready, token(display(.active, step())), "a running timer is another place")
        let hold = token(display(.active, step(), timedStart: now))
        XCTAssertEqual(hold, token(display(.active, step(), timedStart: now)))
        XCTAssertNotEqual(hold, token(display(.active, step(), timedStart: now.addingTimeInterval(20))),
                          "a hold started again is another timer")
        XCTAssertNotEqual(ready, token(display(.ready, step()), run: "2026-11-22#0#2000000600"),
                          "the same set of the workout started again is another run")
        XCTAssertNotEqual(ready, token(display(.ready, step()), run: "2026-11-22#1#2000000000"),
                          "and so is the same set of another workout on the day")
    }

    // MARK: what the Watch shows

    func testTheWorkoutShowsOnItsOwnDayOnly() {
        let shown = state()
        XCTAssertEqual(WatchWorkoutPresentation.shown(shown, today: today), shown)
        XCTAssertNil(WatchWorkoutPresentation.shown(shown, today: "2026-11-23"), "yesterday's set is not today's")
        XCTAssertNil(WatchWorkoutPresentation.shown(nil, today: today))
        var newer = shown
        newer.version = WatchWorkoutState.currentVersion + 1
        XCTAssertNil(WatchWorkoutPresentation.shown(newer, today: today))
    }

    func testTheButtonFollowsThePhaseAndARestEndsOnTheWatchsOwnClock() {
        XCTAssertEqual(WatchWorkoutPresentation.primary(state(.ready), at: now), .log)
        XCTAssertEqual(WatchWorkoutPresentation.primary(state(.ready, step(weight: nil, reps: nil, seconds: 45)), at: now),
                       .startTimer)
        XCTAssertEqual(WatchWorkoutPresentation.primary(state(.active, step(weight: nil, reps: nil, seconds: 45)), at: now),
                       .stopTimer)

        let resting = state(.rest, restEnd: now.addingTimeInterval(60))
        XCTAssertTrue(WatchWorkoutPresentation.isResting(resting, at: now))
        XCTAssertEqual(WatchWorkoutPresentation.primary(resting, at: now), .endRest)
        // The iPhone, asleep in a pocket, has not said the rest ended.
        let later = now.addingTimeInterval(61)
        XCTAssertFalse(WatchWorkoutPresentation.isResting(resting, at: later))
        XCTAssertEqual(WatchWorkoutPresentation.primary(resting, at: later), .log)

        XCTAssertEqual(WatchWorkoutPresentation.title(.log), "Log set")
        XCTAssertEqual(WatchWorkoutPresentation.title(.endRest), "End rest")
        XCTAssertEqual(WatchWorkoutPresentation.action(.startTimer), .startTimer)
        XCTAssertEqual(WatchWorkoutPresentation.action(.stopTimer), .stopTimer)
    }

    func testLoadsRepsAndTimesReadAsOnTheIPhone() {
        let squat = WatchWorkoutBuilder.set(step())
        XCTAssertEqual(WatchWorkoutPresentation.loadText(225, of: squat), "225")
        XCTAssertEqual(WatchWorkoutPresentation.loadText(22.5, of: squat), "22.5")
        XCTAssertEqual(WatchWorkoutPresentation.loadText(8.165, of: squat), "8.165")
        XCTAssertEqual(WatchWorkoutPresentation.loadText(nil, of: squat), "–")
        XCTAssertEqual(WatchWorkoutPresentation.loadLabel(225, of: squat), "lb")
        XCTAssertEqual(WatchWorkoutPresentation.summary(squat), "225 lb × 5")

        let dumbbells = WatchWorkoutBuilder.set(step(weight: 40, perHand: true, unilateral: true))
        XCTAssertEqual(WatchWorkoutPresentation.loadLabel(40, of: dumbbells), "lb / hand")
        XCTAssertEqual(WatchWorkoutPresentation.repsLabel(dumbbells), "reps / side")

        let pullUp = WatchWorkoutBuilder.set(step(weight: 0, bodyweight: true))
        XCTAssertEqual(WatchWorkoutPresentation.loadText(0, of: pullUp), "BW")
        XCTAssertEqual(WatchWorkoutPresentation.loadText(25, of: pullUp), "+25")
        XCTAssertEqual(WatchWorkoutPresentation.loadText(-20, of: pullUp), "20")
        XCTAssertEqual(WatchWorkoutPresentation.loadLabel(-20, of: pullUp), "lb assist")
        XCTAssertEqual(WatchWorkoutPresentation.summary(pullUp), "Bodyweight × 5")

        let plank = WatchWorkoutBuilder.set(step(weight: nil, reps: nil, seconds: 45))
        XCTAssertEqual(WatchWorkoutPresentation.clock(45), "0:45")
        XCTAssertEqual(WatchWorkoutPresentation.clock(90), "1:30")
        XCTAssertEqual(WatchWorkoutPresentation.summary(plank), "0:45")
        XCTAssertEqual(WatchWorkoutPresentation.summary(WatchWorkoutBuilder.set(step(weight: nil))), "5 reps")
    }

    // MARK: the crown

    func testTheCrownStepsLikeTheRunnerAndStaysInBounds() {
        let squat = WatchWorkoutBuilder.set(step())
        var draft = WatchSetDraft(squat)
        XCTAssertFalse(draft.isChanged(from: squat))
        draft.stepWeight(2, of: squat)
        XCTAssertEqual(draft.weight, 235)
        draft.stepWeight(-100, of: squat)
        XCTAssertEqual(draft.weight, 0, "a load never goes below nothing")
        draft.stepReps(3)
        XCTAssertEqual(draft.reps, 8)
        draft.stepReps(-20)
        XCTAssertEqual(draft.reps, 0)
        XCTAssertTrue(draft.isChanged(from: squat))

        let pullUp = WatchWorkoutBuilder.set(step(weight: 0, bodyweight: true))
        var assisted = WatchSetDraft(pullUp)
        assisted.stepWeight(-4, of: pullUp)
        XCTAssertEqual(assisted.weight, -20, "below zero is assistance on a bodyweight movement")

        let unchosen = WatchWorkoutBuilder.set(step(weight: nil, needsWeight: true))
        var chosen = WatchSetDraft(unchosen)
        XCTAssertNil(chosen.weight)
        chosen.stepWeight(9, of: unchosen)
        XCTAssertEqual(chosen.weight, 45, "a load not chosen yet starts from zero")

        let plank = WatchWorkoutBuilder.set(step(weight: nil, reps: nil, seconds: 45))
        var hold = WatchSetDraft(plank)
        hold.stepWeight(3, of: plank)
        XCTAssertNil(hold.weight, "a set with no load has none to change")
        hold.stepDuration(3)
        XCTAssertEqual(hold.durationSeconds, 60)
        hold.stepDuration(-100)
        XCTAssertEqual(hold.durationSeconds, 5)
    }

    func testATapCarriesOnlyWhatTheCrownChanged() {
        let squat = WatchWorkoutBuilder.set(step())
        var draft = WatchSetDraft(squat)
        let plain = draft.command(.logSet, token: "t", set: squat)
        XCTAssertEqual(plain.token, "t")
        XCTAssertNil(plain.weight)
        XCTAssertNil(plain.reps)

        draft.stepWeight(1, of: squat)
        let heavier = draft.command(.logSet, token: "t", set: squat)
        XCTAssertEqual(heavier.weight, 230)
        XCTAssertNil(heavier.reps, "unchanged reps stay the runner's")

        let ended = draft.command(.endRest, token: "t", set: squat)
        XCTAssertNil(ended.weight, "ending a rest changes no values")
    }

    // MARK: how it travels

    func testTheWorkoutRidesBesideTheDayAndLeavesWithIt() throws {
        let channel = WorkoutChannelStub()
        channel.canSend = true
        let sender = WatchDaySender(channel: channel)
        let set = state()

        sender.publishWorkout(set)
        XCTAssertTrue(channel.sent.isEmpty, "a workout waits for the day it rides beside")
        sender.publish(day())
        XCTAssertEqual(channel.sent.count, 1)
        XCTAssertEqual(WatchDayMessage.decode(channel.sent[0]), .day(day()))
        XCTAssertEqual(WatchWorkoutMessage.workout(in: channel.sent[0]), set)

        sender.publishWorkout(set)
        XCTAssertEqual(channel.sent.count, 1, "an unchanged set is sent once")
        let next = state(.rest, step(set: 3), restEnd: now.addingTimeInterval(90))
        sender.publishWorkout(next)
        XCTAssertEqual(channel.sent.count, 2)
        XCTAssertEqual(WatchDayMessage.decode(channel.sent[1]), .day(day()), "the day stays beside it")
        XCTAssertEqual(WatchWorkoutMessage.workout(in: channel.sent[1]), next)

        sender.publishWorkout(nil)
        XCTAssertEqual(channel.sent.count, 3)
        XCTAssertNil(WatchWorkoutMessage.workout(in: channel.sent[2]), "the workout closed")
        XCTAssertEqual(WatchDayMessage.decode(channel.sent[2]), .day(day()))

        // Signed out mid-workout: the set leaves the wrist with the day.
        sender.publishWorkout(set)
        sender.publish(nil)
        let cleared = try XCTUnwrap(channel.sent.last)
        XCTAssertEqual(WatchDayMessage.decode(cleared), .cleared)
        XCTAssertNil(WatchWorkoutMessage.workout(in: cleared))
        sender.publish(day())
        XCTAssertNil(WatchWorkoutMessage.workout(in: try XCTUnwrap(channel.sent.last)),
                     "the next account's day carries no earlier workout")
    }

    func testAContextFromAnotherFormatShowsNoWorkout() throws {
        let bytes = try XCTUnwrap(WatchWorkoutMessage.encode(state()))
        var context = WatchDayMessage.context(day: try XCTUnwrap(WatchDayMessage.encode(day())))
        XCTAssertNil(WatchWorkoutMessage.workout(in: context), "a day with no workout running")
        context[WatchWorkoutMessage.workoutKey] = bytes
        XCTAssertEqual(WatchWorkoutMessage.workout(in: context), state())
        context[WatchDayMessage.versionKey] = 99
        XCTAssertNil(WatchWorkoutMessage.workout(in: context))
        context[WatchDayMessage.versionKey] = WatchDaySnapshot.currentVersion
        context[WatchWorkoutMessage.workoutKey] = Data("not a workout".utf8)
        XCTAssertNil(WatchWorkoutMessage.workout(in: context))
    }

    func testATapIsAnsweredByTheSignedInAccountOrSentToTheIPhone() async throws {
        let channel = WorkoutChannelStub()
        let sender = WatchDaySender(channel: channel)
        let command = WatchWorkoutCommand(id: UUID(), action: .logSet, token: "t", weight: 230)
        let message = try XCTUnwrap(WatchWorkoutMessage.encode(command))

        // Nobody is signed in: the Watch is told to open the app.
        let firstReply = await channel.ask(message)
        let unanswered = try XCTUnwrap(WatchWorkoutMessage.receipt(from: try XCTUnwrap(firstReply)))
        XCTAssertEqual(unanswered, .refused(command, StationLinkCommandReceipt.openWorkout))
        // A Start has no workout to open yet: it asks for the app.
        let start = WatchWorkoutCommand(id: UUID(), action: .start,
                                        token: WatchWorkoutPresentation.startToken(date: "2026-11-22", rowID: "primary"))
        let startMessage = try XCTUnwrap(WatchWorkoutMessage.encode(start))
        let startReply = await channel.ask(startMessage)
        let unstarted = try XCTUnwrap(WatchWorkoutMessage.receipt(from: try XCTUnwrap(startReply)))
        XCTAssertEqual(unstarted, .refused(start, WatchWorkoutCommandRunner.openApp))

        var taken: [WatchWorkoutCommand] = []
        let after = state(.rest, step(set: 3), restEnd: now.addingTimeInterval(90))
        sender.onWorkoutCommand = { command in
            taken.append(command)
            return .accepted(command, state: after)
        }
        let secondReply = await channel.ask(message)
        let answered = try XCTUnwrap(WatchWorkoutMessage.receipt(from: try XCTUnwrap(secondReply)))
        XCTAssertEqual(taken, [command], "the tap arrives with the crown's value")
        XCTAssertEqual(answered, .accepted(command, state: after))

        let garbled = await channel.ask(Data("?".utf8))
        XCTAssertNil(garbled, "a message that isn't a tap is not answered as one")
        XCTAssertEqual(taken.count, 1)
    }
}

private final class WorkoutChannelStub: WatchDayChannel {
    var canSend = false
    var onReady: (() -> Void)?
    var onCounterpartChanged: (() -> Void)?
    var onMessage: ((Data, @escaping (Data?) -> Void) -> Void)?
    private(set) var sent: [[String: Any]] = []

    func send(_ context: [String: Any]) throws { sent.append(context) }

    /// A message from the Watch, and the iPhone's answer.
    func ask(_ message: Data) async -> Data? {
        await withCheckedContinuation { continuation in
            guard let onMessage else { return continuation.resume(returning: nil) }
            onMessage(message) { continuation.resume(returning: $0) }
        }
    }
}
