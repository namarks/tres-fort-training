import Foundation
import SwiftUI

/// One of seven power zones of the member's FTP, with the seconds the
/// activity spent in it (src/ridePower.ts, docs/plans/run-detail-charts P6).
struct ActivityPowerZone: Decodable, Equatable {
    let zone: Int
    let name: String
    /// Percent of FTP the zone starts at; it ends where the next starts.
    let min_pct: Double
    let max_pct: Double?
    let seconds: Double
}

/// The best average power held for `s` seconds.
struct ActivityPowerBest: Decodable, Equatable {
    let s: Double
    let w: Double
}

/// Power figures of one activity, from the full-rate readings the server
/// read for its charts.
struct ActivityPowerSummary: Decodable, Equatable {
    let avg_w: Double
    let max_w: Double
    let normalized_w: Double?
    let work_kj: Double
    let best: [ActivityPowerBest]
    /// The member's FTP on the activity's date; zones and intensity need it.
    let ftp_w: Double?
    let intensity: Double?
    let zones: [ActivityPowerZone]?
}

/// Cadence while pedalling: coasting is left out of the average.
struct ActivityCadenceSummary: Decodable, Equatable {
    let avg_rpm: Double
    let max_rpm: Double
}

/// What the power section shows, worked out from the summary. Pure, so it
/// is unit tested.
struct ActivityPowerPresentation: Equatable {
    struct Stat: Equatable {
        let label: String
        let value: String
    }

    struct Zone: Equatable {
        let label: String
        let range: String
        let duration: String
        /// Share of the time with power, 0 to 1.
        let share: Double
    }

    let stats: [Stat]
    /// "5 s" … "60 min" with the watts held.
    let best: [Stat]
    let zones: [Zone]
    /// "Zones from your FTP of 229 W", or how to get zones without one.
    let zoneNote: String

    init(power p: ActivityPowerSummary, cadence: ActivityCadenceSummary?) {
        func watts(_ w: Double) -> String { "\(Int(w.rounded())) W" }
        var stats = [Stat(label: "Avg", value: watts(p.avg_w))]
        if let np = p.normalized_w { stats.append(Stat(label: "Normalized", value: watts(np))) }
        stats.append(Stat(label: "Max", value: watts(p.max_w)))
        if let intensity = p.intensity, intensity.isFinite {
            stats.append(Stat(label: "Intensity", value: String(format: "%.2f", intensity)))
        }
        if let np = p.normalized_w, p.avg_w > 0 {
            stats.append(Stat(label: "Variability", value: String(format: "%.2f", np / p.avg_w)))
        }
        stats.append(Stat(label: "Work", value: "\(Int(p.work_kj.rounded()).formatted()) kJ"))
        if let cadence {
            stats.append(Stat(label: "Cadence", value: "\(Int(cadence.avg_rpm.rounded())) rpm"))
        }
        self.stats = stats
        best = p.best.map { Stat(label: Self.effortLength($0.s), value: watts($0.w)) }
        let total = (p.zones ?? []).reduce(0) { $0 + $1.seconds }
        zones = (p.zones ?? []).map { z in
            Zone(label: "Z\(z.zone) \(z.name)",
                 range: z.max_pct.map { "\(Int(z.min_pct))–\(Int($0))%" } ?? "\(Int(z.min_pct))%+",
                 duration: RunFormat.duration(z.seconds),
                 share: total > 0 ? z.seconds / total : 0)
        }
        if let ftp = p.ftp_w, p.zones != nil {
            zoneNote = "Zones from your FTP of \(Int(ftp.rounded())) W."
        } else {
            zoneNote = "Add your FTP in Profile → Training thresholds to see time in power zones."
        }
    }

    /// "5 s", "30 s", "1 min", "20 min", "60 min".
    static func effortLength(_ seconds: Double) -> String {
        let s = Int(seconds.rounded())
        return s < 60 ? "\(s) s" : "\(s / 60) min"
    }
}

/// Power figures under an activity's charts: averages, best efforts and
/// time in zones (P6). Shown only for an activity with power.
struct ActivityPowerView: View {
    let power: ActivityPowerSummary
    let cadence: ActivityCadenceSummary?

    private let columns = [GridItem(.adaptive(minimum: 88), spacing: 10, alignment: .leading)]

    var body: some View {
        let view = ActivityPowerPresentation(power: power, cadence: cadence)
        VStack(alignment: .leading, spacing: 14) {
            section("Power") {
                statGrid(view.stats)
            }
            if !view.best.isEmpty {
                section("Best efforts") {
                    statGrid(view.best)
                }
                .accessibilityIdentifier("activity.power.best")
            }
            section("Time in zones") {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(view.zones, id: \.label) { zone in
                        zoneRow(zone)
                    }
                    Text(view.zoneNote)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                }
            }
            .accessibilityIdentifier("activity.power.zones")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity.power")
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(Theme.mono(11, .bold)).tracking(2)
                .foregroundStyle(Theme.muted)
            content()
        }
    }

    private func statGrid(_ stats: [ActivityPowerPresentation.Stat]) -> some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
            ForEach(stats, id: \.label) { stat in
                VStack(alignment: .leading, spacing: 2) {
                    Text(stat.value)
                        .font(Theme.mono(15, .bold))
                        .foregroundStyle(Theme.text)
                    Text(stat.label)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func zoneRow(_ zone: ActivityPowerPresentation.Zone) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(zone.label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.text)
                Text(zone.range)
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                Spacer()
                Text("\(zone.duration) · \(Int((zone.share * 100).rounded()))%")
                    .font(Theme.mono(12, .bold))
                    .foregroundStyle(Theme.text)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surface2)
                    Capsule().fill(BrandPalette.categorical[4])
                        .frame(width: max(zone.share > 0 ? 3 : 0, geo.size.width * zone.share))
                }
            }
            .frame(height: 6)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }
}
