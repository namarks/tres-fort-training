import Foundation

/// Member-reviewed edits to block targets, never to reusable prescriptions.
enum ProgramTargetEditing {
    enum Field: String, CaseIterable, Identifiable {
        case sets, reps, duration, load
        var id: String { rawValue }
        var title: String {
            switch self { case .sets: return "Sets / rounds"; case .reps: return "Reps"; case .duration: return "Seconds"; case .load: return "Load" }
        }
    }
    struct Change: Identifiable, Equatable {
        let id: String
        let workout: String
        let exercise: String
        let field: String
        let before: String
        let after: String
    }
    struct Preview {
        let program: PlanProgram
        let changes: [Change]
    }
    /// Compare effective targets on the runner's civil date. The caller
    /// supplies the session-swapped workout, before local extra work is added.
    static func targetsDiffer(workout: Workout, date: String, current: PlanProgram?, proposed: PlanProgram?) -> Bool {
        func targets(_ program: PlanProgram?) -> [String: SlotTargets] {
            guard let program, let index = program.weekIndex(on: date) else { return [:] }
            return program.weeks[index].targets ?? [:]
        }
        let before = targets(current), after = targets(proposed)
        return workout.exercises.map { $0.applying(before[$0.id]) }
            != workout.exercises.map { $0.applying(after[$0.id]) }
    }

