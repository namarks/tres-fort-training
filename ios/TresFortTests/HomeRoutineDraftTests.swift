import XCTest
@testable import TresFort

final class HomeRoutineDraftTests: XCTestCase {
    private func exercise(_ id: String, modality: String = "bw", laterality: String? = nil) -> ExerciseCatalog {
        ExerciseCatalog(id: id, name: id, primary_muscle: "core", modality: modality, unit: "lb",
                        laterality: laterality, load_mode: nil, demo_slug: nil, aliases: nil)
    }

    func testReviewedCircuitCarriesTimersAndRestsForEveryExercise() throws {
        let exercises = [exercise("ex_dead_bug"), exercise("ex_side_plank", modality: "timed", laterality: "unilateral")]
        var draft = HomeRoutineDraft()
        draft.circuit = true
        draft.timeEveryExercise = true
        draft.sets = "2"
        draft.seconds = "40"
        draft.transitionRest = "20"
        draft.roundRest = "60"
        let request = try XCTUnwrap(draft.request(name: " Core ", exercises: exercises, planID: "plan", version: 7))
        XCTAssertEqual(request.name, "Core")
        XCTAssertEqual(request.expected_plan_id, "plan")
        XCTAssertEqual(request.expected_version, 7)
        XCTAssertNotNil(UUID(uuidString: request.workout_id))
        XCTAssertEqual(request.slots.map(\.exercise_id), exercises.map(\.id))
        XCTAssertEqual(request.slots.map(\.order_index), [0, 1])
        XCTAssertEqual(request.slots.map(\.target_sets), [2, 2])
        XCTAssertEqual(request.slots.map(\.target_duration_s), [40, 40])
        XCTAssertEqual(request.slots.map(\.group_transition_seconds), [20, 20])
        XCTAssertEqual(request.slots.map(\.group_rest_seconds), [60, 60])
        XCTAssertNotNil(request.slots.first?.group_id)
        XCTAssertEqual(Set(request.slots.compactMap(\.group_id)).count, 1)
        XCTAssertEqual(Set(request.slots.map(\.id)).count, 2)
        XCTAssertTrue(request.slots.allSatisfy { $0.target_weight == nil })
        XCTAssertEqual(draft.targetLabel(for: exercises[1]), "2 × 40s")
    }

    func testMixedRoutinePreservesRepsUnlessMemberChoosesTimers() throws {
        let exercises = [exercise("ex_dead_bug"), exercise("ex_plank", modality: "timed")]
        var draft = HomeRoutineDraft()
        draft.sets = " 2 "
        draft.reps = "10"
        draft.seconds = "30"
        draft.rest = "0"
        let request = try XCTUnwrap(draft.request(name: "Core", exercises: exercises, planID: "plan", version: 1))
        XCTAssertEqual(request.slots.map(\.target_duration_s), [nil, 30])
        XCTAssertEqual(request.slots.map(\.target_reps), [10, 30])
        XCTAssertEqual(request.slots.map(\.rest_seconds), [0, 0])
        XCTAssertTrue(request.slots.allSatisfy { $0.group_id == nil && $0.group_rest_seconds == nil })
    }

    func testAnExerciseSetOnItsOwnKeepsItsSetsAndAmount() throws {
        let exercises = [exercise("ex_dead_bug"), exercise("ex_plank", modality: "timed"), exercise("ex_bird_dog")]
        var draft = HomeRoutineDraft()
        draft.overrides["ex_dead_bug"] = .init(sets: 4, reps: 12)
        draft.overrides["ex_plank"] = .init(seconds: 60)
        let request = try XCTUnwrap(draft.request(name: "Core", exercises: exercises, planID: "plan", version: 1))
        XCTAssertEqual(request.slots.map(\.target_sets), [4, 3, 3], "The others keep the routine's sets")
        XCTAssertEqual(request.slots.map(\.target_reps), [12, 60, 8])
        XCTAssertEqual(request.slots.map(\.target_duration_s), [nil, 60, nil])
        XCTAssertEqual(draft.targetLabel(for: exercises[0]), "4 × 12 reps")
        XCTAssertEqual(draft.targetLabel(for: exercises[1]), "3 × 60s")
        XCTAssertEqual(draft.targetLabel(for: exercises[2]), "3 × 8 reps")

        // A circuit's rounds are shared; an exercise's own reps still count.
        draft.circuit = true
        let circuit = try XCTUnwrap(draft.request(name: "Core", exercises: exercises, planID: "plan", version: 1))
        XCTAssertEqual(circuit.slots.map(\.target_sets), [3, 3, 3])
        XCTAssertEqual(circuit.slots.map(\.target_reps), [12, 60, 8])

        // Timing every exercise uses its own hold, not its reps.
        draft.circuit = false
        draft.timeEveryExercise = true
        let timed = try XCTUnwrap(draft.request(name: "Core", exercises: exercises, planID: "plan", version: 1))
        XCTAssertEqual(timed.slots.map(\.target_duration_s), [45, 60, 45])

        // The timer preview follows each exercise's own sets and hold.
        var previewed = HomeRoutineDraft()
        previewed.rest = "0"
        previewed.overrides["ex_plank"] = .init(sets: 1, seconds: 60)
        let preview = try XCTUnwrap(previewed.timerPreview(for: [exercises[1], exercises[0]]))
        XCTAssertEqual(preview.steps.filter { $0.kind == .work }.map(\.exerciseID),
                       ["ex_plank", "ex_dead_bug", "ex_dead_bug", "ex_dead_bug"])
        XCTAssertEqual(preview.timedWorkSeconds, 60)
        XCTAssertEqual(preview.untimedSets, 3)

        // A shared value every exercise overrides doesn't block saving.
        var own = HomeRoutineDraft()
        own.reps = ""
        own.overrides["ex_dead_bug"] = .init(reps: 10)
        XCTAssertNil(own.validationMessage(for: [exercises[0]]))
        XCTAssertNotNil(own.validationMessage(for: [exercises[0], exercises[2]]))
    }

