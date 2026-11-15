import Foundation

/// The top of the Activity tab: this week at a glance, the week streak, how
/// this week compares with the same point last week, and training time by
/// week. It counts everything History lists (workouts, runs, rides, sports
/// and activities logged by hand), from the same entries, so the two never
/// disagree. Pure, so the view and tests share one set of rules.
struct ActivitySummary: Equatable {
    struct Day: Identifiable, Equatable {
        var id: String { date }
        let date: String
        /// Training time by family; a session without a known time adds none.
        let seconds: [ActivityHistory.Family: Int]
        let sessions: Int
        let isToday: Bool
        /// Later this week; nothing can have happened there yet.
        let isFuture: Bool

        var totalSeconds: Int { seconds.values.reduce(0, +) }
    }

    struct Week: Identifiable, Equatable {
        var id: String { start }
        /// Monday, `YYYY-MM-DD`.
        let start: String
        /// Sunday, or today for the current week.
        let end: String
        let seconds: [ActivityHistory.Family: Int]
        let sessions: Int
        let isCurrent: Bool

        var totalSeconds: Int { seconds.values.reduce(0, +) }
    }

    /// The distance figure on the week card: the kind with the most time
    /// this week (swims included), then the most distance, run before ride
    /// on a tie.
    struct Distance: Equatable {
        let meters: Double
        let kind: String
    }

    /// Monday to Sunday of the current week, future days included.
    let days: [Day]
    /// Oldest first, ending with the current week.
    let weeks: [Week]
    /// Consecutive Monday–Sunday weeks with any training, ending this week.
    /// An empty current week is still in progress, so the count then ends
    /// last week instead of resetting.
    let streak: Int
    /// This week's time minus last week's up to the same weekday.
    let changeSeconds: Int
    let distance: Distance?
    /// Known loads summed; nil when nothing this week has one, so unscored
    /// training never reads as zero.
    let load: Int?

    var thisWeek: Week? { weeks.last }
    var isEmpty: Bool { weeks.allSatisfy { $0.sessions == 0 } && streak == 0 }

    init(entries: [ActivityHistory.Entry], today: String, weekCount: Int = 8) {
        let calendar = CalendarProjection.calendar
        guard weekCount > 0, let todayDate = CalendarProjection.date(from: today),
              CalendarProjection.dateString(todayDate) == today else {
            days = []; weeks = []; streak = 0; changeSeconds = 0; distance = nil; load = nil
            return
        }
        let monday = WorkoutConsistency.monday(of: todayDate)
        let mondayString = CalendarProjection.dateString(monday)
        func shift(_ date: Date, days: Int) -> String {
            CalendarProjection.dateString(calendar.date(byAdding: .day, value: days, to: date)!)
        }
        let counted = entries.filter { $0.date <= today }
        let byDate = Dictionary(grouping: counted, by: \.date)

        func seconds(_ items: [ActivityHistory.Entry]) -> [ActivityHistory.Family: Int] {
            var out: [ActivityHistory.Family: Int] = [:]
            for item in items where item.seconds > 0 { out[item.family, default: 0] += item.seconds }
            return out
        }

        days = (0..<7).map { offset in
            let date = shift(monday, days: offset)
            let items = byDate[date] ?? []
            return Day(date: date, seconds: seconds(items), sessions: items.count,
                       isToday: date == today, isFuture: date > today)
        }

        weeks = (0..<weekCount).reversed().map { offset in
            let start = shift(monday, days: -offset * 7)
            let end = offset == 0 ? today : shift(monday, days: -offset * 7 + 6)
            let items = counted.filter { $0.date >= start && $0.date <= end }
            return Week(start: start, end: end, seconds: seconds(items), sessions: items.count,
                        isCurrent: offset == 0)
        }

        // Last week up to the same weekday as today.
        let lastWeekStart = shift(monday, days: -7)
        let lastWeekSameDay = shift(todayDate, days: -7)
        let lastWeekSoFar = counted.filter { $0.date >= lastWeekStart && $0.date <= lastWeekSameDay }
        let thisWeekItems = counted.filter { $0.date >= mondayString }
        changeSeconds = thisWeekItems.reduce(0) { $0 + $1.seconds }
            - lastWeekSoFar.reduce(0) { $0 + $1.seconds }

        // Swims count too: a swimmer's yards are their distance. Kinds are
        // compared by time, since yards and miles don't compare.
        var metersByKind: [String: Double] = [:]
        var secondsByKind: [String: Int] = [:]
        for item in thisWeekItems {
            guard let kind = item.activityKind, let meters = item.meters else { continue }
            metersByKind[kind, default: 0] += meters
            secondsByKind[kind, default: 0] += item.seconds
        }
        let rank = ["run": 0, "ride": 1]
        distance = metersByKind
            .filter { $0.value > 0 }
            .max { a, b in
                let (sa, sb) = (secondsByKind[a.key] ?? 0, secondsByKind[b.key] ?? 0)
                if sa != sb { return sa < sb }
                return a.value != b.value ? a.value < b.value
                    : (rank[a.key] ?? 9, a.key) > (rank[b.key] ?? 9, b.key)
            }
            .map { Distance(meters: $0.value, kind: $0.key) }

        let loads = thisWeekItems.compactMap(\.load)
        load = loads.isEmpty ? nil : loads.reduce(0, +)

        let activeWeeks = Set(counted.compactMap { CalendarProjection.date(from: $0.date) }
            .map { CalendarProjection.dateString(WorkoutConsistency.monday(of: $0)) })
        var cursor = monday
        if !activeWeeks.contains(mondayString) {
            cursor = calendar.date(byAdding: .day, value: -7, to: monday)!
        }
        var run = 0
        while activeWeeks.contains(CalendarProjection.dateString(cursor)) {
            run += 1
            cursor = calendar.date(byAdding: .day, value: -7, to: cursor)!
        }
        streak = run
    }

