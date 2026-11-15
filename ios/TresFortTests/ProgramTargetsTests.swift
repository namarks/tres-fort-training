import XCTest
@testable import TresFort

/// Targets that change from week to week (docs/plans/progressive-plans P1).
/// ProgramTargets.json is the contract with the server's `applySlotTargets`
/// (test/programTargets.test.ts).
final class ProgramTargetsTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Slot: Decodable {
            let id: String
            let exercise_id: String
            let target_sets: Int
            let target_reps: Int
            let target_reps_max: Int?
            let target_rpe: Double?
            let target_weight: Double?
            let target_weight_unit: String
            let target_duration_s: Int?
            let run_steps: String?
        }
        struct Expected: Decodable, Equatable {
            let target_sets: Int
            let target_reps: Int
            let target_reps_max: Int?
            let target_rpe: Double?
            let target_weight: Double?
            let target_weight_unit: String
            let target_duration_s: Int?
            let run_steps: String?
        }
        struct Case: Decodable {
            let name: String
            let date: String
            let slot: String
            let expected: Expected
        }
        let slots: [Slot]
        let cases: [Case]
    }

    private func slot(_ s: Fixture.Slot) -> TemplateExercise {
        TemplateExercise(id: s.id, exercise_id: s.exercise_id, exercise_name: s.id, exercise_unit: "lb",
            order_index: 0, target_sets: s.target_sets, target_reps: s.target_reps,
            target_reps_max: s.target_reps_max, target_rpe: s.target_rpe, rest_seconds: 90,
            target_weight: s.target_weight, cues: nil, exercise_modality: "kettlebell",
            exercise_laterality: nil, exercise_load_mode: nil, exercise_demo_slug: nil,
            target_duration_s: s.target_duration_s, is_warmup: 0,
            target_weight_unit: s.target_weight_unit, run_steps: s.run_steps)
    }

    func testSharedTypeScriptSwiftFixtures() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ProgramTargets", withExtension: "json"))
        let data = try Data(contentsOf: url)
        let fixture = try JSONDecoder().decode(Fixture.self, from: data)
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let meta = try JSONSerialization.data(withJSONObject: ["program": raw["program"] as Any])
        let workout = Workout(id: "w", name: "Bells", day_label: nil, order_index: 0,
                              exercises: fixture.slots.map { self.slot($0) })
        let plan = PlanTree(id: "p", name: "Plan", version: 2, workouts: [workout],
                            meta: String(data: meta, encoding: .utf8))
        XCTAssertNotNil(plan.program)
        XCTAssertFalse(fixture.cases.isEmpty)

        for item in fixture.cases {
            let applied = try XCTUnwrap(plan.workout(workout, on: item.date).exercises.first { $0.id == item.slot })
            let actual = Fixture.Expected(
                target_sets: applied.target_sets, target_reps: applied.target_reps,
                target_reps_max: applied.target_reps_max, target_rpe: applied.target_rpe,
                target_weight: applied.target_weight, target_weight_unit: applied.target_weight_unit ?? "lb",
                target_duration_s: applied.target_duration_s, run_steps: applied.run_steps)
            XCTAssertEqual(actual, item.expected, item.name)
        }
    }

    func testStoredTargetsAreTidiedLikeTheServer() throws {
        let targets: [String: Any] = [
            "a": ["target_sets": 0, "target_reps": 6, "target_weight": "heavy", "colour": "red",
                  "run_steps": NSNull()] as [String: Any],
            "b": ["target_sets": 2.5] as [String: Any],
            "c": "nope",
            "d": ["target_sets": true] as [String: Any],
        ]
        let week: [String: Any] = ["week": [String: Any](), "targets": targets]
        let json: [String: Any] = ["id": "x", "start": "2026-11-09", "weeks": [week]]
        let program = try XCTUnwrap(PlanProgram(json: json))
        XCTAssertEqual(program.weeks[0].targets, ["a": SlotTargets(reps: 6, runSteps: .some(nil))])
    }

    func testOnlyARunTakesStepsAndAClearedValueStaysCleared() {
        let base = TemplateExercise(id: "s", exercise_id: "ex_kb_swing", exercise_name: "Swing",
            exercise_unit: "lb", order_index: 0, target_sets: 3, target_reps: 10, target_reps_max: 12,
            target_rpe: 7, rest_seconds: 60, target_weight: 24, cues: nil, exercise_modality: "kettlebell",
            exercise_laterality: nil, exercise_load_mode: nil, exercise_demo_slug: nil,
            target_duration_s: nil, is_warmup: 0, target_weight_unit: "kg")
        let changed = base.applying(SlotTargets(rpe: .some(nil), weight: .some(28), runSteps: .some("[]")))
        XCTAssertNil(changed.target_rpe)
        XCTAssertEqual(changed.target_weight, 28)
        XCTAssertNil(changed.run_steps, "Steps belong to the outdoor run only")
        XCTAssertEqual(base.applying(nil), base)
    }
}
