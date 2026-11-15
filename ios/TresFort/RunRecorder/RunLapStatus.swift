import Foundation

/// The lap a recording run is in, for the recorder's Step page and the Lock
/// Screen (docs/plans/run-recorder P8): a planned run's current step, or,
/// without a plan or once it's done, the next whole mile or kilometer.
struct RunLapStatus: Equatable {
    /// "RUN · REP 2 OF 4", "WARM UP", or "MILE 3" for a split.
    var title: String
    /// A planned step. A split is only a distance to the next whole unit.
    var planned: Bool
    /// "STEP 4 OF 10" for a planned step.
    var position: String?
    /// The run's moving seconds when the lap started and, for a timed step,
    /// when it ends.
    var startSeconds: Double
    var endSeconds: Double?
    /// What's left now: "1:42", "180 m" or "0.42 mi".
    var left: String
    /// The whole lap: "3:00", "400 m" or "1 mi", for "LEFT OF 3:00".
    var whole: String
    /// How far through the lap, 0 to 1.
    var fraction: Double
    var target: RunPlan.Target?
    /// "2 min recovery"; nil on the last step or for a split.
    var next: String?

    /// The current step of a planned run, or nil without one.
    static func step(_ steps: [RunPlan.ExpandedStep], progress: RunPlanProgress, movingSeconds: Double,
                     meters: Double, unit: RunDistanceUnit) -> RunLapStatus? {
        guard steps.indices.contains(progress.stepIndex) else { return nil }
        let current = steps[progress.stepIndex]
        let step = current.step
        var title = RunPlanFormat.kindTitle(step.kind).uppercased()
        if let round = current.round, let rounds = current.rounds { title += " · REP \(round) OF \(rounds)" }
        let next = steps.indices.contains(progress.stepIndex + 1)
            ? RunPlanFormat.text(steps[progress.stepIndex + 1].step, unit: unit) : nil
        var status = RunLapStatus(title: title, planned: true,
                                  position: "STEP \(progress.stepIndex + 1) OF \(steps.count)",
                                  startSeconds: progress.stepStartSeconds, endSeconds: nil,
                                  left: "–", whole: RunPlanFormat.amount(step, unit: unit), fraction: 0,
                                  target: step.target, next: next)
        if let duration = step.durationSeconds, duration > 0 {
            let total = Double(duration)
            let done = min(max(0, movingSeconds - progress.stepStartSeconds), total)
            status.endSeconds = progress.stepStartSeconds + total
            status.left = RunFormat.duration((total - done).rounded(.up))
            status.whole = RunFormat.duration(total)
            status.fraction = done / total
        } else if let distance = step.distanceMeters, distance > 0 {
            let done = min(max(0, meters - progress.stepStartMeters), distance)
            status.left = RunPlanFormat.distance(distance - done, unit: unit)
            status.fraction = done / distance
        }
        return status
    }

    /// The next whole mile or kilometer: "MILE 3", "0.42 mi" left.
    static func split(meters: Double, movingSeconds: Double, unit: RunDistanceUnit) -> RunLapStatus {
        let done = max(0, meters) / unit.meters
        let number = Int(done.rounded(.down)) + 1
        let fraction = done - Double(number - 1)
        return RunLapStatus(title: "\(unit.spokenName.uppercased()) \(number)", planned: false, position: nil,
                            startSeconds: movingSeconds, endSeconds: nil,
                            left: RunFormat.distance((1 - fraction) * unit.meters, in: unit) + " " + unit.abbreviation,
                            whole: "1 \(unit.abbreviation)", fraction: fraction, target: nil, next: nil)
    }

    /// Where a reading sits against the step's target, for the screen.
    enum Verdict: Equatable {
        case onTarget, speedUp, easeOff, pickItUp

        var text: String {
            switch self {
            case .onTarget: "On target"
            case .speedUp: "Speed up"
            case .easeOff: "Ease off"
            case .pickItUp: "Pick it up"
            }
        }

        var isOnTarget: Bool { self == .onTarget }
    }

    /// `value` is pace in seconds per km or heart rate in bpm. Nil without
    /// a target or a reading, and just outside the range, where a spoken
    /// cue also waits.
    static func verdict(_ value: Double?, target: RunPlan.Target?) -> Verdict? {
        guard let value, let target, let reading = RunTargetCoach.reading(value, target: target) else { return nil }
        switch (target, reading) {
        case (_, .onTarget): return .onTarget
        case (.pace, .above): return .speedUp
        case (.pace, .below): return .easeOff
        case (.heartRate, .above): return .easeOff
        case (.heartRate, .below): return .pickItUp
        }
    }

    /// The step's target is a heart rate, so its reading is one too.
    var isHeartRateTarget: Bool {
        guard case .heartRate = target ?? .pace(fastestSecondsPerKm: 0, slowestSecondsPerKm: 0) else { return false }
        return true
    }

    /// The Lock Screen's copy, with the target written in `unit` and the
    /// verdict for `value`.
    func activityLap(value: Double?, unit: RunDistanceUnit) -> RunActivityAttributes.Lap {
        let verdict = Self.verdict(value, target: target)
        return .init(title: title, planned: planned, startSeconds: startSeconds, endSeconds: endSeconds,
                     left: left, fraction: min(max(fraction, 0), 1),
                     target: target.map { RunPlanFormat.target($0, unit: unit) },
                     targetIsHeartRate: isHeartRateTarget, verdict: verdict?.text,
                     onTarget: verdict?.isOnTarget ?? false, next: next)
    }
}
