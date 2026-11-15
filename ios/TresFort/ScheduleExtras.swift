import Foundation

/// A weekday can hold workouts and activities beside its main workout.
/// They live in `meta.schedule.extras`; workouts with exercises start their
/// own session. These are the pure rules the Plan screens share.
enum ScheduleExtras {
    /// The server's per-day limit (`MAX_SCHEDULE_EXTRAS`).
    static let maxPerDay = 4

    /// Saved extras that are still live workouts, in their saved order.
    static func current(_ plan: PlanTree?) -> [String: [String]] {
        guard let plan, let schedule = plan.schedule else { return [:] }
        let live = Set(plan.availableWorkouts.map(\.id))
        var out: [String: [String]] = [:]
        for key in PlanSchedule.weekdayKeys {
            let ids = schedule.extraIDs(forWeekdayKey: key).filter(live.contains)
            if !ids.isEmpty { out[key] = ids }
        }
        return out
    }

    /// The live workouts saved as extras on one weekday.
    static func workouts(on weekdayKey: String, plan: PlanTree?) -> [Workout] {
        guard let plan else { return [] }
        return (current(plan)[weekdayKey] ?? []).compactMap { id in
            plan.availableWorkouts.first { $0.id == id }
        }
    }

    /// Puts a workout on the chosen days without replacing what is there:
    /// a rest day gets it as the day's workout, a day with a workout keeps
    /// that and gets the workout alongside. Returns the whole week and every
    /// weekday's extras, ready for one schedule write.
    static func adding(_ workoutID: String, to weekdayKeys: Set<String>, plan: PlanTree)
        -> (week: [String: String], extras: [String: [String]])
    {
        let base = PlanComposer.week(plan, setting: [], to: workoutID)
        var week = base
        var extras = current(plan)
        for key in PlanSchedule.weekdayKeys where weekdayKeys.contains(key) {
            let main = base[key] ?? ""
            if main.isEmpty {
                week[key] = workoutID
                extras[key]?.removeAll { $0 == workoutID }
            } else if main != workoutID {
                var list = extras[key] ?? []
                if !list.contains(workoutID) { list.append(workoutID) }
                extras[key] = list
            }
            if extras[key]?.isEmpty == true { extras[key] = nil }
        }
        return (week, extras)
    }

    /// Every weekday's extras with one taken off one day.
    static func removing(_ workoutID: String, from weekdayKey: String, plan: PlanTree) -> [String: [String]] {
        var extras = current(plan)
        extras[weekdayKey]?.removeAll { $0 == workoutID }
        if extras[weekdayKey]?.isEmpty == true { extras[weekdayKey] = nil }
        return extras
    }

    /// Every weekday's extras with one workout taken off all of them.
    static func removingEverywhere(_ workoutID: String, plan: PlanTree) -> [String: [String]] {
        current(plan).compactMapValues { ids in
            let kept = ids.filter { $0 != workoutID }
            return kept.isEmpty ? nil : kept
        }
    }

    /// Live workout ids the calendar may show as extras.
    static func workoutIDs(_ plan: PlanTree) -> Set<String> {
        Set(plan.availableWorkouts.map(\.id))
    }

    /// Days among the chosen ones that would go past the limit.
    static func fullDays(adding workoutID: String, to weekdayKeys: Set<String>, plan: PlanTree) -> [String] {
        let extras = adding(workoutID, to: weekdayKeys, plan: plan).extras
        return PlanSchedule.weekdayKeys.filter { (extras[$0]?.count ?? 0) > maxPerDay }
    }

    /// "Morning stretching", "Stretching and Core", "Yoga, Walk and Core".
    static func spokenList(_ names: [String]) -> String {
        switch names.count {
        case 0: return ""
        case 1: return names[0]
        default: return names.dropLast().joined(separator: ", ") + " and " + names[names.count - 1]
        }
    }

    /// What the composer's footer says when an activity goes alongside:
    /// "Goes alongside Kettlebell A on Monday."
    static func alongsideNote(_ weekdayKeys: Set<String>, with workoutID: String?, plan: PlanTree?) -> String? {
        let kept = WorkoutLibraryPolicy.weekRows(plan: plan).filter {
            weekdayKeys.contains($0.weekdayKey) && $0.workoutID != nil && $0.workoutID != workoutID
        }
        guard !kept.isEmpty else { return nil }
        let parts = kept.map { "\($0.workoutName ?? "a workout") on \(WorkoutLibraryPolicy.weekdayNames[$0.weekdayKey] ?? $0.weekdayKey)" }
        return "Goes alongside " + parts.joined(separator: ", ") + "."
    }
}
