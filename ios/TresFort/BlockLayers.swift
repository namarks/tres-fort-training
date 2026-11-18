import Foundation

/// A training block beside the repeating week (docs/plans/progressive-plans
/// P7, after web-app P2). A block that lists its own workouts
/// (`PlanProgram.workoutIDs`) is "layered": what the member does every week
/// carries on during the block, and the block adds its own workouts to the
/// same dates. The server stores each block week as the whole day (the
/// block's own entries first, then the repeating week's), so the calendar
/// projection and `PlanTree.schedule(on:)` read it unchanged.
///
/// The phone edits a layered block in "own form": each day holds only what
/// the block owns, and the server lays the repeating week back over it on
/// every save (`layerProgram`). Mirror of `src/programLayers.ts` and
/// `web/src/blockLayers.ts`; `test/fixtures/block-layers.json` pins both.
/// Pure: no network, no SyncModel.
enum BlockLayers {
    /// Most workouts one day holds: its main one and the ones beside it.
    static let maxDayWorkouts = 1 + ScheduleExtras.maxPerDay

    /// A workout with the weekdays it is on.
    struct Placed: Identifiable, Equatable {
        let workout: Workout
        let days: [String]
        var id: String { workout.id }
    }

    static let emptyWeek = PlanProgram.Week(
        label: nil, week: Dictionary(uniqueKeysWithValues: PlanSchedule.weekdayKeys.map { ($0, String?.none) }),
        extras: nil)

    // MARK: days

    static func isLayered(_ program: PlanProgram?) -> Bool { program?.workoutIDs != nil }

    /// What a weekday holds in a week: its main workout, then the rest.
    static func entries(_ week: PlanProgram.Week, _ day: String) -> [String] {
        let main = week.week[day] ?? nil
        return (main.map { [$0] } ?? []) + (week.extras?[day] ?? [])
    }

    /// A week with one day's entries replaced: the first is the main workout.
    static func withDay(_ week: PlanProgram.Week, _ day: String, _ ids: [String]) -> PlanProgram.Week {
        var days = week.week
        days[day] = .some(ids.first)
        var extras = week.extras ?? [:]
        let rest = Array(ids.dropFirst().prefix(ScheduleExtras.maxPerDay))
        extras[day] = rest.isEmpty ? nil : rest
        return PlanProgram.Week(label: week.label, week: days, extras: extras.isEmpty ? nil : extras,
                                targets: week.targets)
    }

    /// The saved repeating week as a block week, exactly as stored (the
    /// server compares against what is stored, live or not).
    static func repeatingWeek(_ plan: PlanTree?) -> PlanProgram.Week {
        guard let schedule = plan?.schedule else { return emptyWeek }
        var week: [String: String?] = [:]
        var extras: [String: [String]] = [:]
        for day in PlanSchedule.weekdayKeys {
            let main = schedule.templateID(forWeekdayKey: day).flatMap { $0.isEmpty ? nil : $0 }
            week[day] = .some(main)
            let rest = schedule.extraIDs(forWeekdayKey: day).filter { !$0.isEmpty && $0 != main }
            if !rest.isEmpty { extras[day] = rest }
        }
        return PlanProgram.Week(label: nil, week: week, extras: extras.isEmpty ? nil : extras)
    }

    // MARK: own form and whole days

    /// Whether an entry stored on a block day is the block's own: a listed
    /// workout, or anything the repeating week doesn't hold that weekday
    /// (put there by a client that didn't know the list; never dropped).
    private static func own(_ id: String, blockIDs: Set<String>, repeating: [String]) -> Bool {
        blockIDs.contains(id) || !repeating.contains(id)
    }

    /// One stored day of a block, split into what the block owns and what
    /// comes from the repeating week. An unlayered block owns its whole days.
    static func split(_ program: PlanProgram, schedule: PlanProgram.Week, week index: Int,
                      day: String) -> (own: [String], standing: [String]) {
        guard program.weeks.indices.contains(index) else { return ([], []) }
        let stored = entries(program.weeks[index], day)
        guard let ids = program.workoutIDs else { return (stored, []) }
        let blockIDs = Set(ids), repeating = entries(schedule, day)
        return (stored.filter { own($0, blockIDs: blockIDs, repeating: repeating) },
                stored.filter { !own($0, blockIDs: blockIDs, repeating: repeating) })
    }

    /// What the repeating week adds to a layered block's day: all it holds
    /// that weekday except the block's own workouts.
    static func standing(_ program: PlanProgram, schedule: PlanProgram.Week, day: String) -> [String] {
        let blockIDs = Set(program.workoutIDs ?? [])
        return entries(schedule, day).filter { !blockIDs.contains($0) }
    }

