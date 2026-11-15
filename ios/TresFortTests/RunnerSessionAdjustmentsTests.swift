import XCTest
@testable import TresFort

final class RunnerSessionAdjustmentsTests: XCTestCase {
    private func exercise(id: String = "slot", exerciseID: String = "squat", sets: Int = 3,
                          reps: Int = 5, group: String? = nil) -> TemplateExercise {
        TemplateExercise(id: id, exercise_id: exerciseID, exercise_name: "Squat", exercise_unit: "lb",
            order_index: 0, target_sets: sets, target_reps: reps, target_reps_max: nil,
            target_rpe: 8, rest_seconds: 90, target_weight: 100, cues: "Brace",
            exercise_modality: "barbell", exercise_laterality: "bilateral", exercise_load_mode: "total",
            exercise_demo_slug: nil, target_duration_s: nil, is_warmup: 0,
            target_weight_unit: "kg", group_id: group)
    }

    private func workout(_ exercise: TemplateExercise) -> Workout {
        Workout(tags: "[\"strength\"]", archived_at: nil, one_time_date: "2026-11-13",
            id: "workout", name: "Strength", day_label: "A", order_index: 2, exercises: [exercise])
    }

    func testCompositionKeepsBaselineAndSessionMetadataIntact() throws {
        let planned = exercise(), baseline = workout(planned)
        let catalog = ExerciseCatalog(id: "curl", name: "Curl", primary_muscle: "arms", modality: "dumbbell",
            unit: "lb", laterality: "bilateral", load_mode: "per_hand", demo_slug: nil)
        let added = RunnerSessionAdjustments.addedExercise(catalog, order: 1)
        var adjustments = RunnerSessionAdjustments()
        adjustments.addedExercises = [added]
        adjustments.extraSets[planned.id] = .init(prescription: RunnerPrescription(planned), prescribedSets: 3, count: 2)
        adjustments.extraSets[added.id] = .init(prescription: RunnerPrescription(added), prescribedSets: 1, count: 1)
        adjustments.restOverrides[planned.id] = .init(prescription: RunnerPrescription(planned), seconds: 135)
        let composed = adjustments.applying(to: baseline)
        XCTAssertEqual(composed.exercises.map(\.target_sets), [5, 2])
        XCTAssertEqual(baseline.exercises.map(\.target_sets), [3])
        XCTAssertEqual(composed.tags, baseline.tags)
        XCTAssertEqual(composed.one_time_date, baseline.one_time_date)
        XCTAssertEqual(composed.id, baseline.id)
        XCTAssertNil(composed.exercises.last?.target_weight)
        XCTAssertEqual(try JSONDecoder().decode(RunnerSessionAdjustments.self,
            from: JSONEncoder().encode(adjustments)), adjustments)
    }

    func testChangedPrescriptionCannotInheritExtraWorkOrRest() {
        let planned = exercise()
        var adjustments = RunnerSessionAdjustments()
        adjustments.extraSets[planned.id] = .init(prescription: RunnerPrescription(planned), prescribedSets: 3, count: 1)
        adjustments.restOverrides[planned.id] = .init(prescription: RunnerPrescription(planned), seconds: 135)
        for replacement in [exercise(exerciseID: "press"), exercise(reps: 10), exercise(group: "round")] {
            let normalized = adjustments.normalized(for: workout(replacement))
            XCTAssertTrue(normalized.extraSets.isEmpty)
            XCTAssertTrue(normalized.restOverrides.isEmpty)
        }
        XCTAssertTrue(adjustments.normalized(for: workout(exercise(sets: 4))).extraSets.isEmpty)
    }

    func testDuplicateAddedMovementCannotBecomeAmbiguousSlotlessWork() {
        let planned = exercise()
        var adjustments = RunnerSessionAdjustments()
        adjustments.addedExercises = [exercise(id: "squat", exerciseID: "squat", sets: 1),
                                     exercise(id: "curl", exerciseID: "curl", sets: 1),
                                     exercise(id: "curl", exerciseID: "curl", sets: 1)]
        XCTAssertEqual(adjustments.normalized(for: workout(planned)).addedExercises.map(\.exercise_id), ["curl"])
    }

    func testWarmupRetainsSlotAndUnitButOwnsItsAssessment() {
        let planned = exercise(), warmup = RunnerSessionAdjustments.warmup(planned)
        XCTAssertEqual(warmup.id, planned.id)
        XCTAssertEqual(warmup.exercise_id, planned.exercise_id)
        XCTAssertEqual(warmup.targetWeightUnit, planned.targetWeightUnit)
        XCTAssertTrue(warmup.isWarmup)
        XCTAssertNil(warmup.target_weight)
        XCTAssertNil(warmup.target_rpe)
        XCTAssertFalse(SessionWarmupValues(weight: .infinity, reps: 5).isValid(for: planned))
        XCTAssertFalse(SessionWarmupValues(weight: 45, reps: 0).isValid(for: planned))
        XCTAssertFalse(SessionWarmupValues(weight: 45, reps: 5, rpe: 11).isValid(for: planned))
        XCTAssertTrue(SessionWarmupValues(weight: 45, reps: 5).isValid(for: planned))
    }

    func testEmptyAdjustmentsDoNotRequireLegacyCheckpointRewrite() throws {
        let planned = exercise()
        let checkpoint = WorkoutRunnerCheckpoint(date: "2026-11-13", sessionID: nil,
            selectedDayID: "workout", currentSlotID: planned.id, skippedSlotIDs: [],
            workoutStartedAtMS: 1, finished: false)
        let normalized = try XCTUnwrap(RunnerRecovery.normalized(checkpoint, day: workout(planned),
            serverSession: nil, setIDs: [:], sessionAdjustments: RunnerSessionAdjustments()))
        XCTAssertEqual(normalized, checkpoint,
            "Validating an unchanged saved runner must not need another model's write ownership")

        var staleAdjustments = RunnerSessionAdjustments()
        staleAdjustments.extraSets[planned.id] = .init(prescription: RunnerPrescription(planned), prescribedSets: 3, count: 1)
        let staleCheckpoint = WorkoutRunnerCheckpoint(date: checkpoint.date, sessionID: nil,
            selectedDayID: "workout", currentSlotID: planned.id, skippedSlotIDs: [],
            workoutStartedAtMS: 1, finished: false, sessionAdjustments: staleAdjustments)
        let cleared = try XCTUnwrap(RunnerRecovery.normalized(staleCheckpoint, day: workout(planned),
            serverSession: nil, setIDs: [:], sessionAdjustments: RunnerSessionAdjustments()))
        XCTAssertNil(cleared.sessionAdjustments,
            "An explicitly normalized empty choice still clears invalidated adjustments")
    }
}
