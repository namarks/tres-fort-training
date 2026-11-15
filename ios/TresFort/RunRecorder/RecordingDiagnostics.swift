import Foundation

/// What the recorder saw while a run recorded (docs/plans/run-recorder
/// P5(e)): every pause with whether the member tapped it or auto-pause
/// started it, whether "Pause when I stop" was on, and each GPS fix's speed
/// reading and accuracy, with the phone's motion level when it had one.
/// Sent with the run as the `diagnostics` field of
/// `POST /api/activities/recordings`, in the shape `src/recordingDiagnostics.ts`
/// owns, so a pause can be diagnosed after the phone deletes its copy. Private
/// to the member like the route.
enum RecordingDiagnostics {
    /// A day of fixes at one a second, the server's limit.
    static let maximumFixes = 86_400
    /// The server's limit on the time the fixes span: a day. A run paused
    /// overnight sends only its first day of fixes.
    static let maximumSpanMs: Int64 = 86_400_000
    /// The server's limits on a reading.
    static let maximumSpeedCms = 5_000
    static let maximumAccuracyDm = 100_000
    static let maximumMotionMg = 20_000

    /// The field's JSON, or nil when the run holds nothing to send.
    static func uploadJSON(_ run: RecordedRun) -> String? {
        let ms = { (date: Date) in Int64((date.timeIntervalSince1970 * 1000).rounded()) }
        // Pauses in order, none overlapping, as the server checks.
        var pauses: [[String: Any]] = []
        var lastEnd: Int64 = .min
        for (index, pause) in run.pauses.enumerated() {
            let start = max(ms(pause.start), lastEnd)
            var object: [String: Any] = ["start_ms": start, "automatic": pause.automatic == true]
            if let end = pause.end {
                let endMs = max(ms(end), start)
                object["end_ms"] = endMs
                lastEnd = endMs
            } else if index == run.pauses.count - 1 {
                object["end_ms"] = NSNull()
            } else {
                // An open pause before another can't happen; leave it out.
                continue
            }
            pauses.append(object)
        }
        let body: [String: Any] = [
            "v": 1,
            "auto_pause": run.autoPauseOn.map { $0 as Any } ?? NSNull(),
            "pauses": pauses,
            "speeds": speedsObject(run.speeds ?? [], ms: ms).map { $0 as Any } ?? NSNull(),
        ]
        if pauses.isEmpty && body["speeds"] is NSNull && run.autoPauseOn == nil { return nil }
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func speedsObject(_ samples: [RecordedRun.SpeedSample], ms: (Date) -> Int64) -> [String: Any]? {
        let kept = Array(samples.prefix(maximumFixes))
        guard let first = kept.first else { return nil }
        let start = ms(first.timestamp)
        var last = start
        var dt: [Int64] = []
        var speed: [Any] = []
        var accuracy: [Int] = []
        var motion: [Any] = []
        for sample in kept {
            let time = max(ms(sample.timestamp), last)
            guard time - start <= maximumSpanMs else { break }
            dt.append(time - last)
            last = time
            if let mps = sample.metersPerSecond, mps.isFinite, mps >= 0 {
                speed.append(Int(min(mps * 100, Double(maximumSpeedCms)).rounded()))
            } else {
                speed.append(NSNull())
            }
            let meters = sample.horizontalAccuracy.isFinite ? sample.horizontalAccuracy : .greatestFiniteMagnitude
            accuracy.append(Int(min(max(meters * 10, 0), Double(maximumAccuracyDm)).rounded()))
            if let g = sample.motion, g.isFinite, g >= 0 {
                motion.append(Int(min(g * 1000, Double(maximumMotionMg)).rounded()))
            } else {
                motion.append(NSNull())
            }
        }
        var object: [String: Any] = ["start_ms": start, "dt_ms": dt, "speed_cms": speed, "accuracy_dm": accuracy]
        // Only runs with an accelerometer reading send motion levels, so
        // other runs keep the shape they had.
        if motion.contains(where: { $0 is Int }) { object["motion_mg"] = motion }
        return object
    }
}
