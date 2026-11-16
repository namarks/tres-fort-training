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
    /// Every work set and rest in order, with each exercise's own sets,
    /// reps or hold where it has them (app-design-pass P27).
    func timerPreview(for exercises: [ExerciseCatalog]) -> RoutineTimerPreview? {
        guard validationMessage(for: exercises) == nil else { return nil }
        let regularRest = Int(rest.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        let transition = Int(transitionRest.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        let round = Int(roundRest.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        // (exercise index, set number, sets in all) for each work set.
        var work: [(index: Int, set: Int, of: Int)] = []
        if circuit {
            guard let rounds = Self.number(sets, in: Self.setRange) else { return nil }
            for set in 1...rounds { for index in exercises.indices { work.append((index, set, rounds)) } }
        } else {
            for (index, exercise) in exercises.enumerated() {
                guard let count = self.sets(for: exercise) else { return nil }
                for set in 1...count { work.append((index, set, count)) }
            }
        }
        var steps: [RoutineTimerPreview.Step] = []
        var timedWorkSeconds = 0, restSeconds = 0, untimedSets = 0
        for (position, item) in work.enumerated() {
            let exercise = exercises[item.index]
            let timed = isTimed(exercise)
            guard let value = amount(for: exercise) else { return nil }
            let context = "\(circuit ? "Round" : "Set") \(item.set) of \(item.of)"
            steps.append(.init(id: steps.count, kind: .work, exerciseID: exercise.id, title: exercise.name,
                context: context, seconds: timed ? value : nil,
                reps: timed ? nil : value, perSide: !timed && exercise.laterality == "unilateral"))
            if timed { timedWorkSeconds += value } else { untimedSets += 1 }
            guard position + 1 < work.count else { continue }
            let endsRound = item.index + 1 == exercises.count
            let pause = circuit ? (endsRound ? round : transition) : regularRest
            guard pause > 0 else { continue }
            restSeconds += pause
            steps.append(.init(id: steps.count, kind: .rest, exerciseID: exercise.id,
                title: circuit ? (endsRound ? "Between rounds" : "Between exercises") : "After the set",
                context: context, seconds: pause, reps: nil, perSide: false))
        }
        return RoutineTimerPreview(steps: steps, timedWorkSeconds: timedWorkSeconds, restSeconds: restSeconds, untimedSets: untimedSets)
    }
}
