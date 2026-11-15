import CoreFoundation
import Foundation

/// One slot's targets for one week of a block (docs/plans/progressive-plans
/// P1, spec.md): a long run grows from 8 to 20 miles, a swing gets heavier,
/// without a workout per week. A nil field keeps the slot's own value; for a
/// nullable target, `.some(nil)` clears it. Parsed with the server's
/// `normalizeWeekTargets` envelope rules; applied like `applySlotTargets`
/// (src/programTargets.ts), with ProgramTargets.json as the shared contract.
struct SlotTargets: Equatable {
    var sets: Int?
    var reps: Int?
    var repsMax: Int??
    var rpe: Double??
    var weight: Double??
    var weightUnit: String?
    var durationS: Int??
    var runSteps: String??

    init(sets: Int? = nil, reps: Int? = nil, repsMax: Int?? = nil, rpe: Double?? = nil,
         weight: Double?? = nil, weightUnit: String? = nil, durationS: Int?? = nil, runSteps: String?? = nil) {
        self.sets = sets
        self.reps = reps
        self.repsMax = repsMax
        self.rpe = rpe
        self.weight = weight
        self.weightUnit = weightUnit
        self.durationS = durationS
        self.runSteps = runSteps
    }

    /// Mirror of one entry of `normalizeWeekTargets`; nil when it keeps nothing.
    init?(json: Any?) {
        guard let t = json as? [String: Any] else { return nil }
        self.init()
        sets = Self.count(t["target_sets"])
        reps = Self.count(t["target_reps"])
        repsMax = Self.nullable(t["target_reps_max"], Self.count)
        durationS = Self.nullable(t["target_duration_s"], Self.count)
        rpe = Self.nullable(t["target_rpe"], Self.number)
        weight = Self.nullable(t["target_weight"], Self.number)
        if let unit = t["target_weight_unit"] as? String, unit == "lb" || unit == "kg" { weightUnit = unit }
        runSteps = Self.nullable(t["run_steps"]) { $0 as? String }
        if self == SlotTargets() { return nil }
    }

    /// Present and null → `.some(nil)`; present and valid → `.some(value)`.
    private static func nullable<T>(_ value: Any?, _ read: (Any?) -> T?) -> T?? {
        guard let value else { return nil }
        if value is NSNull { return .some(nil) }
        return read(value).map { .some($0) }
    }

    private static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        return d.isFinite ? d : nil
    }

    /// A whole number of at least 1, as the server's `int` check.
    private static func count(_ value: Any?) -> Int? {
        guard let d = number(value), let i = Int(exactly: d), i >= 1 else { return nil }
        return i
    }
}

extension TemplateExercise {
    /// This slot with one week's targets laid over it. Steps apply only while
    /// the slot is still the outdoor run, and a raised minimum clears a range
    /// it would turn upside down.
    func applying(_ targets: SlotTargets?) -> TemplateExercise {
        guard let targets else { return self }
        let reps = targets.reps ?? target_reps
        var repsMax = targets.repsMax ?? target_reps_max
        if let max = repsMax, max < reps { repsMax = nil }
        let steps = exercise_id == RunPlan.exerciseID ? (targets.runSteps ?? run_steps) : run_steps
        return TemplateExercise(
            progression: progression, id: id, exercise_id: exercise_id, exercise_name: exercise_name,
            exercise_unit: exercise_unit, order_index: order_index,
            target_sets: targets.sets ?? target_sets, target_reps: reps, target_reps_max: repsMax,
            target_rpe: targets.rpe ?? target_rpe, rest_seconds: rest_seconds,
            target_weight: targets.weight ?? target_weight, cues: cues,
            exercise_modality: exercise_modality, exercise_laterality: exercise_laterality,
            exercise_load_mode: exercise_load_mode, exercise_demo_slug: exercise_demo_slug,
            target_duration_s: targets.durationS ?? target_duration_s, is_warmup: is_warmup,
            target_weight_unit: targets.weightUnit ?? target_weight_unit,
            group_id: group_id, group_rest_seconds: group_rest_seconds,
            group_transition_seconds: group_transition_seconds, run_steps: steps)
    }
}

extension PlanTree {
    /// Slot id → targets for the week of the block that covers `ymd`; empty
    /// outside a block. Mirror of `weekTargetsOn`.
    func weekTargets(on ymd: String) -> [String: SlotTargets] {
        guard let program, let index = program.weekIndex(on: ymd) else { return [:] }
        return program.weeks[index].targets ?? [:]
    }

    /// A workout as it reads on `ymd`: every slot with that week's targets.
    func workout(_ workout: Workout, on ymd: String) -> Workout {
        let targets = weekTargets(on: ymd)
        guard !targets.isEmpty else { return workout }
        var out = Workout(id: workout.id, name: workout.name, day_label: workout.day_label,
                          order_index: workout.order_index,
                          exercises: workout.exercises.map { $0.applying(targets[$0.id]) })
        out.tags = workout.tags
        out.archived_at = workout.archived_at
        return out
    }
}
