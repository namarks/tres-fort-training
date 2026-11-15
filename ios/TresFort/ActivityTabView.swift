import Charts
import MapKit
import SwiftUI

/// An entry opened from History. Each row pushes its own value: rows that
/// share a date must not share one, or the list highlights and opens the
/// first row with that value instead of the one tapped.
struct ActivityHistoryDay: Hashable {
    let entryID: String
    let date: String
    let focus: DayAgendaFocus?
}

/// "All history", pushed by value like the entries it lists. Its rows push
/// `ActivityHistoryDay` values, and a value link inside a screen pushed by a
/// view-destination link does not open its entry.
struct ActivityAllHistory: Hashable {}

/// The Activity tab, one scrolling page: this week at a glance (every kind
/// of training counts), highlights from the last 30 days, the latest few
/// sessions, training time by week, and links into strength, endurance,
/// consistency and weight. "All history" opens the full list.
struct ActivityTabView: View {
    @ObservedObject var sync: SyncModel
    var weight: BodyWeightModel? = nil
    var onHealthSettings: () -> Void = {}
    /// Continuing today's workout from its record shows it on Today.
    var onShowWorkout: (() -> Void)? = nil
    /// Changes when another tab sends the member here to see their week
    /// (Today's This week fort): the page returns to its top.
    var rootRequest = 0
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            ActivityOverview(sync: sync, weight: weight, onHealthSettings: onHealthSettings,
                             scrollToTopRequest: rootRequest)
                .background(Theme.background)
                .navigationTitle("Activity")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { ProfileButton() } }
                .navigationDestination(for: ActivityAllHistory.self) { _ in
                    ActivityHistoryView(sync: sync)
                        .background(Theme.background)
                        .navigationTitle("All history")
                        .navigationBarTitleDisplayMode(.inline)
                }
                .navigationDestination(for: ActivityHistoryDay.self) { day in
                    DayAgendaView(sync: sync, dateString: day.date, focus: day.focus,
                                  onStartWorkout: onShowWorkout)
                        .navigationTitle(ActivityHistory.dayTitle(day.date))
                        .navigationBarTitleDisplayMode(.inline)
                }
        }
        .onChange(of: rootRequest) { path = NavigationPath() }
    }
}

/// Every workout, run, ride and logged activity, by month, with a filter for
/// the kinds the member has done.
struct ActivityHistoryView: View {
    @ObservedObject var sync: SyncModel
    @AppStorage(RunDistanceUnit.preferenceKey) private var unitRaw = RunDistanceUnit.miles.rawValue
    @State private var category: ActivityHistory.Category?

    var body: some View {
        let history = makeHistory()
        let categories = history.categories
        // A filter whose last entry went away shows everything again.
        let shown = category.flatMap { categories.contains($0) ? $0 : nil }
        let months = history.months(in: shown)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                if sync.isUsingCachedState { CachedStateBanner() }
                if let error = sync.loadError {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error).font(.footnote).foregroundStyle(Theme.danger)
                        Button("Retry") { Task { await sync.load() } }
                    }
                }
                if categories.count > 1 {
                    filters(categories, selected: shown)
                }
                if months.isEmpty {
                    if sync.isLoading {
                        ProgressView("Loading your activity…")
                    } else {
                        Text("Nothing here yet. Workouts you finish, runs you record and activities you log show up here.")
                            .font(.subheadline).foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("activityHistory.empty")
                    }
                }
                // The same cards as Recent, route maps included, so the
                // list keeps what the Activity page shows.
                ForEach(months) { month in
                    Text(ActivityHistory.monthTitle(month.id))
                        .font(.title3.bold()).foregroundStyle(Theme.text)
                        .accessibilityAddTraits(.isHeader)
                        .padding(.top, 14)
                    ForEach(month.entries) { entry in
                        NavigationLink(value: ActivityHistoryDay(entryID: entry.id, date: entry.date,
                                                                 focus: entry.focus)) {
                            ActivityEntryCard(entry: entry, today: sync.todayString,
                                              routeAccess: sync.activityRouteAccess)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("activityHistory.entry." + entry.id)
                    }
                }
            }
            .readableColumn()
            .padding(16)
        }
        .refreshable { await sync.load() }
    }

    private func makeHistory() -> ActivityHistory {
        sync.activityHistory(unit: RunDistanceUnit(rawValue: unitRaw) ?? .miles)
    }

    private func filters(_ categories: [ActivityHistory.Category],
                         selected: ActivityHistory.Category?) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All", isSelected: selected == nil, id: "all") { category = nil }
                ForEach(categories) { item in
                    chip(item.title, isSelected: selected == item, id: item.rawValue) { category = item }
                }
            }
            .padding(.vertical, 4)
        }
        .scrollClipDisabled()
    }

    private func chip(_ title: String, isSelected: Bool, id: String,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .frame(minHeight: 36)
                .foregroundStyle(isSelected ? Theme.onAccent : Theme.text)
                .background(isSelected ? Theme.accent : Theme.surface, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("activityHistory.filter." + id)
    }
}

extension SyncModel {
    /// Everything the member has done, as History and the Activity summary
    /// both show it.
    func activityHistory(unit: RunDistanceUnit) -> ActivityHistory {
        let today = todayString
        var hidden: [String: Bool] = [:]
        return ActivityHistory(
            sessions: sessions,
            activities: activities,
            logged: manualActivities,
            today: today,
            unit: unit,
            setCount: { self.loggedSetCount(sessionID: $0) },
            workout: { id in
                self.workout(id: id).map { workout in
                    ActivityHistory.WorkoutInfo(
                        name: workout.name,
                        isRunOnly: !workout.exercises.isEmpty && workout.exercises.allSatisfy(\.isOutdoorRun))
                }
            },
            // Like the calendar, a trip day without training hides the
            // activities a provider still reports for it.
            isHidden: { date in
                if let known = hidden[date] { return known }
                let value = self.projection(for: date, today: today).suppressesScheduleAndEndurance
                hidden[date] = value
                return value
            })
    }
}