    /// Mean time over the finished weeks; the current week is still running.
    var averageWeekSeconds: Int {
        let finished = weeks.dropLast()
        guard !finished.isEmpty else { return 0 }
        return finished.reduce(0) { $0 + $1.totalSeconds } / finished.count
    }

    /// "1h 22m more than this time last week", "20m less …", or "Same as …".
    static func changeText(_ seconds: Int) -> String {
        if abs(seconds) < 60 { return "Same as this time last week" }
        let amount = EnduranceProgress.duration(abs(seconds))
        return "\(amount) \(seconds > 0 ? "more" : "less") than this time last week"
    }

    // MARK: Weeks chart axes

    /// Steps the time axis can count in, in minutes.
    static let axisStepsMinutes = [15, 30, 60, 120, 180, 240, 360, 480, 600, 900, 1_200]

    /// The time axis's marks in minutes, from 0 up to the first mark at or
    /// above the busiest week, at most four steps, each mark a different,
    /// round time (so no "1h" twice).
    static func axisMinutes(busiestSeconds: Int) -> [Int] {
        let busiest = max(Double(busiestSeconds) / 60, 1)
        let step = axisStepsMinutes.first { (busiest / Double($0)).rounded(.up) <= 4 }
            ?? Int((busiest / 4).rounded(.up))
        let count = max(1, Int((busiest / Double(step)).rounded(.up)))
        return (0...count).map { $0 * step }
    }

    /// "0", "30m", "1h", "1h 30m".
    static func axisLabel(minutes: Int) -> String {
        minutes == 0 ? "0" : EnduranceProgress.duration(minutes * 60)
    }

    /// The week starts that get a date under their bar: every `every`th week
    /// counting back from this week, so labels never run into each other.
    /// This week reads "This week", the others "Oct 5".
    static func axisWeekLabels(_ starts: [String], every: Int) -> [String: String] {
        guard let last = starts.indices.last else { return [:] }
        var out: [String: String] = [:]
        for index in starts.indices where (last - index) % max(1, every) == 0 {
            let start = starts[index]
            if index == last {
                out[start] = "This week"
            } else if let date = CalendarProjection.date(from: start) {
                out[start] = axisDateFormatter.string(from: date)
            }
        }
        return out
    }

    private static let axisDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = CalendarProjection.calendar
        formatter.timeZone = CalendarProjection.calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter
    }()
}

/// The best things from the last few weeks, for the Activity tab's
/// Highlights: the fastest and longest run, and a new heaviest set.
struct ActivityHighlights: Equatable {
    struct Run: Equatable {
        let entryID: String
        let date: String
        let title: String
        let meters: Double
        let seconds: Int
        let focus: DayAgendaFocus?
    }

