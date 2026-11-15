import Combine
import Foundation
import UIKit
import UserNotifications
import WidgetKit

// The return loop (member-activation P1): a Today widget and opt-in local
// workout reminders. Both read one display snapshot built from the SAME
// calendar projection Today and the calendar use, so there is no second
// schedule algorithm and no server notification system. Account boundaries
// clear both, because the widget and pending notifications are process-shared.

extension SyncModel {
    /// Civil days covered by the widget timeline and the reminder horizon.
    static let trainingAgendaDayCount = 14

    /// Today and the following days as the projection resolves them now.
    /// nil until a plan has been read, so a cold launch never replaces a good
    /// snapshot with an empty "rest" week.
    func trainingAgendaSnapshot(dayCount: Int = SyncModel.trainingAgendaDayCount) -> TrainingAgendaSnapshot? {
        guard plan != nil, dayCount > 0 else { return nil }
        // Single clock for the whole scan, as in `upcomingDays`.
        let today = todayString
        guard let start = CalendarProjection.date(from: today) else { return nil }
        var days: [TrainingAgendaDay] = []
        for offset in 0..<dayCount {
            guard let date = CalendarProjection.calendar.date(byAdding: .day, value: offset, to: start) else { continue }
            days.append(trainingAgendaDay(for: CalendarProjection.dateString(date), today: today))
        }
        return TrainingAgendaSnapshot(days: days)
    }

    func trainingAgendaDay(for ymd: String, today: String) -> TrainingAgendaDay {
        let resolved = projection(for: ymd, today: today)
        // A started runner can name an explicit workout before its first set
        // creates a session, including one chosen on a rest day.
        if ymd == today, (currentWorkoutScope.slot > 0 || (resolved.kind != .completed && resolved.kind != .skipped)),
           let started = startedRunnerWorkout(on: today) {
            return agendaDay(ymd, .inProgress, started)
        }
        switch resolved {
        case .projected(let templateID):
            return agendaDay(ymd, .workout, workout(id: templateID))
        case .session(let status, _):
            let preview = previewWorkout(forDateString: ymd, today: today)
            let freestyle = sessionsByDate[ymd]?.isFreestyle == true
            switch status {
            case "completed":
                return agendaDay(ymd, .completed, preview, freestyle: freestyle)
            case "skipped":
                return agendaDay(ymd, .skipped, nil)
            case "in_progress":
                // A phantom in-progress row (every set deleted) is still the
                // planned workout, exactly as Today presents it.
                let started = loggedSetCount(forDate: ymd) > 0
                return agendaDay(ymd, started ? .inProgress : .workout, preview, freestyle: freestyle)
            default:
                return agendaDay(ymd, .workout, preview, freestyle: freestyle)
            }
        case .rest, .none:
            return agendaDay(ymd, .rest, nil)
        case .unavailable:
            return agendaDay(ymd, .unavailable, nil)
        case .light:
            return agendaDay(ymd, .light, nil)
        }
    }

    private func agendaDay(_ ymd: String, _ status: TrainingAgendaDay.Status, _ workout: Workout?,
                           freestyle: Bool = false) -> TrainingAgendaDay {
        var seen = Set<String>()
        let names = (workout?.exercises ?? [])
            .filter { !$0.isWarmup }
            .map(\.exercise_name)
            .filter { seen.insert($0).inserted }
        return TrainingAgendaDay(
            date: ymd, status: status,
            workoutName: workout.map { $0.id.hasPrefix("freestyle:") ? "Freestyle workout" : $0.name }
                ?? (freestyle ? "Freestyle workout" : nil),
            exerciseNames: names)
    }
}

// MARK: - Timed plan items

/// One thing a date holds that the member gave a time (app-design-pass P19):
/// the day's workout or an activity beside it.
struct TimedPlanItem: Equatable {
    let date: String
    let workoutID: String
    let name: String
    let minutes: Int
    /// The day's workout, as opposed to an activity beside it.
    let isMain: Bool
}