    func testInvalidInputCannotSilentlySaveDefaultTargets() {
        let exercises = [exercise("ex_plank", modality: "timed")]
        for value in ["", "0", "-1", "1.5", "abc", "7201", "999999999999999999999999"] {
            var draft = HomeRoutineDraft()
            draft.seconds = value
            XCTAssertNotNil(draft.validationMessage(for: exercises), value)
            XCTAssertNil(draft.request(name: "Core", exercises: exercises, planID: "plan", version: 1), value)
        }
        var circuit = HomeRoutineDraft(circuit: true)
        XCTAssertNotNil(circuit.validationMessage(for: exercises), "A one-exercise circuit is invalid")
        circuit.transitionRest = "-1"
        XCTAssertNotNil(circuit.validationMessage(for: exercises + [exercise("ex_dead_bug")]))
        XCTAssertNil(HomeRoutineDraft().request(name: " ", exercises: exercises, planID: "plan", version: 1))
        XCTAssertNotNil(HomeRoutineDraft().validationMessage(for: exercises + exercises))
        XCTAssertNotNil(HomeRoutineDraft().validationMessage(for: [exercise("ex_squat", modality: "barbell")]))
    }

    func testSwitchingToCircuitDoesNotValidateHiddenBetweenSetRest() throws {
        var draft = HomeRoutineDraft()
        draft.rest = ""
        let exercises = [exercise("ex_dead_bug"), exercise("ex_plank", modality: "timed")]
        XCTAssertNotNil(draft.validationMessage(for: exercises))
        draft.circuit = true
        XCTAssertNil(draft.validationMessage(for: exercises))
        let request = try XCTUnwrap(draft.request(name: "Core", exercises: exercises, planID: "plan", version: 1))
        XCTAssertEqual(request.slots.map(\.rest_seconds), [60, 60])
        XCTAssertEqual(request.slots.map(\.group_rest_seconds), [60, 60])
    }

    /// Add to your week and Today's Add another workout share one builder:
    /// a suggestion is filled from the catalog, your own starts empty with
    /// the catalog open, and a removed exercise drops its own targets.
    func testTheRoutineBuilderStartsFromASuggestionOrYourOwn() {
        let catalog = ["ex_plank", "ex_dead_bug", "ex_side_plank", "ex_bird_dog", "ex_hollow",
                       "ex_pushup", "ex_bw_squat", "ex_bw_reverse_lunge", "ex_glute_bridge_march"]
            .map { exercise($0) }
        var builder = HomeRoutineBuilder(catalog: catalog)
        XCTAssertEqual(builder.start, .core)
        XCTAssertEqual(builder.exercises.map(\.id), PlanComposer.HomeStart.core.exerciseIDs)
        XCTAssertTrue(builder.isReady)
        XCTAssertFalse(builder.adding)
        XCTAssertEqual(builder.timingSummary, "3 sets · 2 min rest")
        XCTAssertEqual(builder.header, "Suggested core routine · yours to change")

        builder.routine.overrides["ex_dead_bug"] = .init(sets: 2)
        builder.remove(catalog[1])
        XCTAssertNil(builder.routine.overrides["ex_dead_bug"])
        XCTAssertFalse(builder.exercises.contains { $0.id == "ex_dead_bug" })
        XCTAssertTrue(builder.touched)

        builder.choose(.bodyweight, catalog: catalog)
        XCTAssertTrue(builder.routine.circuit)
        XCTAssertFalse(builder.touched)
        XCTAssertEqual(builder.timingSummary, "3 rounds · circuit")

        builder.choose(.own, catalog: catalog)
        XCTAssertTrue(builder.exercises.isEmpty)
        XCTAssertFalse(builder.isReady)
        XCTAssertTrue(builder.adding)
        XCTAssertEqual(builder.header, "Your routine")
        builder.refill(catalog: catalog)
        XCTAssertTrue(builder.exercises.isEmpty, "Your own never refills with a suggestion")

        // A catalog that loads after the screen opens fills an untouched
        // suggestion, never one the member emptied.
        var late = HomeRoutineBuilder(start: .core, catalog: [])
        XCTAssertTrue(late.exercises.isEmpty)
        late.refill(catalog: catalog)
        XCTAssertEqual(late.exercises.count, 5)
        late.exercises.removeAll()
        late.touched = true
        late.refill(catalog: catalog)
        XCTAssertTrue(late.exercises.isEmpty)
    }
}
