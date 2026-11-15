import Charts
import MapKit
import SwiftUI

/// The Activity tab's page. Everything on it reads the same history entries
/// as "All history", so a run or a soccer game counts the same everywhere.
struct ActivityOverview: View {
    @ObservedObject var sync: SyncModel
    var weight: BodyWeightModel?
    var onHealthSettings: () -> Void
    /// Changes when the page should show its top, the week card.
    var scrollToTopRequest = 0
    @AppStorage(RunDistanceUnit.preferenceKey) private var unitRaw = RunDistanceUnit.miles.rawValue

    /// How many sessions the Recent section shows before "All history".
    static let recentCount = 3

    var body: some View {
        let unit = RunDistanceUnit(rawValue: unitRaw) ?? .miles
        let history = sync.activityHistory(unit: unit)
        let today = sync.todayString
        let summary = ActivitySummary(entries: history.entries, today: today)
        let highlights = makeHighlights(history.entries, today: today)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if sync.isUsingCachedState { CachedStateBanner() }
                    if let error = sync.loadError {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(error).font(.footnote).foregroundStyle(Theme.danger)
                            Button("Retry") { Task { await sync.load() } }
                        }
                    }
                    ActivityWeekCard(summary: summary, unit: unit)
                    if !highlights.isEmpty {
                        section("Highlights", trailing: "Last \(ActivityHighlights.windowDays) days") {
                            ActivityHighlightsRow(highlights: highlights, unit: unit, sync: sync)
                        }
                    }
                    recent(history, unit: unit)
                    if summary.weeks.contains(where: { $0.totalSeconds > 0 }) {
                        section("Last \(summary.weeks.count) weeks") {
                            ActivityWeeksChart(summary: summary)
                        }
                    }
                    section("Progress") {
                        ActivityProgressLinks(sync: sync, weight: weight, onHealthSettings: onHealthSettings)
                    }
                }
                .readableColumn()
                .padding(16)
                .id(Self.topID)
            }
            .refreshable {
                await sync.load()
                await weight?.refresh()
            }
            .onChange(of: scrollToTopRequest) {
                withAnimation { proxy.scrollTo(Self.topID, anchor: .top) }
            }
        }
    }

    private static let topID = "activity.top"

    private func makeHighlights(_ entries: [ActivityHistory.Entry], today: String) -> ActivityHighlights {
        let dates = Dictionary(sync.sessions.map { ($0.id, $0.date) }, uniquingKeysWith: { a, _ in a })
        let modality = Dictionary(sync.catalog.map { ($0.id, $0.modality) }, uniquingKeysWith: { a, _ in a })
        return ActivityHighlights(entries: entries, sets: sync.sets, sessionDates: dates, today: today,
                                  countsAsLoaded: { modality[$0] != "timed" })
    }

    @ViewBuilder
    private func recent(_ history: ActivityHistory, unit: RunDistanceUnit) -> some View {
        let entries = Array(history.entries.prefix(Self.recentCount))
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Recent").font(.title3.bold()).foregroundStyle(Theme.text)
                Spacer()
                if !history.entries.isEmpty {
                    NavigationLink(value: ActivityAllHistory()) {
                        Text("All history").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                            .frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("activity.allHistory")
                }
            }
            if entries.isEmpty {
                if sync.isLoading {
                    ProgressView("Loading your activity…")
                } else {
                    Text("Nothing here yet. Workouts you finish, runs you record and activities you log show up here.")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("activity.empty")
                }
            }
            ForEach(entries) { entry in
                NavigationLink(value: ActivityHistoryDay(entryID: entry.id, date: entry.date, focus: entry.focus)) {
                    ActivityEntryCard(entry: entry, today: sync.todayString,
                                      routeAccess: sync.activityRouteAccess)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("activity.recent." + entry.id)
            }
        }
    }

    private func section<Content: View>(_ title: String, trailing: String? = nil,
                                        @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.title3.bold()).foregroundStyle(Theme.text)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let trailing {
                    Text(trailing).font(.subheadline).foregroundStyle(Theme.muted)
                }
            }
            content()
        }
    }
}

