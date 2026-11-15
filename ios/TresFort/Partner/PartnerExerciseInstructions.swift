import Foundation

/// The frozen exercise supplies meaning; each lane supplies its own current
/// values. No display value grants authority to log or change either workout.
struct PartnerExerciseInstructions {
    let exercise: TemplateExercise
    let display: PartnerDisplaySlot

    var targetLabel: String {
        if exercise.isTimed {
            return "\(max(1, display.durationSeconds ?? exercise.holdSeconds)) seconds"
        }
        return "\(display.reps) reps" + (exercise.isUnilateral ? " per side" : "")
    }

    var loadLabel: String? {
        guard exercise.showsLoadControl else { return nil }
        guard let weight = display.weight else { return "Choose weight" }
        let unit = WeightUnit(rawValue: display.unit) ?? exercise.targetWeightUnit
        return exercise.loadInstruction(weight: weight, unit: unit)
    }

    var summary: String { [loadLabel, targetLabel].compactMap { $0 }.joined(separator: " · ") }

    static func loadInputLabel(exercise: TemplateExercise, unit: WeightUnit) -> String {
        if exercise.allowsAssistance { return "Load / assistance (\(unit.rawValue))" }
        return "Weight (\(unit.rawValue))" + (exercise.isPerHand ? " · each hand" : "")
    }

    static func loadInputHint(exercise: TemplateExercise) -> String? {
        if exercise.allowsAssistance { return "0 is bodyweight · positive adds load · negative records assistance" }
        if exercise.isPerHand { return "Enter the weight of one dumbbell." }
        return nil
    }
}