    /// A working set heavier than any earlier set of that exercise.
    struct Lift: Equatable {
        let exerciseID: String
        let date: String
        let weight: Double
        let reps: Int
        let unit: WeightUnit
        /// The heaviest earlier set, in its own unit.
        let previousWeight: Double
        let previousUnit: WeightUnit
    }

    /// Shorter runs don't count for pace, so a sprint or a GPS blip can't
    /// stand as the fastest run.
    static let shortestPaceRunMeters = 1_600.0
    static let windowDays = 30

    let fastestRun: Run?
    let longestRun: Run?
    let newBest: Lift?

    var isEmpty: Bool { fastestRun == nil && longestRun == nil && newBest == nil }

    init(entries: [ActivityHistory.Entry], sets: [SetLog] = [], sessionDates: [String: String] = [:],
         today: String, countsAsLoaded: (String) -> Bool = { _ in true }) {
        guard let todayDate = CalendarProjection.date(from: today),
              let start = CalendarProjection.calendar.date(byAdding: .day, value: -(Self.windowDays - 1),
                                                           to: todayDate) else {
            fastestRun = nil; longestRun = nil; newBest = nil
            return
        }
        let since = CalendarProjection.dateString(start)
        let runs: [Run] = entries.compactMap { entry in
            guard entry.kind == .activity, entry.activityKind == "run",
                  entry.date >= since, entry.date <= today,
                  let meters = entry.meters, meters > 0 else { return nil }
            return Run(entryID: entry.id, date: entry.date, title: entry.title, meters: meters,
                       seconds: entry.seconds, focus: entry.focus)
        }
        fastestRun = runs
            .filter { $0.seconds > 0 && $0.meters >= Self.shortestPaceRunMeters }
            .min { a, b in
                let lhs = Double(a.seconds) / a.meters, rhs = Double(b.seconds) / b.meters
                return lhs != rhs ? lhs < rhs : (a.date, a.entryID) > (b.date, b.entryID)
            }
        longestRun = runs.max { a, b in
            a.meters != b.meters ? a.meters < b.meters : (a.date, a.entryID) > (b.date, b.entryID)
        }
        newBest = Self.newBest(sets: sets, sessionDates: sessionDates, since: since, today: today,
                               countsAsLoaded: countsAsLoaded)
    }

    /// The most recent working set in the window that was heavier, as a
    /// physical load, than every earlier set of its exercise. A first-ever
    /// set is not a new best: there is nothing to beat yet.
    static func newBest(sets: [SetLog], sessionDates: [String: String], since: String, today: String,
                        countsAsLoaded: (String) -> Bool) -> Lift? {
        let working: [SetLog] = sets.filter { (set: SetLog) -> Bool in
            guard set.deleted_at == nil, set.is_warmup == 0, set.is_timed != 1 else { return false }
            return set.weight > 0 && set.reps > 0 && countsAsLoaded(set.exercise_id)
        }
        var best: Lift?
        var bestKey: (String, Int)?
        for (exerciseID, rows) in Dictionary(grouping: working, by: \.exercise_id) {
            var dated: [(row: SetLog, date: String)] = []
            for row in rows {
                guard let date = sessionDates[row.session_id], date <= today else { continue }
                dated.append((row: row, date: date))
            }
            dated.sort { (a: (row: SetLog, date: String), b: (row: SetLog, date: String)) -> Bool in
                if a.date != b.date { return a.date < b.date }
                return a.row.logged_at < b.row.logged_at
            }
            var heaviest: SetLog?
            for item in dated {
                let row: SetLog = item.row
                let date: String = item.date
                let pounds: Double = row.weightUnit.convert(row.weight, to: WeightUnit.lb)
                if let previous = heaviest {
                    let previousPounds: Double = previous.weightUnit.convert(previous.weight, to: WeightUnit.lb)
                    if pounds > previousPounds + 0.01 {
                        var isLatest = true
                        if let key = bestKey {
                            isLatest = date != key.0 ? date > key.0 : row.logged_at > key.1
                        }
                        if date >= since, isLatest {
                            best = Lift(exerciseID: exerciseID, date: date, weight: row.weight, reps: row.reps,
                                        unit: row.weightUnit, previousWeight: previous.weight,
                                        previousUnit: previous.weightUnit)
                            bestKey = (date, row.logged_at)
                        }
                        heaviest = row
                    }
                } else {
                    heaviest = row
                }
            }
        }
        return best
    }
}
