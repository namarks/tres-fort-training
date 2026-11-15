import Charts
import SwiftUI

struct WorkoutConsistencyView: View {
    @ObservedObject var sync: SyncModel
    @State private var weekCount = 16

    var body: some View {
        let summary = WorkoutConsistency(sessions: sync.sessions, today: sync.todayString, weekCount: weekCount)
        List {
            if sync.isUsingCachedState { CachedStateBanner() }
            if let error = sync.loadError { Text(error).foregroundStyle(.orange) }
            Section {
                Picker("Period", selection: $weekCount) {
                    ForEach([8, 16, 26], id: \.self) { Text("\($0) weeks").tag($0) }
                }.pickerStyle(.segmented)
                Text("\(summary.total) completed workouts").font(.title2.bold())
                    .accessibilityIdentifier("consistency.total")
                ConsistencyStats(stats: [
                    .init(value: "\(summary.currentStreak)", caption: "week streak",
                          accessibility: "Current streak: \(summary.currentStreak) weeks"),
                    .init(value: "\(summary.longestStreak)", caption: "best streak",
                          accessibility: "Best streak: \(summary.longestStreak) weeks"),
                    .init(value: "\(summary.activeDays)", caption: "days trained",
                          accessibility: "\(summary.activeDays) days trained in \(weekCount) weeks"),
                ])
                ConsistencyHeatmap(weeks: summary.weeks, maxCell: 30)
                WorkoutConsistencyChart(weeks: summary.weeks).frame(height: 180)
            } footer: {
                Text("Completed Très Fort workouts by workout date. Weeks run Monday–Sunday. A streak counts weeks in a row with at least one completed workout; the current week keeps it alive until Sunday ends. Runs, rides and swims are under Endurance, and the week streak on the Activity tab counts everything you do.")
            }
            Section("By week") {
                ForEach(summary.weeks.reversed()) { week in
                    LabeledContent {
                        Text("\(week.completed)").monospacedDigit()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(week.isCurrent ? "This week so far" : "Week of \(shortDate(week.start))")
                            Text("\(shortDate(week.start)) – \(shortDate(week.end))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Consistency")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await sync.load() }
    }
}

private struct ConsistencyStats: View {
    struct Stat: Identifiable {
        var id: String { caption }
        let value: String
        let caption: String
        let accessibility: String
    }

    let stats: [Stat]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 12) { tiles }
            VStack(alignment: .leading, spacing: 10) { tiles }
        }
    }

    private var tiles: some View {
        ForEach(stats) { stat in
            VStack(alignment: .leading, spacing: 2) {
                Text(stat.value).font(Theme.number(24)).foregroundStyle(Theme.text)
                    .monospacedDigit().lineLimit(1)
                Text(stat.caption).font(.caption).foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(stat.accessibility)
        }
    }
}

/// One column per Monday–Sunday week, one square per day. A filled square has
/// at least one completed workout; today is outlined and later days are empty.
private struct ConsistencyHeatmap: View {
    let weeks: [WorkoutConsistency.Week]
    var maxCell: CGFloat = 22
    @State private var width: CGFloat = 0

    private let gap: CGFloat = 3
    private let labelWidth: CGFloat = 14

    var body: some View {
        let cell = cellSize
        let monthLabels = monthLabelIndexes
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: gap) {
                Color.clear.frame(width: labelWidth, height: 1)
                ForEach(Array(weeks.enumerated()), id: \.element.id) { index, week in
                    Text(monthLabels.contains(index) ? monthName(week) : "")
                        .font(.caption2).foregroundStyle(Theme.muted)
                        .fixedSize()
                        .frame(width: cell, alignment: .leading)
                }
            }
            HStack(alignment: .top, spacing: gap) {
                VStack(spacing: gap) {
                    ForEach(Array(["M", "", "W", "", "F", "", ""].enumerated()), id: \.offset) { _, label in
                        Text(label).font(.caption2).foregroundStyle(Theme.muted)
                            .frame(width: labelWidth, height: cell)
                    }
                }
                ForEach(weeks) { week in
                    VStack(spacing: gap) {
                        ForEach(week.days) { day in square(day, size: cell) }
                    }
                }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityIdentifier("consistency.heatmap")
    }

    private var cellSize: CGFloat {
        guard !weeks.isEmpty else { return maxCell }
        let columns = CGFloat(weeks.count)
        let available = width - labelWidth - gap * columns
        return max(6, min(maxCell, (available / columns).rounded(.down)))
    }