// MARK: - Colors

extension ActivityHistory.Family {
    /// On the navy week card, in both appearances.
    var onNavy: Color {
        switch self {
        case .strength: return BrandPalette.fortLabel
        case .endurance: return BrandPalette.fortOrange
        case .sport: return Color(red: 0x4E / 255, green: 0xCC / 255, blue: 0xD3 / 255)
        }
    }

    /// On the page's own surfaces.
    var color: Color {
        switch self {
        case .strength: return Theme.accent
        case .endurance: return Theme.signal
        case .sport: return BrandPalette.categorical[3]
        }
    }
}

// MARK: - This week

/// This week on the fort's navy: time trained, sessions, distance, strength
/// time and load, a bar per day split by kind, the streak, and the change
/// from this time last week.
struct ActivityWeekCard: View {
    let summary: ActivitySummary
    let unit: RunDistanceUnit
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let week = summary.thisWeek
        let total = week?.totalSeconds ?? 0
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center) { title; Spacer(minLength: 8); streak }
                VStack(alignment: .leading, spacing: 8) { title; streak }
            }
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                Text(EnduranceProgress.duration(total))
                    .font(Theme.display(dynamicTypeSize.isAccessibilitySize ? 44 : 58))
                    .foregroundStyle(.white)
                    .lineLimit(1).minimumScaleFactor(0.6)
                Text("trained").font(Theme.display(24)).foregroundStyle(BrandPalette.fortLabel)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(EnduranceProgress.duration(total)) trained this week")
            .accessibilityIdentifier("activity.week.total")
            stats(week)
            ActivityWeekBars(days: summary.days)
            if let week, week.sessions > 0 || summary.changeSeconds != 0 {
                Label {
                    Text(ActivitySummary.changeText(summary.changeSeconds))
                } icon: {
                    Image(systemName: summary.changeSeconds >= 60 ? "arrow.up"
                          : summary.changeSeconds <= -60 ? "arrow.down" : "equal")
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color(red: 0xD6 / 255, green: 0xE2 / 255, blue: 0xF0 / 255))
                .accessibilityIdentifier("activity.week.change")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandPalette.fortNavy, in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity.week")
    }

    private var title: some View {
        Text(weekTitle)
            .font(.caption.weight(.semibold)).textCase(.uppercase)
            .foregroundStyle(BrandPalette.fortLabel)
    }

    @ViewBuilder private var streak: some View {
        if summary.streak > 0 {
            Label("\(summary.streak)-week streak", systemImage: "flame.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandPalette.fortOrangeText)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(BrandPalette.fortOrange.opacity(0.18), in: Capsule())
                .accessibilityIdentifier("activity.week.streak")
        }
    }

    private var weekTitle: String {
        guard let first = summary.days.first?.date, let last = summary.days.last?.date,
              let start = CalendarProjection.date(from: first), let end = CalendarProjection.date(from: last) else {
            return "This week"
        }
        return "This week · " + Self.rangeFormatter.string(from: start, to: end)
    }

    private struct Stat: Identifiable {
        var id: String { caption }
        let value: String
        let caption: String
        let spoken: String
    }

    private func stats(_ week: ActivitySummary.Week?) -> some View {
        var items: [Stat] = []
        let sessions = week?.sessions ?? 0
        items.append(Stat(value: "\(sessions)", caption: sessions == 1 ? "session" : "sessions",
                          spoken: "\(sessions) \(sessions == 1 ? "session" : "sessions")"))
        if let distance = summary.distance,
           let text = EnduranceProgress.distance(distance.meters, kind: distance.kind, unit: unit) {
            let label = PendingActivity.label(for: distance.kind).lowercased()
            items.append(Stat(value: text, caption: label, spoken: "\(text) \(label)"))
        }
        let strength = week?.seconds[.strength] ?? 0
        if strength > 0 {
            let text = EnduranceProgress.duration(strength)
            items.append(Stat(value: text, caption: "strength", spoken: "\(text) strength"))
        }
        if let load = summary.load {
            items.append(Stat(value: "\(load)", caption: "load", spoken: "Training load \(load)"))
        }
        let shown = items
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 18) { statViews(shown) }
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)],
                      alignment: .leading, spacing: 10) { statViews(shown) }
        }
    }

    private func statViews(_ items: [Stat]) -> some View {
        ForEach(items) { stat in
            VStack(alignment: .leading, spacing: 1) {
                Text(stat.value).font(Theme.number(17)).foregroundStyle(.white).lineLimit(1)
                Text(stat.caption).font(.caption2.weight(.medium)).foregroundStyle(BrandPalette.fortLabel)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(stat.spoken)
        }
    }

    private static let rangeFormatter: DateIntervalFormatter = {
        let formatter = DateIntervalFormatter()
        formatter.calendar = CalendarProjection.calendar
        formatter.timeZone = CalendarProjection.calendar.timeZone
        formatter.dateTemplate = "MMMd"
        return formatter
    }()
}