    /// The saved block as only what it owns. Unlayered blocks come back as is.
    static func ownForm(_ program: PlanProgram, schedule: PlanProgram.Week) -> PlanProgram {
        guard let ids = program.workoutIDs else { return program }
        let blockIDs = Set(ids)
        let weeks = program.weeks.map { week in
            PlanSchedule.weekdayKeys.reduce(week) { next, day in
                let repeating = entries(schedule, day)
                return withDay(next, day, entries(week, day).filter { own($0, blockIDs: blockIDs, repeating: repeating) })
            }
        }
        return replacing(weeks, in: program)
    }

    /// Mirror of `layerProgram`: every week rewritten for the repeating week
    /// `after`, given the one its days were written against (`before`).
    ///
    ///   main   = the block's own main workout, else the repeating week's
    ///   extras = the block's own extras, then the repeating week's main
    ///            (when the block has its own) and extras, without repeats,
    ///            at most `ScheduleExtras.maxPerDay` (the repeating week's cut)
    static func layer(_ program: PlanProgram, before: PlanProgram.Week, after: PlanProgram.Week) -> PlanProgram {
        guard let ids = program.workoutIDs else { return program }
        let blockIDs = Set(ids)
        let weeks = program.weeks.map { stored -> PlanProgram.Week in
            var days: [String: String?] = [:]
            var extras: [String: [String]] = [:]
            for day in PlanSchedule.weekdayKeys {
                let repeating = entries(before, day)
                let isOwn = { (id: String) in own(id, blockIDs: blockIDs, repeating: repeating) }
                let storedMain = stored.week[day] ?? nil
                let ownMain = storedMain.flatMap { isOwn($0) ? $0 : nil }
                let afterMain = after.week[day] ?? nil
                let standingMain = afterMain.flatMap { blockIDs.contains($0) ? nil : $0 }
                let main = ownMain ?? standingMain
                days[day] = .some(main)
                var rest: [String] = []
                var candidates: [String] = (stored.extras?[day] ?? []).filter(isOwn)
                if ownMain != nil, let standingMain { candidates.append(standingMain) }
                candidates += (after.extras?[day] ?? []).filter { !blockIDs.contains($0) }
                for id in candidates where id != main && !rest.contains(id) && rest.count < ScheduleExtras.maxPerDay {
                    rest.append(id)
                }
                if !rest.isEmpty { extras[day] = rest }
            }
            return PlanProgram.Week(label: stored.label, week: days, extras: extras.isEmpty ? nil : extras,
                                    targets: stored.targets)
        }
        return replacing(weeks, in: program)
    }

    /// A block in own form shown as whole days: the repeating week laid over it.
    static func wholeDays(_ program: PlanProgram, schedule: PlanProgram.Week) -> PlanProgram {
        layer(program, before: emptyWeek, after: schedule)
    }

    // MARK: the block's workouts (own form)

    /// Ids the block places anywhere, in the order they first appear.
    static func placed(_ program: PlanProgram) -> [String] {
        var ids: [String] = []
        for week in program.weeks {
            for day in PlanSchedule.weekdayKeys {
                for id in entries(week, day) where !ids.contains(id) { ids.append(id) }
            }
        }
        return ids
    }

