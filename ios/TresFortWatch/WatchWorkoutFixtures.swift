#if DEBUG
import Foundation

/// A fictional lifting workout for simulator screenshots and previews.
/// Launch the Watch app with `-watch-workout-fixture ready` (or `rest`,
/// `timed`, `active`, `review`, `chooseWeight`, `refused`, `outOfReach`) to
/// show one without an iPhone. The fixture answers its own taps the way the
/// iPhone would, so a tap moves it along: three sets of squats with rests,
/// two timed planks, then review. Debug builds only.
enum WatchWorkoutFixtures: String {
    case ready
    case rest
    case timed
    case active
    case review
    /// A set whose load the member hasn't chosen yet.
    case chooseWeight
    /// The iPhone refuses every tap.
    case refused
    case outOfReach

    static let argument = "-watch-workout-fixture"
    static let movedOn = "Your iPhone has moved on. Check the set shown now."

    static func requested(in arguments: [String]) -> WatchWorkoutFixtures? {
        guard let index = arguments.firstIndex(of: argument), arguments.indices.contains(index + 1) else { return nil }
        return WatchWorkoutFixtures(rawValue: arguments[index + 1])
    }

    /// Shown under the set from the start, for the refusal's screenshot.
    var notice: String? { self == .refused ? Self.movedOn : nil }

    func state(today: String, now: Date) -> WatchWorkoutState {
        switch self {
        case .ready, .refused, .outOfReach:
            return Self.squat(2, weight: 225, reps: 5, today: today)
        case .rest:
            return Self.squat(2, weight: 225, reps: 5, today: today, restUntil: now.addingTimeInterval(75))
        case .timed:
            return Self.plank(1, seconds: 45, today: today)
        case .active:
            return Self.plank(1, seconds: 45, today: today, started: now.addingTimeInterval(-13))
        case .review:
            return Self.review(today: today)
        case .chooseWeight:
            return Self.squat(1, weight: nil, reps: 5, today: today)
        }
    }

    /// What the iPhone would answer.
    func answer(_ command: WatchWorkoutCommand, to state: WatchWorkoutState?, today: String,
                now: Date) -> WatchWorkoutReceipt {
        guard self != .refused, let state, state.token == command.token, let set = state.set else {
            return .refused(command, Self.movedOn, state: state)
        }
        let parts = state.token.split(separator: ":")
        let number = parts.count > 1 ? Int(parts[1]) ?? 1 : 1
        let weight = command.weight ?? set.weight
        let reps = command.reps ?? set.reps ?? 5
        let seconds = command.durationSeconds ?? set.durationSeconds ?? 45
        let rest = now.addingTimeInterval(90)
        let exercise = parts.first.map { String($0) } ?? ""
        switch (command.action, exercise) {
        case (.logSet, "squat"):
            guard let weight else { return .refused(command, "Choose a weight for this set first.", state: state) }
            let next = number < 3
                ? Self.squat(number + 1, weight: weight, reps: reps, today: today, restUntil: rest)
                : Self.plank(1, seconds: 45, today: today, restUntil: rest)
            return .accepted(command, state: next)
        case (.endRest, "squat"):
            return .accepted(command, state: Self.squat(number, weight: set.weight, reps: reps, today: today))
        case (.endRest, "plank"):
            return .accepted(command, state: Self.plank(number, seconds: seconds, today: today))
        case (.startTimer, "plank"):
            return .accepted(command, state: Self.plank(number, seconds: seconds, today: today, started: now))
        case (.stopTimer, "plank"):
            let next = number < 2
                ? Self.plank(number + 1, seconds: seconds, today: today, restUntil: now.addingTimeInterval(60))
                : Self.review(today: today)
            return .accepted(command, state: next)
        default:
            return .refused(command, Self.movedOn, state: state)
        }
    }

    private static func squat(_ number: Int, weight: Double?, reps: Int, today: String,
                              restUntil: Date? = nil) -> WatchWorkoutState {
        WatchWorkoutState(
            date: today, phase: restUntil == nil ? .ready : .rest, workoutName: "Lower Body",
            token: "squat:\(number)",
            set: WatchWorkoutSet(exerciseName: "Back squat", position: "Set \(number) of 3", showsLoad: true,
                                 weight: weight, weightUnit: "lb", weightStep: 5, allowsAssistance: false,
                                 isPerHand: false, reps: reps, isPerSide: false, durationSeconds: nil,
                                 effort: "Target RPE 8"),
            restEndDate: restUntil, timedEndDate: nil, timedStartDate: nil, title: nil, message: nil)
    }

    private static func plank(_ number: Int, seconds: Int, today: String, restUntil: Date? = nil,
                              started: Date? = nil) -> WatchWorkoutState {
        WatchWorkoutState(
            date: today, phase: started != nil ? .active : restUntil != nil ? .rest : .ready,
            workoutName: "Lower Body", token: "plank:\(number)" + (started == nil ? "" : ":active"),
            set: WatchWorkoutSet(exerciseName: "Plank", position: "Set \(number) of 2", showsLoad: false,
                                 weight: nil, weightUnit: "lb", weightStep: 5, allowsAssistance: false,
                                 isPerHand: false, reps: nil, isPerSide: false, durationSeconds: seconds,
                                 effort: nil),
            restEndDate: restUntil, timedEndDate: started?.addingTimeInterval(TimeInterval(seconds)),
            timedStartDate: started, title: nil, message: nil)
    }

    private static func review(today: String) -> WatchWorkoutState {
        WatchWorkoutState(date: today, phase: .review, workoutName: "Lower Body", token: "review", set: nil,
                          restEndDate: nil, timedEndDate: nil, timedStartDate: nil,
                          title: "Sets complete", message: "Review and finish on your iPhone.")
    }
}
#endif
