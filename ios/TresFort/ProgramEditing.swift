import Foundation

/// The pure rules behind the Plan tab's block of weeks (docs/plans/
/// progressive-plans P2). A block starts as copies of "Your week"; a day can
/// change for one week or for that week and the ones after; a week can be
/// relabeled or copied over the next. Every edit returns a whole program for
/// one `PUT /api/plan/program` at the plan version on screen, keeping each
/// week's targets (P1) as saved.
enum ProgramEditing {
    /// Which weeks a day change reaches.
    enum Scope: String, CaseIterable, Identifiable {
        case thisWeek, thisAndLater
        var id: String { rawValue }
        var title: String {
            switch self {
            case .thisWeek: return "This week only"
            case .thisAndLater: return "This week and after"
            }
        }
    }

    /// Where today sits against a block.
    enum Position: Equatable {
        /// The block starts on a later Monday.
        case upcoming(startsIn: Int)
        /// Today is in week `index` (0-based).
        case current(index: Int)
        /// A one-off block that has ended; Your week is back.
        case ended
    }

    static let maxWeeks = PlanProgram.maxWeeks

    // MARK: civil dates (the same pure rule as `CalendarProjection.dayNumber`)

    /// `YYYY-MM-DD` for a day number (days since 1970-01-01), Hinnant's
    /// civil_from_days: no Date, no time zone.
    static func ymd(dayNumber z0: Int) -> String {
        func floorDiv(_ a: Int, _ b: Int) -> Int { a >= 0 ? a / b : (a - b + 1) / b }
        let z = z0 + 719468
        let era = floorDiv(z, 146097)
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        let y = yoe + era * 400 + (m <= 2 ? 1 : 0)
        return String(format: "%04ld-%02ld-%02ld", y, m, d)
    }

    static func addingDays(_ days: Int, to ymd: String) -> String? {
        CalendarProjection.dayNumber(ymd).map { self.ymd(dayNumber: $0 + days) }
    }

    /// The Monday on or before a date (1970-01-01 was a Thursday).
    static func monday(onOrBefore date: String) -> String? {
        guard let n = CalendarProjection.dayNumber(date) else { return nil }
        let fromMonday = ((n + 3) % 7 + 7) % 7
        return ymd(dayNumber: n - fromMonday)
    }

    /// The Monday that starts week `index` of a block. For a repeating block
    /// already under way (given `today`), the week's run this week or next,
    /// not its run in the first cycle.
    static func weekStart(_ program: PlanProgram, index: Int, today: String? = nil) -> String? {
        var offset = index
        if program.repeats, !program.weeks.isEmpty, let today,
           let from = CalendarProjection.dayNumber(program.start),
           let to = CalendarProjection.dayNumber(today), to >= from {
            let elapsed = (to - from) / 7
            let count = program.weeks.count
            var cycle = elapsed / count
            if cycle * count + index < elapsed { cycle += 1 }
            offset = cycle * count + index
        }
        return addingDays(offset * 7, to: program.start)
    }

    static func position(of program: PlanProgram, today: String) -> Position {
        if let index = program.weekIndex(on: today) { return .current(index: index) }
        guard let from = CalendarProjection.dayNumber(program.start),
              let to = CalendarProjection.dayNumber(today) else { return .ended }
        return to < from ? .upcoming(startsIn: from - to) : .ended
    }

    /// The week the Plan tab opens on: this week, else the first.
    static func openingWeek(_ program: PlanProgram, today: String) -> Int {
        if case .current(let index) = position(of: program, today: today) { return index }
        return 0
    }

    // MARK: headings

    /// "Week 6 of 16 · Build", "Week 2 of 4 · repeats", "Starts Monday, Nov 16".
    static func heading(_ program: PlanProgram, week index: Int, today: String) -> String {
        var parts = ["Week \(index + 1) of \(program.weeks.count)"]
        if let label = program.weeks[safe: index]?.label { parts.append(label) }
        return parts.joined(separator: " · ")
    }

    /// One line under the heading.
    static func status(_ program: PlanProgram, today: String) -> String {
        switch position(of: program, today: today) {
        case .current(let index):
            let cycle = program.repeats ? " The weeks repeat." : ""
            return "This is week \(index + 1)." + cycle
        case .upcoming:
            return "Starts \(spokenDate(program.start))."
        case .ended:
            return BlockLayers.isLayered(program)
                ? "This block has ended. What you do every week carries on."
                : "This block has ended. Your week is back."
        }
    }

