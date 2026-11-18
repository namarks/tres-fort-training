import SwiftUI

/// One weekday of the repeating week, opened by tapping it on the Plan tab.
/// What the day holds comes first: its workout, one tap from its details,
/// and the activities beside it, such as morning stretching, with the way to
/// add another (docs/plans/app-design-pass P14, P18). Below, make something
/// new for that day (a run, ride, swim, lift, routine at home or activity,
/// P24) in the composer, or pick rest or a saved workout, each shown with
/// what it is and what's in it (P13). The arrows, a sideways swipe or the week's letters move to
/// another day; the content slides with the finger and the phone ticks on
/// each move (P20). Only this weekday changes; dates already assigned stay
/// as they are. A New tile opens the composer in place, not on a page of
/// its own: the title, arrows, Done and week strip stay put, and the tiles
/// fold into one line with Change (P28).
struct WeekdayPlanSheet: View {
    @ObservedObject var sync: SyncModel
    /// Closes the sheet and opens a workout on the Plan tab's own stack.
    var onOpenWorkout: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var swipe = DaySwipeState()
    @State private var weekdayKey: String
    @State private var saving = false
    @State private var composing: PlanComposer.Kind?
    /// The composer in place has a save out: Done and Change wait for it.
    @State private var composerSaving = false
    /// The New tiles' order, the member's most frequent first, fixed while
    /// the sheet is open.
    @State private var order: [PlanComposer.Kind]
    /// The item whose time of day is being set.
    @State private var timing: Workout?

    init(sync: SyncModel, weekdayKey: String, onOpenWorkout: @escaping (String) -> Void) {
        _sync = ObservedObject(wrappedValue: sync)
        self.onOpenWorkout = onOpenWorkout
        _weekdayKey = State(initialValue: weekdayKey)
        _order = State(initialValue: PlanComposer.ranked(for: sync))
    }

    private var dayName: String { WorkoutLibraryPolicy.weekdayNames[weekdayKey] ?? weekdayKey }
    private var current: WorkoutLibraryPolicy.WeekRow? {
        WorkoutLibraryPolicy.weekRows(plan: sync.plan).first { $0.weekdayKey == weekdayKey }
    }
    private var currentWorkout: Workout? {
        guard let id = current?.workoutID else { return nil }
        return sync.plan?.availableWorkouts.first { $0.id == id }
    }
    private var busy: Bool { saving || sync.isRoutineMutationInFlight || sync.plan == nil }
    private var extras: [Workout] { ScheduleExtras.workouts(on: weekdayKey, plan: sync.plan) }

