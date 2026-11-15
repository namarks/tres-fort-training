import SwiftUI

/// Schedule membership belongs to the plan, not to a workout's identity.
enum WorkoutLibraryPolicy {
    static func choices(plan: PlanTree?, date: String) -> [Workout] {
        let workouts = plan?.libraryWorkouts ?? []
        guard plan?.trips.contains(where: { date >= $0.start && date <= $0.end }) == true else { return workouts }
        // Stable partition: travel labels affect ordering, never eligibility.
        return workouts.filter { $0.workoutTags.contains("travel") }
            + workouts.filter { !$0.workoutTags.contains("travel") }
    }

    /// On any weekday, as the day's workout or as an activity beside it.
    static func isScheduled(workoutID: String, plan: PlanTree?) -> Bool {
        PlanSchedule.weekdayKeys.contains { plan?.schedule?.templateID(forWeekdayKey: $0) == workoutID }
            || ScheduleExtras.current(plan).values.contains { $0.contains(workoutID) }
    }

    static func scheduleBadge(workoutID: String, plan: PlanTree?) -> String {
        let days = PlanSchedule.weekdayKeys.filter {
            plan?.schedule?.templateID(forWeekdayKey: $0) == workoutID
        }
        return days.isEmpty ? "On demand" : days.map { $0.capitalized }.joined(separator: " · ")
    }

    struct WeekRow: Equatable {
        let weekdayKey: String
        /// nil is a rest day.
        let workoutID: String?
        let workoutName: String?
    }

    /// The repeating week as the Plan tab shows it, Monday first. A weekday
    /// whose workout is missing or archived reads as rest, as the calendar
    /// projection treats it.
    static func weekRows(plan: PlanTree?) -> [WeekRow] {
        let available = Dictionary(uniqueKeysWithValues: (plan?.availableWorkouts ?? []).map { ($0.id, $0.name) })
        return PlanSchedule.weekdayKeys.map { key in
            let id = plan?.schedule?.templateID(forWeekdayKey: key).flatMap { id -> String? in available[id] == nil ? nil : id }
            return WeekRow(weekdayKey: key, workoutID: id, workoutName: id.flatMap { available[$0] })
        }
    }

    static func hasScheduledDay(plan: PlanTree?) -> Bool {
        weekRows(plan: plan).contains { $0.workoutName != nil }
    }

    /// The saved week with one weekday changed, for a change made from a
    /// single day. Weekdays pointing at a missing or archived workout already
    /// read as rest, so they are sent as rest instead of being rejected.
    static func week(_ plan: PlanTree, setting weekdayKey: String, to workoutID: String?) -> [String: String] {
        let live = Set(plan.availableWorkouts.map(\.id))
        return Dictionary(uniqueKeysWithValues: PlanSchedule.weekdayKeys.map { key in
            if key == weekdayKey { return (key, workoutID ?? "") }
            let id = plan.schedule?.templateID(forWeekdayKey: key) ?? ""
            return (key, live.contains(id) ? id : "")
        })
    }

    /// Use the persisted mapping. An unsaved picker draft must not accidentally
    /// schedule other workouts when the member chooses Unschedule on one card.
    static func unscheduling(workoutID: String, plan: PlanTree) -> [String: String] {
        Dictionary(uniqueKeysWithValues: PlanSchedule.weekdayKeys.map { key in
            let id = plan.schedule?.templateID(forWeekdayKey: key) ?? ""
            return (key, id == workoutID ? "" : id)
        })
    }

    static let weekdayNames = ["mon": "Monday", "tue": "Tuesday", "wed": "Wednesday",
                               "thu": "Thursday", "fri": "Friday", "sat": "Saturday", "sun": "Sunday"]
}

/// A saved workout with no exercises is an activity: something you do, like a
/// soccer match or a yoga class, rather than sets to log. It sits on the week
/// like any workout, and on the day Today offers to log it.
enum PlannedActivity {
    static func isActivity(_ workout: Workout) -> Bool { workout.exercises.isEmpty }

