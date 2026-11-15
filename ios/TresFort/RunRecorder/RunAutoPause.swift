import CoreLocation
import Foundation

/// Decides when auto-pause pauses and resumes a run, one GPS fix at a time,
/// from GPS and the phone's motion (docs/plans/run-recorder P4).
///
/// GPS: the phone's speed reading lags a stop by a second or two, jumps
/// around while the runner stands still, and can be missing altogether,
/// while the fixes' positions stay put (the owner's 2026-11-10 light). So a
/// pause looks at the last three seconds of fixes as a whole: how far they
/// moved, and their typical (median) speed reading.
///
/// Motion: GPS alone can't tell a very slow walk from standing. On the
/// owner's 2026-11-12 intervals the speed reading dipped to 0.4 to 0.7 m/s
/// while he walked his recoveries, under the old 0.8 m/s line, and the run
/// paused twice mid-walk. Steps shake the phone; standing doesn't. So:
/// - while the phone shows steps, the run never pauses;
/// - once it has been still for two seconds, the run pauses as soon as the
///   last two seconds of GPS are under walking pace (0.8 m/s);
/// - without a clear motion reading (no accelerometer, or in between), GPS
///   must read under 0.4 m/s, which a walk didn't reach on that run.
///
/// A resume needs every fix over an easy walk for two seconds, by its speed
/// reading or else by how far it moved from the fix before, or a single
/// such fix while the phone shows steps. A phone that stays still never
/// resumes the run, so a GPS jump while standing can't.
struct RunAutoPause {
    /// Slower than walking pace (about 2.9 km/h), once the phone is still.
    static let pauseSpeed: CLLocationSpeed = 0.8
    /// Without a clear motion reading: slower than any walk on the owner's
    /// runs.
    static let gpsOnlyPauseSpeed: CLLocationSpeed = 0.4
    /// A pause looks at the fixes from this many seconds back.
    static let pauseWindow: TimeInterval = 3
    /// At least this many fixes, covering at least this long, before a
    /// pause: about three seconds of standing at GPS's one fix a second.
    static let pauseMinimumFixes = 3
    static let pauseMinimumSpan: TimeInterval = 2
    /// With the phone still, the fixes from the last two seconds, at least
    /// two a second apart, are enough.
    static let stillWindow: TimeInterval = 2
    static let stillMinimumFixes = 2
    static let stillMinimumSpan: TimeInterval = 1
    /// Faster than an easy walk for this long resumes.
    static let resumeSpeed: CLLocationSpeed = 1.4
    static let resumeDelay: TimeInterval = 2

    /// Motion reads over this many seconds before a fix, from at least two
    /// of the motion source's once-a-second levels.
    static let motionWindow: TimeInterval = 2
    static let motionMinimumSamples = 2
    /// Every level in the window at or under this: the phone is still.
    /// Standing with the phone in a pocket, armband or hand reads a few
    /// hundredths of g.
    static let stillLevel = 0.05
    /// Every level at or over this: steps. A walk reads a few tenths of g,
    /// a run more.
    static let stepsLevel = 0.12

    enum Change: Equatable {
        /// Pause from this time: the fix that showed the stop. Not dated back
        /// further, so the clock agrees with the Health workout, whose
        /// session pauses only when told.
        case pause(at: Date)
        /// Resume from this time: the fix that showed the runner moving.
        case resume(at: Date)
    }

    enum Motion: Equatable { case still, steps, unclear }

    private var recent: [CLLocation] = []
    private var fastSince: Date?
    /// The last fix seen, so a fix without a speed reading can be timed by
    /// how far it moved.
    private var previous: CLLocation?
    /// The motion source's levels from the last few seconds.
    private var motionSamples: [RunMotionSample] = []

    /// Starts over, after any pause or resume. Motion readings are kept.
    mutating func reset() {
        recent = []
        fastSince = nil
    }

    /// A level from the motion source.
    mutating func add(_ sample: RunMotionSample) {
        guard sample.level.isFinite, sample.level >= 0 else { return }
        motionSamples.append(sample)
        motionSamples.sort { $0.timestamp < $1.timestamp }
        let latest = motionSamples.last!.timestamp
        motionSamples.removeAll { latest.timeIntervalSince($0.timestamp) > 30 }
    }

