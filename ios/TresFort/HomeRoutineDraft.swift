import Foundation

/// A home routine is reviewed before its first write. Text fields retain
/// unfinished input; invalid values never fall back to an unseen default.
struct HomeRoutineDraft {
    var sets = "3"
    var reps = "8"
    var seconds = "45"
    var rest = "120"
    var circuit = false
    var timeEveryExercise = false
    var transitionRest = "20"
    var roundRest = "60"
    /// One exercise's own sets, reps or hold, set by tapping it in the
    /// list (app-design-pass P27); anything left nil uses the routine's.
    /// A circuit's rounds are shared, so its sets ignore these.
    var overrides: [String: Override] = [:]

    struct Override: Equatable {
        var sets: Int?
        var reps: Int?
        var seconds: Int?
        var isEmpty: Bool { sets == nil && reps == nil && seconds == nil }
    }

    static let setRange = 1...100
    static let repRange = 1...1_000
    static let secondRange = 1...7_200

    /// The sets an exercise is done for: its own, else the routine's.
    func sets(for exercise: ExerciseCatalog) -> Int? {
        let shared = Self.number(sets, in: Self.setRange)
        guard !circuit, let own = overrides[exercise.id]?.sets else { return shared }
        return own
    }

    /// Its reps, or its hold in seconds when it's timed.
    func amount(for exercise: ExerciseCatalog) -> Int? {
        if isTimed(exercise) {
            return overrides[exercise.id]?.seconds ?? Self.number(seconds, in: Self.secondRange)
        }
        return overrides[exercise.id]?.reps ?? Self.number(reps, in: Self.repRange)
    }

    /// Whether every exercise has a value of its own for this field, so the
    /// routine's shared value doesn't apply to any of them.
    private func allOwn(_ exercises: [ExerciseCatalog], _ value: (Override) -> Int?) -> Bool {
        !exercises.isEmpty && exercises.allSatisfy { overrides[$0.id].flatMap(value) != nil }
    }

    func isTimed(_ exercise: ExerciseCatalog) -> Bool {
        timeEveryExercise || exercise.modality == "timed"
    }

    func validationMessage(for exercises: [ExerciseCatalog]) -> String? {
        guard !exercises.isEmpty else { return "Choose at least one exercise." }
        guard exercises.count <= 50, Set(exercises.map(\.id)).count == exercises.count,
              exercises.allSatisfy(ExerciseSearchPolicy.isEquipmentFree) else {
            return "Choose up to 50 different exercises that need no equipment."
        }
        guard exercises.allSatisfy({ sets(for: $0) != nil }) else { return "Enter 1 to 100 sets or rounds." }
        let timed = exercises.filter(isTimed), counted = exercises.filter { !isTimed($0) }
        if !timed.isEmpty, !allOwn(timed, \.seconds), Self.number(seconds, in: Self.secondRange) == nil {
            return "Enter a hold or work time from 1 to 7,200 seconds."
        }
        if !counted.isEmpty, !allOwn(counted, \.reps), Self.number(reps, in: Self.repRange) == nil {
            return "Enter 1 to 1,000 reps."
        }
        if circuit {
            guard exercises.count >= 2 else { return "A circuit needs at least two exercises." }
            guard Self.number(transitionRest, in: 0...3_600) != nil,
                  Self.number(roundRest, in: 0...3_600) != nil else {
                return "Enter transition and round rests from 0 to 3,600 seconds."
            }
        } else if Self.number(rest, in: 0...3_600) == nil {
            return "Enter a rest from 0 to 3,600 seconds."
        }
        return nil
    }

    func targetLabel(for exercise: ExerciseCatalog) -> String {
        let count = self.sets(for: exercise).map(String.init) ?? sets
        let value = self.amount(for: exercise).map(String.init) ?? (isTimed(exercise) ? seconds : reps)
        let target = isTimed(exercise) ? "\(value)s" : "\(value) reps"
        return "\(count) × \(target)" + (!isTimed(exercise) && exercise.laterality == "unilateral" ? " each side" : "")
    }

    /// IDs are allocated only when the member submits. The caller keeps the
    /// resulting request unchanged until it gets an acknowledgement.
    func request(name: String, exercises: [ExerciseCatalog], planID: String, version: Int)
        -> WorkoutPrescriptionRequest? {
        guard validationMessage(for: exercises) == nil, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let rest = Self.number(circuit ? roundRest : rest, in: 0...3_600) else { return nil }
        let groupID = circuit ? UUID().uuidString : nil
        let slots = exercises.enumerated().map { index, exercise in
            let timed = isTimed(exercise)
            let setCount = self.sets(for: exercise)!
            let value = self.amount(for: exercise)!
            let duration = timed ? value : nil
            let repetitions = value
            let id = UUID().uuidString
            var slot = TemplateExercise(id: id, exercise_id: exercise.id, exercise_name: exercise.name,
                exercise_unit: exercise.unit, order_index: index, target_sets: setCount, target_reps: repetitions,
                target_reps_max: nil, target_rpe: nil, rest_seconds: rest, target_weight: nil, cues: nil,
                exercise_modality: exercise.modality, exercise_laterality: exercise.laterality,
                exercise_load_mode: exercise.load_mode, exercise_demo_slug: exercise.demo_slug,
                target_duration_s: duration, is_warmup: 0)
            slot.group_id = groupID
            slot.group_rest_seconds = circuit ? Int(roundRest.trimmingCharacters(in: .whitespacesAndNewlines)) : nil
            slot.group_transition_seconds = circuit ? Int(transitionRest.trimmingCharacters(in: .whitespacesAndNewlines)) : nil
            return PartnerSlot(slot, id: id, index: index, groupID: groupID)
        }
        return WorkoutPrescriptionRequest(workout_id: UUID().uuidString,
            name: name.trimmingCharacters(in: .whitespacesAndNewlines), expected_plan_id: planID,
            expected_version: version, slots: slots)
    }

    static func number(_ text: String, in range: ClosedRange<Int>) -> Int? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.allSatisfy({ $0.isASCII && $0.isNumber }),
              let value = Int(clean), range.contains(value) else { return nil }
        return value
    }
}