    /// Ideas offered when making one. Any name works. Rides and swims have
    /// their own tiles, with a distance or time (app-design-pass P24).
    static let suggestions = ["Soccer", "Basketball", "Tennis", "Pickleball", "Climbing", "Yoga", "Pilates", "Hike", "Walk", "Stretching", "Core"]

    /// Sports an activity's name can end in after its amount or a word
    /// of its own: "60 min ride", "1000 yd swim", "Evening walk".
    static let trailingSports: Set<String> = ["run", "ride", "swim", "walk", "hike"]

    /// The sport an activity's name stands for: a sport's own name
    /// ("Soccer", "Table tennis"), or a name ending in a ride, swim, run,
    /// walk or hike ("60 min ride").
    static func sport(named name: String) -> Sport? {
        if let sport = Sports.matching(name: name) { return sport }
        let words = name.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        guard words.count > 1, let last = words.last, trailingSports.contains(last) else { return nil }
        return Sports.sport(id: last)
    }

    /// The log sheet's type for an activity's name: a type the sheet knows
    /// ("Yoga", "Hike") or Other, with the name as its title.
    static func kind(for name: String) -> String {
        let key = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let kind = PendingActivity.kinds.first(where: {
            $0 == key || PendingActivity.label(for: $0).lowercased() == key
        }) { return kind }
        if let sportID = Self.sport(named: name)?.id, PendingActivity.kinds.contains(sportID) { return sportID }
        return "other"
    }

    /// Logged when an activity or synced workout on that date carries its
    /// name, or, for a name that is a sport ("Soccer"), is that sport: a
    /// watch calls the match "Evening Soccer" or nothing at all.
    static func isLogged(_ name: String, manual: [ActivityRow], synced: [ExternalActivity]) -> Bool {
        let key = normalized(name)
        guard !key.isEmpty else { return false }
        let sportID = Self.sport(named: name)?.id
        return manual.contains { normalized($0.title ?? "") == key || (sportID != nil && $0.type == sportID) }
            || synced.contains {
                // A synced workout without a named sport still carries its
                // coarse kind: a ride is a ride.
                normalized($0.name ?? "") == key || (sportID != nil && ($0.sport ?? $0.kind) == sportID)
            }
    }

