#if DEBUG
import Foundation

/// Fictional days for simulator screenshots and previews. Launch the Watch
/// app with `-watch-day-fixture today` (or `rest`, `earlier`, `waiting`) to
/// show one without an iPhone. Debug builds only.
enum WatchDayFixtures: String {
    case today
    case rest
    case earlier
    case waiting

    static let argument = "-watch-day-fixture"

    static func requested(in arguments: [String]) -> WatchDayFixtures? {
        guard let index = arguments.firstIndex(of: argument), arguments.indices.contains(index + 1) else { return nil }
        return WatchDayFixtures(rawValue: arguments[index + 1])
    }

    func snapshot(today: String, offersStart: Bool = true) -> WatchDaySnapshot? {
        let calendar = TrainingAgendaCalendar.calendar()
        func day(_ offset: Int) -> String {
            guard let start = TrainingAgendaCalendar.date(from: today, calendar: calendar),
                  let date = calendar.date(byAdding: .day, value: offset, to: start) else { return today }
            return TrainingAgendaCalendar.dateString(date, calendar: calendar)
        }
        let later = [
            WatchUpcomingDay(date: day(1), title: "Rest day", detail: nil, isWorkout: false),
            WatchUpcomingDay(date: day(2), title: "Tempo run", detail: "4 × 4 min", isWorkout: true),
        ]
        switch self {
        case .today:
            return WatchDaySnapshot(date: today, rows: [
                WatchDayRow(id: "run", title: "Easy run", detail: "Done", kicker: nil, state: .done, glyph: "figure.run"),
                WatchDayRow(id: "lift", title: "Lower Body", detail: "Back squat, Deadlift, Split squat +2",
                            kicker: "Up next · 5:30 PM", state: .next, glyph: "dumbbell",
                            start: offersStart ? WatchDayRow.Start(title: "Start", token: "lift") : nil),
                WatchDayRow(id: "core", title: "Core", detail: "Plank, Dead bug", kicker: nil, state: .open,
                            glyph: "figure.core.training"),
            ], emptyTitle: "Rest day", emptyDetail: "Nothing planned today.", upcoming: later)
        case .rest:
            return WatchDaySnapshot(date: today, rows: [], emptyTitle: "Rest day",
                                    emptyDetail: "Nothing planned today.", upcoming: later)
        case .earlier:
            return WatchDaySnapshot(date: day(-2), rows: [], emptyTitle: "Rest day", emptyDetail: nil, upcoming: [
                WatchUpcomingDay(date: day(-1), title: "Rest day", detail: nil, isWorkout: false),
                WatchUpcomingDay(date: today, title: "Lower Body", detail: "Back squat, Deadlift, Split squat +2",
                                 isWorkout: true),
                WatchUpcomingDay(date: day(2), title: "Tempo run", detail: "4 × 4 min", isWorkout: true),
            ])
        case .waiting:
            return nil
        }
    }
}
#endif
