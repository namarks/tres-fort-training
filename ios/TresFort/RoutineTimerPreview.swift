import Foundation

/// A read-only rehearsal of a newly reviewed home routine. This mirrors the
/// runner's ordinary order: no invented rep pace and no rest after the final
/// set. A timed set has one countdown, including a one-sided exercise.
struct RoutineTimerPreview: Equatable {
    struct Step: Equatable, Identifiable {
        enum Kind: String { case work, rest }
        let id: Int
        let kind: Kind
        let exerciseID: String
        let title: String
        let context: String
        let seconds: Int?
        let reps: Int?
        let perSide: Bool

        var target: String {
            if let seconds { return RoutineTimerPreview.duration(seconds) + (kind == .rest ? " rest" : " timer") }
            return "\(reps ?? 0) reps" + (perSide ? " each side" : "")
        }

        var instruction: String {
            if kind == .rest { return "Rest starts after the set logs. A cue marks the end; the next set waits for you." }
            return seconds == nil ? "Complete the reps, then log the set."
                : "Tap Start. The countdown logs this set when it finishes."
        }
    }

    let steps: [Step]
    let timedWorkSeconds: Int
    let restSeconds: Int
    let untimedSets: Int

    var timerSeconds: Int { timedWorkSeconds + restSeconds }
    var timeSummary: String {
        if timerSeconds == 0 { return "No fixed duration" }
        return Self.duration(timerSeconds) + (timedWorkSeconds == 0 ? " of planned rest" : " of planned timers")
    }
    var timeExplanation: String {
        let reps = untimedSets > 0 ? "Plus \(untimedSets) rep-based \(untimedSets == 1 ? "set" : "sets") at your own pace. " : ""
        return reps + "Allow extra time for setup and pauses. Skipping rests shortens this estimate."
    }

    static func duration(_ seconds: Int) -> String {
        let hours = seconds / 3_600, minutes = (seconds % 3_600) / 60, remainder = seconds % 60
        var parts: [String] = []
        if hours > 0 { parts.append("\(hours) hr") }
        if minutes > 0 { parts.append("\(minutes) min") }
        if remainder > 0 || parts.isEmpty { parts.append("\(remainder) sec") }
        return parts.joined(separator: " ")
    }
}

extension HomeRoutineDraft {
    func timerPreview(for exercises: [ExerciseCatalog]) -> RoutineTimerPreview? {
        guard validationMessage(for: exercises) == nil, let sets = Int(sets.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        let workSeconds = Int(seconds.trimmingCharacters(in: .whitespacesAndNewlines))
        let repetitions = Int(reps.trimmingCharacters(in: .whitespacesAndNewlines))
        let regularRest = Int(rest.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        let transition = Int(transitionRest.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        let round = Int(roundRest.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        var steps: [RoutineTimerPreview.Step] = []
        var timedWorkSeconds = 0, restSeconds = 0, untimedSets = 0
        let count = exercises.count * sets
        for workIndex in 0..<count {
            let exerciseIndex = circuit ? workIndex % exercises.count : workIndex / sets
            let set = circuit ? workIndex / exercises.count + 1 : workIndex % sets + 1
            let exercise = exercises[exerciseIndex]
            let timed = isTimed(exercise)
            steps.append(.init(id: steps.count, kind: .work, exerciseID: exercise.id, title: exercise.name,
                context: "\(circuit ? "Round" : "Set") \(set) of \(sets)", seconds: timed ? workSeconds : nil,
                reps: timed ? nil : repetitions, perSide: !timed && exercise.laterality == "unilateral"))
            if timed { timedWorkSeconds += workSeconds! } else { untimedSets += 1 }
            guard workIndex + 1 < count else { continue }
            let endsRound = exerciseIndex + 1 == exercises.count
            let pause = circuit ? (endsRound ? round : transition) : regularRest
            guard pause > 0 else { continue }
            restSeconds += pause
            steps.append(.init(id: steps.count, kind: .rest, exerciseID: exercise.id,
                title: circuit ? (endsRound ? "Between rounds" : "Between exercises") : "After the set",
                context: "\(circuit ? "Round" : "Set") \(set) of \(sets)", seconds: pause, reps: nil, perSide: false))
        }
        return RoutineTimerPreview(steps: steps, timedWorkSeconds: timedWorkSeconds, restSeconds: restSeconds, untimedSets: untimedSets)
    }
}
