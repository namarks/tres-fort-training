import XCTest
@testable import TresFort

/// First-run setup: what the week a new member makes changes elsewhere in the
/// app (docs/plans/member-activation-and-adherence P5).
final class FirstRunSetupTests: XCTestCase {
    private func run(_ id: String) -> Workout {
        var slot = TemplateExercise(id: "\(id)-slot", exercise_id: RunPlan.exerciseID, exercise_name: "Outdoor Run",
            exercise_unit: "lb", order_index: 0, target_sets: 1, target_reps: 1,
            target_reps_max: nil, target_rpe: nil, rest_seconds: 0,
            target_weight: nil, cues: nil, exercise_modality: "cardio",
            exercise_laterality: nil, exercise_load_mode: nil, exercise_demo_slug: nil,
            target_duration_s: nil, is_warmup: 0)
        slot.run_steps = #"[{"kind":"work","distance_m":4828}]"#
        return Workout(id: id, name: "3 mi run", day_label: nil, order_index: 0, exercises: [slot])
    }

    private func activity(_ id: String, _ name: String) -> Workout {
        Workout(id: id, name: name, day_label: nil, order_index: 1, exercises: [])
    }

    private func plan(_ workouts: [Workout], meta: String? = nil) -> PlanTree {
        PlanTree(id: "plan", name: "My Training", version: 2, workouts: workouts, meta: meta)
    }

    func testRunsAndRidesPutWatchSourcesFirst() {
        XCTAssertFalse(FirstRunSetup.plansRuns(nil))
        XCTAssertFalse(FirstRunSetup.plansEndurance(plan([activity("soccer", "Soccer")])))
        XCTAssertTrue(FirstRunSetup.plansRuns(plan([run("r")])))
        XCTAssertTrue(FirstRunSetup.plansRuns(plan([activity("a", "Run")])), "An activity called a run is a run")
        XCTAssertFalse(FirstRunSetup.plansRuns(plan([activity("ride", "Ride")])))
        XCTAssertTrue(FirstRunSetup.plansEndurance(plan([activity("ride", "Ride")])))
        XCTAssertTrue(FirstRunSetup.plansEndurance(plan([activity("swim", "Swim")])))

        XCTAssertEqual(ConnectionSourceRows.setupOrder(endurance: true), [.garmin, .intervals, .appleHealth, .whoop])
        XCTAssertEqual(ConnectionSourceRows.setupOrder(endurance: false), [.appleHealth, .garmin, .intervals, .whoop])
        XCTAssertEqual(Set(ConnectionSourceRows.setupOrder(endurance: true)), Set(ConnectionSourceRows.Source.allCases),
                       "Setup lists every source Connections does")
    }

    func testWeekCountsAWorkoutOrAnActivityOnAnyDay() {
        XCTAssertFalse(FirstRunSetup.hasWeek(nil))
        XCTAssertFalse(FirstRunSetup.hasWeek(plan([run("r")])), "A saved workout on no day is not a week yet")
        XCTAssertTrue(FirstRunSetup.hasWeek(plan([run("r")],
            meta: #"{"schedule":{"version":1,"week":{"tue":"r"}}}"#)))
        XCTAssertTrue(FirstRunSetup.hasWeek(plan([activity("core", "Core")],
            meta: #"{"schedule":{"version":2,"week":{},"extras":{"mon":["core"]}}}"#)))
    }

    func testRideAndSwimHaveTheirOwnTiles() {
        XCTAssertEqual(Array(PlanComposer.Kind.new.prefix(3)), [.run, .ride, .swim])
    }

    func testSavingWorkoutsKeepsWeekPlanningReachable() {
        for tree in [nil, plan([]), plan([run("r"), activity("core", "Core")])] {
            XCTAssertTrue(FirstRunSetup.needsWeekPlanning(plan: tree, sessions: [], today: "2026-11-12"))
        }
    }

    func testRecurringWorkoutOrSeparateCoreFinishesWeekPlanning() {
        let workouts = [run("r"), activity("core", "Core")]
        for meta in [
            #"{"schedule":{"version":1,"week":{"tue":"r"}}}"#,
            #"{"schedule":{"version":2,"week":{},"extras":{"mon":["core"]}}}"#,
        ] {
            XCTAssertFalse(FirstRunSetup.needsWeekPlanning(plan: plan(workouts, meta: meta),
                                                         sessions: [], today: "2026-11-12"))
        }
    }

    func testBlockDoesNotGetAnEmptyWeekPrompt() throws {
        let tree = plan([run("r")],
            meta: #"{"program":{"id":"block","start":"2026-11-16","weeks":[{"week":{"mon":"r"}}]}}"#)
        XCTAssertNotNil(tree.program)
        XCTAssertFalse(FirstRunSetup.needsWeekPlanning(plan: tree, sessions: [], today: "2026-11-12"),
                       "A future block already gives the saved library a place on the plan")
    }

    func testDateAssignmentsDoNotGetAnEmptyWeekPrompt() {
        let tree = plan([run("r")])
        for date in ["2026-11-12", "2026-11-13"] {
            for status in ["planned", "in_progress"] {
                let session = SessionRow(id: "session", date: date, status: status, workout_id: "unavailable")
                XCTAssertFalse(FirstRunSetup.needsWeekPlanning(plan: tree, sessions: [session], today: "2026-11-12"),
                               "A dated workout is already planned, even when its template needs review")
            }
        }
        for session in [
            SessionRow(id: "past", date: "2026-11-11", status: "completed", workout_id: "r"),
            SessionRow(id: "skipped", date: "2026-11-13", status: "skipped", workout_id: "r"),
        ] {
            XCTAssertTrue(FirstRunSetup.needsWeekPlanning(plan: tree, sessions: [session], today: "2026-11-12"),
                          "History and a skipped date do not schedule the next workout")
        }
    }
}
