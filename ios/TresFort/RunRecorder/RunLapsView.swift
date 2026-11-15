import SwiftUI

/// A planned run's lap as `GET /api/activities/:id/route` serves it with the
/// run recorded in the app (src/runLaps.ts, docs/plans/planned-runs P9).
struct ActivityLap: Decodable, Equatable {
    struct Target: Decodable, Equatable {
        let type: String
        var fastest_s_per_km: Int? = nil
        var slowest_s_per_km: Int? = nil
        var min_bpm: Int? = nil
        var max_bpm: Int? = nil
    }

    /// 1-based position of the step in the plan with repeats unrolled; nil
    /// for what was run after the plan finished.
    let step: Int?
    let kind: String?
    let round: Int?
    let rounds: Int?
    let planned_duration_s: Int?
    let planned_distance_m: Double?
    let target: Target?
    let start_s: Double
    let moving_s: Double
    let distance_m: Double
    let avg_hr: Int?
    let max_hr: Int?
    /// "completed", "skipped" or "stopped" (the run ended in it).
    let end: String

    var planKind: RunPlan.Kind? { kind.flatMap(RunPlan.Kind.init(rawValue:)) }

    var planTarget: RunPlan.Target? {
        guard let target else { return nil }
        switch target.type {
        case "pace":
            guard let fastest = target.fastest_s_per_km, let slowest = target.slowest_s_per_km else { return nil }
            return .pace(fastestSecondsPerKm: fastest, slowestSecondsPerKm: slowest)
        case "heart_rate":
            guard let low = target.min_bpm, let high = target.max_bpm else { return nil }
            return .heartRate(minBPM: low, maxBPM: high)
        default:
            return nil
        }
    }
}

/// How a lap reads on a run's detail: "RUN 2/4", "400 m · 1:33 · 6:14 /mi ·
/// 168 bpm", and how it went against the step's target.
struct RunLapRow: Equatable, Identifiable {
    enum Verdict: Equatable {
        case onTarget, fast, slow, high, low
    }

    let id: Int
    let kind: RunPlan.Kind?
    let title: String
    /// "Skipped" or "Ended early"; nil for a step run in full.
    let note: String?
    let figures: String
    /// "Pace 6:20–6:36 /mi · faster"; nil without a target.
    let target: String?
    let verdict: Verdict?
    /// Moving seconds per mile or kilometer; nil under 10 m.
    var pace: Double? = nil
    var movingSeconds: Double = 0
    /// "6:42 /mi", the figure a row leads with.
    var paceText: String? = nil
    /// "200 m · 0:50 · 170 bpm", the rest beside it.
    var details: String = ""

    static func rows(_ laps: [ActivityLap], unit: RunDistanceUnit) -> [RunLapRow] {
        laps.enumerated().map { index, lap in row(lap, id: index, unit: unit) }
    }

    static func row(_ lap: ActivityLap, id: Int, unit: RunDistanceUnit) -> RunLapRow {
        let kind = lap.planKind
        var title = kind.map(RunPlanFormat.kindTitle) ?? "After the plan"
        if let round = lap.round, let rounds = lap.rounds { title += " \(round)/\(rounds)" }
        let note: String?
        switch lap.end {
        case "skipped": note = "Skipped"
        case "stopped" where lap.step != nil: note = "Ended early"
        default: note = nil
        }
        let pace = RunPace.average(movingSeconds: lap.moving_s, meters: lap.distance_m, unit: unit)
        var figures = [distance(lap.distance_m, unit: unit), RunFormat.duration(lap.moving_s)]
        if let pace { figures.append(RunFormat.pace(pace) + " /\(unit.abbreviation)") }
        if let bpm = lap.avg_hr { figures.append("\(bpm) bpm") }

        var targetText: String?
        var verdict: Verdict?
        if let target = lap.planTarget {
            let judged = Self.verdict(lap, target: target)
            verdict = judged
            targetText = RunPlanFormat.targetTitle(target, unit: unit) + (judged.map { " · " + Self.words($0) } ?? "")
        }
        var details = [distance(lap.distance_m, unit: unit), RunFormat.duration(lap.moving_s)]
        if let bpm = lap.avg_hr { details.append("\(bpm) bpm") }
        return RunLapRow(id: id, kind: kind, title: title, note: note, figures: figures.joined(separator: " · "),
                         target: targetText, verdict: verdict, pace: pace, movingSeconds: lap.moving_s,
                         paceText: pace.map { RunFormat.pace($0) + " /\(unit.abbreviation)" },
                         details: details.joined(separator: " · "))
    }

    /// The lap's average pace or heart rate against the step's range. Nil
    /// when the lap has no pace (under 10 m) or no heart rate.
    static func verdict(_ lap: ActivityLap, target: RunPlan.Target) -> Verdict? {
        switch target {
        case .pace(let fastest, let slowest):
            guard let perKm = RunPace.average(movingSeconds: lap.moving_s, meters: lap.distance_m,
                                              unit: .kilometers) else { return nil }
            // Paces compare to the whole second the target is written in.
            let seconds = perKm.rounded()
            if seconds < Double(fastest) { return .fast }
            if seconds > Double(slowest) { return .slow }
            return .onTarget
        case .heartRate(let low, let high):
            guard let bpm = lap.avg_hr else { return nil }
            if bpm > high { return .high }
            if bpm < low { return .low }
            return .onTarget
        }
    }

