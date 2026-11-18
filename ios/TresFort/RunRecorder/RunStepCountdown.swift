import Foundation

/// The 3-2-1 beeps before a timed step of a planned run ends
/// (docs/plans/run-recorder P9). Each of the step's last three seconds beeps
/// once and the next step's announcement marks the end. A late check beeps
/// only for the second it falls in and skips the ones it missed, as the lift
/// runner's `TimedSetCountdown` does, so beeps never come in a burst.
/// Distance steps get no beeps: when they end depends on GPS.
struct RunStepCountdown: Equatable {
    /// Beeps from this many seconds left, once a second.
    static let beeps = 3
    /// A shorter step gets no beeps; they would start over its announcement.
    static let minimumStepSeconds = 10

    /// The step the beeps belong to, by its index and where it started, so a
    /// step undone by a pause and started again beeps again.
    private var stepIndex: Int?
    private var stepStart: Double?
    /// The second the last beep marked, counting down from `beeps`.
    private var lastSecond = RunStepCountdown.beeps + 1

    /// The second to beep for now (3, 2 or 1), if one is due. `elapsed` is
    /// the moving seconds since the step started.
    mutating func beep(stepIndex: Int, step: RunPlan.Step, stepStartSeconds: Double, elapsed: Double) -> Int? {
        guard let duration = step.durationSeconds, duration >= Self.minimumStepSeconds else { return nil }
        if stepIndex != self.stepIndex || stepStartSeconds != stepStart {
            self.stepIndex = stepIndex
            stepStart = stepStartSeconds
            lastSecond = Self.beeps + 1
        }
        let left = Double(duration) - elapsed
        guard left > 0, left <= Double(Self.beeps) else { return nil }
        let second = Int(left.rounded(.up))
        guard second < lastSecond else { return nil }
        lastSecond = second
        return second
    }

    /// How long the plan ticker waits with `left` seconds of a timed step to
    /// go: until just past the next countdown second or the step's end, and
    /// never more than a second.
    static func wait(secondsLeft left: Double) -> Double {
        guard left > 0 else { return 0.05 }
        let next = left > Double(beeps) ? Double(beeps) : left.rounded(.up) - 1
        return min(1, max(0.05, left - next + 0.02))
    }
}