/// Monday to Sunday: each day's bar is its training time, stacked by kind.
/// A day with a session but no known time still shows a short bar.
private struct ActivityWeekBars: View {
    let days: [ActivitySummary.Day]
    private let maxHeight: CGFloat = 56

    var body: some View {
        let most = max(days.map(\.totalSeconds).max() ?? 0, 1)
        HStack(alignment: .bottom, spacing: 6) {
            ForEach(Array(days.enumerated()), id: \.element.id) { index, day in
                VStack(spacing: 4) {
                    bar(day, most: most)
                    Text(Self.letters[index])
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(day.isToday ? BrandPalette.fortOrangeText : BrandPalette.fortLabel)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Self.spoken(day, index: index))
            }
        }
        .frame(height: maxHeight + 20, alignment: .bottom)
        .accessibilityIdentifier("activity.week.days")
    }

    @ViewBuilder
    private func bar(_ day: ActivitySummary.Day, most: Int) -> some View {
        if day.totalSeconds > 0 {
            VStack(spacing: 0) {
                ForEach(ActivityHistory.Family.allCases.reversed()) { family in
                    if let seconds = day.seconds[family], seconds > 0 {
                        Rectangle().fill(family.onNavy)
                            .frame(height: max(3, maxHeight * CGFloat(seconds) / CGFloat(most)))
                    }
                }
            }
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 5, bottomLeadingRadius: 2,
                                              bottomTrailingRadius: 2, topTrailingRadius: 5))
        } else if day.sessions > 0 {
            RoundedRectangle(cornerRadius: 2).fill(BrandPalette.fortLabel).frame(height: 8)
        } else {
            RoundedRectangle(cornerRadius: 2)
                .fill(day.isToday ? BrandPalette.fortOrangeText : BrandPalette.fortIdle)
                .frame(height: 4)
        }
    }

    private static let letters = ["M", "T", "W", "T", "F", "S", "S"]
    private static let names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    private static func spoken(_ day: ActivitySummary.Day, index: Int) -> String {
        let name = names[index] + (day.isToday ? ", today" : "")
        if day.isFuture { return "\(name): still to come" }
        if day.sessions == 0 { return "\(name): rest" }
        let count = "\(day.sessions) \(day.sessions == 1 ? "session" : "sessions")"
        return day.totalSeconds > 0
            ? "\(name): \(EnduranceProgress.duration(day.totalSeconds)), \(count)"
            : "\(name): \(count)"
    }
}

// MARK: - Highlights