    // MARK: which schedule is in use

    /// Whether the block, not Your week, sets today's plan.
    static func isInUse(_ program: PlanProgram, today: String) -> Bool {
        if case .current = position(of: program, today: today) { return true }
        return false
    }

    /// The Monday after a one-off block's last week, when Your week takes
    /// over again; nil for a repeating block, which runs until it is ended.
    static func yourWeekReturns(_ program: PlanProgram) -> String? {
        program.repeats ? nil : addingDays(program.weeks.count * 7, to: program.start)
    }

    /// The one line on Your week's folded row while the block is in use.
    static func yourWeekWhileInUse(_ program: PlanProgram) -> String {
        if BlockLayers.isLayered(program) { return "Carries on beside the block every week" }
        if let back = yourWeekReturns(program) { return "Not in use until \(spokenDate(back)), after the block" }
        return "Not in use while the block repeats"
    }

    /// Your week's footer while a block is saved but not in use.
    static func yourWeekBesideBlock(_ program: PlanProgram, today: String) -> String {
        switch position(of: program, today: today) {
        case .upcoming:
            return "In use until the block starts on \(spokenDate(program.start)). Tap a day to swap it."
        case .ended, .current:
            return "In use again now that the block has ended. Tap a day to swap it."
        }
    }

    /// "Mon, Nov 16" for a `YYYY-MM-DD`.
    static func spokenDate(_ ymd: String) -> String {
        guard let date = CalendarProjection.date(from: ymd) else { return ymd }
        let f = DateFormatter()
        f.calendar = CalendarProjection.calendar
        f.timeZone = CalendarProjection.calendar.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "EEE, MMM d"
        return f.string(from: date)
    }

    /// The short chip for a week in the strip: its label's first word, else "W6".
    static func chip(_ program: PlanProgram, week index: Int) -> String {
        if let label = program.weeks[safe: index]?.label,
           let first = label.split(separator: " ").first {
            return String(first.prefix(6))
        }
        return "W\(index + 1)"
    }

    // MARK: edits

    /// Mondays a block can start on: this week's and the next few.
    static func startChoices(today: String, count: Int = 8) -> [String] {
        guard let first = monday(onOrBefore: today) else { return [] }
        return (0..<count).compactMap { addingDays($0 * 7, to: first) }
    }

    /// A new block of `weeks` copies of the repeating week (its main workouts
    /// and extras), as saved and still live.
    static func newProgram(from plan: PlanTree, start: String, weeks: Int, repeats: Bool,
                           name: String? = nil) -> PlanProgram {
        let live = Set(plan.libraryWorkouts.map(\.id))
        var week: [String: String?] = [:]
        for key in PlanSchedule.weekdayKeys {
            let id = plan.schedule?.templateID(forWeekdayKey: key) ?? ""
            week[key] = live.contains(id) ? .some(id) : .some(nil)
        }
        let extras = ScheduleExtras.current(plan)
        let count = min(max(weeks, 1), maxWeeks)
        let copy = PlanProgram.Week(label: nil, week: week, extras: extras.isEmpty ? nil : extras)
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return PlanProgram(id: "", name: trimmed.isEmpty ? nil : String(trimmed.prefix(PlanProgram.maxName)),
                           start: start, repeats: repeats, weeks: Array(repeating: copy, count: count))
    }

    /// The program with one weekday's main workout (nil = rest) set in week
    /// `index`, or in that week and every later one. An activity already on
    /// the day as an extra moves to the main slot rather than appear twice.
    static func setting(_ weekdayKey: String, to workoutID: String?, week index: Int,
                        scope: Scope, in program: PlanProgram) -> PlanProgram {
        let reach = scope == .thisWeek ? index...index : index...(program.weeks.count - 1)
        var weeks = program.weeks
        for i in reach where weeks.indices.contains(i) {
            let old = weeks[i]
            var week = old.week
            week[weekdayKey] = .some(workoutID)
            var extras = old.extras ?? [:]
            if let workoutID {
                extras[weekdayKey]?.removeAll { $0 == workoutID }
                if extras[weekdayKey]?.isEmpty == true { extras[weekdayKey] = nil }
            }
            weeks[i] = PlanProgram.Week(label: old.label, week: week,
                                        extras: extras.isEmpty ? nil : extras, targets: old.targets)
        }
        return replacing(weeks: weeks, in: program)
    }

