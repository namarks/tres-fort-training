import Foundation

// A lifting workout on the wrist (docs/plans/apple-watch P5). Shared by the
// iPhone app, which runs the workout, and the Apple Watch app, which shows
// the set the iPhone's runner is on and asks the iPhone to act. The Watch
// holds no workout of its own: a tap is a request, the iPhone applies it
// through its own runner or says why not, and the iPhone logs every set.

/// The set the runner is on, worded by the iPhone, with the numbers the
/// crown changes.
struct WatchWorkoutSet: Codable, Equatable {
    let exerciseName: String
    /// "Set 2 of 3", "Warm-up · Set 1 of 2", "Superset A · Round 2 of 3".
    let position: String
    /// Whether this set has a load to show and change.
    let showsLoad: Bool
    /// The load in `weightUnit`. nil while `showsLoad` means the member
    /// hasn't chosen one yet.
    let weight: Double?
    /// "lb" or "kg": the unit the iPhone shows loads in.
    let weightUnit: String
    /// One crown step of load, in `weightUnit`.
    let weightStep: Double
    /// A load below zero is assistance (an assisted pull-up).
    let allowsAssistance: Bool
    let isPerHand: Bool
    let reps: Int?
    let isPerSide: Bool
    /// Set for a timed set, which starts and stops instead of logging reps.
    let durationSeconds: Int?
    /// "RPE 8", "Target RPE 8".
    let effort: String?

    var isTimed: Bool { durationSeconds != nil }
    var needsWeight: Bool { showsLoad && weight == nil }
}

/// What the iPhone's runner shows now.
struct WatchWorkoutState: Codable, Equatable {
    static let currentVersion = 1

    enum Phase: String, Codable {
        case ready, active, rest, paused, exerciseComplete, review, finished, blocked
    }

    var version: Int = WatchWorkoutState.currentVersion
    /// The civil day of the workout on the iPhone. The Watch shows the
    /// workout on that day only.
    let date: String
    let phase: Phase
    let workoutName: String
    /// Names exactly what the runner showed. A tap carries it back, and the
    /// iPhone acts only while its runner still shows the same.
    let token: String
    /// The set to do: during a rest, the set the rest leads to.
    let set: WatchWorkoutSet?
    let restEndDate: Date?
    /// When a running timed set reaches its target; nil for an open hold.
    let timedEndDate: Date?
    let timedStartDate: Date?
    /// For a phase with no set to act on: "Sets complete".
    let title: String?
    let message: String?
}

/// A tap on the Watch: a request the iPhone applies or refuses.
struct WatchWorkoutCommand: Codable, Equatable {
    enum Action: String, Codable {
        case logSet, endRest, startTimer, stopTimer
    }

    let id: UUID
    let action: Action
    /// The `token` of the state the Watch showed when tapped.
    let token: String
    /// Values changed with the crown, in the units the set was shown in.
    /// nil keeps what the runner holds.
    var weight: Double? = nil
    var reps: Int? = nil
    var durationSeconds: Int? = nil
}

/// The iPhone's answer: applied, or why not, and what its runner shows now.
struct WatchWorkoutReceipt: Codable, Equatable {
    let id: UUID
    let accepted: Bool
    let message: String?
    /// The runner after the tap, so the Watch need not wait for it.
    let state: WatchWorkoutState?

    static func accepted(_ command: WatchWorkoutCommand, state: WatchWorkoutState?) -> Self {
        Self(id: command.id, accepted: true, message: nil, state: state)
    }

    static func refused(_ command: WatchWorkoutCommand, _ message: String, state: WatchWorkoutState? = nil) -> Self {
        Self(id: command.id, accepted: false, message: message, state: state)
    }
}

/// How the workout travels. The state rides in the application context
/// beside the day (`WatchDayMessage`), so the Watch gets the latest one when
/// it wakes. A tap goes to the iPhone as a message, answered by a receipt.
enum WatchWorkoutMessage {
    static let workoutKey = "workout"

