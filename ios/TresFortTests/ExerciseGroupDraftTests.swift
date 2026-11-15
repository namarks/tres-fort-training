import XCTest
@testable import TresFort

final class ExerciseGroupDraftTests: XCTestCase {
    private func slot(_ id: String, group: String? = nil, rest: Int = 45, warmup: Bool = false, rounds: Int = 3) throws -> TemplateExercise {
        let fields: [String: Any] = ["id": id, "exercise_id": "ex-\(id)", "exercise_name": id,
            "exercise_unit": "lb", "exercise_modality": "barbell", "order_index": 0,
            "target_sets": rounds, "target_reps": 8, "rest_seconds": rest,
            "group_id": group as Any? ?? NSNull(), "group_rest_seconds": 35,
            "group_transition_seconds": 20, "is_warmup": warmup ? 1 : 0]
        return try JSONDecoder().decode(TemplateExercise.self, from: JSONSerialization.data(withJSONObject: fields))
    }

    private func fixture() throws -> [TemplateExercise] {
        try [slot("pre"), slot("early"), slot("a", group: "g"), slot("b", group: "g", rest: 75),
             slot("c", group: "g"), slot("x", group: "h"), slot("y", group: "h"), slot("late")]
    }

    private func draft(_ slots: [TemplateExercise]) -> ExerciseGroupDraft {
        ExerciseGroupDraft(groupID: "g", planID: "plan", version: 7, slots: slots,
            members: slots.filter { $0.group_id == "g" }, isExisting: true)
    }

    private func packed(_ draft: ExerciseGroupDraft) throws -> [String] {
        let anchor = try XCTUnwrap(draft.orderIndex)
        let others = draft.reviewedSlots.map(\.id).filter { !draft.memberIDs.contains($0) }
        return Array(others.prefix(anchor)) + draft.memberIDs + Array(others.dropFirst(anchor))
    }

    func testInteriorRemovalRetainsSlotAfterGroupAndOtherBlocks() throws {
        let slots = try fixture()
        var draft = draft(slots)
        draft.memberIDs = ["a", "c"]
        XCTAssertEqual(draft.orderIndex, 2)
        XCTAssertEqual(try packed(draft), ["pre", "early", "a", "c", "b", "x", "y", "late"])
        XCTAssertEqual(draft.member("b")?.rest_seconds, 75)
        XCTAssertEqual(draft.availableMembers.map(\.id), ["pre", "early", "b", "late"])
        XCTAssertEqual(slots.filter { $0.group_id == "g" }.map(\.id), ["a", "b", "c"], "Draft editing must not mutate saved membership")
    }

    func testAddingEarlierAndLaterSlotsUsesAnchorAfterExtractingSelection() throws {
        var draft = draft(try fixture())
        draft.memberIDs = ["c", "early", "a", "late"]
        XCTAssertEqual(draft.orderIndex, 1)
        XCTAssertEqual(try packed(draft), ["pre", "c", "early", "a", "late", "b", "x", "y"])
        XCTAssertEqual(draft.submission?.memberIDs, draft.memberIDs)
        XCTAssertEqual(draft.submission?.expectedVersion, 7)
        XCTAssertEqual(draft.submission?.roundRest, 35)
        XCTAssertEqual(draft.submission?.transitionRest, 20)
    }

    func testReviewKeepsProposalsAndMissingMembersUntilExplicitRemoval() throws {
        var slots = try fixture()
        var draft = draft(slots)
        draft.move("c", by: -1)
        draft.rounds = 6; draft.roundRest.text = "37"; draft.transitionRest.text = "19"
        let request = try XCTUnwrap(draft.submission)
        slots.removeAll { $0.id == "b" }
        XCTAssertNotNil(draft.unavailableReason(planID: "plan", slots: slots))
        XCTAssertTrue(draft.review(planID: "plan", version: 8, slots: slots))
        XCTAssertEqual(draft.memberIDs, ["a", "c", "b"])
        XCTAssertEqual(draft.rounds, 6)
        XCTAssertEqual(draft.roundRest.seconds, 37)
        XCTAssertEqual(draft.transitionRest.seconds, 19)
        XCTAssertNil(draft.submission)
        XCTAssertEqual(draft.member("b")?.exercise_name, "b", "Missing selections retain their original name")
        draft.memberIDs.removeAll { $0 == "b" }
        XCTAssertEqual(draft.submission?.expectedVersion, 8)
        XCTAssertEqual(request.expectedVersion, 7, "A submitted request remains frozen through later review")
        XCTAssertEqual(request.memberIDs, ["a", "c", "b"])
    }

    func testMissingGroupDifferentPlanAndOtherGroupSelectionFailClosed() throws {
        let slots = try fixture()
        var draft = draft(slots)
        XCTAssertFalse(draft.review(planID: "another-plan", version: 9, slots: slots))
        XCTAssertFalse(draft.review(planID: "plan", version: 9, slots: slots.filter { $0.group_id != "g" }))
        XCTAssertEqual(draft.reviewedVersion, 7)
        draft.memberIDs.append("x")
        XCTAssertNotNil(draft.unavailableReason(planID: "plan", slots: slots))
        XCTAssertNil(draft.submission)
        XCTAssertFalse(draft.availableMembers.contains { $0.group_id == "h" })
    }

