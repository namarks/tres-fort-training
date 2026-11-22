import XCTest
@testable import TresFort

/// Changing a planned day: Today's run at a glance, the run screen's one
/// kind and one amount, and the saved workouts each Swap tile lists
/// (docs/plans/app-design-pass P25).
final class DayChangeTests: XCTestCase {
    private func slot(_ id: String, _ exerciseID: String, steps: String? = nil,
                      modality: String = "barbell") -> TemplateExercise {
        var slot = TemplateExercise(id: id, exercise_id: exerciseID, exercise_name: exerciseID,
            exercise_unit: "lb", order_index: 0, target_sets: 3, target_reps: 5,
            target_reps_max: nil, target_rpe: nil, rest_seconds: 90,
            target_weight: nil, cues: nil, exercise_modality: modality,
            exercise_laterality: nil, exercise_load_mode: nil, exercise_demo_slug: nil,
            target_duration_s: nil, is_warmup: 0)
        slot.run_steps = steps
        return slot
    }

    private func run(_ name: String, steps: String?) -> Workout {
        Workout(id: name, name: name, day_label: nil, order_index: 0,
                exercises: [slot("r", RunPlan.exerciseID, steps: steps)])
    }

    private func threshold(_ metric: ThresholdMetric, _ value: Double, from date: String = "2026-01-01") -> AthleteThreshold {
        AthleteThreshold(id: "\(metric.rawValue)-\(date)", sport: "run", metric: metric.rawValue, value: value,
                         effective_date: date, source: "member", created_at: 1)
    }

    private let tempoSteps = #"[{"kind":"warmup","duration_s":600},{"kind":"work","duration_s":1200,"target":{"type":"heart_rate","min_bpm":155,"max_bpm":161}},{"kind":"cooldown","duration_s":600}]"#

    // MARK: - Targets

    func testThresholdHeartRateSetsEachKindsBandAndWinsOverPace() {
        let targets = DayChange.Targets.from([threshold(.heartRate, 163), threshold(.pace, 240)], on: "2026-11-13")
        XCTAssertEqual(targets.work(.tempo), .heartRate(minBPM: 155, maxBPM: 161))
        XCTAssertEqual(targets.work(.easy), .heartRate(minBPM: 130, maxBPM: 145))
        XCTAssertEqual(targets.work(.long), .heartRate(minBPM: 130, maxBPM: 145))
        XCTAssertEqual(targets.work(.intervals), .heartRate(minBPM: 163, maxBPM: 171))
    }

    func testPaceAloneSetsAPaceBandAndNeitherMeansByFeel() {
        let pace = DayChange.Targets.from([threshold(.pace, 240)], on: "2026-11-13")
        XCTAssertEqual(pace.work(.tempo), .pace(fastestSecondsPerKm: 240, slowestSecondsPerKm: 252))
        XCTAssertNil(DayChange.Targets.none.work(.tempo))
        let history = [threshold(.heartRate, 160), threshold(.heartRate, 170, from: "2026-12-01")]
        XCTAssertEqual(DayChange.Targets.from(history, on: "2026-11-13").heartRate, 160,
                       "The value in effect on the date, as the Worker picks it")
    }

    func testTheRunsOwnTargetWinsOnlyForTheSameKind() {
        let own = RunPlan.Target.heartRate(minBPM: 150, maxBPM: 158)
        let targets = DayChange.Targets.from([threshold(.heartRate, 163)], on: "2026-11-13", own: (.tempo, own))
        XCTAssertEqual(targets.work(.tempo), own)
        XCTAssertEqual(targets.work(.easy), .heartRate(minBPM: 130, maxBPM: 145))
    }

    // MARK: - Steps from one kind and one amount

    func testAnEasyOrLongRunIsOneStep() {
        let targets = DayChange.Targets(heartRate: 163, pace: nil, own: nil)
        let easy = DayChange.runPlan(.fresh(.easy, unit: .miles), targets: targets, unit: .miles)
        XCTAssertEqual(easy.items, [.step(.init(kind: .work, durationSeconds: 1800, distanceMeters: nil,
                                               target: .heartRate(minBPM: 130, maxBPM: 145)))])

        var long = DayChange.RunDraft.fresh(.long, unit: .kilometers)
        long.measure = .distance
        let plan = DayChange.runPlan(long, targets: .none, unit: .kilometers)
        XCTAssertEqual(plan.items, [.step(.init(kind: .work, durationSeconds: nil, distanceMeters: 12_000, target: nil))])
    }

