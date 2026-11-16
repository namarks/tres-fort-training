import XCTest
@testable import TresFort

final class ProgramTargetEditingTests: XCTestCase {
    private func slot(_ id: String, weight: Double? = 100, unit: String = "lb", modality: String = "barbell", group: String? = nil, warm: Bool = false) -> TemplateExercise {
        TemplateExercise(id: id, exercise_id: id, exercise_name: id, exercise_unit: "lb", order_index: 0,
            target_sets: 4, target_reps: 8, target_reps_max: 10, target_rpe: nil, rest_seconds: 90,
            target_weight: weight, cues: nil, exercise_modality: modality, exercise_laterality: nil,
            exercise_load_mode: nil, exercise_demo_slug: nil, target_duration_s: nil, is_warmup: warm ? 1 : 0,
            target_weight_unit: unit, group_id: group)
    }
    private func workout(_ slots: [TemplateExercise], id: String = "lift") -> Workout {
        Workout(id: id, name: id, day_label: nil, order_index: 0, exercises: slots)
    }
    private func program(repeats: Bool = false) -> PlanProgram {
        PlanProgram(id: "block", name: nil, start: "2026-11-16", repeats: repeats,
            weeks: (0..<3).map { _ in PlanProgram.Week(label: nil, week: ["mon": "lift", "wed": "lift"], extras: ["mon": ["core"]]) })
    }
    private func plan(_ workouts: [Workout]) -> PlanTree { PlanTree(id: "plan", name: "Plan", version: 2, workouts: workouts, meta: nil) }