    /// Each week containing the 1st of a month, plus the first column when the
    /// first such week is far enough away not to crowd it.
    private var monthLabelIndexes: Set<Int> {
        let starts = weeks.indices.filter { index in weeks[index].days.contains { $0.date.hasSuffix("-01") } }
        var result = Set(starts)
        if (starts.first ?? weeks.count) >= 3 { result.insert(0) }
        return result
    }

    private func monthName(_ week: WorkoutConsistency.Week) -> String {
        let date = week.days.first { $0.date.hasSuffix("-01") }?.date ?? week.start
        guard let parsed = CalendarProjection.date(from: date) else { return "" }
        return ProgressDateFormat.month.string(from: parsed)
    }

    @ViewBuilder
    private func square(_ day: WorkoutConsistency.Day, size: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: max(2, size * 0.22))
        Group {
            if day.isFuture {
                shape.stroke(Theme.dim.opacity(0.5), lineWidth: 1)
            } else {
                shape.fill(day.completed > 0 ? Theme.accent : Theme.dim.opacity(0.45))
                    .overlay { if day.isToday { shape.stroke(Theme.text, lineWidth: 1.5) } }
            }
        }
        .frame(width: size, height: size)
    }

    private var accessibilitySummary: String {
        let days = weeks.flatMap(\.days).filter { $0.completed > 0 }.count
        let workouts = weeks.reduce(0) { $0 + $1.completed }
        return "Workout calendar for the last \(weeks.count) weeks: \(workouts) completed workouts on \(days) days."
    }
}

private struct WorkoutConsistencyChart: View {
    let weeks: [WorkoutConsistency.Week]
    var body: some View {
        Chart(weeks) { week in
            BarMark(x: .value("Week of", week.start), y: .value("Workouts", week.completed))
                .foregroundStyle(week.isCurrent ? Theme.accent : Theme.muted)
                .accessibilityLabel(week.isCurrent ? "This week so far" : "Week of \(shortDate(week.start))")
                .accessibilityValue("\(week.completed) completed workouts")
        }
        .chartYScale(domain: 0...max(1, weeks.map(\.completed).max() ?? 0))
        .chartYAxis { AxisMarks(values: .stride(by: 1)) }
        .chartXAxis {
            AxisMarks(values: weeks.enumerated()
                .filter { [0, weeks.count / 2, weeks.count - 1].contains($0.offset) }
                .map { $0.element.start }) { value in
                AxisValueLabel(anchor: value.index == 0 ? .topLeading
                    : value.index == value.count - 1 ? .topTrailing : .top) {
                    if let date = value.as(String.self) { Text(shortDate(date)) }
                }
            }
        }
        .accessibilityIdentifier("consistency.chart")
    }
}

private struct EnduranceStats: View {
    let summary: EnduranceProgress

    var body: some View {
        let week = EnduranceProgress.duration(summary.thisWeekSeconds)
        let average = EnduranceProgress.duration(summary.averageWeekSeconds)
        let count = summary.thisWeekCount
        ConsistencyStats(stats: [
            .init(value: week, caption: "this week", accessibility: "\(week) this week"),
            .init(value: "\(count)", caption: count == 1 ? "session" : "sessions",
                  accessibility: "\(count) \(count == 1 ? "session" : "sessions") this week"),
            .init(value: average, caption: "weekly average",
                  accessibility: "\(average) a week on average over the last \(summary.weeks.count - 1) weeks"),
        ])
    }
}

struct EnduranceHistoryView: View {
    @ObservedObject var sync: SyncModel
    @AppStorage(RunDistanceUnit.preferenceKey) private var unitRaw = RunDistanceUnit.miles.rawValue

