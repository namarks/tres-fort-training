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

    func isTimed(_ exercise: ExerciseCatalog) -> Bool {
        timeEveryExercise || exercise.modality == "timed"
    }

    func validationMessage(for exercises: [ExerciseCatalog]) -> String? {
        guard !exercises.isEmpty else { return "Choose at least one exercise." }
        guard exercises.count <= 50, Set(exercises.map(\.id)).count == exercises.count,
              exercises.allSatisfy(ExerciseSearchPolicy.isEquipmentFree) else {
            return "Choose up to 50 different exercises that need no equipment."
        }
        guard Self.number(sets, in: 1...100) != nil else { return "Enter 1 to 100 sets or rounds." }
        if exercises.contains(where: isTimed), Self.number(seconds, in: 1...7_200) == nil {
            return "Enter a hold or work time from 1 to 7,200 seconds."
        }
        if exercises.contains(where: { !isTimed($0) }), Self.number(reps, in: 1...1_000) == nil {
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
        let target = isTimed(exercise) ? "\(seconds)s" : "\(reps) reps"
        return "\(sets) × \(target)" + (!isTimed(exercise) && exercise.laterality == "unilateral" ? " each side" : "")
    }

    /// IDs are allocated only when the member submits. The caller keeps the
    /// resulting request unchanged until it gets an acknowledgement.
    func request(name: String, exercises: [ExerciseCatalog], planID: String, version: Int)
        -> WorkoutPrescriptionRequest? {
        guard validationMessage(for: exercises) == nil, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let sets = Self.number(sets, in: 1...100),
              let rest = Self.number(circuit ? roundRest : rest, in: 0...3_600) else { return nil }
        let groupID = circuit ? UUID().uuidString : nil
        let slots = exercises.enumerated().map { index, exercise in
            let timed = isTimed(exercise)
            let duration = timed ? Int(seconds.trimmingCharacters(in: .whitespacesAndNewlines)) : nil
            let repetitions = timed ? duration! : Int(reps.trimmingCharacters(in: .whitespacesAndNewlines))!
            let id = UUID().uuidString
            var slot = TemplateExercise(id: id, exercise_id: exercise.id, exercise_name: exercise.name,
                exercise_unit: exercise.unit, order_index: index, target_sets: sets, target_reps: repetitions,
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

    private static func number(_ text: String, in range: ClosedRange<Int>) -> Int? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.allSatisfy({ $0.isASCII && $0.isNumber }),
              let value = Int(clean), range.contains(value) else { return nil }
        return value
    }
}
