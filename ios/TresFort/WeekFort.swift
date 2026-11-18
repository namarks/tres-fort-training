import SwiftUI

/// Today's week as a fort, in the app icon's colors: every day you trained
/// raises an orange tower, a day with training still planned (or missed)
/// stands as a quiet blue tower, and a rest day stays low. It reads the same
/// projection, sessions and activities as the calendar cells below it.
enum WeekFort {
    enum State: Equatable { case trained, planned, rest }

    struct Day: Equatable {
        let ymd: String
        let state: State
        let isToday: Bool
    }

    /// One day's tower. Logged work wins: a completed session, an in-progress
    /// one with sets, or an activity that day. A session or schedule entry
    /// still to do, an activity planned beside the day's workout (a schedule
    /// extra, such as Friday's core work) or a planned ride is a planned
    /// tower; anything else rests. Endurance on a hard-blackout day is
    /// ignored, as the calendar does; the projection already leaves extras
    /// off past dates and trip days.
    static func state(kind: DayProjection.Kind,
                      loggedSets: Int,
                      hasActivity: Bool,
                      hasPlannedRide: Bool,
                      suppressesEndurance: Bool,
                      hasPlannedExtra: Bool = false) -> State {
        if kind == .completed || (kind == .inProgress && loggedSets > 0) { return .trained }
        if hasActivity && !suppressesEndurance { return .trained }
        switch kind {
        case .planned, .projected, .inProgress: return .planned
        default: break
        }
        if hasPlannedExtra { return .planned }
        if hasPlannedRide && !suppressesEndurance { return .planned }
        return .rest
    }

    @MainActor
    static func days(for dates: [Date], sync: SyncModel) -> [Day] {
        let today = sync.todayString
        return dates.map { date in
            let ymd = CalendarProjection.dateString(date)
            let projection = sync.projection(for: ymd, today: today)
            let dayState = Self.state(kind: projection.kind,
                                      loggedSets: sync.loggedSetCount(forDate: ymd),
                                      hasActivity: !sync.activities(on: ymd).isEmpty
                                          || !sync.manualActivities(on: ymd).isEmpty,
                                      hasPlannedRide: !sync.rides(on: ymd).isEmpty,
                                      suppressesEndurance: projection.suppressesScheduleAndEndurance,
                                      hasPlannedExtra: !sync.plannedExtras(on: ymd, today: today).isEmpty)
            return Day(ymd: ymd, state: dayState, isToday: ymd == today)
        }
    }

    /// "2 of 5 done", "5 planned", "1 done" or "Rest week".
    static func summary(_ days: [Day]) -> String {
        let trained = days.filter { $0.state == .trained }.count
        let planned = days.filter { $0.state == .planned }.count
        switch (trained, planned) {
        case (0, 0): return "Rest week"
        case (0, _): return "\(planned) planned"
        case (_, 0): return "\(trained) done"
        default: return "\(trained) of \(trained + planned) done"
        }
    }

    /// "M" for a Monday: the letter under each tower.
    static func weekdayLetter(_ ymd: String) -> String {
        guard let date = CalendarProjection.date(from: ymd) else { return "" }
        return letterFormatter.string(from: date)
    }

    /// The day of the month under each tower.
    static func dayNumber(_ ymd: String) -> String {
        guard let date = CalendarProjection.date(from: ymd) else { return "" }
        return String(CalendarProjection.calendar.component(.day, from: date))
    }

    /// "Friday, Nov 6, today: rest". Each tower opens its day.
    static func dayAccessibilityLabel(_ day: Day) -> String {
        let state: String
        switch day.state {
        case .trained: state = "trained"
        case .planned: state = "training planned"
        case .rest: state = "rest"
        }
        return DateLabel.long(day.ymd) + (day.isToday ? ", today" : "") + ": " + state
    }

    private static let letterFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = CalendarProjection.calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = CalendarProjection.calendar.timeZone
        f.dateFormat = "EEEEE"
        return f
    }()

    static func accessibilityLabel(title: String, days: [Day]) -> String {
        let trained = days.filter { $0.state == .trained }.count
        let planned = days.filter { $0.state == .planned }.count
        let total = trained + planned
        let noun = total == 1 ? "training day" : "training days"
        let range = title.lowercased()
        if total == 0 { return "\(range.capitalizedFirst): rest week" }
        return "\(range.capitalizedFirst): \(trained) of \(total) \(noun) done"
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// The week as a light chart on the page, with no card of its own
/// (app-design-pass P29): seven towers, Monday first, each over its weekday
/// letter and date. Trained days are the only orange; planned days stand in
/// a quiet blue, rest days stay low, and today's date is ringed. The count
/// ("2 of 5 done") is in the section's heading. Tapping a day opens it.
struct WeekFortView: View {
    let days: [WeekFort.Day]
    var onSelect: ((String) -> Void)? = nil

    private static let towerHeight: CGFloat = 28
    private static let restHeight: CGFloat = 6
    private static let dateSize: CGFloat = 28

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            ForEach(days, id: \.ymd) { day in
                dayColumn(day)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 4)
    }

    @ViewBuilder
    private func dayColumn(_ day: WeekFort.Day) -> some View {
        let column = VStack(spacing: 4) {
            tower(day)
                .frame(height: Self.towerHeight, alignment: .bottom)
            Text(WeekFort.weekdayLetter(day.ymd))
                .font(Theme.mono(10, .bold))
                .foregroundStyle(day.isToday ? Theme.signal : Theme.muted)
                .lineLimit(1)
                .padding(.top, 2)
            Text(WeekFort.dayNumber(day.ymd))
                .font(.subheadline.weight(day.isToday ? .bold : .semibold).monospacedDigit())
                .foregroundStyle(day.isToday ? Theme.signal : Theme.text)
                .lineLimit(1).minimumScaleFactor(0.7)
                .frame(minWidth: Self.dateSize, minHeight: Self.dateSize)
                .overlay {
                    // Where you are in the week.
                    if day.isToday { Capsule().strokeBorder(Theme.signal, lineWidth: 2) }
                }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        if let onSelect {
            Button { onSelect(day.ymd) } label: { column }
                .buttonStyle(.plain)
                .accessibilityLabel(WeekFort.dayAccessibilityLabel(day))
                .accessibilityIdentifier("today.week.\(day.ymd)")
        } else {
            column
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(WeekFort.dayAccessibilityLabel(day))
        }
    }

    private func tower(_ day: WeekFort.Day) -> some View {
        let fill: Color
        switch day.state {
        case .trained: fill = BrandPalette.fortOrange
        case .planned: fill = BrandPalette.weekPlanned
        case .rest: fill = Theme.surface2
        }
        return UnevenRoundedRectangle(topLeadingRadius: 3, topTrailingRadius: 3)
            .fill(fill)
            .frame(height: day.state == .rest ? Self.restHeight : Self.towerHeight)
    }
}