/// One thing a date holds that is still to do and has no set time: the
/// evening "Still to do" nudge lists these (app-design-pass P22).
struct UntimedPlanItem: Equatable {
    let date: String
    let workoutID: String
    let name: String
}

extension SyncModel {
    /// Items with a set time on today and the following days that are still
    /// to do: a workout not yet started, an activity not yet logged today.
    /// Rest, trip, skipped and finished days have none.
    func timedPlanItems(dayCount: Int = SyncModel.trainingAgendaDayCount) -> [TimedPlanItem] {
        guard let plan, plan.schedule?.times?.isEmpty == false else { return [] }
        return plannedItemsToDo(dayCount: dayCount).compactMap { item in
            ScheduleTimes.minutes(item.workout.id, onDate: item.date, plan: plan).map {
                TimedPlanItem(date: item.date, workoutID: item.workout.id, name: item.workout.name,
                              minutes: $0, isMain: item.isMain)
            }
        }
    }

    /// The same items still to do, without a set time: the day's workout and
    /// the activities beside it, in plan order.
    func untimedPlanItems(dayCount: Int = SyncModel.trainingAgendaDayCount) -> [UntimedPlanItem] {
        guard let plan else { return [] }
        return plannedItemsToDo(dayCount: dayCount).compactMap { item in
            ScheduleTimes.minutes(item.workout.id, onDate: item.date, plan: plan) == nil
                ? UntimedPlanItem(date: item.date, workoutID: item.workout.id, name: item.workout.name)
                : nil
        }
    }

    /// What today and the following days hold that is still to do, timed or
    /// not: a workout not yet started, an activity not yet logged today.
    private func plannedItemsToDo(dayCount: Int) -> [(date: String, workout: Workout, isMain: Bool)] {
        guard plan != nil, dayCount > 0 else { return [] }
        let today = todayString
        guard let start = CalendarProjection.date(from: today) else { return [] }
        var items: [(date: String, workout: Workout, isMain: Bool)] = []
        for offset in 0..<dayCount {
            guard let date = CalendarProjection.calendar.date(byAdding: .day, value: offset, to: start) else { continue }
            let ymd = CalendarProjection.dateString(date)
            let started = ymd == today ? startedRunnerWorkout(on: today) : nil
            if !(currentWorkoutScope.slot == 0 && started != nil),
               let planned = unstartedPlannedWorkout(on: ymd, today: today),
               !planned.id.hasPrefix("freestyle:"),
               !(ymd == today && PlannedActivity.isActivity(planned)
                   && PlannedActivity.isLogged(planned.name, manual: manualActivities(on: ymd),
                                               synced: activities(on: ymd))) {
                items.append((ymd, planned, true))
            }
            for extra in plannedExtras(on: ymd, today: today) {
                if started?.id == extra.id { continue }
                if sessions(on: ymd).contains(where: { $0.workout_id == extra.id && ["in_progress", "completed", "skipped"].contains($0.status) }) { continue }
                if ymd == today, PlannedActivity.isLogged(extra.name, manual: manualActivities(on: ymd),
                                                          synced: activities(on: ymd)) { continue }
                items.append((ymd, extra, false))
            }
        }
        return items
    }

    /// The workout a date still holds, read the way the agenda reads it: the
    /// weekly schedule, or a real session that hasn't started (a planned row,
    /// or an in-progress row with every set deleted). Finished and skipped
    /// days hold none.
    private func unstartedPlannedWorkout(on ymd: String, today: String) -> Workout? {
        switch projection(for: ymd, today: today) {
        case .projected(let templateID):
            return workout(id: templateID)
        case .session(let status, _):
            switch status {
            case "completed", "skipped":
                return nil
            case "in_progress":
                return loggedSetCount(forDate: ymd) > 0 ? nil : previewWorkout(forDateString: ymd, today: today)
            default:
                return previewWorkout(forDateString: ymd, today: today)
            }
        case .rest, .none, .unavailable, .light:
            return nil
        }
    }
}