    /// The motion levels read over the window before `time`. A level stamped
    /// up to half a second after the fix still counts, as the two clocks
    /// tick separately.
    private func motionWindow(at time: Date) -> [Double] {
        motionSamples.filter {
            let age = time.timeIntervalSince($0.timestamp)
            return age < Self.motionWindow && age >= -0.5
        }.map(\.level)
    }

    /// What the phone's motion says at `time`.
    func motion(at time: Date) -> Motion {
        let levels = motionWindow(at: time)
        guard levels.count >= Self.motionMinimumSamples else { return .unclear }
        if levels.allSatisfy({ $0 <= Self.stillLevel }) { return .still }
        if levels.allSatisfy({ $0 >= Self.stepsLevel }) { return .steps }
        return .unclear
    }

    /// The average motion level at `time`, kept with each fix for diagnosing
    /// a pause later; nil without a reading.
    func motionLevel(at time: Date) -> Double? {
        let levels = motionWindow(at: time)
        guard !levels.isEmpty else { return nil }
        return levels.reduce(0, +) / Double(levels.count)
    }

    /// A fix while the run is moving.
    mutating func running(_ location: CLLocation) -> Change? {
        previous = location
        fastSince = nil
        let time = location.timestamp
        recent.append(location)
        recent.removeAll { time.timeIntervalSince($0.timestamp) > Self.pauseWindow }
        let phone = motion(at: time)
        // Steps mean the runner hasn't stopped, whatever GPS says.
        guard phone != .steps else { return nil }
        let still = phone == .still
        let fixes = still ? recent.filter { time.timeIntervalSince($0.timestamp) <= Self.stillWindow } : recent
        let minimumFixes = still ? Self.stillMinimumFixes : Self.pauseMinimumFixes
        guard fixes.count >= minimumFixes, let first = fixes.first else { return nil }
        let span = time.timeIntervalSince(first.timestamp)
        guard span >= (still ? Self.stillMinimumSpan : Self.pauseMinimumSpan),
              // Not while the latest fix shows the runner off again.
              location.speed <= Self.resumeSpeed else { return nil }
        let threshold = still ? Self.pauseSpeed : Self.gpsOnlyPauseSpeed
        let moved = zip(fixes, fixes.dropFirst()).reduce(0.0) { $0 + $1.1.distance(from: $1.0) } / span
        let readings = fixes.map { $0.speed }.filter { $0 >= 0 }
        let stopped = readings.count >= minimumFixes
            // A low reading while the fixes still cover ground isn't a stop.
            ? Self.median(readings) < threshold && moved < Self.resumeSpeed
            : moved < threshold
        return stopped ? .pause(at: time) : nil
    }

    /// A fix while auto-paused.
    mutating func paused(_ location: CLLocation) -> Change? {
        recent = []
        let time = location.timestamp
        var speed = location.speed
        if speed < 0 {
            guard let previous, time > previous.timestamp else {
                self.previous = location
                return nil
            }
            speed = location.distance(from: previous) / time.timeIntervalSince(previous.timestamp)
            // A jump faster than a sprinter is a bad fix, as the route
            // treats it, not the runner setting off.
            if speed > RunLocationFilter.maximumSpeed {
                fastSince = nil
                return nil
            }
        }
        previous = location
        switch motion(at: time) {
        case .still:
            // A still phone hasn't set off, whatever GPS says.
            fastSince = nil
            return nil
        case .steps where speed > Self.resumeSpeed:
            return .resume(at: time)
        default:
            break
        }
        fastSince = speed > Self.resumeSpeed ? fastSince ?? time : nil
        guard let fastSince, time.timeIntervalSince(fastSince) >= Self.resumeDelay else { return nil }
        return .resume(at: time)
    }

    static func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        guard !sorted.isEmpty else { return .nan }
        let middle = sorted.count / 2
        return sorted.count.isMultiple(of: 2) ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
    }
}