    /// The program with week `index`'s label (blank clears it).
    static func relabeling(week index: Int, to label: String, in program: PlanProgram) -> PlanProgram {
        guard program.weeks.indices.contains(index) else { return program }
        var weeks = program.weeks
        let old = weeks[index]
        let trimmed = String(label.trimmingCharacters(in: .whitespacesAndNewlines).prefix(PlanProgram.maxLabel))
        weeks[index] = PlanProgram.Week(label: trimmed.isEmpty ? nil : trimmed, week: old.week,
                                        extras: old.extras, targets: old.targets)
        return replacing(weeks: weeks, in: program)
    }

    /// The program with week `index`'s days, extras and targets copied over
    /// the next week, which keeps its own label. Nil on the last week.
    static func copyingToNext(week index: Int, in program: PlanProgram) -> PlanProgram? {
        guard program.weeks.indices.contains(index), program.weeks.indices.contains(index + 1) else { return nil }
        var weeks = program.weeks
        let source = weeks[index]
        weeks[index + 1] = PlanProgram.Week(label: weeks[index + 1].label, week: source.week,
                                            extras: source.extras, targets: source.targets)
        return replacing(weeks: weeks, in: program)
    }

    /// The program with a week added after the last (a copy of it), or the
    /// last week removed. Nil past the limits.
    static func addingWeek(to program: PlanProgram) -> PlanProgram? {
        guard let last = program.weeks.last, program.weeks.count < maxWeeks else { return nil }
        return replacing(weeks: program.weeks + [PlanProgram.Week(label: nil, week: last.week,
                                                                   extras: last.extras, targets: last.targets)],
                         in: program)
    }

    static func removingLastWeek(from program: PlanProgram) -> PlanProgram? {
        guard program.weeks.count > 1 else { return nil }
        return replacing(weeks: Array(program.weeks.dropLast()), in: program)
    }

    private static func replacing(weeks: [PlanProgram.Week], in program: PlanProgram) -> PlanProgram {
        PlanProgram(id: program.id, name: program.name, start: program.start,
                    repeats: program.repeats, weeks: weeks, workoutIDs: program.workoutIDs)
    }

    // MARK: reading a week

    /// One weekday of a block week: its main workout and extras, live only.
    /// In a layered block, `everyWeek` holds the ids that come from Your week
    /// rather than the block (P7).
    struct DayRow: Equatable, Identifiable {
        let weekdayKey: String
        let workout: Workout?
        let extras: [Workout]
        var everyWeek: Set<String> = []
        var id: String { weekdayKey }
        /// Whether the day holds nothing from the block itself.
        var isEveryWeekOnly: Bool { workout.map { everyWeek.contains($0.id) } ?? false }
    }