    /// Sorted keys make equal states encode to equal bytes, so an unchanged
    /// state is never sent twice.
    static func encode(_ state: WatchWorkoutState) -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try? encoder.encode(state)
    }

    /// The workout in a context, or nil: none running, the account left, or
    /// a format this build doesn't understand.
    static func workout(in context: [String: Any]) -> WatchWorkoutState? {
        guard context[WatchDayMessage.versionKey] as? Int == WatchDaySnapshot.currentVersion,
              context[WatchDayMessage.clearedKey] as? Bool != true,
              let bytes = context[workoutKey] as? Data,
              let state = try? JSONDecoder().decode(WatchWorkoutState.self, from: bytes),
              state.version == WatchWorkoutState.currentVersion
        else { return nil }
        return state
    }

    static func encode(_ command: WatchWorkoutCommand) -> Data? { try? JSONEncoder().encode(command) }
    static func command(from data: Data) -> WatchWorkoutCommand? {
        try? JSONDecoder().decode(WatchWorkoutCommand.self, from: data)
    }

    static func encode(_ receipt: WatchWorkoutReceipt) -> Data? { try? JSONEncoder().encode(receipt) }
    static func receipt(from data: Data) -> WatchWorkoutReceipt? {
        try? JSONDecoder().decode(WatchWorkoutReceipt.self, from: data)
    }
}

/// The values on the Watch's set screen while the member turns the crown.
/// They stay on the Watch until Log or Start sends them with the tap.
struct WatchSetDraft: Equatable {
    static let heaviest = 2_000.0
    static let mostReps = 999
    static let durationStep = 5
    static let longestSeconds = 3_600

    var weight: Double?
    var reps: Int?
    var durationSeconds: Int?

    init(_ set: WatchWorkoutSet) {
        weight = set.weight
        reps = set.reps
        durationSeconds = set.durationSeconds
    }

    /// One crown step is the runner's small step: 5 lb or 2.5 kg. A load not
    /// chosen yet starts from zero.
    mutating func stepWeight(_ steps: Int, of set: WatchWorkoutSet) {
        guard set.showsLoad, steps != 0 else { return }
        let lowest = set.allowsAssistance ? -Self.heaviest : 0
        let next = (weight ?? 0) + Double(steps) * set.weightStep
        weight = min(Self.heaviest, max(lowest, next))
    }

    mutating func stepReps(_ steps: Int) {
        guard let current = reps, steps != 0 else { return }
        reps = min(Self.mostReps, max(0, current + steps))
    }

    mutating func stepDuration(_ steps: Int) {
        guard let current = durationSeconds, steps != 0 else { return }
        durationSeconds = min(Self.longestSeconds, max(Self.durationStep, current + steps * Self.durationStep))
    }

    /// Whether the member changed anything from what the iPhone sent.
    func isChanged(from set: WatchWorkoutSet) -> Bool { self != WatchSetDraft(set) }

    /// The tap for this set, carrying only the values that changed.
    func command(_ action: WatchWorkoutCommand.Action, token: String, set: WatchWorkoutSet,
                 id: UUID = UUID()) -> WatchWorkoutCommand {
        var command = WatchWorkoutCommand(id: id, action: action, token: token)
        guard action == .logSet || action == .startTimer else { return command }
        if weight != set.weight { command.weight = weight }
        if reps != set.reps { command.reps = reps }
        if durationSeconds != set.durationSeconds { command.durationSeconds = durationSeconds }
        return command
    }
}

/// What the Watch shows for a workout state, and its words.
enum WatchWorkoutPresentation {
    /// The button under the set.
    enum Primary: Equatable {
        case log, startTimer, stopTimer, endRest
    }

    static let outOfReach = "Your iPhone is out of reach. Nothing is logged until it is back."
    static let noAnswer = "Your iPhone didn’t answer. Nothing was logged. Try again."
    /// In the button's place while it can't act.
    static let outOfReachShort = "iPhone out of reach"
    static let chooseWeight = "Turn the crown for the weight"

