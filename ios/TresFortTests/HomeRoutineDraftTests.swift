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
}
