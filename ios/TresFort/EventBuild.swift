import Foundation

/// "Train for an event" (docs/plans/progressive-plans P3): the weeks the
/// server's fixed rules lay out from Your week to an event, as previewed.
struct EventBuildPreview: Decodable, Equatable {
    struct Week: Decodable, Equatable {
        let start: String
        /// base, build, peak, easy, taper or race.
        let phase: String
        let label: String
        /// The week's long run in meters; nil when it falls after the event.
        let long_run_m: Double?
        let factor: Double
        /// How much of the long run, at its end, is at goal pace.
        var long_run_goal_m: Double? = nil
        /// The workout day's session; nil when there is none this week.
        var workout: Workout? = nil
    }

    /// `reps` × `work_s` of strides, tempo, intervals or goal-pace running.
    struct Workout: Decodable, Equatable {
        /// strides, tempo, intervals, goal_pace or shakeout.
        let type: String
        let reps: Int
        let work_s: Int
    }

    struct Rules: Decodable, Equatable {
        let long_run_weekday: String
        let long_run_now_m: Double
        let longest_recent_m: Double?
        let peak_m: Double
        let easy_every: Int
        let taper_weeks: Int
        let shorten_other_runs: Bool
        let unit: String
        var workout_weekday: String? = nil
        /// "goal" with a goal time, else "finish".
        var style: String? = nil
        var goal_pace_s_per_km: Double? = nil
    }

    let start: String
    let weeks: [Week]
    let reached_peak: Bool
    let rules: Rules
    let replaces_block: Bool
    /// The plan version these weeks were laid out from; saving sends it.
    let plan_version: Int
}

/// What the member sets on the "Train for an event" sheet. Rules left nil
/// take the server's defaults, which the preview reports back.
struct EventBuildRequest: Equatable {
    var name: String
    var date: String
    var distance: EventBuilding.Distance
    var longRunWeekday: String
    var today: String
    var unit: RunDistanceUnit
    var longRunNowMeters: Double?
    var peakMeters: Double?
    var easyEvery: Int?
    var taperWeeks: Int?
    var shortenOtherRuns: Bool?
    /// The goal finish time; with one the weeks aim at goal pace.
    var goalTimeSeconds: Int? = nil
    /// The day of the week's harder run; nil lets the server suggest one.
    var workoutDay: EventBuilding.WorkoutDay? = nil
    /// "Keep building, no date": a block of this many weeks with no event,
    /// building to `peakMeters` (the ceiling) and holding there.
    var openWeeks: Int? = nil
    /// The block's first Monday; nil lets the server pick from today.
    var start: String? = nil

    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The wire body for `POST /api/plan/program/build`.
    var body: [String: Any] {
        var race: [String: Any] = [
            "name": String((trimmedName.isEmpty ? distance.title : trimmedName).prefix(100)),
            "date": date,
            "discipline": "running",
            "distance": distance.title,
            "distance_m": distance.meters,
        ]
        if let goalTimeSeconds { race["goal_time_s"] = goalTimeSeconds }
        var body: [String: Any] = [
            "today": today,
            "long_run_weekday": longRunWeekday,
            "unit": unit == .miles ? "mi" : "km",
        ]
        if let openWeeks {
            body["open"] = ["weeks": openWeeks]
        } else {
            body["race"] = race
        }
        if let longRunNowMeters { body["long_run_now_m"] = Int(longRunNowMeters.rounded()) }
        if let peakMeters { body["peak_m"] = Int(peakMeters.rounded()) }
        if let easyEvery { body["easy_every"] = easyEvery }
        if let taperWeeks { body["taper_weeks"] = taperWeeks }
        if let shortenOtherRuns { body["shorten_other_runs"] = shortenOtherRuns }
        switch workoutDay {
        case .off?: body["workout_weekday"] = NSNull()
        case .day(let key)?: body["workout_weekday"] = key
        case nil: break
        }
        if let start { body["start"] = start }
        return body
    }

    /// This request with every rule the preview resolved spelled out, so a
    /// save lays out exactly the weeks shown even if a run synced since
    /// would change the longest run lately or today moved on.
    func resolved(by preview: EventBuildPreview) -> EventBuildRequest {
        var next = self
        next.longRunNowMeters = longRunNowMeters ?? preview.rules.long_run_now_m
        next.peakMeters = peakMeters ?? preview.rules.peak_m
        next.easyEvery = easyEvery ?? preview.rules.easy_every
        next.taperWeeks = taperWeeks ?? preview.rules.taper_weeks
        next.shortenOtherRuns = shortenOtherRuns ?? preview.rules.shorten_other_runs
        next.workoutDay = workoutDay ?? preview.rules.workout_weekday.map { EventBuilding.WorkoutDay.day($0) } ?? EventBuilding.WorkoutDay.off
        next.start = start ?? preview.start
        return next
    }
}