    func testATempoIsAWarmUpTheTempoAndACoolDown() {
        let targets = DayChange.Targets(heartRate: 163, pace: nil, own: nil)
        let byTime = DayChange.runPlan(.fresh(.tempo, unit: .miles), targets: targets, unit: .miles)
        XCTAssertEqual(byTime.items, [
            .step(.init(kind: .warmup, durationSeconds: 600, distanceMeters: nil, target: nil)),
            .step(.init(kind: .work, durationSeconds: 1200, distanceMeters: nil, target: .heartRate(minBPM: 155, maxBPM: 161))),
            .step(.init(kind: .cooldown, durationSeconds: 600, distanceMeters: nil, target: nil)),
        ])

        var byDistance = DayChange.RunDraft.fresh(.tempo, unit: .miles)
        byDistance.measure = .distance
        let plan = DayChange.runPlan(byDistance, targets: targets, unit: .miles)
        let steps = plan.expandedSteps.map(\.step)
        XCTAssertEqual(steps.map(\.kind), [.warmup, .work, .cooldown])
        XCTAssertEqual(steps[0].distanceMeters ?? 0, 1609, accuracy: 1, "A mile to warm up")
        XCTAssertEqual(steps[1].distanceMeters ?? 0, 3218, accuracy: 1, "Two miles of the four at tempo")
        XCTAssertEqual(steps[2].distanceMeters ?? 0, 1609, accuracy: 1)
    }

    func testIntervalsRepeatHardAndEasyBetweenAWarmUpAndCoolDown() {
        let byTime = DayChange.runPlan(.fresh(.intervals, unit: .miles), targets: .none, unit: .miles)
        guard byTime.items.count == 3, case let .repeated(times, steps) = byTime.items[1] else {
            return XCTFail("warm-up, repeats, cool-down")
        }
        XCTAssertEqual(times, 4, "40 minutes leaves 20 for 3 min hard, 2 min easy")
        XCTAssertEqual(steps.map(\.durationSeconds), [180, 120])

        var short = DayChange.RunDraft.fresh(.intervals, unit: .miles)
        short.measure = .distance
        short.distance = 3
        guard case let .repeated(fewest, metered) = DayChange.runPlan(short, targets: .none, unit: .miles).items[1] else {
            return XCTFail("repeats")
        }
        XCTAssertEqual(fewest, 2, "Never fewer than two repeats")
        XCTAssertEqual(metered.map(\.distanceMeters), [800, 400])
    }

    func testTheSummarySaysWhenARunIsPlannedByFeel() {
        let draft = DayChange.RunDraft.fresh(.tempo, unit: .miles)
        XCTAssertTrue(DayChange.summary(draft, targets: .none, unit: .miles).contains("By feel"))
        XCTAssertFalse(DayChange.summary(draft, targets: .init(heartRate: 163, pace: nil, own: nil), unit: .miles)
            .contains("By feel"))
    }

    // MARK: - The draft

