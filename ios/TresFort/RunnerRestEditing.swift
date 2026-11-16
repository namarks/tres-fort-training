import Foundation

enum RunnerGroupRestKind: String, Codable, Equatable {
    case round, transition

    var remainingLabel: String {
        self == .round ? "Remaining round rests" : "Remaining transitions"
    }
}

struct RunnerGroupRestSource: Equatable {
    let prescription: RunnerGroupPrescription
    let kind: RunnerGroupRestKind
}

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
    var groupSource: RunnerGroupRestSource? = nil

    var id: String { controlID }
    var allowsRemainingSets: Bool { prescription != nil || groupSource != nil }
    var remainingLabel: String { groupSource?.kind.remainingLabel ?? "Remaining sets of this exercise" }
    var scopeTitle: String {
        guard let groupSource else { return exerciseName }
        let members = groupSource.prescription.members
        return (members.count == 2 ? "Superset · " : "Circuit · ")
            + members.map(\.exercise_name).joined(separator: " + ")
    }
    var remainingExplanation: String {
        if let groupSource {
            return groupSource.kind == .round
                ? "Restart this rest from now and use this duration after remaining rounds of this group. Transitions between exercises stay unchanged. This session only."
                : "Restart this rest from now and use this duration between remaining exercises in this group. Rest after each round stays unchanged. This session only."
        }
        return "Restart this rest from now and use this duration after the remaining sets of this exercise. Your saved workout stays unchanged."
    }
}