    static func scope(_ program: PlanProgram, week: Int, later: Bool = false) -> String {
        let weeks = later && week < program.weeks.count - 1 ? "Weeks \(week + 1)–\(program.weeks.count)" : "Week \(week + 1)"
        return weeks + " of this block" + (program.repeats ? ", each time the block repeats." : ".")
    }
    static func isWorkingLift(_ slot: TemplateExercise) -> Bool {
        !slot.isWarmup && slot.exercise_modality != "cardio" && slot.exercise_id != RunPlan.exerciseID
    }
    static func workouts(_ program: PlanProgram, week index: Int, plan: PlanTree) -> [Workout] {
        guard program.weeks.indices.contains(index) else { return [] }
        let week = program.weeks[index]
        let ids = Set(week.week.values.compactMap { $0 } + (week.extras ?? [:]).values.flatMap { $0 })
        return plan.libraryWorkouts.filter { ids.contains($0.id) && $0.exercises.contains(where: isWorkingLift) }
    }
    static func fields(_ slot: TemplateExercise) -> [Field] {
        [.sets, slot.isTimed ? .duration : .reps, .load]
    }
    static func value(_ slot: TemplateExercise, field: Field) -> Double? {
        switch field {
        case .sets: return Double(slot.target_sets)
        case .reps: return Double(slot.target_reps)
        case .duration: return Double(slot.target_duration_s ?? slot.target_reps)
        case .load: return slot.target_weight
        }
    }
    static func text(_ slot: TemplateExercise, field: Field) -> String {
        guard let value = value(slot, field: field) else { return "Not set" }
        return WeightUnit.text(value) + (field == .load ? " \(slot.targetWeightUnit.rawValue)" : field == .duration ? " s" : "")
    }
    static func valid(_ value: Double, field: Field, slot: TemplateExercise) -> Bool {
        guard value.isFinite else { return false }
        switch field {
        case .sets: return value >= 1 && value <= 100 && value.rounded() == value
        case .reps: return value >= 1 && value <= 10000 && value.rounded() == value
        case .duration: return value >= 1 && value <= 86400 && value.rounded() == value
        case .load: return abs(value) <= 10000 && (value >= 0 || slot.allowsAssistance)
        }
    }
    /// A single field, optionally across later indexed weeks. A nil value
    /// removes that override, allowing future reusable-target edits to flow in.
    static func setting(_ field: Field, value: Double?, slot: TemplateExercise, workout: Workout,
                        week: Int, later: Bool, in program: PlanProgram) -> Preview {
        guard program.weeks.indices.contains(week), isWorkingLift(slot),
              value.map({ valid($0, field: field, slot: slot) }) ?? true else { return Preview(program: program, changes: []) }
        let members = field == .sets && slot.group_id != nil
            ? workout.exercises.filter { $0.group_id == slot.group_id } : [slot]
        // Cardio/warm-up group members are not part of this lifting editor.
        guard members.allSatisfy(isWorkingLift) else { return Preview(program: program, changes: []) }
        var weeks = program.weeks
        var changes: [Change] = []
        for index in week...(later ? weeks.count - 1 : week) {
            let oldWeek = weeks[index]
            var targets = oldWeek.targets ?? [:]
            for member in members {
                let before = member.applying(targets[member.id])
                var target = targets[member.id] ?? SlotTargets()
                switch field {
                case .sets: target.sets = value.map(Int.init)
                case .reps:
                    target.reps = value.map(Int.init)
                    let reps = target.reps ?? member.target_reps
                    if let max = target.repsMax ?? member.target_reps_max, max < reps { target.repsMax = .some(nil) }
                    else if target.repsMax == .some(nil) { target.repsMax = nil }
                case .duration:
                    target.durationS = value.map { .some(Int($0)) }
                    if member.isTimed { target.reps = nil }
                case .load:
                    target.weight = value.map { .some($0) }
                    // The entered load is always in the reusable slot's unit.
                    target.weightUnit = nil
                }
                targets[member.id] = target == SlotTargets() ? nil : target
                let after = member.applying(targets[member.id])
                if before != after || oldWeek.targets?[member.id] != targets[member.id] {
                    changes.append(Change(id: "\(index):\(member.id):\(field.rawValue)", workout: "Week \(index + 1) · \(workout.name)",
                                          exercise: member.exercise_name, field: field.title,
                                          before: text(before, field: field), after: text(after, field: field)))
                }
            }
            weeks[index] = PlanProgram.Week(label: oldWeek.label, week: oldWeek.week, extras: oldWeek.extras,
                                             targets: targets.isEmpty ? nil : targets)
        }
        return Preview(program: replacing(weeks, in: program), changes: changes)
    }
    static func lighter(_ program: PlanProgram, week: Int, plan: PlanTree, workoutID: String?,
                        setsPercent: Double, loadPercent: Double) -> Preview {
        guard program.weeks.indices.contains(week), [setsPercent, loadPercent].allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 90 }) else {
            return Preview(program: program, changes: [])
        }
        var next = program
        var changes: [Change] = []
        for workout in workouts(program, week: week, plan: plan) where workoutID == nil || workout.id == workoutID {
            var groups = Set<String>()
            for slot in workout.exercises where isWorkingLift(slot) {
                let current = slot.applying(program.weeks[week].targets?[slot.id])
                if setsPercent > 0 && (slot.group_id == nil || !groups.contains(slot.group_id!)) {
                    let count = max(1, floor(Double(current.target_sets) * (1 - setsPercent / 100)))
                    if count != Double(current.target_sets) {
                        let result = setting(.sets, value: count, slot: slot, workout: workout, week: week, later: false, in: next)
                        next = result.program; changes += result.changes
                    }
                    if let group = slot.group_id { groups.insert(group) }
                }
                if loadPercent > 0, let load = current.target_weight, load != 0 {
                    let reduced = (load * (load < 0 ? 1 + loadPercent / 100 : 1 - loadPercent / 100) * 10).rounded() / 10
                    guard reduced != load else { continue }
                    var weeks = next.weeks
                    let old = weeks[week]
                    var targets = old.targets ?? [:]
                    var target = targets[slot.id] ?? SlotTargets()
                    target.weight = .some(reduced)
                    // Keep a week's original load unit, avoiding any conversion
                    // or repeated rounding during a percentage adjustment.
                    target.weightUnit = program.weeks[week].targets?[slot.id]?.weightUnit
                    targets[slot.id] = target
                    weeks[week] = PlanProgram.Week(label: old.label, week: old.week, extras: old.extras, targets: targets)
                    next = replacing(weeks, in: next)
                    changes.append(Change(id: "\(week):\(slot.id):load", workout: "Week \(week + 1) · \(workout.name)",
                                          exercise: slot.exercise_name, field: "Load", before: text(current, field: .load),
                                          after: text(slot.applying(target), field: .load)))
                }
            }
        }
        return Preview(program: next, changes: changes)
    }
    private static func replacing(_ weeks: [PlanProgram.Week], in p: PlanProgram) -> PlanProgram {
        PlanProgram(id: p.id, name: p.name, start: p.start, repeats: p.repeats, weeks: weeks)
    }
}