enum EventBuilding {
    /// The day of the week's harder run, or none.
    enum WorkoutDay: Hashable {
        case off
        case day(String)
    }

    /// The distances the sheet offers; the server picks a peak and taper to suit each.
    enum Distance: String, CaseIterable, Identifiable {
        case fiveK, tenK, half, marathon
        var id: String { rawValue }
        var title: String {
            switch self {
            case .fiveK: "5K"
            case .tenK: "10K"
            case .half: "Half marathon"
            case .marathon: "Marathon"
            }
        }
        var meters: Int {
            switch self {
            case .fiveK: 5_000
            case .tenK: 10_000
            case .half: 21_097
            case .marathon: 42_195
            }
        }
        /// A goal time to start from when the member picks "Goal time".
        var suggestedGoalSeconds: Int {
            switch self {
            case .fiveK: 30 * 60
            case .tenK: 60 * 60
            case .half: 2 * 3_600
            case .marathon: 4 * 3_600 + 30 * 60
            }
        }
    }

    /// How long a "Keep building" block runs (the server takes 4 to 52 weeks).
    static let openWeekChoices = [8, 12, 16, 24]

    /// The server's limits (`BUILD_LIMITS`).
    static let easyEveryChoices = [0, 2, 3, 4, 5, 6]
    static let taperChoices = 1...4
    static let minMeters = 1_000.0
    static let maxMeters = 100_000.0