    /// An existing workout already called this, so a second isn't made.
    static func existing(named name: String, in plan: PlanTree?) -> Workout? {
        let key = normalized(name)
        guard !key.isEmpty else { return nil }
        return plan?.libraryWorkouts.first { normalized($0.name) == key }
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

/// A run planned on a weekday: a saved workout holding one outdoor run, made
/// from the weekday sheet and planned step by step right after, so a member
/// sets up intervals or an easy run without the coach.
enum PlannedRunCreation {
    /// Ideas offered when making one. Any name works.
    static let suggestions = ["Easy run", "Intervals", "Tempo run", "Long run"]
    static let defaultName = "Run"

    enum Match: Equatable {
        /// No workout has the name, so a new run is made.
        case available
        /// A run with this name exists; it goes on the weekday instead of a copy.
        case run(Workout)
        /// A workout that isn't a run has the name; pick another.
        case taken(Workout)
    }

    static func name(_ typed: String) -> String {
        let clean = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? defaultName : clean
    }

    static func match(named name: String, in plan: PlanTree?) -> Match {
        guard let workout = PlannedActivity.existing(named: name, in: plan) else { return .available }
        return isRun(workout) ? .run(workout) : .taken(workout)
    }

    /// Only runs: one or more outdoor run slots and nothing else.
    static func isRun(_ workout: Workout) -> Bool {
        !workout.exercises.isEmpty && workout.exercises.allSatisfy(\.isOutdoorRun)
    }

    /// The slot whose steps the editor opens on.
    static func runSlot(in workout: Workout?) -> TemplateExercise? {
        workout?.exercises.first(where: \.isOutdoorRun)
    }
}

/// What a saved workout is and what's in it, so a list of names tells one
/// from another (docs/plans/app-design-pass P13): an icon for the kind, a
/// line of contents and the weekdays that already use it.
enum PlanItemSummary {
    enum Kind: Equatable { case lift, run, activity }

    static func kind(of workout: Workout) -> Kind {
        if PlannedActivity.isActivity(workout) { return .activity }
        if PlannedRunCreation.isRun(workout) { return .run }
        return .lift
    }

    /// SF Symbol: the sport's own figure for an activity named after one.
    static func glyph(for workout: Workout) -> String {
        switch kind(of: workout) {
        case .run: return "figure.run"
        case .lift: return "dumbbell"
        case .activity: return PlannedActivity.sport(named: workout.name)?.glyph ?? "sportscourt"
        }
    }

    /// "Swing, goblet squat, press +3", "6 × 400 m", or what an activity is.
    static func detail(for workout: Workout, unit: RunDistanceUnit) -> String {
        switch kind(of: workout) {
        case .activity:
            return "Activity · log it when it's done"
        case .run:
            guard let slot = PlannedRunCreation.runSlot(in: workout) else { return "Run" }
            if let plan = slot.runPlan { return RunPlanFormat.summary(plan, unit: unit) }
            if slot.run_steps == nil, let seconds = slot.target_duration_s, seconds > 0 {
                return RunPlanFormat.duration(seconds)
            }
            return "Run at your own pace"
        case .lift:
            return contents(workout.exercises.map(\.exercise_name))
        }
    }

    /// The first three names and how many more: "Squat, bench, row +2".
    static func contents(_ names: [String], shown: Int = 3) -> String {
        let clean = names.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard !clean.isEmpty else { return "No exercises yet" }
        let head = clean.prefix(shown).joined(separator: ", ")
        return clean.count > shown ? "\(head) +\(clean.count - shown)" : head
    }

    /// The kind in a word, for VoiceOver, which can't see the icon.
    static func kindName(_ workout: Workout) -> String {
        switch kind(of: workout) {
        case .run: return "Run"
        case .lift: return "Workout"
        case .activity: return "Activity"
        }
    }

    /// "Intervals, Run, 6 × 400 m, on Tuesday".
    static func spoken(_ workout: Workout, plan: PlanTree?, unit: RunDistanceUnit, showsWeekdays: Bool = true) -> String {
        var parts = [workout.name, kindName(workout)]
        if kind(of: workout) != .activity { parts.append(Self.detail(for: workout, unit: unit)) }
        let days = showsWeekdays ? weekdays(using: workout.id, plan: plan) : []
        if !days.isEmpty {
            parts.append("on " + days.map { WorkoutLibraryPolicy.weekdayNames[$0] ?? $0 }.joined(separator: ", "))
        }
        return parts.joined(separator: ", ")
    }

    /// Weekday keys whose repeating day is this workout, Monday first.
    /// Weekdays that hold it, as the day's workout or beside it.
    static func weekdays(using workoutID: String, plan: PlanTree?) -> [String] {
        let extras = ScheduleExtras.current(plan)
        return PlanSchedule.weekdayKeys.filter {
            plan?.schedule?.templateID(forWeekdayKey: $0) == workoutID
                || extras[$0]?.contains(workoutID) == true
        }
    }
}

/// A saved workout's kind as an icon on a quiet tile: runs, lifts and
/// activities are told apart by shape, not by color (docs/DESIGN-SYSTEM.md).
struct PlanItemBadge: View {
    let glyph: String
    var size: CGFloat = 30

    var body: some View {
        Image(systemName: glyph)
            .font(.system(size: size * 0.52, weight: .semibold))
            .foregroundStyle(Theme.accent)
            .frame(width: size, height: size)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A saved workout as a list shows it: name, the weekdays that use it and
/// what's in it.
struct PlanItemLabel: View {
    let workout: Workout
    let plan: PlanTree?
    var showsWeekdays = true
    private let unit = RunDistanceUnit.preferred()

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            PlanItemBadge(glyph: PlanItemSummary.glyph(for: workout))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(workout.name).font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                        .lineLimit(1)
                    if showsWeekdays {
                        ForEach(PlanItemSummary.weekdays(using: workout.id, plan: plan), id: \.self) { key in
                            Text(key.uppercased())
                                .font(Theme.mono(10, .bold)).foregroundStyle(Theme.muted)
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 5))
                        }
                    }
                }
                Text(PlanItemSummary.detail(for: workout, unit: unit))
                    .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .lineLimit(2)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(PlanItemSummary.spoken(workout, plan: plan, unit: unit, showsWeekdays: showsWeekdays))
    }
}