// MARK: - Reminder settings and plan

/// Reminder preferences belong to one account: several people can share an
/// install, and one person's opt-in never schedules another's workouts.
enum WorkoutReminderSettings {
    /// 7:00 in the morning, local time.
    static let defaultMinutes = 7 * 60
    static let changed = Notification.Name("com.nmarkspdx.tresfort.workout-reminder-settings")

    static func enabledKey(userID: String) -> String {
        "com.nmarkspdx.tresfort.workout-reminders-enabled.v1.\(userID)"
    }

    static func minutesKey(userID: String) -> String {
        "com.nmarkspdx.tresfort.workout-reminder-minutes.v1.\(userID)"
    }

    static func isEnabled(_ defaults: UserDefaults = .standard, userID: String?) -> Bool {
        guard let userID else { return false }
        return defaults.bool(forKey: enabledKey(userID: userID))
    }

    static func minutesAfterMidnight(_ defaults: UserDefaults = .standard, userID: String?) -> Int {
        guard let userID, defaults.object(forKey: minutesKey(userID: userID)) != nil else { return defaultMinutes }
        return min(max(defaults.integer(forKey: minutesKey(userID: userID)), 0), 24 * 60 - 1)
    }

    // The evening "Still to do" nudge (app-design-pass P22). On unless the
    // member turns it off; it only ever reaches someone who has allowed
    // notifications, so it never asks for permission on its own.

    /// 6:00 in the evening, local time.
    static let defaultStillToDoMinutes = 18 * 60

    static func stillToDoEnabledKey(userID: String) -> String {
        "com.nmarkspdx.tresfort.still-to-do-enabled.v1.\(userID)"
    }

    static func stillToDoMinutesKey(userID: String) -> String {
        "com.nmarkspdx.tresfort.still-to-do-minutes.v1.\(userID)"
    }

    static func isStillToDoEnabled(_ defaults: UserDefaults = .standard, userID: String?) -> Bool {
        guard let userID else { return false }
        let key = stillToDoEnabledKey(userID: userID)
        return defaults.object(forKey: key) == nil ? true : defaults.bool(forKey: key)
    }

    static func stillToDoMinutes(_ defaults: UserDefaults = .standard, userID: String?) -> Int {
        guard let userID, defaults.object(forKey: stillToDoMinutesKey(userID: userID)) != nil
        else { return defaultStillToDoMinutes }
        return min(max(defaults.integer(forKey: stillToDoMinutesKey(userID: userID)), 0), 24 * 60 - 1)
    }
}

struct WorkoutReminder: Equatable {
    let id: String
    let date: String
    let fireComponents: DateComponents
    let title: String
    let body: String
}

enum WorkoutReminderPlan {
    static let idPrefix = "workout-reminder-"

    static func isReminderID(_ identifier: String) -> Bool { identifier.hasPrefix(idPrefix) }

    /// One reminder per day that still has a workout to start, at the chosen
    /// local time. Rest, skipped, trip, started and finished days stay quiet,
    /// and a time already past today is not scheduled.
    static func reminders(snapshot: TrainingAgendaSnapshot, now: Date, minutesAfterMidnight: Int,
                          calendar: Calendar) -> [WorkoutReminder] {
        snapshot.days.compactMap { day -> WorkoutReminder? in
            guard day.status == .workout,
                  let start = TrainingAgendaCalendar.date(from: day.date, calendar: calendar),
                  let fire = calendar.date(bySettingHour: minutesAfterMidnight / 60,
                                           minute: minutesAfterMidnight % 60, second: 0, of: start),
                  fire > now
            else { return nil }
            return WorkoutReminder(
                id: idPrefix + day.date,
                date: day.date,
                fireComponents: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire),
                title: "Today: \(day.workoutName ?? "Workout")",
                body: body(for: day))
        }
    }

    static func body(for day: TrainingAgendaDay) -> String {
        let names = day.exerciseNames
        guard !names.isEmpty else { return "Your workout is ready in Très Fort." }
        let shown = names.prefix(3).joined(separator: " · ")
        return names.count > 3 ? "\(shown) + \(names.count - 3) more" : shown
    }
}