    func testLegacyRoundCountCanBeReducedAndRestoredWithoutShrinkingStepperRange() throws {
        let slots = try [slot("a", group: "g", rounds: 25), slot("b", group: "g", rounds: 25)]
        var draft = draft(slots)
        XCTAssertEqual(draft.maximumRounds, 25)
        draft.rounds -= 1
        XCTAssertLessThan(draft.rounds, draft.maximumRounds, "Increment must remain enabled after 25 → 24")
        draft.rounds += 1
        XCTAssertEqual(draft.submission?.rounds, 25)
        XCTAssertFalse(draft.isDirty)

        let higher = try [slot("a", group: "g", rounds: 30), slot("b", group: "g", rounds: 30)]
        XCTAssertTrue(draft.review(planID: "plan", version: 8, slots: higher))
        XCTAssertEqual(draft.maximumRounds, 30)
        draft.rounds = 30
        XCTAssertTrue(draft.review(planID: "plan", version: 9, slots: slots))
        draft.rounds -= 1
        XCTAssertLessThan(draft.rounds, draft.maximumRounds, "A later review must not strand an already-supported proposal")
        draft.rounds += 1
        XCTAssertEqual(draft.submission?.rounds, 30)
    }

    func testMinimumMembershipExactRestsAndDirtyState() throws {
        var draft = draft(try fixture())
        XCTAssertFalse(draft.isDirty)
        draft.memberIDs = ["a"]
        XCTAssertTrue(draft.isDirty)
        XCTAssertNil(draft.submission)
        draft.memberIDs = ["a", "b"]
        draft.transitionRest.text = "3601"
        XCTAssertNil(draft.submission)
        draft.transitionRest.text = "0"
        draft.roundRest.text = "35"
        XCTAssertEqual(draft.submission?.transitionRest, 0)
        XCTAssertEqual(draft.submission?.roundRest, 35)
        draft.memberIDs = ["a", "a"]
        XCTAssertNil(draft.submission)
    }

    func testSameSlotReplacementRequiresReviewBeforeAdoptingNewExecutionIdentity() throws {
        var slots = try fixture()
        var draft = draft(slots)
        var fields = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(slots[2])) as? [String: Any])
        fields["exercise_id"] = "new-exercise"
        fields["exercise_name"] = "Different movement"
        fields["exercise_laterality"] = "unilateral"
        fields["exercise_load_mode"] = "per_hand"
        slots[2] = try JSONDecoder().decode(TemplateExercise.self, from: JSONSerialization.data(withJSONObject: fields))
        XCTAssertNotNil(draft.unavailableReason(planID: "plan", slots: slots))
        XCTAssertEqual(draft.member("a")?.exercise_name, "a")
        XCTAssertTrue(ExerciseGroupDraft.reviewLabel(slots[2]).contains("Different movement"))
        XCTAssertTrue(ExerciseGroupDraft.reviewLabel(slots[2]).contains("per side"))
        XCTAssertTrue(ExerciseGroupDraft.reviewLabel(slots[2]).contains("per hand"))
        XCTAssertTrue(draft.review(planID: "plan", version: 8, slots: slots))
        XCTAssertNil(draft.unavailableReason(planID: "plan", slots: slots))
        XCTAssertEqual(draft.memberIDs, ["a", "b", "c"])
    }

    func testDuplicateMovementSlotsExposeWorkoutPositionRoleAndDistinctPrescriptions() throws {
        let base = try slot("warm-bench", warmup: true, rounds: 2)
        var warmFields = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(base)) as? [String: Any])
        warmFields["exercise_id"] = "bench"
        warmFields["exercise_name"] = "Bench Press"
        warmFields["target_reps"] = 10
        warmFields["target_weight"] = 45
        warmFields["target_weight_unit"] = "lb"
        var workingFields = warmFields
        workingFields["id"] = "working-bench"
        workingFields["is_warmup"] = 0
        workingFields["target_sets"] = 3
        workingFields["target_reps"] = 5
        workingFields["target_weight"] = 80
        workingFields["target_weight_unit"] = "kg"
        let warm = try JSONDecoder().decode(TemplateExercise.self, from: JSONSerialization.data(withJSONObject: warmFields))
        let working = try JSONDecoder().decode(TemplateExercise.self, from: JSONSerialization.data(withJSONObject: workingFields))
        let slots = try [slot("pre"), warm, working, slot("a", group: "g"), slot("b", group: "g")]
        var draft = draft(slots)
        let warmLabel = ExerciseGroupDraft.reviewLabel(warm, in: slots)
        let workingLabel = ExerciseGroupDraft.reviewLabel(working, in: slots)
        XCTAssertTrue(warmLabel.contains("Bench Press · Workout exercise 2 · warm-up · 2×10 · 45 lb"))
        XCTAssertTrue(workingLabel.contains("Bench Press · Workout exercise 3 · working · 3×5 · 80 kg"))
        XCTAssertNotEqual(warmLabel, workingLabel)
        XCTAssertEqual(draft.availableMembers.filter { $0.exercise_name == "Bench Press" }.map(\.id), ["warm-bench", "working-bench"])
        draft.memberIDs.append("working-bench")
        draft.move("working-bench", by: -1)
        XCTAssertEqual(draft.memberContext("working-bench"), "Workout exercise 3 · working · 3×5 · 80 kg",
                       "Proposal reordering must retain the reviewed workout slot's identity")
        XCTAssertTrue(draft.availableMembers.contains { $0.id == "warm-bench" })
    }

    func testWarmupSlotsRemainEligibleAndReorderHasBounds() throws {
        var slots = try fixture()
        slots[0] = try slot("pre", warmup: true)
        var draft = draft(slots)
        XCTAssertTrue(draft.availableMembers.contains { $0.id == "pre" && $0.isWarmup })
        draft.move("a", by: -1)
        draft.move("c", by: 1)
        draft.move("missing", by: 1)
        XCTAssertEqual(draft.memberIDs, ["a", "b", "c"])
        draft.move("b", by: -1)
        XCTAssertEqual(draft.memberIDs, ["b", "a", "c"])
    }
}
