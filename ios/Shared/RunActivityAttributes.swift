import ActivityKit
import Foundation

// Shared between the app (the run recorder starts, updates and ends the
// Activity) and the widget extension (renders it on the Lock Screen and in
// the Dynamic Island). Compiled into BOTH targets, like RestActivityAttributes.
struct RunActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// While running, the clock counts up from here: the start moved
        /// later by every pause, so the time needs no updates.
        var clockStart: Date
        /// The moving time to show while paused, when the clock stops.
        var pausedSeconds: Double?
        var meters: Double
        /// Seconds per `unit` over the last 30 seconds, when there is one.
        var currentPace: Double?
        var unit: RunDistanceUnit
        /// The lap the run is in: a planned run's step, or the next whole
        /// mile or kilometer. Nil from a build before laps showed here.
        var lap: Lap? = nil
        /// The latest heart rate, sent when the step's target is a heart
        /// rate, so the Lock Screen shows what the target judges.
        var heartRate: Double? = nil

        var isPaused: Bool { pausedSeconds != nil }

        /// When the moving clock reaches `seconds` of moving time, while
        /// running. Nil while paused, when the clock stands still.
        func date(atMovingSeconds seconds: Double) -> Date? {
            isPaused ? nil : clockStart.addingTimeInterval(seconds)
        }
    }

    /// The lap on the Lock Screen (docs/plans/run-recorder P8).
    struct Lap: Codable, Hashable {
        /// "RUN · REP 2 OF 4", "WARM UP", or "MILE 3" for a split.
        var title: String
        /// A planned step, whose time left leads the Lock Screen. A split
        /// leaves the run's time in front.
        var planned: Bool
        /// The run's moving seconds when the lap started and, for a timed
        /// step, when it ends, so the Lock Screen counts down on its own.
        var startSeconds: Double
        var endSeconds: Double?
        /// What's left at this update: "1:42", "180 m" or "0.42 mi".
        var left: String
        /// How far through the lap, 0 to 1, at this update.
        var fraction: Double
        /// "6:00–6:15 /mi" or "150–160 bpm".
        var target: String?
        /// Whether the target is a heart rate, so the Lock Screen shows the
        /// heart rate beside it instead of the pace.
        var targetIsHeartRate: Bool = false
        /// "On target", "Speed up", "Ease off", "Pick it up"; nil without a
        /// reading to judge.
        var verdict: String?
        var onTarget: Bool = false
        /// "2 min recovery"; nil on the last step or for a split.
        var next: String?

        /// The countdown's range of dates while a timed step runs.
        func timerRange(_ state: ContentState) -> ClosedRange<Date>? {
            guard let endSeconds, endSeconds > startSeconds,
                  let start = state.date(atMovingSeconds: startSeconds),
                  let end = state.date(atMovingSeconds: endSeconds) else { return nil }
            return start...end
        }
    }

    /// `RecordedRun.uploadID`, so a control on an older run's activity does
    /// nothing to a newer run.
    var recordingID: String
}

/// Miles or kilometers for the recorder's screen, Lock Screen and spoken
/// splits. The upload always carries meters.
enum RunDistanceUnit: String, Codable, CaseIterable, Hashable {
    case miles
    case kilometers

    var meters: Double { self == .miles ? 1_609.344 : 1_000 }
    var abbreviation: String { self == .miles ? "mi" : "km" }
    var title: String { self == .miles ? "Miles" : "Kilometers" }
    var spokenName: String { self == .miles ? "mile" : "kilometer" }
}

enum RunFormat {
    static func duration(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    static func distance(_ meters: Double, in unit: RunDistanceUnit) -> String {
        String(format: "%.2f", max(0, meters) / unit.meters)
    }

    static func miles(_ meters: Double) -> String { distance(meters, in: .miles) }

    /// "8:05" per mile or kilometer, or a dash when there is no pace yet.
    /// Paces slower than an hour per unit read as no pace.
    static func pace(_ secondsPerUnit: Double?) -> String {
        guard let secondsPerUnit, secondsPerUnit.isFinite, secondsPerUnit > 0, secondsPerUnit < 3600 else {
            return "–"
        }
        let total = Int(secondsPerUnit.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