/// A reminder at each time the member set (app-design-pass P19). These come
/// whenever notifications are allowed, without the daily reminder switch:
/// setting a time is the opt-in. A time already past is not scheduled.
enum TimedReminderPlan {
    static let idPrefix = "planned-time-"

    static func isReminderID(_ identifier: String) -> Bool { identifier.hasPrefix(idPrefix) }

    static func reminders(items: [TimedPlanItem], now: Date, calendar: Calendar,
                          locale: Locale = .current) -> [WorkoutReminder] {
        items.compactMap { item -> WorkoutReminder? in
            guard let start = TrainingAgendaCalendar.date(from: item.date, calendar: calendar),
                  let fire = calendar.date(bySettingHour: item.minutes / 60, minute: item.minutes % 60,
                                           second: 0, of: start),
                  fire > now
            else { return nil }
            return WorkoutReminder(
                id: idPrefix + item.date + "-" + item.workoutID,
                date: item.date,
                fireComponents: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire),
                title: "Time for \(item.name)",
                body: "Planned for \(ScheduleTimes.display(item.minutes, locale: locale)) in Très Fort.")
        }
    }

    /// Dates whose workout has its own time, so the daily reminder can stay
    /// quiet there instead of notifying twice.
    static func timedWorkoutDates(_ items: [TimedPlanItem]) -> Set<String> {
        Set(items.filter(\.isMain).map(\.date))
    }
}

/// One evening nudge per day for what it holds that is still to do and has
/// no set time, such as core beside a lift (app-design-pass P22). A day with
/// nothing left stays quiet, and a time already past is not scheduled. Items
/// with their own time remind then instead.
enum StillToDoReminderPlan {
    static let idPrefix = "still-to-do-"

    static func isReminderID(_ identifier: String) -> Bool { identifier.hasPrefix(idPrefix) }

    static func reminders(items: [UntimedPlanItem], now: Date, minutesAfterMidnight: Int,
                          calendar: Calendar) -> [WorkoutReminder] {
        var dates: [String] = []
        var names: [String: [String]] = [:]
        for item in items {
            if names[item.date] == nil { dates.append(item.date) }
            if names[item.date, default: []].contains(item.name) == false {
                names[item.date, default: []].append(item.name)
            }
        }
        return dates.compactMap { date -> WorkoutReminder? in
            guard let start = TrainingAgendaCalendar.date(from: date, calendar: calendar),
                  let fire = calendar.date(bySettingHour: minutesAfterMidnight / 60,
                                           minute: minutesAfterMidnight % 60, second: 0, of: start),
                  fire > now
            else { return nil }
            return WorkoutReminder(
                id: idPrefix + date,
                date: date,
                fireComponents: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire),
                title: "Still to do today",
                body: body(names[date] ?? []))
        }
    }

    /// "Core", "Soccer · Core", or the first three and how many more.
    static func body(_ names: [String]) -> String {
        let shown = names.prefix(3).joined(separator: " · ")
        return names.count > 3 ? "\(shown) + \(names.count - 3) more" : shown
    }
}

// MARK: - Notification center

@MainActor
protocol WorkoutReminderCenter: AnyObject {
    func authorizationStatus() async -> UNAuthorizationStatus
    func requestAuthorization() async -> Bool
    func add(_ request: UNNotificationRequest) async throws
    func pendingIdentifiers() async -> [String]
    func deliveredIdentifiers() async -> [String]
    func removePending(_ identifiers: [String])
    func removeDelivered(_ identifiers: [String])
}

