import Foundation

/// An optional time of day for what a weekday holds (its workout or an
/// activity beside it), such as a run at 7:00 and core at 21:00. Most items
/// have none. They live in `meta.schedule.times` (weekday → workout id →
/// "HH:MM", 24-hour local time), and the app reminds the member at a set
/// time (docs/plans/app-design-pass P19). These are the pure rules the Plan
/// screens, Today and the reminders share.
enum ScheduleTimes {
    /// The time set for a workout on a weekday, as minutes after midnight.
    static func minutes(_ workoutID: String, on weekdayKey: String, plan: PlanTree?) -> Int? {
        plan?.schedule?.time(forWeekdayKey: weekdayKey, workoutID: workoutID).flatMap(minutes(from:))
    }

    /// The time set for a workout on a date's weekday, as minutes after midnight.
    static func minutes(_ workoutID: String, onDate ymd: String, plan: PlanTree?) -> Int? {
        guard let key = CalendarProjection.weekdayKey(forDateString: ymd) else { return nil }
        return minutes(workoutID, on: key, plan: plan)
    }

    /// "07:00" → 420. Nil for anything that isn't a 24-hour "HH:MM".
    static func minutes(from hhmm: String) -> Int? {
        let parts = hhmm.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0..<24).contains(hour), (0..<60).contains(minute)
        else { return nil }
        return hour * 60 + minute
    }

    /// 420 → "07:00", the wire form.
    static func hhmm(_ minutes: Int) -> String {
        let clamped = min(max(minutes, 0), 24 * 60 - 1)
        return String(format: "%02d:%02d", clamped / 60, clamped % 60)
    }

    /// How a time reads in the member's locale: "7:00 AM" or "07:00".
    static func display(_ minutes: Int, locale: Locale = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let date = calendar.date(from: DateComponents(year: 2000, month: 1, day: 1,
                                                      hour: minutes / 60, minute: minutes % 60)) ?? Date()
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Every weekday's times with one item's time set (or cleared with nil),
    /// ready for one schedule write. Times for what a weekday no longer
    /// holds are left out, as the server does.
    static func setting(_ minutes: Int?, for workoutID: String, on weekdayKey: String,
                        plan: PlanTree) -> [String: [String: String]] {
        setting(minutes, for: workoutID, on: [weekdayKey], plan: plan)
    }

    /// The same, on several weekdays at once: "same time every day it's on".
    static func setting(_ minutes: Int?, for workoutID: String, on weekdayKeys: [String],
                        plan: PlanTree) -> [String: [String: String]] {
        var times = current(plan)
        for key in weekdayKeys {
            var day = times[key] ?? [:]
            day[workoutID] = minutes.map(hhmm)
            times[key] = day.isEmpty ? nil : day
        }
        return times.filter { !$0.value.isEmpty }
    }

    /// Whether every weekday holding the item has the same time (or none),
    /// so "every day it's on" can start switched on without changing any.
    static func isSameEveryDay(_ workoutID: String, plan: PlanTree?) -> Bool {
        Set(PlanItemSummary.weekdays(using: workoutID, plan: plan).map { minutes(workoutID, on: $0, plan: plan) })
            .count <= 1
    }

    /// Saved times still on their weekday: the day's workout or one of its
    /// extras.
    static func current(_ plan: PlanTree) -> [String: [String: String]] {
        guard let schedule = plan.schedule else { return [:] }
        var out: [String: [String: String]] = [:]
        for key in PlanSchedule.weekdayKeys {
            let held = Set([schedule.templateID(forWeekdayKey: key)].compactMap { $0 }
                + schedule.extraIDs(forWeekdayKey: key))
            let kept = (schedule.times?[key] ?? [:]).filter { held.contains($0.key) && minutes(from: $0.value) != nil }
            if !kept.isEmpty { out[key] = kept }
        }
        return out
    }
}