    /// The weekday whose Your-week workout has a run, Sunday first, else the
    /// last such day of the week; nil when no day has one.
    static func longRunWeekday(in plan: PlanTree?) -> String? {
        guard let plan, let schedule = plan.schedule else { return nil }
        let workouts = Dictionary(plan.availableWorkouts.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let runDays = PlanSchedule.weekdayKeys.filter { key in
            let ids = [schedule.week[key] ?? nil].compactMap { $0 } + (schedule.extras?[key] ?? [])
            return ids.contains { id in workouts[id]?.exercises.contains(where: \.isOutdoorRun) ?? false }
        }
        if runDays.contains("sun") { return "sun" }
        return runDays.last
    }

    /// Whole units, as the rules round them.
    static func units(_ meters: Double, _ unit: RunDistanceUnit) -> Int {
        max(1, Int((meters / unit.meters).rounded()))
    }

    static func meters(_ units: Int, _ unit: RunDistanceUnit) -> Double {
        (Double(units) * unit.meters).rounded()
    }

    /// "8 mi", or "26.2 mi" for a distance that isn't whole.
    static func distanceText(_ meters: Double, _ unit: RunDistanceUnit) -> String {
        let value = meters / unit.meters
        let rounded = (value * 10).rounded() / 10
        let text = rounded == rounded.rounded() ? String(Int(rounded)) : String(format: "%.1f", rounded)
        return "\(text) \(unit.abbreviation)"
    }

    static func easyEveryTitle(_ every: Int) -> String {
        switch every {
        case 0: "Never"
        case 2: "Every 2nd"
        case 3: "Every 3rd"
        default: "Every \(every)th"
        }
    }

    /// Phases in the order the chart's key lists them, with their week span.
    static func phaseSpans(_ weeks: [EventBuildPreview.Week]) -> [(label: String, range: String)] {
        let order = ["base": "Base", "build": "Build", "peak": "Peak", "hold": "Holding", "taper": "Taper", "race": "Race"]
        var spans: [(String, Int, Int)] = []
        for (index, week) in weeks.enumerated() where week.phase != "easy" {
            let phase = week.phase == "race" ? "taper" : week.phase
            if let last = spans.last, last.0 == phase {
                spans[spans.count - 1].2 = index + 1
            } else {
                spans.append((phase, index + 1, index + 1))
            }
        }
        return spans.compactMap { span -> (label: String, range: String)? in
            guard let label = order[span.0] else { return nil }
            return (label: label, range: span.1 == span.2 ? "\(span.1)" : "\(span.1)–\(span.2)")
        }
    }

    /// "RACE DAY SUN, JUN 1 · 15 WEEKS TO GO" over a block that runs to the
    /// event; nil once it has passed or when the block doesn't reach it.
    static func raceDayLine(_ event: PlanEvent, program: PlanProgram, today: String) -> String? {
        guard let days = CalendarProjection.dayNumber(event.date),
              let now = CalendarProjection.dayNumber(today),
              let start = CalendarProjection.dayNumber(program.start),
              days >= now, days >= start, days < start + program.weeks.count * 7 else { return nil }
        let left = days - now
        let toGo = left == 0 ? "today" : left < 7 ? (left == 1 ? "tomorrow" : "in \(left) days")
            : "\((left + 6) / 7) weeks to go"
        return "Race day \(ProgramEditing.spokenDate(event.date)) · \(toGo)".uppercased()
    }

    /// "3:30" for a goal time in whole minutes, "3:29:30" otherwise; "25:00" under an hour.
    static func goalTimeText(_ seconds: Int) -> String {
        let h = seconds / 3_600, m = seconds % 3_600 / 60, s = seconds % 60
        if h == 0 { return String(format: "%d:%02d", m, s) }
        return s == 0 ? String(format: "%d:%02d", h, m) : String(format: "%d:%02d:%02d", h, m, s)
    }

    /// "8:01/mi" for a pace in seconds per kilometer.
    static func paceText(_ secondsPerKm: Double, _ unit: RunDistanceUnit) -> String {
        let total = Int((secondsPerKm * unit.meters / 1_000).rounded())
        return String(format: "%d:%02d/%@", total / 60, total % 60, unit.abbreviation)
    }

    private static func minutes(_ seconds: Int) -> String {
        seconds % 60 == 0 ? "\(seconds / 60) min" : "\(seconds) s"
    }

    /// The workout day's session in a few words: "Tempo 20 min", "6 × 3 min".
    static func workoutText(_ workout: EventBuildPreview.Workout) -> String {
        switch workout.type {
        case "strides": return "Strides \(workout.reps) × \(minutes(workout.work_s))"
        case "tempo": return "Tempo \(minutes(workout.work_s * workout.reps))"
        case "intervals": return "\(workout.reps) × \(minutes(workout.work_s))"
        case "goal_pace": return "\(workout.reps) × \(minutes(workout.work_s)) at goal pace"
        case "shakeout": return "Shakeout and \(workout.reps) strides"
        default: return "\(workout.reps) × \(minutes(workout.work_s))"
        }
    }

    /// "Long run 16 mi, last 4 at goal pace", or the race itself in race week.
    static func longRunText(_ week: EventBuildPreview.Week, raceMeters: Int, _ unit: RunDistanceUnit) -> String? {
        guard let meters = week.long_run_m else { return nil }
        if week.phase == "race", Int(meters.rounded()) == raceMeters {
            return week.long_run_goal_m == nil ? "Race day" : "Race day at goal pace"
        }
        var text = "Long run \(distanceText(meters, unit))"
        if let goal = week.long_run_goal_m {
            text += ", last \(distanceText(goal, unit).split(separator: " ").first.map(String.init) ?? "") at goal pace"
        }
        return text
    }

    /// What a rule the server refused means, in the member's words.
    static func message(for body: String) -> String {
        if body.contains("\"long_run_shared\"") {
            let day = PlanSchedule.weekdayKeys.first { body.contains("\"weekday\":\"\($0)\"") }
            let name = day.flatMap { WorkoutLibraryPolicy.weekdayNames[$0] } ?? "another day"
            return "Your long run workout is also on \(name). Give the long run its own workout, then try again."
        }
        if body.contains("\"workout_shared\"") {
            let day = PlanSchedule.weekdayKeys.first { body.contains("\"weekday\":\"\($0)\"") }
            let name = day.flatMap { WorkoutLibraryPolicy.weekdayNames[$0] } ?? "another day"
            return "Your workout day's run is also on \(name). Give it its own workout or pick another day."
        }
        if body.contains("\"no_workout_run\"") {
            return "That workout day has no run of its own in Your week. Pick another day or None."
        }
        if body.contains("\"goal_pace_out_of_range\"") {
            return "That goal time is too fast or too slow a pace for this distance. Check the goal time."
        }
        if body.contains("\"no_long_run\"") {
            return "That day has no run in Your week. Pick the day of your long run, or add a run to it."
        }
        if body.contains("\"event_in_past\"") { return "Pick an event date that hasn't passed." }
        if body.contains("\"event_before_start\"") { return "The event is before the block would start." }
        if body.contains("\"too_many_weeks\"") { return "That's more than 52 weeks away. Pick a closer date." }
        return "Couldn't plan the weeks. Check your connection and try again."
    }
}

struct EventBuildFailure: Error, Equatable {
    let message: String
}