@MainActor
final class SystemWorkoutReminderCenter: WorkoutReminderCenter {
    private let center = UNUserNotificationCenter.current()

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
    }

    func add(_ request: UNNotificationRequest) async throws { try await center.add(request) }

    func pendingIdentifiers() async -> [String] {
        await center.pendingNotificationRequests().map(\.identifier)
    }

    func deliveredIdentifiers() async -> [String] {
        await center.deliveredNotifications().map { $0.request.identifier }
    }

    func removePending(_ identifiers: [String]) {
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
    }

    func removeDelivered(_ identifiers: [String]) {
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
}

/// Owns the reminder identifiers. Applications run one after another, and a
/// superseded one stops at its next await, so a stale agenda can never leave
/// its reminders behind a newer replacement or a sign-out.
@MainActor
final class WorkoutReminderCoordinator {
    static let shared = WorkoutReminderCoordinator(center: SystemWorkoutReminderCenter())

    private let center: any WorkoutReminderCenter
    private var generation = 0
    private var task: Task<Void, Never>?

    init(center: any WorkoutReminderCenter) { self.center = center }

    /// Replace every pending reminder with `reminders`. A delivered reminder
    /// stays in Notification Center only while its date is in `keepDelivered`,
    /// and a kept date is never scheduled again, so moving the reminder time
    /// later the same day cannot notify twice. A delivered timed reminder
    /// stays too, so it is never scheduled again, unless `keepDeliveredTimed`
    /// is false (an account leaving takes every one with it).
    func apply(_ reminders: [WorkoutReminder], keepDelivered: Set<String> = [],
               keepDeliveredTimed: Bool = true) {
        generation &+= 1
        let token = generation
        let previous = task
        task = Task { @MainActor [weak self] in
            await previous?.value
            guard let self, token == self.generation else { return }
            let pending = await self.center.pendingIdentifiers()
            let delivered = await self.center.deliveredIdentifiers()
            guard token == self.generation else { return }
            self.center.removePending(pending.filter {
                WorkoutReminderPlan.isReminderID($0) || WorkoutReminderCoordinator.isOneShotID($0)
            })
            let deliveredDates = delivered.filter(WorkoutReminderPlan.isReminderID)
                .map { String($0.dropFirst(WorkoutReminderPlan.idPrefix.count)) }
            self.center.removeDelivered(deliveredDates.filter { !keepDelivered.contains($0) }
                .map { WorkoutReminderPlan.idPrefix + $0 })
            let kept = Set(deliveredDates).intersection(keepDelivered)
            // A timed or still-to-do reminder already shown stays in
            // Notification Center and is never scheduled again.
            var deliveredTimed = Set(delivered.filter(WorkoutReminderCoordinator.isOneShotID))
            if !keepDeliveredTimed {
                self.center.removeDelivered(Array(deliveredTimed))
                deliveredTimed = []
            }
            let toAdd = reminders.filter { reminder in
                WorkoutReminderCoordinator.isOneShotID(reminder.id)
                    ? !deliveredTimed.contains(reminder.id)
                    : !kept.contains(reminder.date)
            }
            guard !toAdd.isEmpty else { return }
            let status = await self.center.authorizationStatus()
            guard token == self.generation, [.authorized, .provisional, .ephemeral].contains(status) else { return }
            for reminder in toAdd {
                guard token == self.generation else { return }
                try? await self.center.add(WorkoutReminderCoordinator.request(for: reminder))
            }
        }
    }

    /// A reminder for one moment (a set time, or the evening nudge), as
    /// opposed to the daily one: once shown, it is never scheduled again.
    nonisolated static func isOneShotID(_ identifier: String) -> Bool {
        TimedReminderPlan.isReminderID(identifier) || StillToDoReminderPlan.isReminderID(identifier)
    }

    /// Removes every pending and delivered workout reminder, timed ones
    /// included: the account boundary, where nothing may stay behind.
    func clear() { apply([], keepDeliveredTimed: false) }