    /// The block's own workouts: listed ones first, in list order, then
    /// anything else its weeks hold. Live library workouts only.
    static func workouts(_ program: PlanProgram, plan: PlanTree?) -> [Workout] {
        let live = Dictionary((plan?.libraryWorkouts ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let anywhere = placed(program)
        let listed = (program.workoutIDs ?? []).filter(anywhere.contains)
        return (listed + anywhere.filter { !listed.contains($0) }).compactMap { live[$0] }
    }

    /// The weekdays a workout is on in one week.
    static func days(_ program: PlanProgram, week index: Int, workoutID: String) -> [String] {
        guard program.weeks.indices.contains(index) else { return [] }
        return PlanSchedule.weekdayKeys.filter { entries(program.weeks[index], $0).contains(workoutID) }
    }

    /// The weekdays a workout is on across the block, and whether weeks differ.
    static func days(_ program: PlanProgram, workoutID: String) -> (days: [String], varies: Bool) {
        let perWeek = program.weeks.indices.map { days(program, week: $0, workoutID: workoutID) }
        let shapes = Set(perWeek.map { $0.joined(separator: ",") })
        return (PlanSchedule.weekdayKeys.filter { day in perWeek.contains { $0.contains(day) } }, shapes.count > 1)
    }

    /// "Tue", "Mon, Thu", "Every day", "No day".
    static func daysLabel(_ days: [String]) -> String {
        if days.isEmpty { return "No day" }
        if days.count == 7 { return "Every day" }
        return days.map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: ", ")
    }

    /// Whether a day in some week has no room for one more workout.
    static func dayFull(_ program: PlanProgram, day: String, workoutID: String) -> Bool {
        program.weeks.contains { week in
            let ids = entries(week, day)
            return !ids.contains(workoutID) && ids.count >= maxDayWorkouts
        }
    }

    /// The weekdays among `days` where some week has no room for the workout.
    static func fullDays(_ program: PlanProgram, workoutID: String, days: [String]) -> [String] {
        PlanSchedule.weekdayKeys.filter { days.contains($0) && dayFull(program, day: $0, workoutID: workoutID) }
    }

    /// A workout on exactly these weekdays in every week; the rest of each
    /// day stays, and a day's first workout is its main one.
    static func placing(_ program: PlanProgram, workoutID: String, on days: [String]) -> PlanProgram {
        let weeks = program.weeks.map { week in
            PlanSchedule.weekdayKeys.reduce(week) { next, day in
                let ids = entries(next, day)
                let has = ids.contains(workoutID)
                if days.contains(day) == has { return next }
                return withDay(next, day, has ? ids.filter { $0 != workoutID } : ids + [workoutID])
            }
        }
        return replacing(weeks, in: program)
    }

    /// One more workout in the block's list, on these weekdays in every week.
    static func adding(_ program: PlanProgram, workoutID: String, on days: [String]) -> PlanProgram {
        var listed = program
        if let ids = program.workoutIDs, !ids.contains(workoutID) {
            listed = with(ids: ids + [workoutID], program)
        }
        return placing(listed, workoutID: workoutID, on: days)
    }

    /// A workout taken out of the block: off every week and the list, with
    /// the targets the weeks gave its exercises.
    static func removing(_ program: PlanProgram, workout: Workout) -> PlanProgram {
        let slots = Set(workout.exercises.map(\.id))
        let cleared = placing(program, workoutID: workout.id, on: [])
        let weeks = cleared.weeks.map { week -> PlanProgram.Week in
            let kept = (week.targets ?? [:]).filter { !slots.contains($0.key) }
            return PlanProgram.Week(label: week.label, week: week.week, extras: week.extras,
                                    targets: kept.isEmpty ? nil : kept)
        }
        let next = replacing(weeks, in: cleared)
        return program.workoutIDs.map { ids in with(ids: ids.filter { $0 != workout.id }, next) } ?? next
    }

    /// The weekdays the repeating week holds a workout on: where one added
    /// to the block from Your week goes.
    static func everyWeekDays(_ schedule: PlanProgram.Week, workoutID: String) -> [String] {
        PlanSchedule.weekdayKeys.filter { entries(schedule, $0).contains(workoutID) }
    }

    // MARK: the repeating week beside it

    /// The repeating week without the block's own workouts, for the same
    /// `PUT /api/plan/program`; nil when it holds none of them. Times are
    /// left out: the server keeps each saved one a weekday still holds.
    static func trimmedSchedule(_ schedule: PlanProgram.Week, workoutIDs: [String]?)
        -> (week: [String: String?], extras: [String: [String]])?
    {
        let blockIDs = Set(workoutIDs ?? [])
        guard PlanSchedule.weekdayKeys.contains(where: { entries(schedule, $0).contains(where: blockIDs.contains) })
        else { return nil }
        var week: [String: String?] = [:]
        var extras: [String: [String]] = [:]
        for day in PlanSchedule.weekdayKeys {
            let main = schedule.week[day] ?? nil
            week[day] = .some(main.flatMap { blockIDs.contains($0) ? nil : $0 })
            let kept = (schedule.extras?[day] ?? []).filter { !blockIDs.contains($0) }
            if !kept.isEmpty { extras[day] = kept }
        }
        return (week, extras)
    }

    /// What the member does every week beside the block: each live workout
    /// the repeating week holds that the block doesn't own, with its days.
    static func beside(_ program: PlanProgram, plan: PlanTree?) -> [Placed] {
        let schedule = repeatingWeek(plan)
        let live = Dictionary((plan?.libraryWorkouts ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var order: [String] = []
        var byID: [String: [String]] = [:]
        for day in PlanSchedule.weekdayKeys {
            for id in standing(program, schedule: schedule, day: day) {
                if byID[id] == nil { order.append(id) }
                byID[id, default: []].append(day)
            }
        }
        return order.compactMap { id in live[id].map { Placed(workout: $0, days: byID[id] ?? []) } }
    }

    // MARK: starting and sorting

    /// Workouts switched on by default when a block starts: each weekday's
    /// main workout that has exercises. Activities, and anything that sits
    /// beside another workout on some day, stay every week unless picked.
    static func suggested(_ plan: PlanTree?) -> [String] {
        let schedule = repeatingWeek(plan)
        let live = Dictionary((plan?.libraryWorkouts ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let besideIDs = Set(PlanSchedule.weekdayKeys.flatMap { schedule.extras?[$0] ?? [] })
        var ids: [String] = []
        for day in PlanSchedule.weekdayKeys {
            guard let main = schedule.week[day] ?? nil, !ids.contains(main), !besideIDs.contains(main),
                  !(live[main]?.exercises.isEmpty ?? true) else { continue }
            ids.append(main)
        }
        return ids
    }

    /// The live workouts Your week holds, in weekday order, with their days:
    /// what a new block can take as its own.
    static func repeatingWorkouts(_ plan: PlanTree?) -> [Placed] {
        let schedule = repeatingWeek(plan)
        let live = Dictionary((plan?.libraryWorkouts ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var order: [String] = []
        var byID: [String: [String]] = [:]
        for day in PlanSchedule.weekdayKeys {
            for id in entries(schedule, day) where live[id] != nil {
                if byID[id] == nil { order.append(id) }
                byID[id, default: []].append(day)
            }
        }
        return order.compactMap { id in live[id].map { Placed(workout: $0, days: byID[id] ?? []) } }
    }

    /// A new layered block of `weeks` equal weeks holding only its own
    /// workouts: the picked ones on the weekdays the repeating week has them.
    static func newBlock(from plan: PlanTree, start: String, weeks: Int, repeats: Bool,
                         name: String? = nil, picked: [String]) -> PlanProgram {
        let schedule = repeatingWeek(plan)
        let live = Set(plan.libraryWorkouts.map(\.id))
        let picks = picked.filter(live.contains)
        let week = PlanSchedule.weekdayKeys.reduce(emptyWeek) { next, day in
            withDay(next, day, entries(schedule, day).filter(picks.contains))
        }
        let count = min(max(weeks, 1), PlanProgram.maxWeeks)
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let ids = picks.filter { id in PlanSchedule.weekdayKeys.contains { entries(week, $0).contains(id) } }
        return PlanProgram(id: "", name: trimmed.isEmpty ? nil : String(trimmed.prefix(PlanProgram.maxName)),
                           start: start, repeats: repeats, weeks: Array(repeating: week, count: count),
                           workoutIDs: ids)
    }

    /// For a block that doesn't list its workouts yet: the ones it clearly
    /// trains (a week gives them targets, or puts them where the repeating
    /// week doesn't), else the suggestion a new block gets.
    static func suggestedSorting(_ program: PlanProgram, plan: PlanTree?) -> [String] {
        let schedule = repeatingWeek(plan)
        let targeted = Set(program.weeks.flatMap { ($0.targets ?? [:]).keys })
        var ids: [String] = []
        for workout in workouts(program, plan: plan) {
            let hasTargets = workout.exercises.contains { targeted.contains($0.id) }
            let placedApart = program.weeks.contains { week in
                PlanSchedule.weekdayKeys.contains { day in
                    entries(week, day).contains(workout.id) && !entries(schedule, day).contains(workout.id)
                }
            }
            if hasTargets || placedApart { ids.append(workout.id) }
        }
        let anywhere = placed(program)
        return ids.isEmpty ? suggested(plan).filter(anywhere.contains) : ids
    }

    /// A block that lists `picked` as its own, from one that listed none:
    /// each week keeps only those workouts, where it had them. One left out
    /// follows the repeating week from then on and loses the targets the
    /// weeks gave it, as when it is removed from a block.
    static func sorting(_ program: PlanProgram, picked: [String], plan: PlanTree?) -> PlanProgram {
        let left = Set((plan?.workouts ?? []).filter { !picked.contains($0.id) }.flatMap { $0.exercises.map(\.id) })
        let weeks = program.weeks.map { week -> PlanProgram.Week in
            let next = PlanSchedule.weekdayKeys.reduce(week) { kept, day in
                withDay(kept, day, entries(week, day).filter(picked.contains))
            }
            let targets = (next.targets ?? [:]).filter { !left.contains($0.key) }
            return PlanProgram.Week(label: next.label, week: next.week, extras: next.extras,
                                    targets: targets.isEmpty ? nil : targets)
        }
        return with(ids: picked, replacing(weeks, in: program))
    }

    // MARK: helpers

    private static func replacing(_ weeks: [PlanProgram.Week], in program: PlanProgram) -> PlanProgram {
        PlanProgram(id: program.id, name: program.name, start: program.start, repeats: program.repeats,
                    weeks: weeks, workoutIDs: program.workoutIDs)
    }

    private static func with(ids: [String], _ program: PlanProgram) -> PlanProgram {
        PlanProgram(id: program.id, name: program.name, start: program.start, repeats: program.repeats,
                    weeks: program.weeks, workoutIDs: ids)
    }
}