    func testOneWeekOrLaterTargetsNeverChangeReusableSlots() {
        let s = slot("squat"), w = workout([slot("squat")]), p = program()
        let one = ProgramTargetEditing.setting(.reps, value: 12, slot: s, workout: w, week: 1, later: false, in: p)
        XCTAssertNil(one.program.weeks[0].targets)
        XCTAssertEqual(one.program.weeks[1].targets?[s.id]?.reps, 12)
        XCTAssertNil(s.applying(one.program.weeks[1].targets?[s.id]).target_reps_max)
        XCTAssertNil(one.program.weeks[2].targets)
        let later = ProgramTargetEditing.setting(.load, value: 125, slot: s, workout: w, week: 1, later: true, in: p)
        XCTAssertEqual(s.applying(later.program.weeks[1].targets?[s.id]).target_weight, 125)
        XCTAssertEqual(s.applying(later.program.weeks[2].targets?[s.id]).target_weight, 125)
        XCTAssertEqual(s.target_weight, 100); XCTAssertNil(p.weeks[1].targets)
        let reset = ProgramTargetEditing.setting(.load, value: nil, slot: s, workout: w, week: 1, later: false, in: later.program)
        XCTAssertNil(reset.program.weeks[1].targets)
        XCTAssertNotNil(reset.program.weeks[2].targets)
    }
    func testGroupRoundsChangeTogetherButNotSiblingLoad() {
        let a = slot("a", group: "g"), b = slot("b", weight: 50, group: "g"), w = workout([a, b])
        let p = ProgramTargetEditing.setting(.sets, value: 2, slot: a, workout: w, week: 0, later: false, in: program()).program
        XCTAssertEqual(p.weeks[0].targets?[a.id]?.sets, 2); XCTAssertEqual(p.weeks[0].targets?[b.id]?.sets, 2)
        let loaded = ProgramTargetEditing.setting(.load, value: 80, slot: a, workout: w, week: 0, later: false, in: p).program
        XCTAssertNil(loaded.weeks[0].targets?[b.id]?.weight)
    }
    func testLighterWeekUsesEffectiveTargetsOnceIncludingExtrasAndPreservesUnknownLoad() {
        let a = slot("a"), unknown = slot("unknown", weight: nil), assisted = slot("assist", weight: -20, modality: "bw")
        let w = workout([a, unknown]), core = workout([assisted], id: "core")
        let p = ProgramTargetEditing.setting(.load, value: 120, slot: a, workout: w, week: 1, later: false, in: program()).program
        let result = ProgramTargetEditing.lighter(p, week: 1, plan: plan([w, core]), workoutID: nil, setsPercent: 25, loadPercent: 10)
        XCTAssertEqual(a.applying(result.program.weeks[1].targets?[a.id]).target_weight, 108)
        XCTAssertEqual(assisted.applying(result.program.weeks[1].targets?[assisted.id]).target_weight, -22)
        XCTAssertNil(unknown.applying(result.program.weeks[1].targets?[unknown.id]).target_weight)
        XCTAssertEqual(result.changes.filter { $0.id == "1:a:load" }.count, 1)
        XCTAssertEqual(result.program.weeks[0], p.weeks[0]); XCTAssertEqual(result.program.weeks[2], p.weeks[2])
    }
    func testLighterWeekPreservesMixedGroupAndWarmupsAndZeroLoad() {
        let lift = slot("lift", group: "mixed"), cardio = slot("cardio", modality: "cardio", group: "mixed")
        let warm = slot("warm", warm: true), zero = slot("zero", weight: 0), w = workout([lift, cardio, warm, zero])
        let result = ProgramTargetEditing.lighter(program(), week: 0, plan: plan([w]), workoutID: nil, setsPercent: 50, loadPercent: 0)
        XCTAssertNil(result.program.weeks[0].targets?[lift.id]); XCTAssertNil(result.program.weeks[0].targets?[cardio.id])
        XCTAssertNil(result.program.weeks[0].targets?[warm.id]); XCTAssertNil(result.program.weeks[0].targets?[zero.id]?.weight)
        XCTAssertEqual(result.program.weeks[0].targets?[zero.id]?.sets, 2)
    }
    func testLighterWeekKeepsCrossUnitOverrideAndSavedTargetResetIsFieldSpecific() {
        let kg = slot("kg", weight: 50, unit: "kg"), w = workout([kg])
        let base = program()
        let first = base.weeks[0]
        let p = PlanProgram(id: base.id, name: base.name, start: base.start, repeats: false, weeks: [
            PlanProgram.Week(label: first.label, week: first.week, extras: first.extras,
                            targets: [kg.id: SlotTargets(reps: 12, repsMax: .some(nil), weight: .some(100), weightUnit: "lb")]),
            base.weeks[1], base.weeks[2]])
        let lighter = ProgramTargetEditing.lighter(p, week: 0, plan: plan([w]), workoutID: nil, setsPercent: 0, loadPercent: 10)
        let effective = kg.applying(lighter.program.weeks[0].targets?[kg.id])
        XCTAssertEqual(effective.target_weight, 90); XCTAssertEqual(effective.targetWeightUnit, .lb)
        let resetLoad = ProgramTargetEditing.setting(.load, value: nil, slot: kg, workout: w, week: 0, later: false, in: lighter.program)
        XCTAssertEqual(kg.applying(resetLoad.program.weeks[0].targets?[kg.id]).target_weight, 50)
        XCTAssertEqual(kg.applying(resetLoad.program.weeks[0].targets?[kg.id]).targetWeightUnit, .kg)
        XCTAssertEqual(kg.applying(resetLoad.program.weeks[0].targets?[kg.id]).target_reps, 12)
        let resetReps = ProgramTargetEditing.setting(.reps, value: nil, slot: kg, workout: w, week: 0, later: false, in: resetLoad.program)
        XCTAssertEqual(kg.applying(resetReps.program.weeks[0].targets?[kg.id]).target_reps_max, 10)
        XCTAssertNil(resetReps.program.weeks[0].targets)
    }

    func testUnitsValidationAndRepeatScope() {
        let kg = slot("kg", weight: 50, unit: "kg"), w = workout([kg]), p = program(repeats: true)
        let result = ProgramTargetEditing.lighter(p, week: 0, plan: plan([w]), workoutID: "lift", setsPercent: 0, loadPercent: 10)
        XCTAssertEqual(kg.applying(result.program.weeks[0].targets?[kg.id]).target_weight, 45)
        XCTAssertEqual(kg.applying(result.program.weeks[0].targets?[kg.id]).targetWeightUnit, .kg)
        XCTAssertFalse(ProgramTargetEditing.valid(-1, field: .load, slot: kg))
        XCTAssertFalse(ProgramTargetEditing.valid(1.5, field: .sets, slot: kg))
        XCTAssertTrue(ProgramTargetEditing.scope(p, week: 1, later: true).contains("each time the block repeats"))
    }
}
