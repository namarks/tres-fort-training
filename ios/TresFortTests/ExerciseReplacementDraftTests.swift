import XCTest
@testable import TresFort

final class ExerciseReplacementDraftTests: XCTestCase {
    private func source(modality: String = "barbell", perHand: Bool = false) -> TemplateExercise {
        TemplateExercise(id: "slot", exercise_id: "bench", exercise_name: "Bench Press",
            exercise_unit: "lb", order_index: 2, target_sets: 3, target_reps: 5,
            target_reps_max: 8, target_rpe: 7, rest_seconds: 120, target_weight: 135,
            cues: "Brace", exercise_modality: modality, exercise_laterality: "bilateral",
            exercise_load_mode: perHand ? "per_hand" : "total", exercise_demo_slug: nil,
            target_duration_s: nil, is_warmup: 1, target_weight_unit: "lb",
            group_id: "group", group_rest_seconds: 90, group_transition_seconds: 15)
    }

    private func destination(modality: String = "dumbbell", perHand: Bool = true) -> ExerciseCatalog {
        ExerciseCatalog(id: "replacement", name: "New movement", primary_muscle: "chest",
            modality: modality, unit: "lb", laterality: "unilateral",
            load_mode: perHand ? "per_hand" : "total", demo_slug: nil)
    }

    func testTotalToPerHandClearsLoadAndRetainsSlotAndGroupIdentity() {
        let original = source()
        let draft = ExerciseReplacementDraft.slot(original, with: destination())
        XCTAssertNil(draft.target_weight)
        XCTAssertEqual(draft.exercise_id, "replacement")
        XCTAssertTrue(draft.isPerHand)
        XCTAssertTrue(draft.isUnilateral)
        XCTAssertEqual(draft.id, original.id)
        XCTAssertEqual(draft.target_sets, original.target_sets)
        XCTAssertEqual(draft.target_reps, original.target_reps)
        XCTAssertEqual(draft.target_reps_max, original.target_reps_max)
        XCTAssertEqual(draft.target_rpe, original.target_rpe)
        XCTAssertEqual(draft.group_id, original.group_id)
        XCTAssertEqual(draft.group_rest_seconds, original.group_rest_seconds)
        XCTAssertEqual(draft.group_transition_seconds, original.group_transition_seconds)
        XCTAssertEqual(draft.is_warmup, original.is_warmup)
        XCTAssertEqual(draft.order_index, original.order_index)
        XCTAssertTrue(SlotLoadDraft(slot: draft).reviewedFields["target_weight"] is NSNull,
                      "An unspecified replacement must clear, not omit, the old load")
    }

    func testModalityChangeClearsEvenWhenBothUseTotalWeight() {
        let draft = ExerciseReplacementDraft.slot(source(), with: destination(modality: "machine", perHand: false))
        XCTAssertNil(draft.target_weight)
    }

    func testSameLoadingConventionCanBeExplicitlyReviewedWithoutRounding() {
        let draft = ExerciseReplacementDraft.slot(source(), with: destination(modality: "barbell", perHand: false))
        var load = SlotLoadDraft(slot: draft)
        XCTAssertEqual(load.weight, 135)
        load.select(.kg)
        load.select(.lb)
        XCTAssertEqual(load.reviewedFields["target_weight"] as? Double, 135)
        XCTAssertEqual(load.reviewedFields["target_weight_unit"] as? String, "lb")
        load.text = "45"
        XCTAssertEqual(load.reviewedFields["target_weight"] as? Double, 45)
        load.rpe = nil
        XCTAssertTrue(load.reviewedFields["target_rpe"] is NSNull)
    }

    func testTimedReplacementDoesNotRelabelFiveRepsAsFiveSeconds() {
        let draft = ExerciseReplacementDraft.slot(source(), with: destination(modality: "timed", perHand: false))
        XCTAssertEqual(draft.target_duration_s, 45)
        XCTAssertEqual(draft.target_reps, 45)
        XCTAssertNil(draft.target_reps_max)
        XCTAssertNil(draft.target_weight)
        XCTAssertTrue(draft.isTimed)
    }
}
