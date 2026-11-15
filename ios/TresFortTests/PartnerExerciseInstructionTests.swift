import XCTest
@testable import TresFort

final class PartnerExerciseInstructionTests: XCTestCase {
    private func exercise(modality: String = "dumbbell", laterality: String = "bilateral",
                          loadMode: String = "total", weight: Double? = 30, unit: String = "lb",
                          reps: Int = 8, duration: Int? = nil) throws -> TemplateExercise {
        var value: [String: Any] = [
            "id": "host-slot", "exercise_id": "movement", "exercise_name": "Movement",
            "exercise_unit": "lb", "exercise_modality": modality, "order_index": 0,
            "target_sets": 3, "target_reps": reps, "rest_seconds": 60,
            "exercise_laterality": laterality, "exercise_load_mode": loadMode,
            "target_weight_unit": unit,
        ]
        if let weight { value["target_weight"] = weight }
        if let duration { value["target_duration_s"] = duration }
        return try JSONDecoder().decode(TemplateExercise.self, from: JSONSerialization.data(withJSONObject: value))
    }

    func testLegacyTimedSnapshotDecodesAndUsesFrozenDurationInsteadOfReps() throws {
        let bytes = Data(#"{"logged":[],"skipped":[],"closed":false,"display":{"hostSlotID":"host-slot","unit":"lb","reps":8}}"#.utf8)
        let snapshot = try JSONDecoder().decode(PartnerLaneSnapshot.self, from: bytes)
        let display = try XCTUnwrap(snapshot.display)
        XCTAssertNil(display.weight)
        XCTAssertNil(display.durationSeconds)
        let instructions = PartnerExerciseInstructions(exercise: try exercise(duration: 45), display: display)
        XCTAssertEqual(instructions.targetLabel, "45 seconds")
        XCTAssertEqual(instructions.loadLabel, "Choose weight")
    }

    func testDurationRoundTripsThroughPartnerPacketAndTriggersSnapshotChange() throws {
        let hold = try exercise(modality: "timed", weight: 0, duration: 45)
        let initial = PartnerLaneSnapshot(display: .current(hostSlotID: hold.id, exercise: hold,
            weight: 0, needsWeight: false, reps: 8, durationSeconds: 45))
        let edited = PartnerLaneSnapshot(display: .current(hostSlotID: hold.id, exercise: hold,
            weight: 0, needsWeight: false, reps: 8, durationSeconds: 70))
        XCTAssertNotEqual(initial, edited, "The phone's deduplicated snapshot must publish duration edits")
        let packet = PartnerPacket(id: UUID(), message: .snapshot(edited))
        let decoded = try JSONDecoder().decode(PartnerPacket.self, from: JSONEncoder().encode(packet))
        XCTAssertEqual(decoded, packet)
        XCTAssertEqual(PartnerExerciseInstructions(exercise: hold, display: try XCTUnwrap(edited.display)).summary,
                       "Bodyweight · 70 seconds")
    }

    func testReadyPartnerUsesItsCopiedNilZeroAssistanceAndUnitWithoutHostFallback() throws {
        let host = try exercise(modality: "bw", weight: 45)
        var copy = PartnerSlot(host, id: "partner-slot", index: 0, groupID: nil)
        copy.target_weight = nil
        copy.target_weight_unit = "kg"
        let unchosen = PartnerDisplaySlot.prescribed(exercise: host, copy: copy)
        XCTAssertNil(unchosen.weight)
        XCTAssertEqual(unchosen.unit, "kg")
        XCTAssertEqual(PartnerExerciseInstructions(exercise: host, display: unchosen).loadLabel, "Choose weight")
        copy.target_weight = 0
        XCTAssertEqual(PartnerExerciseInstructions(exercise: host,
            display: .prescribed(exercise: host, copy: copy)).loadLabel, "Bodyweight")
        copy.target_weight = -12.5
        XCTAssertEqual(PartnerExerciseInstructions(exercise: host,
            display: .prescribed(exercise: host, copy: copy)).loadLabel, "12.5 kg assistance")
        XCTAssertEqual(PartnerDisplaySlot.prescribed(exercise: host).weight, 45)
    }

    func testCurrentUnknownLoadDoesNotBecomeTheRunnerPlaceholderZero() throws {
        let lift = try exercise(weight: nil)
        let unknown = PartnerDisplaySlot.current(hostSlotID: lift.id, exercise: lift,
            weight: 0, needsWeight: true, reps: 9, durationSeconds: 45)
        XCTAssertNil(unknown.weight)
        XCTAssertNil(unknown.durationSeconds, "Rep sets must not acquire the runner's dormant timer duration")
        XCTAssertEqual(PartnerExerciseInstructions(exercise: lift, display: unknown).summary, "Choose weight · 9 reps")
        let chosen = PartnerDisplaySlot.current(hostSlotID: lift.id, exercise: lift,
            weight: 0, needsWeight: false, reps: 9, durationSeconds: 45)
        XCTAssertEqual(chosen.weight, 0)
        XCTAssertEqual(PartnerExerciseInstructions(exercise: lift, display: chosen).summary, "0 lb · 9 reps")
    }

    func testSharedLanesKeepTheirOwnCurrentValuesAndUnits() throws {
        let host = try exercise(laterality: "unilateral", loadMode: "per_hand", weight: 40)
        let partner = try exercise(laterality: "unilateral", loadMode: "per_hand", weight: 12.5, unit: "kg")
        var coordinator = PartnerCoordinator(steps: [.init(slotID: host.id, set: 1, name: "Movement", restSeconds: 60)])
        let now = Date(timeIntervalSince1970: 10)
        coordinator.receive(.init(display: .current(hostSlotID: host.id, exercise: host,
            weight: 40, needsWeight: false, reps: 8, durationSeconds: 45)), from: .host, now: now)
        coordinator.receive(.init(display: .current(hostSlotID: host.id, exercise: partner,
            weight: 12.5, needsWeight: false, reps: 10, durationSeconds: 45)), from: .partner, now: now)
        XCTAssertEqual(PartnerExerciseInstructions(exercise: host,
            display: try XCTUnwrap(coordinator.state.host.display)).summary, "40 lb each hand · 8 reps per side")
        XCTAssertEqual(PartnerExerciseInstructions(exercise: host,
            display: try XCTUnwrap(coordinator.state.partner.display)).summary, "12.5 kg each hand · 10 reps per side")
    }

    func testBodyweightAssistanceAndAddedLoadUseTheSameMeaningAsSoloPrescription() throws {
        for (weight, label) in [(0.0, "Bodyweight"), (-20.0, "20 lb assistance"), (10.0, "+10 lb")] {
            let lift = try exercise(modality: "bw", weight: weight)
            let shared = PartnerExerciseInstructions(exercise: lift, display: .prescribed(exercise: lift))
            XCTAssertEqual(shared.loadLabel, label)
            XCTAssertEqual(lift.prescriptionLabel(in: .lb), "3×8 · \(label)")
        }
    }

    func testCardioAndLegacyHoldsShowDurationWithoutInventingARepOrLoadInstruction() throws {
        let cardio = try exercise(modality: "cardio", weight: nil, reps: 300)
        let instruction = PartnerExerciseInstructions(exercise: cardio, display: .prescribed(exercise: cardio))
        XCTAssertEqual(instruction.summary, "300 seconds")
        XCTAssertNil(instruction.loadLabel)
        let legacyHold = try exercise(modality: "timed", laterality: "unilateral", weight: 0, reps: 25)
        XCTAssertEqual(PartnerExerciseInstructions(exercise: legacyHold,
            display: .prescribed(exercise: legacyHold)).summary, "Bodyweight · 25 seconds")
    }

    func testSetupClearingAndUnitSelectionPreserveUnknownLoad() throws {
        let host = try exercise(weight: 30)
        var copy = PartnerSlot(host, id: "partner-slot", index: 0, groupID: nil)
        XCTAssertTrue(copy.updateWeight(nil, unit: "lb", allowsAssistance: false))
        XCTAssertNil(copy.target_weight)
        XCTAssertTrue(copy.updateWeight(copy.target_weight, unit: "kg", allowsAssistance: false))
        XCTAssertNil(copy.target_weight)
        XCTAssertEqual(copy.target_weight_unit, "kg")
        XCTAssertTrue(copy.updateWeight(0, unit: "kg", allowsAssistance: false))
        XCTAssertEqual(copy.target_weight, 0, "Choosing zero stays different from clearing the field")
    }

    func testSetupConvertsReviewedAssistanceWithoutLosingItsSignAndRejectsInvalidLoads() throws {
        let host = try exercise(modality: "bw", weight: -20)
        var copy = PartnerSlot(host, id: "partner-slot", index: 0, groupID: nil)
        XCTAssertTrue(copy.updateWeight(copy.target_weight, unit: "kg", allowsAssistance: true))
        XCTAssertEqual(try XCTUnwrap(copy.target_weight), -9.0718474, accuracy: 0.0000001)
        let accepted = copy
        XCTAssertFalse(copy.updateWeight(-1, unit: "kg", allowsAssistance: false))
        XCTAssertFalse(copy.updateWeight(.infinity, unit: "kg", allowsAssistance: true))
        XCTAssertFalse(copy.updateWeight(10, unit: "stone", allowsAssistance: true))
        XCTAssertEqual(copy, accepted)
    }

    func testSetupAndRunnerInputLabelsExplainPerHandAndAssistanceValues() throws {
        let dumbbell = try exercise(loadMode: "per_hand")
        XCTAssertEqual(PartnerExerciseInstructions.loadInputLabel(exercise: dumbbell, unit: .kg), "Weight (kg) · each hand")
        XCTAssertEqual(PartnerExerciseInstructions.loadInputHint(exercise: dumbbell), "Enter the weight of one dumbbell.")
        let bodyweight = try exercise(modality: "bw")
        XCTAssertEqual(PartnerExerciseInstructions.loadInputLabel(exercise: bodyweight, unit: .lb), "Load / assistance (lb)")
        XCTAssertEqual(PartnerExerciseInstructions.loadInputHint(exercise: bodyweight),
                       "0 is bodyweight · positive adds load · negative records assistance")
    }
}