private struct ActivityHighlightsRow: View {
    let highlights: ActivityHighlights
    let unit: RunDistanceUnit
    @ObservedObject var sync: SyncModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 10) {
                if let run = highlights.fastestRun {
                    NavigationLink(value: ActivityHistoryDay(entryID: run.entryID, date: run.date, focus: run.focus)) {
                        card(title: "Fastest pace",
                             value: "\(RunFormat.pace(Double(run.seconds) / (run.meters / unit.meters))) /\(unit.abbreviation)",
                             detail: "\(run.title) · \(ActivityHistory.dayTitle(run.date))")
                    }
                    .accessibilityIdentifier("activity.highlight.fastest")
                }
                if let lift = highlights.newBest {
                    NavigationLink {
                        ExerciseDetailView(sync: sync, exerciseID: lift.exerciseID)
                    } label: {
                        card(title: "New best",
                             value: "\(SetValueFormatter.number(lift.weight)) \(lift.unit.rawValue) × \(lift.reps)",
                             detail: "\(sync.exerciseName(lift.exerciseID)) · up from \(SetValueFormatter.number(lift.previousWeight)) \(lift.previousUnit.rawValue)")
                    }
                    .accessibilityIdentifier("activity.highlight.best")
                }
                if let run = highlights.longestRun,
                   let distance = EnduranceProgress.distance(run.meters, kind: "run", unit: unit) {
                    NavigationLink(value: ActivityHistoryDay(entryID: run.entryID, date: run.date, focus: run.focus)) {
                        card(title: "Longest run", value: distance,
                             detail: "\(run.title) · \(ActivityHistory.dayTitle(run.date))")
                    }
                    .accessibilityIdentifier("activity.highlight.longest")
                }
            }
            .buttonStyle(.plain)
        }
        .scrollClipDisabled()
    }

    private func card(title: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Theme.signal)
            Text(value).font(Theme.number(20)).foregroundStyle(Theme.text)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(detail).font(.caption).foregroundStyle(Theme.muted)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(width: 168, alignment: .topLeading)
        .frame(minHeight: 108, alignment: .topLeading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Recent

/// One session as a card, on Recent and in All history: its kind, name,
/// when, its numbers and, for a run, ride or walk with a GPS track, its route
/// on a small map.
struct ActivityEntryCard: View {
    let entry: ActivityHistory.Entry
    let today: String
    let routeAccess: ActivityRouteAccess?
    @State private var route: [[CLLocationCoordinate2D]] = []

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: entry.glyph)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(entry.family.color)
                .frame(width: 40, height: 40)
                .background(entry.family.color.opacity(0.15), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.title).font(.headline).foregroundStyle(Theme.text).lineLimit(2)
                Text(Self.when(entry.date, today: today)).font(.caption).foregroundStyle(Theme.muted)
                if !entry.details.isEmpty {
                    Text(entry.details.joined(separator: "  "))
                        .font(Theme.mono(13)).foregroundStyle(Theme.text)
                        .lineLimit(2)
                }
                if entry.inProgress {
                    Text("In progress").font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
                }
                SourceAttributionLabel(text: entry.attribution)
            }
            Spacer(minLength: 0)
            if !route.isEmpty {
                ActivityRouteSnapshot(key: entry.id, segments: route, tint: entry.family.color)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .contentShape(RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
        .task(id: entry.id) { await loadRoute() }
    }

    private func loadRoute() async {
        guard let routeAccess, case .activity(let id)? = entry.focus,
              let kind = entry.activityKind, ["run", "ride", "walk", "hike"].contains(kind),
              (entry.meters ?? 0) > 0 else { return }
        let response = await ActivityRouteStore.shared.route(for: id, access: routeAccess)
        route = response?.route?.drawableSegments ?? []
    }

    /// "Today", "Yesterday" or "Thu, Nov 5".
    static func when(_ date: String, today: String) -> String {
        if date == today { return "Today" }
        if let day = CalendarProjection.date(from: today),
           let yesterday = CalendarProjection.calendar.date(byAdding: .day, value: -1, to: day),
           CalendarProjection.dateString(yesterday) == date {
            return "Yesterday"
        }
        return ActivityHistory.dayTitle(date)
    }
}

