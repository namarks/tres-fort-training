import Foundation

/// A saved replacement is a reviewed prescription, not a relabeling of a load.
/// The slot identity and grouping stay intact; logged sets keep their identity.
enum ExerciseReplacementDraft {
    static func resetsLoad(_ source: TemplateExercise, with destination: ExerciseCatalog) -> Bool {
        source.exercise_modality != destination.modality
            || source.isPerHand != (destination.load_mode == "per_hand")
    }

    static func slot(_ source: TemplateExercise, with destination: ExerciseCatalog) -> TemplateExercise {
        let duration = source.isTimed ? source.holdSeconds
            : destination.modality == "timed" ? 45 : destination.modality == "cardio" ? 300 : nil
        return TemplateExercise(
            progression: source.progression,
            id: source.id, exercise_id: destination.id, exercise_name: destination.name,
            exercise_unit: destination.unit, order_index: source.order_index,
            target_sets: source.target_sets,
            target_reps: duration ?? source.target_reps,
            target_reps_max: duration == nil ? source.target_reps_max : nil,
            target_rpe: destination.modality == "cardio" ? nil : source.target_rpe,
            rest_seconds: source.rest_seconds,
            target_weight: resetsLoad(source, with: destination) ? nil : source.target_weight,
            cues: source.cues, exercise_modality: destination.modality,
            exercise_laterality: destination.laterality, exercise_load_mode: destination.load_mode,
            exercise_demo_slug: destination.demo_slug, target_duration_s: duration,
            is_warmup: source.is_warmup, target_weight_unit: source.target_weight_unit,
            group_id: source.group_id, group_rest_seconds: source.group_rest_seconds,
            group_transition_seconds: source.group_transition_seconds)
    }

    static func loadMeaning(_ slot: TemplateExercise) -> String {
        if !slot.showsLoadControl { return "No load" }
        if slot.isPerHand { return "Weight of each hand" }
        if slot.allowsAssistance { return "Added load or assistance" }
        return "Total weight"
    }

    /// Review every field a retained target draft can overwrite, including
    /// unknowns. The short targetLabel intentionally excludes load and effort.
    static func summary(_ slot: TemplateExercise) -> String {
        let load = slot.target_weight.map {
            "\(WeightUnit.text($0)) \(slot.targetWeightUnit.rawValue)\(slot.isPerHand ? " each hand" : "")"
        } ?? "No weight target"
        let effort = slot.target_rpe.map { "RPE \(SetValueFormatter.number($0))" } ?? "No effort target"
        return [slot.isWarmup ? "Warm-up" : "Working sets", slot.targetLabel,
                loadMeaning(slot), load, effort, "\(slot.rest_seconds)s rest"].joined(separator: " · ")
    }
}