    /// The workout to show on `today`, or nil for the day's list: nothing is
    /// running, or what the Watch holds is from another day.
    static func shown(_ state: WatchWorkoutState?, today: String) -> WatchWorkoutState? {
        guard let state, state.version == WatchWorkoutState.currentVersion, state.date == today else { return nil }
        return state
    }

    /// A rest is over once its end passes, whether or not the iPhone, which
    /// may be asleep in a pocket, has said so yet.
    static func isResting(_ state: WatchWorkoutState, at now: Date) -> Bool {
        guard state.phase == .rest, let end = state.restEndDate else { return false }
        return end > now
    }

    static func primary(_ state: WatchWorkoutState, at now: Date) -> Primary? {
        guard let set = state.set else { return nil }
        switch state.phase {
        case .rest:
            return isResting(state, at: now) ? .endRest : (set.isTimed ? .startTimer : .log)
        case .ready:
            return set.isTimed ? .startTimer : .log
        case .active:
            return .stopTimer
        case .paused, .exerciseComplete, .review, .finished, .blocked:
            return nil
        }
    }

    static func title(_ primary: Primary) -> String {
        switch primary {
        case .log: return "Log set"
        case .startTimer: return "Start"
        case .stopTimer: return "Stop & log"
        case .endRest: return "End rest"
        }
    }

    static func action(_ primary: Primary) -> WatchWorkoutCommand.Action {
        switch primary {
        case .log: return .logSet
        case .startTimer: return .startTimer
        case .stopTimer: return .stopTimer
        case .endRest: return .endRest
        }
    }

    /// "225", "+25" on a bodyweight movement, "20" for 20 of assistance,
    /// "BW" for none, and a dash while no load is chosen.
    static func loadText(_ weight: Double?, of set: WatchWorkoutSet) -> String {
        guard let weight else { return "–" }
        if set.allowsAssistance, weight == 0 { return "BW" }
        let prefix = set.allowsAssistance && weight > 0 ? "+" : ""
        return prefix + number(abs(weight))
    }

    /// Under the load: "lb", "lb / hand", "lb assist".
    static func loadLabel(_ weight: Double?, of set: WatchWorkoutSet) -> String {
        if let weight, weight < 0 { return "\(set.weightUnit) assist" }
        return set.isPerHand ? "\(set.weightUnit) / hand" : set.weightUnit
    }

    static func repsLabel(_ set: WatchWorkoutSet) -> String { set.isPerSide ? "reps / side" : "reps" }

    /// "0:45", "1:30".
    static func clock(_ seconds: Int) -> String {
        let total = max(0, seconds)
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }

    /// One line for the set a rest leads to: "225 lb × 5", "0:45".
    static func summary(_ set: WatchWorkoutSet) -> String {
        var parts: [String] = []
        if set.showsLoad, let weight = set.weight {
            if set.allowsAssistance, weight == 0 {
                parts.append("Bodyweight")
            } else {
                parts.append("\(loadText(weight, of: set)) \(loadLabel(weight, of: set))")
            }
        }
        if let seconds = set.durationSeconds {
            parts.append(clock(seconds))
        } else if let reps = set.reps {
            parts.append(parts.isEmpty ? "\(reps) \(repsLabel(set))" : "\(reps)")
        }
        return parts.joined(separator: " × ")
    }

    /// Up to three decimals and no trailing zeros: 225, 22.5, 8.165.
    static func number(_ value: Double) -> String {
        let text = String(format: "%.3f", locale: Locale(identifier: "en_US_POSIX"), value)
        guard text.contains(".") else { return text }
        var trimmed = Substring(text)
        while trimmed.hasSuffix("0") { trimmed = trimmed.dropLast() }
        if trimmed.hasSuffix(".") { trimmed = trimmed.dropLast() }
        return String(trimmed)
    }
}