/// A route's outline fitted to its frame, north up, without map tiles.
struct ActivityRouteShape: Shape {
    let segments: [[CLLocationCoordinate2D]]

    func path(in rect: CGRect) -> Path {
        let points = segments.flatMap { $0 }
        guard let first = points.first else { return Path() }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for p in points {
            minLat = min(minLat, p.latitude); maxLat = max(maxLat, p.latitude)
            minLon = min(minLon, p.longitude); maxLon = max(maxLon, p.longitude)
        }
        // A degree of longitude is shorter away from the equator.
        let squash: Double = cos((minLat + maxLat) / 2 * .pi / 180)
        let width = CGFloat(max((maxLon - minLon) * squash, 1e-9))
        let height = CGFloat(max(maxLat - minLat, 1e-9))
        let scale: CGFloat = min(rect.width / width, rect.height / height)
        let offsetX: CGFloat = rect.minX + (rect.width - width * scale) / 2
        let offsetY: CGFloat = rect.minY + (rect.height - height * scale) / 2
        func point(_ c: CLLocationCoordinate2D) -> CGPoint {
            CGPoint(x: offsetX + CGFloat((c.longitude - minLon) * squash) * scale,
                    y: offsetY + CGFloat(maxLat - c.latitude) * scale)
        }
        var path = Path()
        for segment in segments where segment.count > 1 {
            path.move(to: point(segment[0]))
            for c in segment.dropFirst() { path.addLine(to: point(c)) }
        }
        return path
    }
}

// MARK: - Weeks