/// The repeating week at the top of the Plan tab: what each weekday holds,
/// with its kind and contents, so the plan reads without opening anything.
/// Tapping any day, rest days too, opens that day to change it.
struct PlanWeekSummary: View {
    @ObservedObject var sync: SyncModel
    var onChangeDay: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(WorkoutLibraryPolicy.weekRows(plan: sync.plan), id: \.weekdayKey) { row in
                Button { onChangeDay(row.weekdayKey) } label: { line(row) }
                    .buttonStyle(.plain)
                    .disabled(sync.isRoutineMutationInFlight)
                    .accessibilityLabel(spokenLine(row))
                    .accessibilityHint("Change this day")
                    .accessibilityIdentifier("plan.week.\(row.weekdayKey)")
            }
        }
        .padding(.vertical, 6)
    }

    private func spokenLine(_ row: WorkoutLibraryPolicy.WeekRow) -> String {
        let day = WorkoutLibraryPolicy.weekdayNames[row.weekdayKey] ?? row.weekdayKey
        let extras = ScheduleExtras.workouts(on: row.weekdayKey, plan: sync.plan).map { timed($0, row) }
        let also = extras.isEmpty ? "" : ". Also \(ScheduleExtras.spokenList(extras))"
        guard let workout = sync.workout(id: row.workoutID) else { return "\(day): Rest" + also }
        let at = timeText(workout.id, row).map { ", at \($0)" } ?? ""
        return "\(day): " + PlanItemSummary.spoken(workout, plan: sync.plan,
                                                     unit: RunDistanceUnit.preferred(), showsWeekdays: false) + at + also
    }

    private func line(_ row: WorkoutLibraryPolicy.WeekRow) -> some View {
        let extras = ScheduleExtras.workouts(on: row.weekdayKey, plan: sync.plan)
        return VStack(alignment: .leading, spacing: 4) {
            mainLine(row)
            // Activities beside the day's workout, one short line under it.
            if !extras.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                        .font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.dim)
                    Text(extras.map { timed($0, row) }.joined(separator: " · "))
                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                .padding(.leading, 48)
                .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }

    /// The time set for an item on this row's weekday, as it reads locally.
    private func timeText(_ workoutID: String, _ row: WorkoutLibraryPolicy.WeekRow) -> String? {
        ScheduleTimes.minutes(workoutID, on: row.weekdayKey, plan: sync.plan).map { ScheduleTimes.display($0) }
    }

    /// "Core before bed 9:00 PM", or just the name without a time.
    private func timed(_ workout: Workout, _ row: WorkoutLibraryPolicy.WeekRow) -> String {
        timeText(workout.id, row).map { "\(workout.name) \($0)" } ?? workout.name
    }

    private func mainLine(_ row: WorkoutLibraryPolicy.WeekRow) -> some View {
        let workout = sync.workout(id: row.workoutID)
        return HStack(alignment: .center, spacing: 12) {
            Text(row.weekdayKey.uppercased())
                .font(Theme.mono(11, .bold)).foregroundStyle(Theme.muted)
                .frame(width: 36, alignment: .leading)
            if let workout {
                PlanItemLabel(workout: workout, plan: sync.plan, showsWeekdays: false)
                Spacer(minLength: 0)
                if let time = timeText(workout.id, row) {
                    Text(time).font(Theme.mono(12, .bold)).foregroundStyle(Theme.muted)
                        .accessibilityHidden(true)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                    .accessibilityHidden(true)
            } else {
                Image(systemName: "moon.zzz")
                    .font(.system(size: 15)).foregroundStyle(Theme.dim)
                    .frame(width: 30)
                    .accessibilityHidden(true)
                Text("Rest").font(Theme.mono(15, .medium)).foregroundStyle(Theme.muted)
                Spacer(minLength: 0)
                Label("Add", systemImage: "plus")
                    .font(Theme.mono(14, .bold)).foregroundStyle(Theme.accent)
                    .accessibilityHidden(true)
            }
        }
    }
}

