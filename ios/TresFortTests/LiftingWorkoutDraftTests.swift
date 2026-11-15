import XCTest
@testable import TresFort

final class LiftingWorkoutDraftTests: XCTestCase {
    private func exercise(_ id: String, modality: String = "barbell", laterality: String? = nil, loadMode: String? = nil) -> ExerciseCatalog {
        ExerciseCatalog(id: id, name: id, primary_muscle: "legs", modality: modality, unit: "lb",
            laterality: laterality, load_mode: loadMode, demo_slug: nil)
    }

    func testSixReviewedTargetsPreserveMixedUnitsRangesAssistanceAndTimers() throws {
        let exercises = [exercise("squat"), exercise("bench"), exercise("row", modality: "dumbbell", laterality: "unilateral", loadMode: "per_hand"),
            exercise("pullup", modality: "bw"), exercise("plank", modality: "timed"), exercise("bike", modality: "cardio")]
        var draft = LiftingWorkoutDraft()
        for exercise in exercises { draft.include(exercise, unit: .lb) }
        draft.targets["squat"]?.sets = "4"
        draft.targets["squat"]?.reps = "5"
        draft.targets["squat"]?.rest.text = "135"
        draft.targets["bench"]?.load.text = "95"
        draft.targets["row"]?.load.select(.kg)
        draft.targets["row"]?.load.text = "22.5"
        draft.targets["row"]?.repsMax = "12"
        draft.targets["row"]?.load.rpe = 8.5
        draft.targets["pullup"]?.load.text = "-20"
        draft.targets["plank"]?.seconds = "40"
        draft.targets["plank"]?.rest.text = "0"
        draft.targets["bike"]?.warmup = true
        draft.targets["bike"]?.cues = " Easy pace "
        let request = try XCTUnwrap(draft.request(name: " Strength ", exercises: exercises, planID: nil, version: 0))
        XCTAssertEqual(request.name, "Strength")
        XCTAssertNil(request.expected_plan_id)
        XCTAssertEqual(request.expected_version, 0)
        XCTAssertEqual(request.slots.count, 6)
        XCTAssertEqual(Set(request.slots.map(\.id)).count, 6)
        XCTAssertEqual(request.slots.map(\.order_index), [0, 1, 2, 3, 4, 5])
        XCTAssertNil(request.slots[0].target_weight, "An unknown loaded target must not become zero")
        XCTAssertEqual(request.slots[0].target_sets, 4)
        XCTAssertEqual(request.slots[0].target_reps, 5)
        XCTAssertEqual(request.slots[0].rest_seconds, 135)
        XCTAssertEqual(request.slots[1].target_weight, 95)
        XCTAssertEqual(request.slots[1].target_weight_unit, "lb")
        XCTAssertEqual(request.slots[2].target_weight, 22.5)
        XCTAssertEqual(request.slots[2].target_weight_unit, "kg")
        XCTAssertEqual(request.slots[2].target_reps_max, 12)
        XCTAssertEqual(request.slots[2].target_rpe, 8.5)
        XCTAssertTrue(try XCTUnwrap(draft.targets["row"]).summary.contains("each hand"))
        XCTAssertTrue(try XCTUnwrap(draft.targets["row"]).summary.contains("per side"))
        XCTAssertEqual(request.slots[3].target_weight, -20)
        XCTAssertEqual(request.slots[4].target_duration_s, 40)
        XCTAssertEqual(request.slots[4].rest_seconds, 0)
        XCTAssertEqual(request.slots[5].target_duration_s, 300)
        XCTAssertEqual(request.slots[5].target_sets, 1)
        XCTAssertEqual(request.slots[5].is_warmup, 1)
        XCTAssertEqual(request.slots[5].cues, "Easy pace")
        XCTAssertNil(request.slots[5].target_weight)
        XCTAssertTrue(request.slots.allSatisfy { $0.group_id == nil })
    }

    func testOrderRemovalReselectionAndNewUnitPreferenceKeepExistingProposals() throws {
        let squat = exercise("squat"), bench = exercise("bench")
        var draft = LiftingWorkoutDraft()
        draft.include(squat, unit: .kg)
        draft.include(bench, unit: .lb)
        draft.targets[squat.id]?.rest.text = "75"
        draft.targets[squat.id]?.load.text = "60"
        draft.include(squat, unit: .lb)
        let request = try XCTUnwrap(draft.request(name: "Lift", exercises: [bench, squat], planID: "plan", version: 8))
        XCTAssertEqual(request.slots.map(\.exercise_id), ["bench", "squat"])
        XCTAssertNil(request.slots[0].target_weight)
        XCTAssertEqual(request.slots[1].target_weight, 60)
        XCTAssertEqual(request.slots[1].target_weight_unit, "kg")
        XCTAssertEqual(request.slots[1].rest_seconds, 75)
        XCTAssertEqual(request.expected_plan_id, "plan")
        XCTAssertEqual(request.expected_version, 8)
        // A retained submission is a value: editing proposals cannot mutate an
        // uncertain retry's IDs, version, order, or payload.
        let frozen = request
        draft.targets[squat.id]?.load.text = "65"
        XCTAssertEqual(request, frozen)
        XCTAssertEqual(request.slots[1].target_weight, 60)
    }

    func testReviewAuthorityIncludesPlanIdentityAndPlanlessState() {
        let reviewed = LiftingCreationAuthority(planID: "plan-a", version: 4)
        XCTAssertEqual(reviewed, LiftingCreationAuthority(planID: "plan-a", version: 4))
        XCTAssertNotEqual(reviewed, LiftingCreationAuthority(planID: "plan-a", version: 5))
        XCTAssertNotEqual(reviewed, LiftingCreationAuthority(planID: "plan-b", version: 4))
        XCTAssertNotEqual(LiftingCreationAuthority(planID: nil, version: 0), LiftingCreationAuthority(planID: "plan-a", version: 0))
    }

    func testIncompleteOrInvalidFourthTargetPreventsWholeRequest() {
        let exercises = (0..<6).map { exercise("lift-\($0)") }
        var draft = LiftingWorkoutDraft()
        for exercise in exercises { draft.include(exercise, unit: .kg) }
        for value in ["", "0", "-1", "1.5", "1001", "abc"] {
            draft.targets["lift-3"]?.reps = value
            XCTAssertNil(draft.request(name: "Lift", exercises: exercises, planID: "plan", version: 1), value)
        }
        draft.targets["lift-3"]?.reps = "8"
        draft.targets["lift-3"]?.repsMax = "7"
        XCTAssertNotNil(draft.validationMessage(for: exercises))
        draft.targets["lift-3"]?.repsMax = "12"
        draft.targets["lift-3"]?.rest.text = "3601"
        XCTAssertNotNil(draft.validationMessage(for: exercises))
        draft.targets["lift-3"]?.rest.text = "75"
        draft.targets["lift-3"]?.load.text = "-10"
        XCTAssertNotNil(draft.validationMessage(for: exercises))
        draft.targets["lift-3"]?.load.text = ""
        XCTAssertNil(draft.validationMessage(for: exercises))
        XCTAssertNotNil(draft.validationMessage(for: exercises + [exercises[0]]))
        XCTAssertNotNil(draft.validationMessage(for: [exercise(RunPlan.exerciseID, modality: "cardio")]))
        XCTAssertNil(draft.request(name: " ", exercises: exercises, planID: "plan", version: 1))
        XCTAssertNil(draft.request(name: String(repeating: "a", count: 201), exercises: exercises, planID: "plan", version: 1))
    }
}