/// Training time per Monday–Sunday week, stacked by kind. The time axis
/// counts in round steps (30m, 1h, 2h) so no two marks read the same, and
/// only every other week is dated so the dates never run into each other.
private struct ActivityWeeksChart: View {
    let summary: ActivitySummary
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let marks = ActivitySummary.axisMinutes(busiestSeconds: summary.weeks.map(\.totalSeconds).max() ?? 0)
        let top = Double(marks.last ?? 60)
        let labels = ActivitySummary.axisWeekLabels(summary.weeks.map(\.start),
                                                    every: dynamicTypeSize.isAccessibilitySize ? 4 : 2)
        VStack(alignment: .leading, spacing: 10) {
            Text("Training time per week · average \(EnduranceProgress.duration(summary.averageWeekSeconds))")
                .font(.caption).foregroundStyle(Theme.muted)
            Chart {
                ForEach(summary.weeks) { week in
                    ForEach(ActivityHistory.Family.allCases) { family in
                        BarMark(x: .value("Week of", week.start),
                                y: .value("Minutes", Double(week.seconds[family] ?? 0) / 60))
                            .foregroundStyle(by: .value("Kind", family.title))
                    }
                }
            }
            .chartForegroundStyleScale(domain: ActivityHistory.Family.allCases.map(\.title),
                                       range: ActivityHistory.Family.allCases.map(\.color))
            .chartYScale(domain: 0...top)
            .chartXAxis {
                AxisMarks(values: summary.weeks.map(\.start)) { value in
                    AxisValueLabel {
                        if let start = value.as(String.self), let label = labels[start] {
                            Text(label).font(.caption2).fixedSize()
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: marks.map { Double($0) }) { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let minutes = value.as(Double.self) {
                            Text(ActivitySummary.axisLabel(minutes: Int(minutes.rounded())))
                        }
                    }
                }
            }
            .chartLegend(position: .bottom, alignment: .leading)
            .frame(height: 170)
            .accessibilityIdentifier("activity.weeks.chart")
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Progress

/// Strength, endurance, consistency and weight, each opening its own detail
/// screen.
private struct ActivityProgressLinks: View {
    @ObservedObject var sync: SyncModel
    var weight: BodyWeightModel?
    let onHealthSettings: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            NavigationLink {
                ExerciseHistoryList(sync: sync)
                    .background(Theme.background)
                    .navigationTitle("Strength")
                    .navigationBarTitleDisplayMode(.inline)
            } label: {
                row("Strength", icon: "dumbbell.fill", tint: Theme.accent,
                    detail: strengthDetail)
            }
            .accessibilityIdentifier("progress.strength")
            divider
            NavigationLink {
                EnduranceHistoryView(sync: sync)
            } label: {
                row("Endurance", icon: "figure.run", tint: Theme.signal, detail: enduranceDetail)
            }
            .accessibilityIdentifier("progress.endurance")
            divider
            NavigationLink {
                WorkoutConsistencyView(sync: sync)
            } label: {
                row("Workout consistency", icon: "calendar.badge.checkmark", tint: Theme.accent,
                    detail: consistencyDetail)
            }
            .accessibilityIdentifier("progress.consistency")
            if let weight {
                ActivityWeightRow(model: weight, onHealthSettings: onHealthSettings, divider: divider)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private var divider: some View {
        Rectangle().fill(Theme.surface2).frame(height: 1).padding(.leading, 36)
    }

    private var strengthDetail: String {
        let count = sync.loggedExerciseIDs.count
        return count == 0 ? "Your first working set starts your progress."
            : "\(count) \(count == 1 ? "exercise" : "exercises") · trends and best sets"
    }

    private var enduranceDetail: String {
        let summary = EnduranceProgress(activities: sync.activities, today: sync.todayString)
        if summary.isEmpty { return "Runs, rides, swims and walks" }
        return "\(EnduranceProgress.duration(summary.thisWeekSeconds)) this week · average \(EnduranceProgress.duration(summary.averageWeekSeconds))"
    }

    private var consistencyDetail: String {
        let summary = WorkoutConsistency(sessions: sync.sessions, today: sync.todayString, weekCount: 16)
        return "\(summary.total) \(summary.total == 1 ? "workout" : "workouts") in 16 weeks · \(summary.currentStreak) week streak"
    }
}

/// A row on the Progress card: icon, title, one line of detail, chevron.
private func row(_ title: String, icon: String, tint: Color, detail: String) -> some View {
    HStack(spacing: 12) {
        Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(tint)
            .frame(width: 24)
            .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.body.weight(.medium)).foregroundStyle(Theme.text)
            Text(detail).font(.caption).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 8)
        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
            .accessibilityHidden(true)
    }
    .padding(.vertical, 12)
    .frame(minHeight: 44)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
}

/// Weight from Apple Health when it's on; otherwise a way to turn it on.
private struct ActivityWeightRow<Separator: View>: View {
    @ObservedObject var model: BodyWeightModel
    let onHealthSettings: () -> Void
    let divider: Separator
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(WeightUnit.preferenceKey) private var weightUnitRaw = WeightUnit.lb.rawValue

    var body: some View {
        Group {
            if model.enabled {
                divider
                NavigationLink {
                    BodyWeightView(model: model, onManageAccess: onHealthSettings)
                } label: {
                    row("Weight", icon: "scalemass", tint: Theme.accent, detail: detail)
                }
                .accessibilityIdentifier("progress.weight")
            } else if model.isAvailable && !model.requiresPersonalSignIn {
                divider
                Button(action: onHealthSettings) {
                    row("Weight", icon: "scalemass", tint: Theme.accent,
                        detail: "Optional · Show your Apple Health weight alongside your training.")
                }
                .accessibilityIdentifier("progress.weightSettings")
            }
        }
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
    }

    private var detail: String {
        guard let latest = model.history?.latest else {
            return model.isBusy ? "Reading weight…" : model.errorMessage ?? "No weight yet"
        }
        let unit = BodyWeightUnit(rawValue: weightUnitRaw) ?? .pounds
        let value = unit.value(latest.kilograms).formatted(.number.precision(.fractionLength(1)))
        return "\(value) \(unit.rawValue) · Apple Health · only visible to you"
    }
}
