import Foundation

/// A session-only choice expires when this slot's prescription changes.
struct RunnerRestOverride: Codable, Equatable {
    let prescription: RunnerPrescription
    let seconds: Int

    func matches(_ exercise: TemplateExercise) -> Bool {
        exercise.group_id == nil && (0...3_600).contains(seconds)
            && prescription.matches(current: RunnerPrescription(exercise))
    }
}

/// The editor belongs to the rest that opened it, even after the runner has
/// advanced to another exercise. It can never edit a replacement countdown.
struct RestEditTarget: Identifiable, Equatable {
    let controlID: String
    let seconds: Int
    let exerciseName: String
    let prescription: RunnerPrescription?

    var id: String { controlID }
    var allowsRemainingSets: Bool { prescription != nil }
}