    func testDetailedStepsKeepExactIntervalsAndTargetsUntilConfirmed() throws {
        var draft = DayChange.RunDraft.fresh(.intervals, unit: .miles)
        let steps = try XCTUnwrap(RunPlan(json: #"[{"kind":"warmup","duration_s":601},{"repeat":7,"steps":[{"kind":"work","distance_m":401,"target":{"type":"heart_rate","min_bpm":147,"max_bpm":153}},{"kind":"recovery","duration_s":93}]}]"#))
        draft.steps = .custom(steps)

        XCTAssertEqual(draft.plan(targets: .none, unit: .miles), steps)
        XCTAssertEqual(draft.plan(targets: .init(heartRate: 180, pace: 240, own: nil), unit: .miles), steps,
                       "A later threshold response cannot replace the member's edits")
        XCTAssertEqual(DayChange.summary(draft, targets: .none, unit: .miles),
                       RunPlanFormat.summary(steps, unit: .miles) + ".")

        draft.choose(.intervals, unit: .miles)
        XCTAssertEqual(draft.plan(targets: .none, unit: .miles), steps, "Tapping the selected kind keeps edits")
        draft.choose(.easy, unit: .miles)
        XCTAssertFalse(draft.hasCustomSteps)
        XCTAssertEqual(draft.plan(targets: .none, unit: .miles), DayChange.runPlan(draft, targets: .none, unit: .miles))
    }

    func testClearingDetailedStepsStaysAnUntargetedRun() {
        var draft = DayChange.RunDraft.fresh(unit: .miles)
        draft.steps = .custom(nil)
        XCTAssertTrue(draft.hasCustomSteps)
        XCTAssertNil(draft.plan(targets: .init(heartRate: 163, pace: nil, own: nil), unit: .miles),
                     "Explicitly removing steps must not regenerate the quick preset on Save")
        XCTAssertEqual(DayChange.summary(draft, targets: .none, unit: .miles), "Run at your own pace.")
    }

    func testANewKindKeepsTheAmountWhenItFitsAndStepsStayInBounds() {
        var draft = DayChange.RunDraft.fresh(.easy, unit: .miles)
        draft.minutes = 15
        draft.choose(.tempo, unit: .miles)
        XCTAssertEqual(draft.minutes, 40, "A tempo needs room for its warm-up and cool-down")
        draft.minutes = 60
        draft.choose(.easy, unit: .miles)
        XCTAssertEqual(draft.minutes, 60)

        draft.choose(.tempo, unit: .miles)
        draft.minutes = 30
        draft.step(by: -1, unit: .miles)
        XCTAssertEqual(draft.minutes, 30, "Stops at the kind's least")
        draft.step(by: 1, unit: .miles)
        XCTAssertEqual(draft.minutes, 35)

        draft.toggleMeasure()
        XCTAssertEqual(draft.measure, .distance)
        draft.step(by: 1, unit: .miles)
        XCTAssertEqual(draft.distance, 3.5)
        XCTAssertEqual(DayChange.amountText(draft, unit: .miles).value, "3.5")
        XCTAssertEqual(DayChange.amountText(draft, unit: .miles).unit, "mi")
    }

    func testTheDraftReadsTheDaysRunByNameThenShape() {
        let tempo = DayChange.draft(from: run("Tempo run", steps: tempoSteps), unit: .miles)
        XCTAssertEqual(tempo, DayChange.RunDraft(kind: .tempo, measure: .time, minutes: 40, distance: 4))

        let repeats = run("Tuesday", steps: #"[{"repeat":6,"steps":[{"kind":"work","distance_m":400},{"kind":"recovery","distance_m":400}]}]"#)
        let intervals = DayChange.draft(from: repeats, unit: .miles)
        XCTAssertEqual(intervals.kind, .intervals)
        XCTAssertEqual(intervals.measure, .distance)
        XCTAssertEqual(intervals.distance, 3, "4.8 km rounds to 3 mi")

        XCTAssertEqual(DayChange.runKind(named: "Saturday", plan: RunPlan(json: tempoSteps)), .tempo,
                       "A warm-up and a targeted middle read as a tempo")
        XCTAssertEqual(DayChange.runKind(named: "Long Sunday", plan: nil), .long)
        XCTAssertEqual(DayChange.draft(from: nil, unit: .miles), .fresh(unit: .miles))
        XCTAssertEqual(DayChange.ownTarget(of: run("Tempo run", steps: tempoSteps))?.target,
                       .heartRate(minBPM: 155, maxBPM: 161))
    }

    // MARK: - Today's card

    func testAPlannedRunAtAGlanceIsTimeEffortAndTarget() {
        XCTAssertEqual(DayChange.glance(run("Tempo run", steps: tempoSteps), unit: .miles), [
            .init(label: "Time", value: "40 min"),
            .init(label: "Effort", value: "Tempo"),
            .init(label: "Target", value: "HR 155–161"),
        ])
        let easy = DayChange.glance(run("Easy run", steps: #"[{"kind":"work","distance_m":4828}]"#), unit: .miles)
        XCTAssertEqual(easy.map(\.label), ["Distance", "Effort"], "No target, no target figure")
        XCTAssertEqual(easy.last?.value, "Easy")
        XCTAssertEqual(DayChange.glance(run("Run", steps: nil), unit: .miles), [],
                       "A run without steps keeps its one-line label")
    }

    // MARK: - What a day holds and what Swap lists

    func testWhatADayHoldsAndTheSavedWorkoutsUnderEachTile() {
        let lift = Workout(id: "kb", name: "Kettlebell A", day_label: nil, order_index: 0,
                           exercises: [slot("1", "swing")])
        let home = Workout(id: "core", name: "Core", day_label: nil, order_index: 1,
                           exercises: [slot("2", "plank", modality: "timed")])
        let tempo = run("Tempo run", steps: tempoSteps)
        let soccer = Workout(id: "soccer", name: "Soccer", day_label: nil, order_index: 3, exercises: [])
        let ride = Workout(id: "ride", name: "45 min ride", day_label: nil, order_index: 4, exercises: [])

        XCTAssertEqual(DayChange.holding(lift), .lift)
        XCTAssertEqual(DayChange.holding(home), .home)
        XCTAssertEqual(DayChange.holding(tempo), .run)
        XCTAssertEqual(DayChange.holding(soccer), .activity)
        XCTAssertEqual(DayChange.holding(ride), .ride)
        XCTAssertFalse(DayChange.Holding.activity.canChange)

        var oneTime = Workout(id: "once", name: "Strength today", day_label: nil, order_index: 5,
                              exercises: [slot("3", "squat")])
        oneTime.one_time_date = "2026-11-13"
        let plan = PlanTree(id: "p", name: "Library", version: 1,
                            workouts: [lift, home, tempo, soccer, ride, oneTime], meta: nil)
        XCTAssertEqual(DayChange.saved(.lift, in: plan).map(\.id), ["kb"], "One-time workouts aren't offered")
        XCTAssertEqual(DayChange.saved(.home, in: plan).map(\.id), ["core"])
        XCTAssertEqual(DayChange.saved(.sport, in: plan).map(\.id), ["soccer"])
        XCTAssertEqual(DayChange.saved(.ride, in: plan).map(\.id), ["ride"])

        XCTAssertEqual(DayChange.swapKinds([.lift, .run, .saved, .ride]), [.lift, .run, .ride])
        XCTAssertEqual(DayChange.firstSwapKind([.run, .lift], current: tempo), .lift)
        XCTAssertEqual(DayChange.weekday("2026-11-13"), "Friday")
        XCTAssertEqual(DayChange.weekday("not a date"), "this day")
    }
}
