import SwiftUI

/// A run's time for each mile or kilometer, from the distance and moving
/// time its chart series carry (`GET /api/activities/:id/streams`), so any
/// run with a distance track has splits, wherever it was recorded. A
/// planned run recorded in the app shows its laps instead (planned-runs P9).
struct ActivitySplit: Equatable, Identifiable {
    /// 1-based.
    let id: Int
    let meters: Double
    /// Moving seconds.
    let seconds: Double
    let averageHeartRate: Int?
    /// The last stretch, shorter than a whole mile or kilometer.
    let isPartial: Bool

    /// Seconds per mile or kilometer.
    func pace(_ unit: RunDistanceUnit) -> Double? {
        RunPace.average(movingSeconds: seconds, meters: meters, unit: unit)
    }

    /// A last stretch shorter than this share of a unit is left out: its
    /// pace would mostly be the stop.
    static let shortestPartShare = 0.1

    /// The splits of one activity in `unit`, or none when the series has no
    /// distance or doesn't reach one whole mile or kilometer.
    ///
    /// The series is bucketed (src/activityStreams.ts): `t` is the middle of
    /// each bucket of moving time and `distance_m` the distance at its end,
    /// counted from the start of the activity. So the splits count from 0 m
    /// at 0 s, each distance is paired with its bucket's end, and a
    /// boundary's time is read between the two bucket ends on either side.
    static func splits(_ streams: ActivityStreams, unit: RunDistanceUnit) -> [ActivitySplit] {
        guard let distances = streams.distance_m else { return [] }
        let hr = streams.heart_rate
        let count = min(streams.t.count, distances.count)
        let ends = bucketEnds(streams.t, count: count, movingSeconds: streams.moving_s)
        var out: [ActivitySplit] = []
        var previous = (t: 0.0, d: 0.0)
        var splitStart = (t: 0.0, d: 0.0)
        var hrSum = 0.0
        var hrCount = 0

        func close(at end: (t: Double, d: Double), partial: Bool) {
            let bpm = hrCount > 0 ? Int((hrSum / Double(hrCount)).rounded()) : nil
            out.append(ActivitySplit(id: out.count + 1, meters: end.d - splitStart.d, seconds: end.t - splitStart.t,
                                     averageHeartRate: bpm, isPartial: partial))
            splitStart = end
            hrSum = 0
            hrCount = 0
        }

        for i in 0..<count {
            guard let d = distances[i], d.isFinite, ends[i].isFinite else { continue }
            let t = ends[i]
            guard d >= previous.d, t >= previous.t else { continue }
            // A bucket's heart rate counts toward the split it ends in.
            if let hr, i < hr.count, let bpm = hr[i], bpm.isFinite, bpm > 0 {
                hrSum += bpm
                hrCount += 1
            }
            // Every boundary this bucket passes, in case buckets are long.
            // A hair of slack keeps rounding from moving a boundary that
            // falls on a bucket's end into the next split.
            var boundary = splitStart.d + unit.meters
            while d + 1e-6 >= boundary {
                let share = d > previous.d ? min(1, (boundary - previous.d) / (d - previous.d)) : 1
                close(at: (previous.t + share * (t - previous.t), boundary), partial: false)
                boundary = splitStart.d + unit.meters
            }
            previous = (t, d)
        }
        guard !out.isEmpty else { return [] }
        if previous.d - splitStart.d >= unit.meters * shortestPartShare, previous.t > splitStart.t {
            close(at: previous, partial: true)
        }
        return out
    }

    /// The moving time at the end of each bucket: halfway to the next
    /// bucket's middle, and the activity's moving time for the last one.
    static func bucketEnds(_ middles: [Double], count: Int, movingSeconds: Double) -> [Double] {
        (0..<count).map { i in
            if i + 1 < middles.count, i + 1 < count { return (middles[i] + middles[i + 1]) / 2 }
            return max(movingSeconds, middles[i])
        }
    }
}

/// A run's splits on its detail: one line per mile or kilometer with its
/// pace and heart rate, and a bar that is longer the faster it was.
struct ActivitySplitsView: View {
    let splits: [ActivitySplit]
    let unit: RunDistanceUnit

    var body: some View {
        let paces = splits.compactMap { $0.pace(unit) }
        let fastest = paces.min() ?? 1
        let slowest = paces.max() ?? 1
        VStack(alignment: .leading, spacing: 8) {
            Text("SPLITS")
                .font(Theme.mono(11, .bold)).tracking(2)
                .foregroundStyle(Theme.muted)
            ForEach(splits) { split in
                HStack(spacing: 10) {
                    Text(label(split))
                        .font(Theme.mono(13, .bold))
                        .foregroundStyle(Theme.muted)
                        .frame(minWidth: 44, alignment: .leading)
                    Text(RunFormat.pace(split.pace(unit)) + " /\(unit.abbreviation)")
                        .font(Theme.mono(13, .bold))
                        .foregroundStyle(Theme.text)
                        .monospacedDigit()
                        .fixedSize()
                    GeometryReader { geometry in
                        Capsule()
                            .fill(Theme.accent.opacity(split.isPartial ? 0.45 : 1))
                            .frame(width: geometry.size.width * Self.barShare(split.pace(unit),
                                                                              fastest: fastest, slowest: slowest),
                                   height: 6)
                            .frame(maxHeight: .infinity, alignment: .center)
                    }
                    .frame(height: 14)
                    .accessibilityHidden(true)
                    Text(split.averageHeartRate.map { "\($0) bpm" } ?? "")
                        .font(Theme.mono(12))
                        .foregroundStyle(Theme.muted)
                        .monospacedDigit()
                        .frame(minWidth: 60, alignment: .trailing)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(spoken(split))
                .accessibilityIdentifier("activity.split.\(split.id)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity.splits")
    }

    /// "1", "2", or the last stretch's own distance, "0.37".
    private func label(_ split: ActivitySplit) -> String {
        split.isPartial ? RunFormat.distance(split.meters, in: unit) : "\(split.id)"
    }

    private func spoken(_ split: ActivitySplit) -> String {
        let name = split.isPartial
            ? "Last \(RunFormat.distance(split.meters, in: unit)) \(unit.abbreviation)"
            : "\(unit.spokenName.capitalized) \(split.id)"
        var words = "\(name): \(RunFormat.pace(split.pace(unit))) per \(unit.spokenName)"
        if let bpm = split.averageHeartRate { words += ", \(bpm) beats per minute" }
        return words
    }

    /// The fastest split fills most of the row and the slowest a third, so
    /// small differences still show.
    static func barShare(_ pace: Double?, fastest: Double, slowest: Double) -> CGFloat {
        guard let pace else { return 0 }
        guard slowest > fastest else { return 1 }
        let speedShare = (slowest - pace) / (slowest - fastest)
        return CGFloat(0.35 + 0.65 * min(max(speedShare, 0), 1))
    }
}

/// Splits for a run, walk or hike whose series carry distance; nothing for
/// any other activity, or one too short for a whole mile or kilometer.
struct ActivitySplitsSection: View {
    let kind: String
    let streams: ActivityStreams?
    let unit: RunDistanceUnit

    /// Activities measured by pace, where a split per mile or kilometer reads.
    static let kinds: Set<String> = ["run", "walk", "hike"]

    var body: some View {
        if Self.kinds.contains(kind), let streams {
            let splits = ActivitySplit.splits(streams, unit: unit)
            if !splits.isEmpty {
                ActivitySplitsView(splits: splits, unit: unit)
            }
        }
    }
}
