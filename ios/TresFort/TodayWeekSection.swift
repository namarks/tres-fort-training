import SwiftUI

/// Today's look ahead: the week as a fort (`WeekFortView`), one tower per
/// day over its date, opening on the current week and paging sideways into
/// the next few; then the next few days that carry a workout or planned ride
/// as one list, headed by the route to the full calendar. This week's fort
/// opens the Activity tab, where the week is told in full; a later week's
/// towers and each upcoming day open the same date sheet the calendar uses,
/// so assigning or replacing a workout works from here too.
struct TodayWeekSection: View {
    @ObservedObject var sync: SyncModel
    let onOpenCalendar: () -> Void
    /// Shows the Activity tab. Nil where there is no tab bar (UI fixtures),
    /// and then this week's towers open their days like the later weeks.
    var onOpenActivity: (() -> Void)? = nil
    @State private var selectedDate: IdentifiedString?
    /// The page on screen; 0 is the week containing today.
    @State private var visibleWeek: Int? = 0

    /// This week plus the next seven. Further out belongs to the calendar.
    static let weekCount = 8

    var body: some View {
        let weeks = Self.weeks(startingWith: sync.todayString, count: Self.weekCount)
        let upcoming = sync.upcomingDays()
        let page = min(visibleWeek ?? 0, max(weeks.count - 1, 0))
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                TodaySectionLabel(text: weeks.isEmpty ? "THIS WEEK" : Self.title(forWeek: page, days: weeks[page]))
                    .accessibilityIdentifier("today.weekTitle")
                if page > 0 {
                    Button {
                        withAnimation { visibleWeek = 0 }
                    } label: {
                        Image(systemName: "arrow.uturn.backward")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Theme.accent)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Back to this week")
                    .accessibilityIdentifier("today.thisWeek")
                }
                Spacer()
            }
            .frame(minHeight: 44)
            .padding(.horizontal, 4)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(weeks.indices, id: \.self) { index in
                        // The week on screen as a fort: trained days rise in
                        // orange. This week opens Activity as a whole; a
                        // later week has nothing done yet, so each of its
                        // towers opens its day for planning.
                        let title = Self.title(forWeek: index, days: weeks[index])
                        let days = WeekFort.days(for: weeks[index], sync: sync)
                        Group {
                            if index == 0, let onOpenActivity {
                                Button(action: onOpenActivity) {
                                    WeekFortView(title: title, days: days, showsDisclosure: true)
                                }
                                .buttonStyle(.plain)
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel(WeekFort.accessibilityLabel(title: title, days: days))
                                .accessibilityHint("Opens Activity")
                                .accessibilityAddTraits(.isButton)
                                .accessibilityIdentifier("today.weekActivity")
                            } else {
                                WeekFortView(title: title, days: days) { ymd in
                                    selectedDate = IdentifiedString(id: ymd)
                                }
                            }
                        }
                        .containerRelativeFrame(.horizontal)
                        .id(index)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $visibleWeek)
            .scrollIndicators(.hidden)
            HStack {
                TodaySectionLabel(text: "COMING UP")
                Spacer()
                Button(action: onOpenCalendar) {
                    HStack(spacing: 4) {
                        Text("Calendar")
                        Image(systemName: "chevron.right").font(.caption.weight(.bold))
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(minWidth: 44, minHeight: 44, alignment: .trailing)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("today.calendar")
            }
            .padding(.horizontal, 4)
            .padding(.top, 16).padding(.bottom, upcoming.isEmpty ? 0 : 4)
            if upcoming.isEmpty {
                Text("Nothing planned in the next two weeks.")
                    .font(.footnote).foregroundStyle(Theme.muted)
                    .padding(.horizontal, 4)
                    .accessibilityIdentifier("today.upcoming.none")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(upcoming.enumerated()), id: \.element.id) { index, day in
                        if index > 0 {
                            Rectangle().fill(Theme.surface2).frame(height: 1).padding(.leading, 64)
                        }
                        Button { selectedDate = IdentifiedString(id: day.dateString) } label: {
                            UpcomingDayRow(sync: sync, day: day)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("today.upcoming.\(day.dateString)")
                    }
                }
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
            }
        }
        .sheet(item: $selectedDate) { d in
            NavigationStack {
                DayAgendaView(sync: sync, dateString: d.id)
                    .navigationTitle("Workout date")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { selectedDate = nil }
                        }
                    }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    /// Monday through Sunday of the civil week containing `today`, on the
    /// same calendar the projection and the month grid use.
    static func week(containing today: String) -> [Date] {
        let cal = CalendarProjection.calendar
        guard let date = CalendarProjection.date(from: today) else { return [] }
        let daysSinceMonday = (cal.component(.weekday, from: date) + 5) % 7
        guard let monday = cal.date(byAdding: .day, value: -daysSinceMonday, to: date) else { return [] }
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: monday) }
    }

    /// `count` consecutive Monday–Sunday weeks, the first containing `today`.
    static func weeks(startingWith today: String, count: Int) -> [[Date]] {
        let first = week(containing: today)
        guard first.count == 7, count > 0 else { return [] }
        let cal = CalendarProjection.calendar
        return (0..<count).compactMap { offset in
            let days = first.compactMap { cal.date(byAdding: .day, value: offset * 7, to: $0) }
            return days.count == 7 ? days : nil
        }
    }

    /// "THIS WEEK", "NEXT WEEK", then the dates the page covers.
    static func title(forWeek index: Int, days: [Date]) -> String {
        switch index {
        case 0: return "THIS WEEK"
        case 1: return "NEXT WEEK"
        default:
            guard let first = days.first, let last = days.last else { return "" }
            let cal = CalendarProjection.calendar
            let sameMonth = cal.component(.month, from: first) == cal.component(.month, from: last)
            let end = sameMonth ? dayFormatter.string(from: last) : monthDayFormatter.string(from: last)
            return "\(monthDayFormatter.string(from: first)) – \(end)".uppercased()
        }
    }

    private static let monthDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = CalendarProjection.calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "MMM d"
        return f
    }()

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = CalendarProjection.calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "d"
        return f
    }()
}