    static func words(_ verdict: Verdict) -> String {
        switch verdict {
        case .onTarget: return "on target"
        case .fast: return "faster"
        case .slow: return "slower"
        case .high: return "above"
        case .low: return "below"
        }
    }

    /// Track distances in meters, longer laps in the member's unit.
    static func distance(_ meters: Double, unit: RunDistanceUnit) -> String {
        if meters < 1_000 { return "\(Int(meters.rounded())) m" }
        return RunFormat.distance(meters, in: unit) + " " + unit.abbreviation
    }
}

/// The shape of a planned run's laps: one block per lap, as wide as its
/// share of the moving time and as tall as it was fast, the way a watch
/// draws a workout. A lap with no moving time has no block.
struct RunLapChart {
    struct Block: Equatable, Identifiable {
        let id: Int
        let kind: RunPlan.Kind?
        let widthShare: CGFloat
        /// The fastest lap is full height and the slowest a third, the same
        /// scale as the splits' bars. Zero for a lap with no pace.
        let heightShare: CGFloat
    }

    static func blocks(_ rows: [RunLapRow]) -> [Block] {
        let timed = rows.filter { $0.movingSeconds > 0 }
        let total = timed.reduce(0) { $0 + $1.movingSeconds }
        guard total > 0 else { return [] }
        let paces = timed.compactMap(\.pace)
        let fastest = paces.min() ?? 1
        let slowest = paces.max() ?? 1
        return timed.map { row in
            Block(id: row.id, kind: row.kind, widthShare: CGFloat(row.movingSeconds / total),
                  heightShare: ActivitySplitsView.barShare(row.pace, fastest: fastest, slowest: slowest))
        }
    }
}

/// A planned run's laps on its detail: a chart of the whole session, then
/// each step on its own line with its pace, a bar for speed and how it went
/// against the step's target, so an interval session reads like a watch's
/// lap list instead of one average.
struct RunLapsView: View {
    let laps: [ActivityLap]
    let unit: RunDistanceUnit

    private static let chartHeight: CGFloat = 56

    var body: some View {
        let rows = RunLapRow.rows(laps, unit: unit)
        let blocks = RunLapChart.blocks(rows)
        let speeds = Dictionary(uniqueKeysWithValues: blocks.map { ($0.id, $0.heightShare) })
        VStack(alignment: .leading, spacing: 12) {
            Text("LAPS")
                .font(Theme.mono(11, .bold)).tracking(2)
                .foregroundStyle(Theme.muted)
            if blocks.count > 1 {
                chart(blocks)
            }
            ForEach(rows) { row in
                lapRow(row, speed: speeds[row.id] ?? 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity.laps")
    }

    private func chart(_ blocks: [RunLapChart.Block]) -> some View {
        GeometryReader { geometry in
            let gaps = CGFloat(blocks.count - 1) * 2
            let width = max(0, geometry.size.width - gaps)
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(blocks) { block in
                    UnevenRoundedRectangle(topLeadingRadius: 3, topTrailingRadius: 3)
                        .fill(color(block.kind))
                        .frame(width: max(2, width * block.widthShare),
                               height: max(3, Self.chartHeight * block.heightShare))
                }
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .frame(height: Self.chartHeight)
        .padding(.bottom, 2)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.surface2).frame(height: 1)
        }
        .accessibilityHidden(true)
    }

    private func lapRow(_ row: RunLapRow, speed: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color(row.kind))
                .frame(width: 4)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(row.title.uppercased())
                        .font(Theme.mono(11, .bold)).tracking(1)
                        .foregroundStyle(color(row.kind))
                    if let note = row.note {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 8)
                    if let pace = row.paceText {
                        Text(pace)
                            .font(Theme.mono(15, .bold))
                            .foregroundStyle(Theme.text)
                            .monospacedDigit()
                            .fixedSize()
                    }
                }
                if speed > 0 {
                    GeometryReader { geometry in
                        Capsule()
                            .fill(color(row.kind))
                            .frame(width: geometry.size.width * speed, height: 6)
                    }
                    .frame(height: 6)
                    .accessibilityHidden(true)
                }
                Text(row.details)
                    .font(Theme.mono(12))
                    .foregroundStyle(Theme.muted)
                    .monospacedDigit()
                if let target = row.target {
                    HStack(spacing: 4) {
                        Image(systemName: icon(row.verdict))
                            .font(.caption)
                            .accessibilityHidden(true)
                        Text(target)
                            .font(.caption)
                    }
                    .foregroundStyle(row.verdict == .onTarget ? Theme.done : Theme.muted)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("activity.lap.\(row.id)")
    }

    private func icon(_ verdict: RunLapRow.Verdict?) -> String {
        switch verdict {
        case .onTarget: return "checkmark.circle.fill"
        case .fast, .high: return "arrow.up.circle"
        case .slow, .low: return "arrow.down.circle"
        case nil: return "circle.dashed"
        }
    }

    private func color(_ kind: RunPlan.Kind?) -> Color {
        switch kind {
        case .work: return Theme.accent
        case .recovery: return Theme.done
        case .warmup, .cooldown: return Theme.muted
        case nil: return Theme.dim
        }
    }
}