    func requestAuthorization() async -> Bool {
        switch await center.authorizationStatus() {
        case .authorized, .provisional, .ephemeral: return true
        case .notDetermined: return await center.requestAuthorization()
        default: return false
        }
    }

    func authorizationStatus() async -> UNAuthorizationStatus { await center.authorizationStatus() }

    func waitForTests() async { await task?.value }

    static func request(for reminder: WorkoutReminder) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = reminder.body
        content.sound = .default
        content.userInfo = ["date": reminder.date]
        let trigger = UNCalendarNotificationTrigger(dateMatching: reminder.fireComponents, repeats: false)
        return UNNotificationRequest(identifier: reminder.id, content: content, trigger: trigger)
    }
}

// MARK: - Publisher

/// Writes the widget snapshot and reschedules reminders after each published
/// plan/session change, a reminder-setting change, and a new civil day. One is
/// owned by each signed-in tab shell; the feature-session boundary retires it
/// and clears what it published.
@MainActor
final class TrainingAgendaPublisher {
    private struct ReminderInput: Equatable {
        let snapshot: TrainingAgendaSnapshot
        let enabled: Bool
        let minutes: Int
        let timed: [TimedPlanItem]
        let stillToDoEnabled: Bool
        let stillToDoMinutes: Int
        let untimed: [UntimedPlanItem]
    }

    private weak var sync: SyncModel?
    private let sharedDefaults: UserDefaults?
    private let settings: UserDefaults
    /// The account this publisher serves; a new account gets a new publisher.
    private let userID: String?
    private let reminders: WorkoutReminderCoordinator
    private let reloadWidgets: () -> Void
    private let now: () -> Date
    private var cancellables: Set<AnyCancellable> = []
    private var lastReminderInput: ReminderInput?
    private(set) var isRetired = false

    init(sync: SyncModel, auth: AuthModel,
         sharedDefaults: UserDefaults? = TrainingAgendaStore.sharedDefaults,
         settings: UserDefaults = .standard,
         reminders: WorkoutReminderCoordinator = .shared,
         reloadWidgets: @escaping () -> Void = {
             WidgetCenter.shared.reloadTimelines(ofKind: TrainingAgendaStore.widgetKind)
         },
         now: @escaping () -> Date = Date.init,
         notificationCenter: NotificationCenter = .default) {
        self.sync = sync
        self.sharedDefaults = sharedDefaults
        self.settings = settings
        self.userID = auth.userID
        self.reminders = reminders
        self.reloadWidgets = reloadWidgets
        self.now = now
        // objectWillChange fires before the mutation lands; read on the next
        // main-actor turn. Throttle so a running rest timer cannot rebuild the
        // snapshot every tick.
        sync.objectWillChange
            .throttle(for: .seconds(1), scheduler: RunLoop.main, latest: true)
            .sink { [weak self] _ in Task { @MainActor in self?.refresh() } }
            .store(in: &cancellables)
        // Permission can change without changing the saved times or either
        // reminder toggle. Reapply those unchanged items after permission is
        // granted instead of letting the input cache suppress the refresh.
        notificationCenter.publisher(for: WorkoutReminderSettings.changed)
            .sink { [weak self] _ in Task { @MainActor in self?.refresh(reapplyReminders: true) } }
            .store(in: &cancellables)
        notificationCenter.publisher(for: .NSCalendarDayChanged)
            .sink { [weak self] _ in Task { @MainActor in self?.refresh() } }
            .store(in: &cancellables)
        // The widget timeline holds absolute midnights computed in the zone it
        // was built in, so a new zone needs a rebuilt timeline even when the
        // snapshot is unchanged.
        notificationCenter.publisher(for: .NSSystemTimeZoneDidChange)
            .sink { [weak self] _ in Task { @MainActor in self?.refresh(forceWidgetReload: true) } }
            .store(in: &cancellables)
        // Notification permission can change in Settings while the agenda does
        // not, and the zone can change while the app is not running. Reapply
        // reminders and rebuild the timeline on each return.
        notificationCenter.publisher(for: UIApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in
                Task { @MainActor in self?.refresh(reapplyReminders: true, forceWidgetReload: true) }
            }
            .store(in: &cancellables)
        auth.observeFeatureSessionBoundary { [weak self] in
            self?.retire()
            return false
        }
        Task { @MainActor [weak self] in self?.refresh() }
    }