/// One upcoming day: its date, the workout it resolves to, the activities
/// beside it, and any planned ride or run. A workout whose template isn't cached still shows its date.
private struct UpcomingDayRow: View {
    @ObservedObject var sync: SyncModel
    let day: SyncModel.UpcomingDay
    @AppStorage(RunDistanceUnit.preferenceKey) private var runUnitRaw = RunDistanceUnit.miles.rawValue
    private var runUnit: RunDistanceUnit { RunDistanceUnit(rawValue: runUnitRaw) ?? .miles }

    var body: some View {
        HStack(spacing: 12) {
            VStack(spacing: 1) {
                Text(weekday)
                    .font(Theme.mono(9, .bold)).tracking(1)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1).minimumScaleFactor(0.6)
                Text(dayNumber)
                    .font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(Theme.text)
            }
            .frame(width: 40)
            VStack(alignment: .leading, spacing: 6) {
                if day.hasWorkout {
                    let isRun = day.workout.map { !$0.exercises.isEmpty && $0.exercises.allSatisfy(\.isOutdoorRun) } ?? false
                    let isActivity = day.workout.map(PlannedActivity.isActivity) ?? false
                    HStack(alignment: .top, spacing: 10) {
                        glyph(isRun ? "figure.run" : isActivity ? "sportscourt" : "dumbbell.fill",
                              color: isRun || isActivity ? WorkoutCategory.endurance.color : WorkoutCategory.lift.color)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(day.workout?.name ?? "Workout scheduled")
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
                                .lineLimit(1)
                            if let workout = day.workout, !workout.exercises.isEmpty {
                                // A planned run reads as its steps, a lift as its exercises.
                                Text(workout.exercises.map { $0.isOutdoorRun ? $0.runPrescriptionLabel(in: runUnit) : $0.exercise_name }
                                    .joined(separator: " · "))
                                    .font(.footnote).foregroundStyle(Theme.muted)
                                    .lineLimit(isRun ? 2 : 1)
                            }
                        }
                    }
                }
                // Activities beside the day's workout, such as stretching.
                ForEach(day.extras) { extra in
                    HStack(spacing: 10) {
                        glyph(PlanItemSummary.glyph(for: extra), color: WorkoutCategory.endurance.color)
                        Text(day.hasWorkout ? "+ \(extra.name)" : extra.name)
                            .font(.subheadline).foregroundStyle(Theme.text)
                            .lineLimit(1)
                    }
                    .accessibilityLabel(day.hasWorkout ? "Also \(extra.name)" : extra.name)
                }
                ForEach(day.rides) { ride in
                    HStack(spacing: 10) {
                        glyph(ExternalActivity.glyph(forKind: ride.kind), color: WorkoutCategory.endurance.color)
                        Text(ride.durationLabel.map { "\(ride.displayTitle) · \($0)" } ?? ride.displayTitle)
                            .font(.subheadline).foregroundStyle(Theme.text)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.dim)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
        .contentShape(Rectangle())
    }

    /// The kind of day in a small tinted square, as in the Activity list.
    private func glyph(_ systemName: String, color: Color) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(color)
            .frame(width: 28, height: 28)
            .background(color.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityHidden(true)
    }

    /// "THU": the date sits below it, so the short weekday is enough and
    /// fits the 40 pt column.
    private var weekday: String {
        guard let date = CalendarProjection.date(from: day.dateString) else { return "" }
        return Self.weekdayFormatter.string(from: date).uppercased()
    }

    private static let weekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = CalendarProjection.calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "EEE"
        return f
    }()

    private var dayNumber: String {
        guard let date = CalendarProjection.date(from: day.dateString) else { return "" }
        return String(CalendarProjection.calendar.component(.day, from: date))
    }
}