/// Archived workouts get their own screen instead of a toggle that swaps the
/// whole library. Restoring one puts it back in the library; deleting asks first.
struct ArchivedWorkoutsView: View {
    @ObservedObject var sync: SyncModel
    @State private var detailTarget: IdentifiedString?
    @State private var deletingDay: Workout?

    private var archived: [Workout] { sync.plan?.workouts.filter(\.isArchived) ?? [] }

    var body: some View {
        List {
            Section {
                if archived.isEmpty {
                    Text("No archived workouts.")
                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        .accessibilityIdentifier("archived.empty")
                }
                ForEach(archived) { day in
                    HStack(spacing: 0) {
                        Button { detailTarget = IdentifiedString(id: day.id) } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(day.name)
                                        .font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                                    if !day.workoutTags.isEmpty {
                                        Text(day.workoutTags.joined(separator: " · "))
                                            .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                                    }
                                    Text(day.exercises.isEmpty
                                         ? "No exercises"
                                         : "\(day.exercises.count) exercise\(day.exercises.count == 1 ? "" : "s")")
                                        .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                                    .accessibilityHidden(true)
                            }
                            .padding(.leading, 16).padding(.trailing, 8).padding(.vertical, 14)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("library.workout.\(day.id)")
                        .accessibilityHint("Opens workout details")
                        .disabled(sync.isRoutineMutationInFlight)
                        Menu {
                            Button("Restore workout", systemImage: "arrow.uturn.backward") { restore(day) }
                            Button("Delete workout", role: .destructive) { deletingDay = day }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .font(.system(size: 18)).foregroundStyle(Theme.muted)
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .padding(.trailing, 4)
                        .disabled(sync.isRoutineMutationInFlight)
                        .accessibilityLabel("Actions for \(day.name)")
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Theme.surface)
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button { restore(day) } label: {
                            Label("Restore", systemImage: "arrow.uturn.backward")
                        }
                        .tint(Theme.accent)
                        .disabled(sync.isRoutineMutationInFlight)
                    }
                }
            } footer: {
                Text("Restore a workout to use it again. Completed workouts and logged sets stay in your history either way.")
            }
            if let error = sync.loadError {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Archived workouts")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $detailTarget) { target in
            WorkoutDetailsView(sync: sync, workoutID: target.id, date: nil, onStart: nil, isPushed: true)
        }
        .alert(
            "Delete \(deletingDay?.name ?? "this workout")?",
            isPresented: Binding(get: { deletingDay != nil }, set: { if !$0 { deletingDay = nil } })
        ) {
            Button("Delete workout", role: .destructive) {
                guard let day = deletingDay, !sync.isRoutineMutationInFlight else { return }
                deletingDay = nil
                Task { await sync.deleteWorkoutDay(dayID: day.id) }
            }
            .disabled(sync.isRoutineMutationInFlight)
            Button("Cancel", role: .cancel) { deletingDay = nil }
        } message: {
            Text("Past sessions and logged sets stay in your history.")
        }
    }

    private func restore(_ day: Workout) {
        guard !sync.isRoutineMutationInFlight else { return }
        Task { await sync.setWorkoutArchived(dayID: day.id, archived: false) }
    }
}

struct WorkoutDateSheet: View {
    @ObservedObject var sync: SyncModel
    let workout: Workout
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var saving = false

    init(sync: SyncModel, workout: Workout) {
        self.sync = sync
        self.workout = workout
        _date = State(initialValue: CalendarProjection.date(from: sync.todayString) ?? Date())
    }

