import Foundation

/// A read-only overview of today's independent workouts. A schedule entry is
/// replaced by its real session; two real sessions using the same workout
/// remain separate. Selection and starting still belong to SyncModel.
enum DailyWorkoutAgenda {
    enum Source: Equatable {
        case primary
        case additional
        case session
    }

    struct Item: Identifiable {
        let id: String
        let workout: Workout?
        let session: SessionRow?
        let source: Source
        let minutes: Int?
        let status: String

        var title: String {
            session?.isFreestyle == true ? "Freestyle"
                : workout?.name ?? (source == .primary && session == nil ? "Main workout" : "Workout")
        }
        var isActivity: Bool { workout.map(PlannedActivity.isActivity) == true && session?.isFreestyle != true }
        var isDone: Bool { status == "completed" || status == "logged" }
        var statusLabel: String {
            switch status {
            case "completed": return "Complete"
            case "logged": return "Logged"
            case "in_progress": return "In progress"
            case "skipped": return "Skipped"
            case "rest": return "Nothing planned"
            default: return "Planned"
            }
        }
    }

    static func items(primary: Workout?, extras: [Workout], sessions: [SessionRow],
                      workouts: [Workout], times: [String: Int], loggedActivityIDs: Set<String>,
                      activeScope: WorkoutSessionScope? = nil) -> [Item] {
        let liveSessions = sessions.filter { $0.status != "discarded" }
            .sorted { ($0.slot ?? 0, $0.id) < ($1.slot ?? 0, $1.id) }
        let primarySession = liveSessions.first { ($0.slot ?? 0) == 0 }
        let additionalSessions = liveSessions.filter { ($0.slot ?? 0) > 0 }
        var result: [Item] = []
        var representedWorkoutIDs: Set<String> = []
        var timedWorkoutIDs: Set<String> = []

        func append(_ workout: Workout?, session: SessionRow?, source: Source) {
            let workoutID = workout?.id ?? session?.workout_id
            let minutes = workoutID.flatMap { id -> Int? in
                guard timedWorkoutIDs.insert(id).inserted else { return nil }
                return times[id]
            }
            if let workoutID { representedWorkoutIDs.insert(workoutID) }
            let status: String
            if let session, ["completed", "skipped"].contains(session.status) {
                status = session.status
            } else if let scope = activeScope,
                      session?.workoutScope == scope || (source == .primary && session == nil && scope.slot == 0) {
                status = "in_progress"
            } else if let workout, PlannedActivity.isActivity(workout), loggedActivityIDs.contains(workout.id) {
                status = "logged"
            } else {
                status = session?.status ?? (workout == nil ? "rest" : "planned")
            }
            result.append(Item(id: session.map { "session:\($0.id)" }
                ?? (source == .primary ? "primary" : "scheduled:\(workoutID ?? "")"),
                workout: workout, session: session, source: source, minutes: minutes, status: status))
        }

        if primary != nil || primarySession != nil || !additionalSessions.isEmpty {
            append(primary, session: primarySession, source: .primary)
        }
        for session in additionalSessions {
            append(workouts.first { $0.id == session.workout_id }, session: session, source: .session)
        }
        for workout in extras where !representedWorkoutIDs.contains(workout.id) {
            append(workout, session: nil, source: .additional)
        }
        // Explicit times order the agenda. Untimed items retain their stable
        // plan/session order; completion never shuffles the day's schedule.
        return result.enumerated().sorted {
            ($0.element.minutes ?? Int.max, $0.offset) < ($1.element.minutes ?? Int.max, $1.offset)
        }.map(\.element)
    }

    static func showsCombinedAgenda(_ items: [Item]) -> Bool {
        items.count > 1 || items.contains { $0.source != .primary }
    }
}

@MainActor
extension SyncModel {
    var dailyWorkoutAgenda: [DailyWorkoutAgenda.Item] {
        let today = todayString
        let activeScope = running ? currentWorkoutScope : resumableCheckpoint?.workoutScope
        let primary = activeScope?.date == today && activeScope?.slot == 0
            ? startedRunnerWorkout(on: today) ?? previewWorkout(forDateString: today, today: today)
            : previewWorkout(forDateString: today, today: today)
        // Every row reads as it does today, with a block week's targets,
        // so Today's list and the runner agree (progressive-plans P1).
        let onToday: (Workout) -> Workout = { [plan] workout in plan?.workout(workout, on: today) ?? workout }
        let extras = plannedExtras(on: today, today: today).map(onToday)
        // Archiving removes future choices, not the identity of a real session.
        // plannedExtras already filters the recurring agenda to live workouts.
        let workouts = (plan?.workouts ?? []).map(onToday)
        let minutes = Dictionary(uniqueKeysWithValues: workouts.compactMap { workout -> (String, Int)? in
            ScheduleTimes.minutes(workout.id, onDate: today, plan: plan).map { (workout.id, $0) }
        })
        let loggedIDs = Set(([primary].compactMap { $0 } + extras).filter {
            PlannedActivity.isActivity($0) && PlannedActivity.isLogged($0.name,
                manual: manualActivities(on: today), synced: activities(on: today))
        }.map(\.id))
        return DailyWorkoutAgenda.items(primary: primary, extras: extras, sessions: sessions(on: today),
            workouts: workouts, times: minutes, loggedActivityIDs: loggedIDs,
            activeScope: activeScope?.date == today ? activeScope : nil)
    }
}