    var body: some View {
        let summary = EnduranceProgress(activities: sync.activities, today: sync.todayString)
        let unit = RunDistanceUnit(rawValue: unitRaw) ?? .miles
        List {
            if sync.isUsingCachedState { CachedStateBanner() }
            Section {
                EnduranceStats(summary: summary)
                EnduranceWeeksChart(weeks: summary.weeks).frame(height: 180)
                if summary.hasLoad {
                    let week = summary.thisWeekLoad.map { "\($0)" } ?? "unknown"
                    let average = summary.averageWeekLoad.map { " · avg \($0)" } ?? ""
                    LabeledContent {
                        Text(week + average).monospacedDigit()
                    } label: {
                        Label("Training load", systemImage: "gauge.with.dots.needle.67percent")
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Training load \(week) this week"
                        + (summary.averageWeekLoad.map { ", \($0) a week on average" } ?? ""))
                }
                ForEach(summary.thisWeek) { total in
                    let duration = EnduranceProgress.duration(total.seconds)
                    LabeledContent {
                        Text(EnduranceProgress.distance(total.meters, kind: total.kind, unit: unit)
                            .map { "\($0) · \(duration)" } ?? duration)
                            .monospacedDigit()
                    } label: {
                        Label("\(PendingActivity.label(for: total.kind)) × \(total.count)",
                              systemImage: ExternalActivity.glyph(forKind: total.kind))
                    }
                }
            } header: {
                Text("This week")
            } footer: {
                Text("Runs, rides, swims and walks from intervals.icu, Apple Health and imported .fit files, including ones you log with + on Today. Weeks run Monday–Sunday; the average leaves out this week.")
            }
            if summary.unscoredCount > 0 {
                Section {
                    Text(summary.unscoredCount == 1
                         ? "1 activity has no training load. Add your FTP, threshold heart rate or threshold pace in Profile → Training thresholds to score it."
                         : "\(summary.unscoredCount) activities have no training load. Add your FTP, threshold heart rate or threshold pace in Profile → Training thresholds to score them.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                .accessibilityIdentifier("endurance.unscored")
            }
            Section("By week") {
                ForEach(summary.weeks.reversed()) { week in
                    LabeledContent {
                        Text(weekLine(week))
                            .monospacedDigit()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(week.isCurrent ? "This week so far" : "Week of \(shortDate(week.start))")
                            Text("\(week.count) \(week.count == 1 ? "session" : "sessions")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Section("Activities") {
                ForEach(summary.recent) { activity in
                    EnduranceActivityRow(activity: activity, unit: unit)
                }
            }
        }
        .navigationTitle("Endurance")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await sync.load() }
    }

    /// "3h 10m · load 210", or just the time when the week has no known load.
    private func weekLine(_ week: EnduranceProgress.Week) -> String {
        let duration = EnduranceProgress.duration(week.seconds)
        guard let load = week.load, load > 0 else { return duration }
        return "\(duration) · load \(load)"
    }
}

private struct EnduranceActivityRow: View {
    let activity: ExternalActivity
    let unit: RunDistanceUnit

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: activity.glyph)
                .foregroundStyle(Theme.accent)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(activity.displayTitle)
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
                    .lineLimit(2)
                Text(details).font(.caption).foregroundStyle(Theme.muted)
                SourceAttributionLabel(text: activity.source_attribution)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private var details: String {
        var parts = [shortDate(activity.date)]
        if let meters = activity.distance_m,
           let distance = EnduranceProgress.distance(meters, kind: activity.kind, unit: unit) {
            parts.append(distance)
        }
        let seconds = EnduranceProgress.seconds(activity)
        if seconds > 0 { parts.append(EnduranceProgress.duration(seconds)) }
        if let pace = EnduranceProgress.pace(activity, unit: unit) { parts.append(pace) }
        if let load = activity.shownLoad {
            parts.append(activity.loadMethodLabel.map { "load \(load) (\($0))" } ?? "load \(load)")
        }
        return parts.joined(separator: " · ")
    }
}

private struct EnduranceWeeksChart: View {
    let weeks: [EnduranceProgress.Week]

    var body: some View {
        let maxMinutes = weeks.map { $0.seconds / 60 }.max() ?? 0
        Chart(weeks) { week in
            BarMark(x: .value("Week of", week.start), y: .value("Minutes", week.seconds / 60))
                .foregroundStyle(week.isCurrent ? Theme.accent : Theme.muted)
                .accessibilityLabel(week.isCurrent ? "This week so far" : "Week of \(shortDate(week.start))")
                .accessibilityValue(EnduranceProgress.duration(week.seconds))
        }
        .chartYScale(domain: 0...max(60, maxMinutes))
        .chartYAxis {
            AxisMarks { value in
                AxisGridLine()
                AxisValueLabel {
                    if let minutes = value.as(Int.self) { Text(EnduranceProgress.duration(minutes * 60)) }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: weeks.enumerated()
                .filter { [0, weeks.count / 2, weeks.count - 1].contains($0.offset) }
                .map { $0.element.start }) { value in
                AxisValueLabel(anchor: value.index == 0 ? .topLeading
                    : value.index == value.count - 1 ? .topTrailing : .top) {
                    if let date = value.as(String.self) { Text(shortDate(date)) }
                }
            }
        }
        .accessibilityIdentifier("endurance.chart")
    }
}

private enum ProgressDateFormat {
    static let shortDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = CalendarProjection.calendar
        formatter.timeZone = CalendarProjection.calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMM d")
        return formatter
    }()

    static let month: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = CalendarProjection.calendar
        formatter.timeZone = CalendarProjection.calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMM")
        return formatter
    }()
}

private func shortDate(_ civilDate: String) -> String {
    guard let date = CalendarProjection.date(from: civilDate) else { return civilDate }
    return ProgressDateFormat.shortDate.string(from: date)
}