    private var dateString: String { CalendarProjection.dateString(date) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Date", selection: $date,
                               in: (CalendarProjection.date(from: sync.todayString) ?? Date())...,
                               displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .accessibilityIdentifier("workoutAssignmentDate")
                } footer: {
                    Text("Use \(workout.name) on this date. Your weekly schedule stays the same.")
                }
                Section {
                    if let reason = sync.calendarAssignmentUnavailableReason(date: dateString) {
                        Text(reason).foregroundStyle(Theme.muted)
                    } else if let current = sync.previewWorkout(forDateString: dateString) {
                        Text("Replaces \(current.name) for this date only.")
                            .foregroundStyle(Theme.muted)
                    }
                    Button(saving ? "Saving…" : "Use \(workout.name)") {
                        saving = true
                        Task {
                            let accepted = await sync.setCalendarOverride(date: dateString, dayID: workout.id)
                            saving = false
                            if accepted { dismiss() }
                        }
                    }
                    .disabled(saving || sync.isRoutineMutationInFlight
                        || sync.workout(id: workout.id)?.isArchived != false
                        || sync.calendarAssignmentUnavailableReason(date: dateString) != nil)
                    .accessibilityIdentifier("assignLibraryWorkout")
                    if let error = sync.loadError {
                        Text(error).foregroundStyle(Theme.danger)
                    }
                }
            }
            .navigationTitle("Use on a date")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .environment(\.calendar, CalendarProjection.calendar)
        .environment(\.timeZone, CalendarProjection.calendar.timeZone)
    }
}

/// A failed transport keeps its original request for a receipt-safe retry.
struct MoveWorkoutDateSheet: View {
    @ObservedObject var sync: SyncModel
    let workout: Workout
    let fromDate: String
    @Environment(\.dismiss) private var dismiss
    @State private var date: Date
    @State private var request: APIClient.CalendarMoveRequest?
    @State private var saving = false

    init(sync: SyncModel, workout: Workout, fromDate: String) {
        self.sync = sync; self.workout = workout; self.fromDate = fromDate
        _date = State(initialValue: CalendarProjection.date(from: fromDate) ?? Date())
    }

    private var dateString: String { CalendarProjection.dateString(date) }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Move \(workout.name) from \(fromDate).")
                    DatePicker("New date", selection: $date,
                               in: (CalendarProjection.date(from: sync.todayString) ?? Date())...,
                               displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .disabled(saving || request != nil)
                        .accessibilityIdentifier("calendar.moveDate")
                } footer: {
                    Text("The original date becomes rest. Your saved workout and weekly schedule stay the same.")
                }
                Section {
                    if request == nil, let reason = sync.calendarMoveUnavailableReason(from: fromDate, to: dateString, workoutID: workout.id) {
                        Text(reason).foregroundStyle(Theme.muted)
                    }
                    Button(saving ? "Moving…" : request == nil ? "Move workout" : "Retry move") {
                        if request == nil { request = sync.calendarMoveRequest(from: fromDate, to: dateString, workoutID: workout.id) }
                        guard let request else { return }
                        saving = true
                        Task {
                            let outcome = await sync.moveCalendarWorkout(request)
                            saving = false
                            switch outcome {
                            case .acknowledged: dismiss()
                            case .needsReview: self.request = nil
                            case .retrySameRequest: break
                            }
                        }
                    }
                    .disabled(saving || sync.isRoutineMutationInFlight || (request == nil
                        && sync.calendarMoveUnavailableReason(from: fromDate, to: dateString, workoutID: workout.id) != nil))
                    .accessibilityIdentifier("calendar.confirmMove")
                    if let error = sync.loadError {
                        Text(error).foregroundStyle(Theme.danger)
                        Button("Refresh calendar") { Task { await sync.load() } }
                            .disabled(saving || sync.isRoutineMutationInFlight)
                    }
                }
            }
            .navigationTitle("Move workout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(saving) } }
        }
        .environment(\.calendar, CalendarProjection.calendar)
        .environment(\.timeZone, CalendarProjection.calendar.timeZone)
        .interactiveDismissDisabled(saving)
    }
}
