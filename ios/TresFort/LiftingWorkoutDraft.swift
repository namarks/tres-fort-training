import Foundation

struct LiftingCreationAuthority: Equatable {
    let planID: String?
    let version: Int
}

/// Per-exercise proposals stay local, including incomplete text, until the whole
/// reviewed workout can be committed. Selection order never owns these values.
struct LiftingWorkoutDraft {
    var targets: [String: LiftingExerciseDraft] = [:]

    mutating func include(_ exercise: ExerciseCatalog, unit: WeightUnit) {
        if targets[exercise.id] == nil { targets[exercise.id] = LiftingExerciseDraft(exercise: exercise, unit: unit) }
    }

    func validationMessage(for exercises: [ExerciseCatalog]) -> String? {
        guard !exercises.isEmpty else { return "Choose at least one exercise." }
        guard exercises.count <= 50, Set(exercises.map(\.id)).count == exercises.count else {
            return "Choose up to 50 different exercises."
        }
        for exercise in exercises {
            guard exercise.id != RunPlan.exerciseID else { return "Create an Outdoor Run from your weekly setup so you can review its run steps." }
            guard let draft = targets[exercise.id] else { return "Review the targets for \(exercise.name)." }
            if let message = draft.validationMessage { return "\(exercise.name): \(message)" }
        }
        return nil
    }

    /// Allocate IDs once at submission; retain this exact value for retries.
    func request(name: String, exercises: [ExerciseCatalog], planID: String?, version: Int) -> WorkoutPrescriptionRequest? {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty, cleanName.count <= 200, validationMessage(for: exercises) == nil else { return nil }
        let slots = exercises.enumerated().compactMap { index, exercise -> PartnerSlot? in
            guard let slot = targets[exercise.id]?.slot(id: UUID().uuidString, index: index) else { return nil }
            return PartnerSlot(slot, id: slot.id, index: index, groupID: nil)
        }
        guard slots.count == exercises.count else { return nil }
        return WorkoutPrescriptionRequest(workout_id: UUID().uuidString, name: cleanName,
            expected_plan_id: planID, expected_version: version, slots: slots)
    }
}

struct LiftingExerciseDraft {
    let exercise: ExerciseCatalog
    var sets = "3"
    var reps = "8"
    var repsMax = ""
    var seconds = "45"
    var rest = RestSecondsDraft(seconds: 120)
    var load: SlotLoadDraft
    var warmup = false
    var cues = ""

    init(exercise: ExerciseCatalog, unit: WeightUnit) {
        self.exercise = exercise
        load = SlotLoadDraft(weight: nil, unit: unit, rpe: nil,
            allowsAssistance: exercise.modality == "bw" || exercise.modality == "timed")
        if exercise.modality == "cardio" { sets = "1"; seconds = "300" }
    }

    var isTimed: Bool { exercise.modality == "timed" || exercise.modality == "cardio" }
    var validationMessage: String? {
        guard Self.number(sets, in: 1...100) != nil else { return "Enter 1 to 100 sets." }
        if isTimed {
            guard Self.number(seconds, in: 1...7_200) != nil else { return "Enter 1 to 7,200 seconds." }
        } else {
            guard let minimum = Self.number(reps, in: 1...1_000) else { return "Enter 1 to 1,000 reps." }
            if !repsMax.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               Self.number(repsMax, in: minimum...1_000) == nil { return "The top of the rep range must be at least the starting reps, up to 1,000." }
        }
        guard rest.seconds != nil else { return "Enter a rest from 0 to 3,600 seconds." }
        guard load.isValid else { return "Review the target weight." }
        if let rpe = load.rpe, !rpe.isFinite || !(1...10).contains(rpe) { return "Choose an RPE from 1 to 10." }
        guard cues.count <= 2_000 else { return "Keep cues within 2,000 characters." }
        return nil
    }

    var summary: String {
        guard let slot = slot(id: "preview", index: 0) else { return validationMessage ?? "Review targets" }
        let weight = exercise.modality != "cardio" && load.weight == nil ? " · No target weight" : ""
        return slot.prescriptionLabel(in: load.unit) + weight + " · \(slot.rest_seconds)s rest" + (warmup ? " · Warm-up" : "")
    }

    func slot(id: String, index: Int) -> TemplateExercise? {
        guard validationMessage == nil, let sets = Self.number(sets, in: 1...100), let rest = rest.seconds else { return nil }
        let duration = isTimed ? Self.number(seconds, in: 1...7_200) : nil
        let cleanCues = cues.trimmingCharacters(in: .whitespacesAndNewlines)
        var slot = TemplateExercise(id: id, exercise_id: exercise.id, exercise_name: exercise.name,
            exercise_unit: exercise.unit, order_index: index, target_sets: sets,
            target_reps: duration ?? Self.number(reps, in: 1...1_000)!,
            target_reps_max: isTimed ? nil : Self.number(repsMax, in: 1...1_000), target_rpe: load.rpe,
            rest_seconds: rest, target_weight: exercise.modality == "cardio" ? nil : load.weight,
            cues: cleanCues.isEmpty ? nil : cleanCues, exercise_modality: exercise.modality,
            exercise_laterality: exercise.laterality, exercise_load_mode: exercise.load_mode,
            exercise_demo_slug: exercise.demo_slug, target_duration_s: duration, is_warmup: warmup ? 1 : 0)
        slot.target_weight_unit = load.unit.rawValue
        return slot
    }

    private static func number(_ text: String, in range: ClosedRange<Int>) -> Int? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.allSatisfy({ $0.isASCII && $0.isNumber }),
              let value = Int(clean), range.contains(value) else { return nil }
        return value
    }
}