    static func rows(_ program: PlanProgram, week index: Int, plan: PlanTree?) -> [DayRow] {
        guard let week = program.weeks[safe: index] else { return [] }
        let live = Dictionary((plan?.availableWorkouts ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let schedule = BlockLayers.repeatingWeek(plan)
        return PlanSchedule.weekdayKeys.map { key in
            let main = (week.week[key] ?? nil).flatMap { live[$0] }
            let extras = (week.extras?[key] ?? []).compactMap { live[$0] }
            let standing = BlockLayers.split(program, schedule: schedule, week: index, day: key).standing
            return DayRow(weekdayKey: key, workout: main, extras: extras, everyWeek: Set(standing))
        }
    }

    /// A day change on a block: the program to save and the one it is
    /// compared with to see whether anything changed. A layered block is
    /// changed in own form, so only what the block owns moves; the server
    /// lays Your week back over it.
    static func dayChange(_ weekdayKey: String, to workoutID: String?, week index: Int, scope: Scope,
                          in program: PlanProgram, plan: PlanTree?) -> (before: PlanProgram, after: PlanProgram) {
        let base = BlockLayers.isLayered(program)
            ? BlockLayers.ownForm(program, schedule: BlockLayers.repeatingWeek(plan)) : program
        return (base, setting(weekdayKey, to: workoutID, week: index, scope: scope, in: base))
    }

    /// Whether a week differs from Your week (its days, extras or targets).
    static func differsFromYourWeek(_ program: PlanProgram, week index: Int, plan: PlanTree) -> Bool {
        guard let week = program.weeks[safe: index] else { return false }
        let base = newProgram(from: plan, start: program.start, weeks: 1, repeats: false).weeks[0]
        return week.week != base.week || (week.extras ?? [:]) != (base.extras ?? [:])
            || !(week.targets ?? [:]).isEmpty
    }

    // MARK: wire

    /// Slot ids of the plan's live (unarchived) workouts.
    static func liveSlots(_ plan: PlanTree) -> Set<String> {
        Set(plan.availableWorkouts.flatMap { $0.exercises.map(\.id) })
    }

    /// Ids of live workouts a day can hold as extras.
    static func liveWorkouts(_ plan: PlanTree) -> Set<String> {
        Set(plan.libraryWorkouts.map(\.id))
    }

    /// The `program` body of `PUT /api/plan/program`: weekday maps with null
    /// rests, and targets as the server stores them (run steps as text).
    /// `liveSlots` (slot ids of live workouts) drops the targets of a slot
    /// deleted or archived since they were set, and `activities` drops an
    /// extra that was deleted or archived, as `ScheduleExtras.current` does.
    static func wire(_ program: PlanProgram, liveSlots: Set<String>? = nil,
                     activities: Set<String>? = nil) -> [String: Any] {
        var body: [String: Any] = [
            "start": program.start,
            "repeat": program.repeats,
            "weeks": program.weeks.map { wire(week: $0, liveSlots: liveSlots, activities: activities) },
        ]
        if let name = program.name { body["name"] = name }
        // A layered block sends its list; one that never had a list leaves it
        // out, so the server keeps whatever list the saved block has.
        if let ids = program.workoutIDs {
            body["workout_ids"] = ids.filter { activities?.contains($0) ?? true }
        }
        return body
    }

    /// The `schedule` beside a layered block's `PUT /api/plan/program`:
    /// the repeating week without the block's own workouts, or nil when it
    /// holds none of them (or the block lists none).
    static func wireSchedule(beside program: PlanProgram, plan: PlanTree?) -> [String: Any]? {
        guard let ids = program.workoutIDs,
              let trimmed = BlockLayers.trimmedSchedule(BlockLayers.repeatingWeek(plan), workoutIDs: ids)
        else { return nil }
        var days: [String: Any] = [:]
        for key in PlanSchedule.weekdayKeys {
            if let id = trimmed.week[key] ?? nil { days[key] = id } else { days[key] = NSNull() }
        }
        return ["week": days, "extras": trimmed.extras]
    }

    static func wire(week: PlanProgram.Week, liveSlots: Set<String>? = nil,
                     activities: Set<String>? = nil) -> [String: Any] {
        var days: [String: Any] = [:]
        for key in PlanSchedule.weekdayKeys {
            if let id = week.week[key] ?? nil { days[key] = id } else { days[key] = NSNull() }
        }
        var out: [String: Any] = ["week": days]
        if let label = week.label { out["label"] = label }
        let extras = (week.extras ?? [:]).compactMapValues { ids -> [String]? in
            let kept = ids.filter { activities?.contains($0) ?? true }
            return kept.isEmpty ? nil : kept
        }
        if !extras.isEmpty { out["extras"] = extras }
        let kept = (week.targets ?? [:]).filter { liveSlots?.contains($0.key) ?? true }
        if !kept.isEmpty {
            out["targets"] = kept.mapValues(wire(targets:))
        }
        return out
    }

    static func wire(targets t: SlotTargets) -> [String: Any] {
        var out: [String: Any] = [:]
        func put<T>(_ key: String, _ value: T??) {
            guard let value else { return }
            out[key] = value.map { $0 as Any } ?? NSNull()
        }
        if let sets = t.sets { out["target_sets"] = sets }
        if let reps = t.reps { out["target_reps"] = reps }
        put("target_reps_max", t.repsMax)
        put("target_rpe", t.rpe)
        put("target_weight", t.weight)
        if let unit = t.weightUnit { out["target_weight_unit"] = unit }
        put("target_duration_s", t.durationS)
        put("run_steps", t.runSteps)
        return out
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