    func refresh(reapplyReminders: Bool = false, forceWidgetReload: Bool = false) {
        guard !isRetired, let sync, sync.canPublishTrainingAgenda,
              let snapshot = sync.trainingAgendaSnapshot()
        else { return }
        let changed = TrainingAgendaStore.save(snapshot, to: sharedDefaults)
        if changed || forceWidgetReload { reloadWidgets() }
        let input = ReminderInput(
            snapshot: snapshot,
            enabled: WorkoutReminderSettings.isEnabled(settings, userID: userID),
            minutes: WorkoutReminderSettings.minutesAfterMidnight(settings, userID: userID),
            timed: sync.timedPlanItems(),
            stillToDoEnabled: WorkoutReminderSettings.isStillToDoEnabled(settings, userID: userID),
            stillToDoMinutes: WorkoutReminderSettings.stillToDoMinutes(settings, userID: userID),
            untimed: sync.untimedPlanItems())
        guard reapplyReminders || input != lastReminderInput else { return }
        lastReminderInput = input
        let calendar = TrainingAgendaCalendar.calendar()
        // Times the member set remind on their own; the daily reminder stays
        // quiet on a day whose workout already has one.
        let timed = TimedReminderPlan.reminders(items: input.timed, now: now(), calendar: calendar)
        let timedDates = TimedReminderPlan.timedWorkoutDates(input.timed)
        let daily = input.enabled
            ? WorkoutReminderPlan.reminders(snapshot: snapshot, now: now(),
                                            minutesAfterMidnight: input.minutes, calendar: calendar)
                .filter { !timedDates.contains($0.date) }
            : []
        // In the evening, whatever is left without its own time.
        let stillToDo = input.stillToDoEnabled
            ? StillToDoReminderPlan.reminders(items: input.untimed, now: now(),
                                              minutesAfterMidnight: input.stillToDoMinutes, calendar: calendar)
            : []
        guard !daily.isEmpty || !timed.isEmpty || !stillToDo.isEmpty else {
            // Nothing to schedule, but a timed reminder already shown stays
            // put; only the account boundary clears those.
            reminders.apply([])
            return
        }
        // Today's delivered reminder stays visible until the workout starts.
        let keep = input.enabled ? snapshot.days.first.flatMap { $0.status == .workout ? $0.date : nil } : nil
        reminders.apply(daily + timed + stillToDo, keepDelivered: Set([keep].compactMap { $0 }))
    }

    /// The account is leaving: nothing it published may stay on the Home
    /// Screen, Lock Screen or in pending notifications.
    func retire() {
        guard !isRetired else { return }
        isRetired = true
        cancellables = []
        lastReminderInput = nil
        Self.clearPublished(sharedDefaults: sharedDefaults, reminders: reminders, reloadWidgets: reloadWidgets)
    }

    /// Clears what any earlier process published. A launch that is not signed
    /// in never mounts a publisher, so it cannot retire one.
    static func clearPublished(
        sharedDefaults: UserDefaults? = TrainingAgendaStore.sharedDefaults,
        reminders: WorkoutReminderCoordinator = .shared,
        reloadWidgets: () -> Void = {
            WidgetCenter.shared.reloadTimelines(ofKind: TrainingAgendaStore.widgetKind)
        }
    ) {
        if TrainingAgendaStore.save(nil, to: sharedDefaults) { reloadWidgets() }
        reminders.clear()
    }
}