    /// Saved workouts grouped by kind, runs first, keeping library order.
    private var saved: [Workout] {
        let all = sync.plan?.libraryWorkouts ?? []
        return [PlanItemSummary.Kind.run, .lift, .activity].flatMap { kind in
            all.filter { PlanItemSummary.kind(of: $0) == kind }
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let composing {
                    PlanComposerView(sync: sync, kind: composing, days: [weekdayKey],
                                     day: .init(header: "New for every \(dayName)",
                                                onChangeKind: { changeKind() },
                                                onSavingChange: { composerSaving = $0 })) { dismiss() }
                        .id(composing)
                        .transition(.opacity)
                } else {
                    dayList
                        .transition(.opacity)
                }
            }
            .background(Theme.background)
            .safeAreaInset(edge: .top, spacing: 0) {
                WeekdayStrip(selected: weekdayKey) { key in
                    let keys = PlanSchedule.weekdayKeys
                    guard let from = keys.firstIndex(of: weekdayKey), let to = keys.firstIndex(of: key) else { return }
                    step(to - from)
                }
                .disabled(composing != nil)
            }
            .navigationTitle(dayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    dayArrow(-1, systemImage: "chevron.left", id: "weekday.previous")
                    dayArrow(1, systemImage: "chevron.right", id: "weekday.next")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .disabled(saving || composerSaving)
                        .accessibilityIdentifier("weekday.done")
                }
            }
            .sheet(item: $timing) { workout in
                ScheduleTimeSheet(name: workout.name, weekdayKey: weekdayKey,
                                  minutes: ScheduleTimes.minutes(workout.id, on: weekdayKey, plan: sync.plan),
                                  otherDays: PlanItemSummary.weekdays(using: workout.id, plan: sync.plan)
                                      .filter { $0 != weekdayKey },
                                  sameEveryDay: ScheduleTimes.isSameEveryDay(workout.id, plan: sync.plan)) { minutes, keys in
                    setTime(minutes, for: workout.id, on: keys)
                }
            }
        }
        .interactiveDismissDisabled(saving || composerSaving)
    }

    /// Opens the composer in place of the tiles.
    private func compose(_ kind: PlanComposer.Kind) {
        withAnimation(reduceMotion ? nil : .snappy) { composing = kind }
    }

    /// Change: the tiles again, in the places they were.
    private func changeKind() {
        guard !composerSaving else { return }
        withAnimation(reduceMotion ? nil : .snappy) { composing = nil }
    }

    /// The day as it is: what it holds, the New tiles, and rest or a saved
    /// workout.
    private var dayList: some View {
        List {
            if currentWorkout != nil || !extras.isEmpty {
                daySection
            }
            // The tiles sit in the header, not a row: a row's rounded
            // corners clipped the outer tiles (app-design-pass P24).
            Section {
            } header: {
                VStack(alignment: .leading, spacing: 8) {
                    Text("New for every \(dayName)")
                    // Three and three, the member's most frequent first.
                    HStack(spacing: 8) {
                        ForEach(Array(order.prefix(3))) { kind in newTile(kind) }
                    }
                    HStack(spacing: 8) {
                        ForEach(Array(order.dropFirst(3))) { kind in newTile(kind) }
                    }
                }
                .textCase(nil)
            }
            Section {
                choice(workout: nil)
                ForEach(saved) { workout in choice(workout: workout) }
            } header: {
                Text("Or use one you have")
            } footer: {
                Text("Repeats every week. To change one date, use the calendar.")
            }
            if let error = sync.loadError {
                Section {
                    Text(error).foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("weekday.error")
                }
            }
        }
        .scrollContentBackground(.hidden)
        // A sideways swipe moves a day, like the arrows. A mostly
        // vertical drag stays a scroll.
        .daySwipe(swipe, isEnabled: canStep) { offset in
            weekdayKey = Self.weekday(weekdayKey, offset: offset)
        }
    }

    /// The weekday `offset` days away, wrapping Sunday to Monday.
    static func weekday(_ key: String, offset: Int) -> String {
        let keys = PlanSchedule.weekdayKeys
        guard let index = keys.firstIndex(of: key) else { return key }
        return keys[((index + offset) % keys.count + keys.count) % keys.count]
    }

    private var canStep: Bool { !saving && composing == nil }

    private func step(_ offset: Int) {
        guard canStep else { return }
        swipe.move(offset, reduceMotion: reduceMotion) {
            weekdayKey = Self.weekday(weekdayKey, offset: offset)
        }
    }

    private func dayArrow(_ offset: Int, systemImage: String, id: String) -> some View {
        let name = WorkoutLibraryPolicy.weekdayNames[Self.weekday(weekdayKey, offset: offset)] ?? ""
        return Button { step(offset) } label: {
            Image(systemName: systemImage).font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.text)
        }
        .disabled(saving || composing != nil)
        .accessibilityLabel(offset < 0 ? "Previous day, \(name)" : "Next day, \(name)")
        .accessibilityIdentifier(id)
    }

    /// The old one-word kind, kept for the library's rows.
    static func detail(for workout: Workout) -> String {
        if PlannedActivity.isActivity(workout) { return "Activity" }
        if PlannedRunCreation.isRun(workout) { return "Run" }
        let count = workout.exercises.count
        return "\(count) exercise\(count == 1 ? "" : "s")"
    }

    /// The New tiles' identifiers, kept from before they were ranked.
    static func tileID(_ kind: PlanComposer.Kind) -> String {
        switch kind {
        case .run: return "weekday.newRun"
        case .ride: return "weekday.newRide"
        case .swim: return "weekday.newSwim"
        case .lift: return "weekday.newWorkout"
        case .home: return "weekday.newHome"
        case .sport, .saved: return "weekday.newActivity"
        }
    }

    private func newTile(_ kind: PlanComposer.Kind) -> some View {
        let title = kind.title
        let id = Self.tileID(kind)
        return Button { compose(kind) } label: {
            VStack(spacing: 6) {
                Image(systemName: kind.glyph).font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(height: 26)
                Text(title).font(Theme.mono(14, .bold)).foregroundStyle(Theme.text)
                    .lineLimit(1).minimumScaleFactor(0.75)
            }
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, minHeight: 72)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel("New \(kind == .sport ? "other activity" : title.lowercased()) every \(dayName)")
        .accessibilityIdentifier(id)
    }

    /// What the day holds: its workout, which opens its details, then the
    /// activities beside it, each of which can come off, and the way to add
    /// another. The composer keeps the workout by default.
    private var daySection: some View {
        Section {
            if let workout = currentWorkout {
                HStack(spacing: 8) {
                    Button { onOpenWorkout(workout.id) } label: {
                        HStack(spacing: 12) {
                            PlanItemLabel(workout: workout, plan: sync.plan, showsWeekdays: false)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("View \(workout.name)")
                    .accessibilityIdentifier("weekday.viewWorkout")
                    timeButton(workout)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                        .accessibilityHidden(true)
                }
            }
            ForEach(extras) { workout in
                HStack(spacing: 8) {
                    Button { onOpenWorkout(workout.id) } label: {
                        HStack {
                            PlanItemLabel(workout: workout, plan: sync.plan, showsWeekdays: false)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("View \(workout.name)")
                    .accessibilityIdentifier("weekday.viewExtra.\(workout.id)")
                    timeButton(workout)
                    Button { removeExtra(workout.id) } label: {
                        Image(systemName: "minus.circle")
                            .font(.system(size: 20)).foregroundStyle(Theme.muted)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    .accessibilityLabel("Take \(workout.name) off \(dayName)s")
                    .accessibilityIdentifier("weekday.extra.remove.\(workout.id)")
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("weekday.extra.\(workout.id)")
            }
            if extras.count < ScheduleExtras.maxPerDay {
                Button { compose(.home) } label: {
                    Label("Add something alongside", systemImage: "plus")
                        .font(Theme.mono(14, .bold)).foregroundStyle(Theme.accent)
                        .frame(minHeight: 44)
                }
                .disabled(busy)
                .accessibilityIdentifier("weekday.addExtra")
            }
        } header: {
            Text("Every \(dayName)")
        } footer: {
            Text("Add a separate core routine, run or other activity beside this workout. Each keeps its own time and completion. Choose Other if you only want to schedule and log it.")
        }
    }

    /// The item's time of day, or a quiet "Time" to set one. Optional: most
    /// items never get one.
    private func timeButton(_ workout: Workout) -> some View {
        let minutes = ScheduleTimes.minutes(workout.id, on: weekdayKey, plan: sync.plan)
        return Button { timing = workout } label: {
            HStack(spacing: 4) {
                Image(systemName: "clock").font(.system(size: 12, weight: .semibold))
                Text(minutes.map { ScheduleTimes.display($0) } ?? "Time")
                    .font(Theme.mono(13, minutes == nil ? .regular : .bold))
            }
            .foregroundStyle(minutes == nil ? Theme.muted : Theme.text)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel(minutes.map { "\(workout.name) at \(ScheduleTimes.display($0)). Change time" }
            ?? "Set a time for \(workout.name)")
        .accessibilityIdentifier("weekday.time.\(workout.id)")
    }

    private func setTime(_ minutes: Int?, for workoutID: String, on weekdayKeys: [String]) {
        guard !busy else { return }
        saving = true
        Task {
            _ = await sync.setScheduleTime(minutes, for: workoutID, on: weekdayKeys)
            saving = false
        }
    }

    private func removeExtra(_ workoutID: String) {
        guard !busy else { return }
        saving = true
        Task {
            _ = await sync.removeScheduleExtra(workoutID, from: weekdayKey)
            saving = false
        }
    }

    private func choice(workout: Workout?) -> some View {
        let workoutID = workout?.id
        let selected = (current?.workoutID) == workoutID
        return Button { choose(workoutID) } label: {
            HStack(spacing: 12) {
                if let workout {
                    PlanItemLabel(workout: workout, plan: sync.plan)
                } else {
                    HStack(spacing: 12) {
                        PlanItemBadge(glyph: "moon.zzz")
                        Text("Rest").font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                    }
                }
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.accent)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityIdentifier("weekday.choice.\(workoutID ?? "rest")")
    }

    private func choose(_ workoutID: String?) {
        guard !busy else { return }
        guard current?.workoutID != workoutID else { dismiss(); return }
        saving = true
        Task {
            let accepted = await sync.setWeekday(weekdayKey, to: workoutID)
            saving = false
            if accepted { dismiss() }
        }
    }
}

/// Sets or clears the time of day for one thing a weekday holds. A time is
/// optional; with one, the app reminds the member then. When the item is on
/// other weekdays too, one switch applies the time to every day it's on
/// (app-design-pass P22).
struct ScheduleTimeSheet: View {
    let name: String
    let weekdayKey: String
    let minutes: Int?
    /// The other weekdays of the repeating week that hold this item.
    let otherDays: [String]
    /// Saves a time (nil clears it) on the weekdays it should apply to.
    let onSave: (Int?, [String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var picked: Date
    @State private var everyDay: Bool

    init(name: String, weekdayKey: String, minutes: Int?, otherDays: [String] = [],
         sameEveryDay: Bool = false, onSave: @escaping (Int?, [String]) -> Void) {
        self.name = name
        self.weekdayKey = weekdayKey
        self.minutes = minutes
        self.otherDays = otherDays
        self.onSave = onSave
        let start = minutes ?? 7 * 60
        let today = Calendar.current.startOfDay(for: Date())
        _picked = State(initialValue: Calendar.current.date(byAdding: .minute, value: start, to: today) ?? today)
        // On when the days already agree, so saving changes nothing unasked.
        _everyDay = State(initialValue: !otherDays.isEmpty && sameEveryDay)
    }

    private var dayName: String { WorkoutLibraryPolicy.weekdayNames[weekdayKey] ?? weekdayKey }

    /// The weekdays a save applies to, in week order.
    private var days: [String] {
        everyDay ? PlanSchedule.weekdayKeys.filter { $0 == weekdayKey || otherDays.contains($0) } : [weekdayKey]
    }

    /// "Every Monday", or "Every Monday, Tuesday and Wednesday".
    private var daysPhrase: String {
        let names = days.map { WorkoutLibraryPolicy.weekdayNames[$0] ?? $0 }
        guard let last = names.last else { return "" }
        return "Every " + (names.count == 1 ? last : names.dropLast().joined(separator: ", ") + " and " + last)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Time", selection: $picked, displayedComponents: .hourAndMinute)
                        .datePickerStyle(.wheel)
                        .labelsHidden()
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("scheduleTime.picker")
                } footer: {
                    Text("\(daysPhrase). The time stays on your plan whether or not notifications are allowed.")
                }
                Section { ScheduleReminderPermissionView() }
                if !otherDays.isEmpty {
                    Section {
                        Toggle("Every day it's on", isOn: $everyDay)
                            .accessibilityIdentifier("scheduleTime.everyDay")
                    } footer: {
                        Text(everyDay ? "Changes the time on each of these days."
                                      : "Changes \(dayName) only.")
                    }
                }
                if minutes != nil {
                    Section {
                        Button("No set time") {
                            onSave(nil, days)
                            dismiss()
                        }
                        .foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("scheduleTime.clear")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("scheduleTime.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let parts = Calendar.current.dateComponents([.hour, .minute], from: picked)
                        onSave((parts.hour ?? 0) * 60 + (parts.minute ?? 0), days)
                        dismiss()
                    }
                    .accessibilityIdentifier("scheduleTime.save")
                }
            }
        }
        .presentationDetents([.large])
    }
}
