import XCTest
@testable import TresFort

/// The Plan tab's "Add to your week" sheet and the labels that say what each
/// saved workout is (docs/plans/app-design-pass P13).
final class PlanComposerTests: XCTestCase {
    private func slot(_ id: String, _ exerciseID: String, name: String? = nil,
                      steps: String? = nil, duration: Int? = nil, modality: String = "barbell") -> TemplateExercise {
        var slot = TemplateExercise(id: id, exercise_id: exerciseID, exercise_name: name ?? exerciseID,
            exercise_unit: "lb", order_index: 0, target_sets: 3, target_reps: 5,
            target_reps_max: nil, target_rpe: nil, rest_seconds: 90,
            target_weight: nil, cues: nil, exercise_modality: modality,
            exercise_laterality: nil, exercise_load_mode: nil, exercise_demo_slug: nil,
            target_duration_s: duration, is_warmup: 0)
        slot.run_steps = steps
        return slot
    }

    func testEachSavedWorkoutSaysWhatItIsAndWhatsInIt() {
        let lift = Workout(id: "kb", name: "Kettlebell A", day_label: nil, order_index: 0, exercises: [
            slot("1", "swing", name: "Swing"), slot("2", "goblet", name: "Goblet squat"),
            slot("3", "press", name: "Press"), slot("4", "row", name: "Row"), slot("5", "carry", name: "Carry"),
        ])
        let intervals = Workout(id: "int", name: "Intervals", day_label: nil, order_index: 1, exercises: [
            slot("r", RunPlan.exerciseID,
                 steps: #"[{"repeat":6,"steps":[{"kind":"work","distance_m":400}]}]"#),
        ])
        let plain = Workout(id: "plain", name: "Run", day_label: nil, order_index: 2,
                            exercises: [slot("p", RunPlan.exerciseID)])
        let soccer = Workout(id: "soccer", name: "Soccer", day_label: nil, order_index: 3, exercises: [])
        let board = Workout(id: "board", name: "Board games", day_label: nil, order_index: 4, exercises: [])

        XCTAssertEqual(PlanItemSummary.kind(of: lift), .lift)
        XCTAssertEqual(PlanItemSummary.kind(of: intervals), .run)
        XCTAssertEqual(PlanItemSummary.kind(of: soccer), .activity)

        XCTAssertEqual(PlanItemSummary.glyph(for: lift), "dumbbell")
        XCTAssertEqual(PlanItemSummary.glyph(for: intervals), "figure.run")
        XCTAssertEqual(PlanItemSummary.glyph(for: soccer), "figure.soccer", "A sport's own figure")
        XCTAssertEqual(PlanItemSummary.glyph(for: board), "sportscourt")

        XCTAssertEqual(PlanItemSummary.detail(for: lift, unit: .miles), "Swing, Goblet squat, Press +2")
        XCTAssertEqual(PlanItemSummary.detail(for: intervals, unit: .miles), "6 × 400 m")
        XCTAssertEqual(PlanItemSummary.detail(for: plain, unit: .miles), "Run at your own pace")
        XCTAssertEqual(PlanItemSummary.contents(["Squat", "Bench"]), "Squat, Bench")
        XCTAssertEqual(PlanItemSummary.contents([]), "No exercises yet")

        let plan = PlanTree(id: "p", name: "Library", version: 3, workouts: [lift, intervals, soccer],
            meta: #"{"schedule":{"version":1,"week":{"mon":"kb","tue":"int","thu":"kb"}}}"#)
        XCTAssertEqual(PlanItemSummary.weekdays(using: "kb", plan: plan), ["mon", "thu"])
        XCTAssertEqual(PlanItemSummary.weekdays(using: "soccer", plan: plan), [])
        XCTAssertEqual(PlanItemSummary.spoken(intervals, plan: plan, unit: .miles),
                       "Intervals, Run, 6 × 400 m, on Tuesday")
        XCTAssertEqual(PlanItemSummary.spoken(soccer, plan: plan, unit: .miles), "Soccer, Activity")
    }

    func testAPlainRunIsOneStepOfDistanceOrTimeNamedForIt() throws {
        let threeMiles = try XCTUnwrap(PlanComposer.runPlan(measure: .distance, distance: 3, minutes: 30, unit: .miles))
        XCTAssertEqual(threeMiles.items.count, 1)
        guard case let .step(step) = threeMiles.items[0] else { return XCTFail("one step") }
        XCTAssertEqual(step.kind, .work)
        XCTAssertNil(step.durationSeconds)
        XCTAssertNil(step.target)
        XCTAssertEqual(try XCTUnwrap(step.distanceMeters), 4828.0, accuracy: 0.1)
        XCTAssertEqual(RunPlanFormat.summary(threeMiles, unit: .miles), "3 mi")

        let fiveK = try XCTUnwrap(PlanComposer.runPlan(measure: .distance, distance: 5, minutes: 0, unit: .kilometers))
        XCTAssertEqual(RunPlanFormat.summary(fiveK, unit: .kilometers), "5 km")

        let half = try XCTUnwrap(PlanComposer.runPlan(measure: .time, distance: 0, minutes: 45, unit: .miles))
        XCTAssertEqual(RunPlanFormat.summary(half, unit: .miles), "45 min")
        XCTAssertNil(PlanComposer.runPlan(measure: .steps, distance: 3, minutes: 30, unit: .miles),
                     "Steps are planned in the step editor")

        XCTAssertEqual(PlanComposer.runName(measure: .distance, distance: 3, minutes: 30, unit: .miles), "3 mi run")
        XCTAssertEqual(PlanComposer.runName(measure: .distance, distance: 21.1, minutes: 30, unit: .kilometers), "21.1 km run")
        XCTAssertEqual(PlanComposer.runName(measure: .time, distance: 3, minutes: 90, unit: .miles), "1 h 30 min run")
        XCTAssertEqual(PlanComposer.runName(measure: .steps, distance: 3, minutes: 30, unit: .miles), "Run")
        XCTAssertEqual(PlanComposer.number(3.5), "3.5")
        XCTAssertEqual(PlanComposer.number(4), "4")
    }

    func testOneWritePutsTheWorkoutOnEveryChosenDayAndSaysWhatItReplaces() {
        let gym = Workout(id: "gym", name: "Gym", day_label: nil, order_index: 0, exercises: [])
        let run = Workout(id: "run", name: "3 mi run", day_label: nil, order_index: 1, exercises: [])
        let retired = Workout(archived_at: 1, id: "retired", name: "Retired", day_label: nil, order_index: 2, exercises: [])
        let plan = PlanTree(id: "p", name: "Library", version: 5, workouts: [gym, run, retired],
            meta: #"{"schedule":{"version":1,"week":{"mon":"gym","tue":"retired","sat":"gym"}}}"#)

        XCTAssertEqual(PlanComposer.week(plan, setting: ["wed", "fri"], to: "run"),
                       ["mon": "gym", "tue": "", "wed": "run", "thu": "", "fri": "run", "sat": "gym", "sun": ""])
        XCTAssertEqual(PlanComposer.week(plan, setting: ["mon"], to: "run")["mon"], "run")

        XCTAssertNil(PlanComposer.replacing(["wed"], with: nil, plan: plan), "Rest days lose nothing")
        XCTAssertNil(PlanComposer.replacing(["tue"], with: nil, plan: plan), "An archived workout reads as rest")
        XCTAssertNil(PlanComposer.replacing(["mon"], with: "gym", plan: plan), "Same workout, nothing replaced")
        XCTAssertEqual(PlanComposer.replacing(["mon", "wed", "sat"], with: nil, plan: plan),
                       "Replaces Gym on Monday, Gym on Saturday.")

        XCTAssertEqual(PlanComposer.addTitle([]), "Pick a day")
        XCTAssertEqual(PlanComposer.addTitle(["wed"]), "Add to Wednesdays")
        XCTAssertEqual(PlanComposer.addTitle(["fri", "mon", "wed"]), "Add to Mon, Wed, Fri")
        XCTAssertEqual(PlanComposer.addTitle(Set(PlanSchedule.weekdayKeys)), "Add to every day")
    }

    func testTheDaySheetStepsThroughTheWeekAndWraps() {
        XCTAssertEqual(WeekdayPlanSheet.weekday("wed", offset: 1), "thu")
        XCTAssertEqual(WeekdayPlanSheet.weekday("wed", offset: -1), "tue")
        XCTAssertEqual(WeekdayPlanSheet.weekday("sun", offset: 1), "mon", "Sunday goes on to Monday")
        XCTAssertEqual(WeekdayPlanSheet.weekday("mon", offset: -1), "sun", "Monday goes back to Sunday")
        XCTAssertEqual(PlanComposer.Kind.sport.title, "Other", "Not \"Activity\", which is a tab's name")
    }

    // MARK: - P24: rides, swims, routines at home, a time while adding

    func testEveryKindHasOneTileAndRidesAndSwimsAreTheirOwn() {
        XCTAssertEqual(PlanComposer.Kind.rows.flatMap { $0 }, [.run, .ride, .swim, .lift, .home, .sport, .saved])
        XCTAssertEqual(Set(PlanComposer.Kind.rows.flatMap { $0 }), Set(PlanComposer.Kind.allCases),
                       "Every kind has a tile")
        XCTAssertEqual(PlanComposer.Kind.new, [.run, .ride, .swim, .lift, .home, .sport])
        XCTAssertEqual(PlanComposer.Kind.ride.title, "Ride")
        XCTAssertEqual(PlanComposer.Kind.swim.title, "Swim")
        XCTAssertEqual(PlanComposer.Kind.home.title, "At home")
        XCTAssertTrue(PlanComposer.Kind.ride.isEndurance)
        XCTAssertFalse(PlanComposer.Kind.run.isEndurance, "A run keeps its own steps")
        XCTAssertFalse(PlannedActivity.suggestions.contains("Ride"), "Rides have their own tile")
    }

    func testARideOrSwimIsPlannedByDistanceOrTimeAndNamedForItsSport() {
        let ride = PlanComposer.amounts(.ride, unit: .miles)
        XCTAssertEqual(ride.defaultMeasure, .time)
        XCTAssertEqual(ride.defaultMinutes, 60)
        XCTAssertEqual(ride.distanceLabel, "mi")
        XCTAssertEqual(PlanComposer.amounts(.ride, unit: .kilometers).distanceLabel, "km")
        let swim = PlanComposer.amounts(.swim, unit: .miles)
        XCTAssertEqual(swim.defaultMeasure, .distance)
        XCTAssertEqual(swim.distanceLabel, "yd", "Pool swims count yards on miles")
        XCTAssertEqual(PlanComposer.amounts(.swim, unit: .kilometers).distanceLabel, "m")
        XCTAssertEqual(PlanComposer.amounts(.run, unit: .miles).distanceChoices, PlanComposer.distanceChoices(.miles))

        XCTAssertEqual(PlanComposer.enduranceName(.ride, measure: .time, distance: 20, minutes: 60, unit: .miles),
                       "1 h ride")
        XCTAssertEqual(PlanComposer.enduranceName(.ride, measure: .time, distance: 20, minutes: 45, unit: .miles),
                       "45 min ride")
        XCTAssertEqual(PlanComposer.enduranceName(.ride, measure: .distance, distance: 20, minutes: 60, unit: .miles),
                       "20 mi ride")
        XCTAssertEqual(PlanComposer.enduranceName(.swim, measure: .distance, distance: 1000, minutes: 30, unit: .miles),
                       "1000 yd swim")
        XCTAssertEqual(PlanComposer.enduranceName(.swim, measure: .distance, distance: 1500, minutes: 30, unit: .kilometers),
                       "1500 m swim")

        // A typed name keeps the sport, which is all an activity has to say
        // what it is.
        XCTAssertEqual(PlanComposer.enduranceName(.ride, typed: "Recovery", auto: "1 h ride"), "Recovery ride")
        XCTAssertEqual(PlanComposer.enduranceName(.swim, typed: " Pool intervals ", auto: "1000 yd swim"),
                       "Pool intervals swim")
        XCTAssertEqual(PlanComposer.enduranceName(.ride, typed: "Zwift ride", auto: "1 h ride"), "Zwift ride")
        XCTAssertEqual(PlanComposer.enduranceName(.swim, typed: "Swim", auto: "1000 yd swim"), "Swim")
        XCTAssertEqual(PlanComposer.enduranceName(.ride, typed: "", auto: "1 h ride"), "1 h ride")
        XCTAssertEqual(PlannedActivity.kind(for: PlanComposer.enduranceName(.swim, typed: "Pool intervals", auto: "")),
                       "swim")
    }

    func testAPlannedRideOrSwimReadsAsItsSportEverywhere() {
        XCTAssertEqual(PlannedActivity.sport(named: "45 min ride")?.id, "ride")
        XCTAssertEqual(PlannedActivity.sport(named: "1000 yd swim")?.id, "swim")
        XCTAssertEqual(PlannedActivity.sport(named: "Evening walk")?.id, "walk")
        XCTAssertEqual(PlannedActivity.sport(named: "Soccer")?.id, "soccer", "A sport's own name still counts")
        XCTAssertNil(PlannedActivity.sport(named: "Board games"))
        XCTAssertNil(PlannedActivity.sport(named: "Ride along"), "The sport has to be the last word")

        XCTAssertEqual(PlannedActivity.kind(for: "45 min ride"), "ride", "The log sheet opens as a ride")
        XCTAssertEqual(PlannedActivity.kind(for: "1000 yd swim"), "swim")

        let ride = Workout(id: "ride", name: "45 min ride", day_label: nil, order_index: 0, exercises: [])
        let swim = Workout(id: "swim", name: "1000 yd swim", day_label: nil, order_index: 1, exercises: [])
        XCTAssertEqual(PlanItemSummary.glyph(for: ride), "bicycle")
        XCTAssertEqual(PlanItemSummary.glyph(for: swim), "figure.pool.swim")
        XCTAssertTrue(FirstRunSetup.plansEndurance(PlanTree(id: "p", name: "L", version: 1, workouts: [ride], meta: nil)))

        func synced(kind: String, sport: String?) -> ExternalActivity {
            var activity = ExternalActivity(
                attribution_version: 1, id: kind, source: "intervals", external_id: kind, date: "2026-11-10",
                kind: kind, name: "Zwift - Watopia", moving_time_sec: 2_700, elapsed_time_sec: nil,
                distance_m: nil, average_watts: nil, weighted_avg_watts: nil, average_hr: nil,
                max_hr: nil, training_load: nil, intensity: nil, calories: nil,
                elevation_gain_m: nil, synced_at: 1, deleted_at: nil)
            activity.sport = sport
            return activity
        }
        XCTAssertTrue(PlannedActivity.isLogged("45 min ride", manual: [], synced: [synced(kind: "ride", sport: "ride")]),
                      "A synced ride that day counts the planned one done")
        XCTAssertTrue(PlannedActivity.isLogged("45 min ride", manual: [], synced: [synced(kind: "ride", sport: nil)]),
                      "Its coarse kind is enough")
        XCTAssertFalse(PlannedActivity.isLogged("45 min ride", manual: [], synced: [synced(kind: "run", sport: "run")]))
    }

    func testARoutineAtHomeStartsFromExercisesThePhoneHas() {
        func exercise(_ id: String, _ modality: String) -> ExerciseCatalog {
            ExerciseCatalog(id: id, name: id, primary_muscle: "core", modality: modality, unit: "lb",
                            laterality: "bilateral", load_mode: "total", demo_slug: nil)
        }
        let catalog = [exercise("ex_dead_bug", "bw"), exercise("ex_plank", "timed"), exercise("ex_back_squat", "barbell")]
        XCTAssertEqual(PlanComposer.HomeStart.core.exercises(in: catalog).map(\.id), ["ex_plank", "ex_dead_bug"],
                       "In the routine's order, leaving out what the catalog lacks")
        XCTAssertTrue(PlanComposer.HomeStart.own.exercises(in: catalog).isEmpty)
        XCTAssertEqual(PlanComposer.HomeStart.core.defaultName, "Core routine")
        for start in PlanComposer.HomeStart.allCases where start != .own {
            XCTAssertFalse(start.exerciseIDs.isEmpty, "\(start) starts with exercises")
        }

        XCTAssertEqual(ExerciseSearchPolicy.results(catalog, query: "", region: .all, equipmentFree: true).map(\.id),
                       ["ex_dead_bug", "ex_plank"], "No equipment: bodyweight moves and holds only")
        XCTAssertEqual(ExerciseSearchPolicy.results(catalog, query: "", region: .all).count, 3)
        func named(_ id: String, _ name: String, _ modality: String) -> ExerciseCatalog {
            ExerciseCatalog(id: id, name: name, primary_muscle: "back", modality: modality, unit: "lb",
                            laterality: "bilateral", load_mode: "total", demo_slug: nil)
        }
        XCTAssertFalse(ExerciseSearchPolicy.isEquipmentFree(named("ex_pullup", "Pull-Up", "bw")), "Needs a bar")
        XCTAssertFalse(ExerciseSearchPolicy.isEquipmentFree(named("ex_dead_hang", "Dead Hang", "timed")))
        XCTAssertFalse(ExerciseSearchPolicy.isEquipmentFree(named("ex_ring_row", "Ring Row", "bw")))
        XCTAssertFalse(ExerciseSearchPolicy.isEquipmentFree(named("ex_box_jump", "Box Jump", "bw")))
        XCTAssertTrue(ExerciseSearchPolicy.isEquipmentFree(named("ex_pushup", "Push-Up", "bw")))
        XCTAssertTrue(ExerciseSearchPolicy.isEquipmentFree(named("ex_side_plank", "Side Plank", "timed")))
        XCTAssertTrue(ExerciseSearchPolicy.isEquipmentFree(named("ex_hamstring", "Hamstring Stretch", "timed")),
                      "Hamstring isn't a ring")
        for start in PlanComposer.HomeStart.allCases {
            for id in start.exerciseIDs {
                XCTAssertFalse(ExerciseSearchPolicy.needsEquipment.contains(id), "\(id) needs no equipment")
            }
        }
        XCTAssertEqual(PlanComposer.defaultTimeOfDay(for: .home), 20 * 60, "A routine at home starts in the evening")
        XCTAssertEqual(PlanComposer.defaultTimeOfDay(for: .run), 7 * 60)
    }

    func testATimeSetWhileAddingGoesOnEveryChosenDayAndKeepsTheRest() throws {
        let gym = Workout(id: "gym", name: "Gym", day_label: nil, order_index: 0, exercises: [])
        let core = Workout(id: "core", name: "Core routine", day_label: nil, order_index: 1, exercises: [])
        let walk = Workout(id: "walk", name: "Walk", day_label: nil, order_index: 2, exercises: [])
        let plan = PlanTree(id: "p", name: "Library", version: 4, workouts: [gym, core, walk],
            meta: #"{"schedule":{"version":2,"week":{"mon":"gym","tue":"walk"},"extras":{},"times":{"mon":{"gym":"06:30"},"tue":{"walk":"12:00"}}}}"#)

        XCTAssertNil(PlanComposer.times(nil, for: "core", on: ["mon"], week: [:], extras: nil, plan: plan),
                     "No time leaves saved times as they are")

        // Alongside: Monday keeps the gym and its time; Wednesday holds core alone.
        let alongside = ScheduleExtras.adding("core", to: ["mon", "wed"], plan: plan)
        let times = try XCTUnwrap(PlanComposer.times(21 * 60, for: "core", on: ["mon", "wed"],
                                                     week: alongside.week, extras: alongside.extras, plan: plan))
        XCTAssertEqual(times["mon"], ["gym": "06:30", "core": "21:00"])
        XCTAssertEqual(times["wed"], ["core": "21:00"])
        XCTAssertEqual(times["tue"], ["walk": "12:00"], "Other days keep their times")

        // Swapping Tuesday's walk out drops the walk's time there, which the
        // server would refuse for something no longer on the day.
        let swapped = PlanComposer.week(plan, setting: ["tue"], to: "core")
        let swappedTimes = try XCTUnwrap(PlanComposer.times(7 * 60, for: "core", on: ["tue"],
                                                            week: swapped, extras: nil, plan: plan))
        XCTAssertEqual(swappedTimes["tue"], ["core": "07:00"])
        XCTAssertEqual(swappedTimes["mon"], ["gym": "06:30"])
    }

    func testTilesPutWhatTheMemberDoesMostFirst() {
        XCTAssertEqual(PlanComposer.ranked([:]), PlanComposer.Kind.new, "Nothing yet keeps the default order")
        XCTAssertEqual(PlanComposer.ranked([.home: 3, .ride: 3, .lift: 1]), [.ride, .home, .lift, .run, .swim, .sport],
                       "Ties keep the default order")
        XCTAssertEqual(PlanComposer.Kind.layout([.home, .lift, .run, .ride, .swim, .sport]),
                       [[.home, .lift, .run, .ride], [.swim, .sport, .saved]], "Saved stays last")

        let kb = Workout(id: "kb", name: "Kettlebell A", day_label: nil, order_index: 0, exercises: [slot("1", "swing")])
        let core = Workout(id: "core", name: "Core routine", day_label: nil, order_index: 1, exercises: [
            slot("1", "ex_plank", modality: "timed"), slot("2", "ex_dead_bug", modality: "bw"),
        ])
        let tempo = Workout(id: "tempo", name: "Tempo", day_label: nil, order_index: 2, exercises: [slot("r", RunPlan.exerciseID)])
        let soccer = Workout(id: "soccer", name: "Soccer", day_label: nil, order_index: 3, exercises: [])
        let ride = Workout(id: "ride", name: "1 h ride", day_label: nil, order_index: 4, exercises: [])
        XCTAssertEqual(PlanComposer.kind(of: kb), .lift)
        XCTAssertEqual(PlanComposer.kind(of: core), .home, "All bodyweight and holds is at home")
        XCTAssertEqual(PlanComposer.kind(of: tempo), .run)
        XCTAssertEqual(PlanComposer.kind(of: soccer), .sport)
        XCTAssertEqual(PlanComposer.kind(of: ride), .ride)
        XCTAssertEqual(PlanComposer.kind(sport: "flexibility"), .home)
        XCTAssertEqual(PlanComposer.kind(sport: "strength"), .lift)
        XCTAssertEqual(PlanComposer.kind(sport: "tennis"), .sport)

        let plan = PlanTree(id: "p", name: "L", version: 1, workouts: [kb, core, tempo, soccer, ride],
            meta: #"{"schedule":{"version":1,"week":{"mon":"kb","tue":"tempo","thu":"kb"},"extras":{"mon":["core"],"wed":["core"],"fri":["core"]}}}"#)
        func session(_ id: String, _ date: String, _ status: String, _ workout: String?) -> SessionRow {
            SessionRow(id: id, date: date, status: status, workout_id: workout)
        }
        func synced(_ id: String, _ date: String, kind: String, sport: String?, deleted: Int? = nil) -> ExternalActivity {
            var activity = ExternalActivity(
                attribution_version: 1, id: id, source: "intervals", external_id: id, date: date,
                kind: kind, name: nil, moving_time_sec: 2_700, elapsed_time_sec: nil,
                distance_m: nil, average_watts: nil, weighted_avg_watts: nil, average_hr: nil,
                max_hr: nil, training_load: nil, intensity: nil, calories: nil,
                elevation_gain_m: nil, synced_at: 1, deleted_at: deleted)
            activity.sport = sport
            return activity
        }
        let manual = ActivityRow(id: "m", user_id: "u", date: "2026-11-05", type: "yoga", title: nil,
                                 duration_minutes: 30, notes: nil, logged_at: 1, source: "manual", deleted_at: nil)
        let counts = PlanComposer.usage(
            plan: plan,
            sessions: [
                session("s1", "2026-11-03", "completed", "kb"),
                session("s2", "2026-11-04", "completed", "core"),
                session("s3", "2026-11-05", "completed", "tempo"),
                session("s4", "2026-11-06", "skipped", "kb"),
                session("s5", "2026-09-01", "completed", "kb"),
            ],
            synced: [
                synced("a1", "2026-11-04", kind: "run", sport: "run"),
                synced("a2", "2026-11-07", kind: "ride", sport: nil),
                synced("a3", "2026-11-08", kind: "ride", sport: "ride", deleted: 1),
            ],
            manual: [manual], since: "2026-10-01")
        XCTAssertEqual(counts[.home], 4, "Three days in the week, one done")
        XCTAssertEqual(counts[.lift], 3, "Two days in the week, one done; skipped and old ones don't count")
        XCTAssertEqual(counts[.run], 2, "A run once from the week and once from the synced run, not its session too")
        XCTAssertEqual(counts[.ride], 1, "A deleted ride doesn't count")
        XCTAssertEqual(counts[.sport], 1, "Yoga is other")
        XCTAssertEqual(PlanComposer.ranked(counts), [.home, .lift, .run, .ride, .sport, .swim])
    }
}
