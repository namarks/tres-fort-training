import SwiftUI

/// Swap what a date holds (docs/plans/app-design-pass P25): what instead,
/// as tiles, each opening its own screen (a run by its kind and amount, a
/// ride or swim by its amount, a lift, routine or activity the member has or
/// a new one), or a rest day. Every answer changes that date only; saved
/// workouts and the week stay as they are. Opened from Today's Swap, a day
/// swiped to on Today and a calendar date. Changing the workout itself
/// happens from its details, so there is one way in to a workout's details.
struct WorkoutDatePickerView: View {
    @ObservedObject var sync: SyncModel
    let date: String
    @Environment(\.dismiss) private var dismiss
    @State private var path: [DayChangeRoute] = []
    @State private var confirmingRest = false
    @State private var resting = false
    @State private var refreshing = false
    /// Fixed while the sheet is open so a sync doesn't move a tile.
    @State private var kinds: [PlanComposer.Kind]

    init(sync: SyncModel, date: String) {
        self.sync = sync
        self.date = date
        _kinds = State(initialValue: DayChange.swapKinds(PlanComposer.ranked(for: sync)))
    }

    /// What the date holds now; nil for a rest day.
    private var current: Workout? { sync.previewWorkout(forDateString: date) }
    private var unavailableReason: String? { sync.calendarAssignmentUnavailableReason(date: date) }
    private var weekday: String { DayChange.weekday(date) }
    private var busy: Bool { resting || sync.isRoutineMutationInFlight || unavailableReason != nil }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let reason = unavailableReason {
                    Section { Text(reason).font(.subheadline).foregroundStyle(Theme.muted) }
                }
                Section {
                    DayKindGrid(kinds: kinds) { kind in path.append(DayChangeRoute.forNew(kind)) }
                        .disabled(busy)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        .listRowBackground(Color.clear)
                } header: {
                    Text(current == nil ? "What on \(weekday)?" : "What instead?")
                        .accessibilityIdentifier("workoutPicker.date")
                } footer: {
                    Text(current.map { "Takes the place of \($0.name) on \(DateLabel.long(date)) only. Your week stays the same." }
                         ?? "On \(DateLabel.long(date)) only. Your week stays the same.")
                }
                if current != nil {
                    Section {
                        Button {
                            confirmingRest = true
                        } label: {
                            Label(resting ? "Saving…" : "Rest on \(weekday)", systemImage: "moon.zzz")
                                .frame(minHeight: 44)
                        }
                        .disabled(busy)
                        .accessibilityIdentifier("dayChange.rest")
                    }
                }
                statusSection
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(current.map { "Swap \(weekday)'s \(DayChange.holding($0).noun)" } ?? "Plan \(weekday)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(resting)
                        .accessibilityIdentifier("dayChange.cancel")
                }
            }
            .navigationDestination(for: DayChangeRoute.self) { route in
                destination(route)
            }
            .dayRestConfirmation(isPresented: $confirmingRest, weekday: weekday, name: current?.name) { rest() }
            .tint(Theme.accent)
        }
        .interactiveDismissDisabled(resting)
    }

    @ViewBuilder private func destination(_ route: DayChangeRoute) -> some View {
        switch route {
        case .run:
            // Swapping a run for a run starts from the day's run.
            DayRunChangeView(sync: sync, date: date,
                             source: current.flatMap { DayChange.holding($0) == .run ? $0 : nil }) { dismiss() }
        case .endurance(let kind):
            DayEnduranceChangeView(sync: sync, date: date, kind: kind) { dismiss() }
        case .pick(let kind):
            DayPickView(sync: sync, date: date, kind: kind) { dismiss() }
        }
    }

    @ViewBuilder private var statusSection: some View {
        if sync.loadError != nil || sync.plan == nil || sync.isUsingCachedState {
            Section {
                if let error = sync.loadError {
                    Text(error).font(.subheadline).foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("workoutPicker.error")
                }
                Button(refreshing ? "Refreshing…" : "Refresh workouts") {
                    refreshing = true
                    Task { await sync.load(); refreshing = false }
                }
                .frame(minHeight: 44)
                .disabled(resting || refreshing || sync.isRoutineMutationInFlight)
                .accessibilityIdentifier("workoutPicker.refresh")
            }
        }
    }

    private func rest() {
        resting = true
        Task {
            let accepted = await sync.setCalendarOverride(date: date, dayID: nil)
            resting = false
            if accepted { dismiss() }
        }
    }
}

extension View {
    /// The one question before a day becomes a rest day.
    func dayRestConfirmation(isPresented: Binding<Bool>, weekday: String, name: String?,
                             onRest: @escaping () -> Void) -> some View {
        let restTitle = weekday == "today" ? "Rest today" : "Rest on \(weekday)"
        return confirmationDialog("Make \(weekday) a rest day?", isPresented: isPresented, titleVisibility: .visible) {
            Button(restTitle, role: .destructive, action: onRest)
                .accessibilityIdentifier("dayChange.confirmRest")
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(name.map { "\($0) comes off \(weekday). Nothing else moves, and your week stays the same." }
                 ?? "Nothing else moves, and your week stays the same.")
        }
    }
}

/// The screens behind Swap.
enum DayChangeRoute: Hashable {
    /// The run screen: the day's run changed, or a new run in its place.
    case run
    case endurance(PlanComposer.Kind)
    /// A lift, routine or activity: one the member has, or a new one.
    case pick(PlanComposer.Kind)

    static func forNew(_ kind: PlanComposer.Kind) -> DayChangeRoute {
        switch kind {
        case .run: return .run
        case .ride, .swim: return .endurance(kind)
        case .lift, .home, .sport, .saved: return .pick(kind)
        }
    }
}

/// The kinds of thing a day can hold, as tiles, the member's most frequent
/// first.
struct DayKindGrid: View {
    let kinds: [PlanComposer.Kind]
    let onPick: (PlanComposer.Kind) -> Void

    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8),
                           GridItem(.flexible(), spacing: 8)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(kinds) { kind in
                Button { onPick(kind) } label: {
                    VStack(spacing: 6) {
                        Image(systemName: kind.glyph).font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Theme.accent).frame(height: 24)
                        Text(kind.title).font(Theme.mono(13, .bold)).foregroundStyle(Theme.text)
                            .lineLimit(1).minimumScaleFactor(0.75)
                    }
                    .padding(.horizontal, 4)
                    .frame(maxWidth: .infinity, minHeight: 72)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("dayChange.kind.\(kind.rawValue)")
            }
        }
    }
}

/// The run screen: one choice for the kind of run, which sets its effort,
/// and one amount. Steps are a tap away. Saved as a one-time run for the
/// date, so the saved run and the week stay as they are.
struct DayRunChangeView: View {
    @ObservedObject var sync: SyncModel
    let date: String
    /// The date's run being changed; nil for a new run in place of
    /// something else. Held from the first open, so a refresh after Save
    /// (which puts the new run on the date) can't replace what the screen
    /// started from.
    @State private var source: Workout?
    /// The source is held from first open; its write authority must be too.
    /// A foreground refresh cannot approve overwriting another client's edit.
    @State private var reviewedVersion: Int?
    /// Opened from the run's details: offers editing the saved run, for
    /// every day it is used, instead of this day only.
    var offersSavedEdit = false
    let onFinished: () -> Void

    @State private var editingSaved = false
    /// A saved run picked instead of the one on screen.
    @State private var savedID: String?
    @State private var draft: DayChange.RunDraft
    @State private var initial: DayChange.RunDraft
    @State private var thresholds: [AthleteThreshold] = []
    @State private var saving = false
    /// The run an earlier try made, so Try again doesn't make another.
    @State private var createdID: String?
    @State private var stepsSaved = false
    @State private var editingSteps: StepDraft?
    private let unit = RunDistanceUnit.preferred()

    private struct StepDraft: Identifiable {
        let id = UUID()
        let plan: RunPlan?
        let unreadable: Bool
    }

    init(sync: SyncModel, date: String, source: Workout?, offersSavedEdit: Bool = false,
         onFinished: @escaping () -> Void) {
        self.sync = sync
        self.date = date
        _source = State(initialValue: source)
        _reviewedVersion = State(initialValue: sync.plan?.version)
        self.offersSavedEdit = offersSavedEdit
        self.onFinished = onFinished
        let start = DayChange.draft(from: source, unit: RunDistanceUnit.preferred())
        _initial = State(initialValue: start)
        _draft = State(initialValue: start)
    }

    private var weekday: String { DayChange.weekday(date) }
    private var targets: DayChange.Targets {
        DayChange.Targets.from(thresholds, on: date, own: DayChange.ownTarget(of: source))
    }
    /// A run that only reopens steps keeps the day's own steps, so Save
    /// waits for a change.
    private var changed: Bool {
        savedID != nil || source == nil || draft != initial || (createdID != nil && !stepsSaved)
    }
    private var busy: Bool { saving || sync.isRoutineMutationInFlight }
    /// Saved runs, offered when this screen swaps the day's plan; editing
    /// from Details changes the run itself.
    private var savedRuns: [Workout] {
        offersSavedEdit ? [] : DayChange.saved(.run, in: sync.plan, on: date).filter { $0.id != source?.id }
    }

    var body: some View {
        form
        .sheet(item: $editingSteps) { steps in
            NavigationStack {
                RunPlanStepsEditor(plan: steps.plan, unreadable: steps.unreadable,
                                   saveTitle: "Done", onCancel: { editingSteps = nil }) { plan in
                    draft.steps = .custom(plan)
                    savedID = nil
                    editingSteps = nil
                }
            }
        }
        .task { thresholds = await sync.planningThresholds() }
    }

    private var form: some View {
        Form {
            Section {
                kindPills
            } header: {
                Text("Kind of run")
            }
            Section {
                if draft.hasCustomSteps {
                    Text(draft.plan(targets: targets, unit: unit)
                        .flatMap { RunPlanFormat.total($0, unit: unit) } ?? "At your own pace")
                        .font(Theme.mono(22, .bold)).foregroundStyle(Theme.text)
                        .accessibilityIdentifier("dayRun.customAmount")
                } else {
                    amountRow
                }
            } header: {
                Text(draft.hasCustomSteps ? "Your steps" : draft.measure == .time ? "How long" : "How far")
            } footer: {
                Text(DayChange.summary(draft, targets: targets, unit: unit))
                    .accessibilityIdentifier("dayRun.summary")
            }
            Section {
                Button("Edit steps") {
                    // Capture exactly what opens, even if thresholds finish
                    // loading while the member is editing. No write or refresh.
                    if draft == initial, let slot = PlannedRunCreation.runSlot(in: source) {
                        editingSteps = StepDraft(plan: slot.runPlan,
                                                 unreadable: slot.run_steps != nil && slot.runPlan == nil)
                    } else {
                        editingSteps = StepDraft(plan: draft.plan(targets: targets, unit: unit), unreadable: false)
                    }
                }
                    .frame(minHeight: 44)
                    .disabled(busy || createdID != nil)
                    .accessibilityIdentifier("dayRun.editSteps")
            } footer: {
                Text("Plan each warm-up, interval and recovery with its own pace or heart rate.")
            }
            if !savedRuns.isEmpty {
                Section {
                    ForEach(savedRuns) { workout in
                        DaySavedRow(workout: workout, plan: sync.plan, selected: savedID == workout.id) {
                            savedID = savedID == workout.id ? nil : workout.id
                        }
                        .disabled(busy || createdID != nil)
                    }
                } header: {
                    Text("Or one of your runs")
                }
            }
        }
        .onChange(of: draft) { _, _ in savedID = nil }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) { saveBar }
        .navigationTitle(source == nil ? "\(weekday)'s run" : "Edit \(weekday)'s run")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(saving)
        .navigationDestination(isPresented: $editingSaved) {
            if let source { EditWorkoutSheet(sync: sync, dayID: source.id, isPushed: true) }
        }
        .tint(Theme.accent)
    }

    private var kindPills: some View {
        HStack(spacing: 8) {
            ForEach(DayChange.RunKind.allCases) { kind in
                let on = draft.kind == kind
                Button(kind.title) { draft.choose(kind, unit: unit) }
                    .font(Theme.mono(14, .bold))
                    .foregroundStyle(on ? Theme.onAccent : Theme.text)
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .padding(.horizontal, 10).frame(maxWidth: .infinity, minHeight: 40)
                    .background(on ? Theme.accent : Theme.surface2, in: Capsule())
                    .buttonStyle(.plain)
                    .disabled(busy || createdID != nil)
                    .accessibilityAddTraits(on ? [.isSelected] : [])
                    .accessibilityIdentifier("dayRun.kind.\(kind.rawValue)")
            }
        }
        .padding(.vertical, 4)
    }

    private var amountRow: some View {
        let amount = DayChange.amountText(draft, unit: unit)
        return HStack {
            stepButton("minus", label: "Less") { draft.step(by: -1, unit: unit) }
            Spacer()
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(amount.value).font(Theme.display(48)).foregroundStyle(Theme.text)
                    .accessibilityIdentifier("dayRun.amount")
                Button { draft.toggleMeasure() } label: {
                    HStack(spacing: 3) {
                        Text(amount.unit).font(Theme.mono(17, .bold))
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold))
                    }
                    .foregroundStyle(Theme.accent)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(draft.measure == .time ? "Minutes. Switch to \(unit.title.lowercased())"
                                    : "\(unit.title). Switch to minutes")
                .accessibilityIdentifier("dayRun.measure")
            }
            Spacer()
            stepButton("plus", label: "More") { draft.step(by: 1, unit: unit) }
        }
        .disabled(busy || createdID != nil)
    }

    private func stepButton(_ glyph: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: glyph)
                .font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.accent)
                .frame(width: 44, height: 44)
                .background(Theme.surface2, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var saveBar: some View {
        VStack(spacing: 8) {
            if let error = sync.loadError {
                Text(error).font(.footnote).foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("dayRun.error")
            }
            Button(saving ? "Saving…" : createdID != nil && !stepsSaved ? "Try again" : "Save for \(weekday)") {
                save()
            }
            .buttonStyle(WorkoutPrimaryButtonStyle())
            .disabled(busy || !changed)
            .accessibilityIdentifier("dayRun.save")
            if offersSavedEdit, let source, !source.isOneTime {
                Button("Edit your saved \(source.name) instead") { editingSaved = true }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                    .disabled(busy || createdID != nil)
                    .accessibilityIdentifier("dayRun.editSaved")
            } else {
                Text(source.map { $0.isOneTime ? "This date only. Your week stays the same."
                                      : "Your saved \($0.name) and your week stay the same." }
                     ?? "This date only. Your week stays the same.")
                    .font(.caption).foregroundStyle(Theme.muted)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(Theme.background)
    }

    private func save() {
        guard !busy else { return }
        saving = true
        Task {
            defer { saving = false }
            if let savedID, createdID == nil {
                if await sync.setCalendarOverride(date: date, dayID: savedID) { onFinished() }
                return
            }
            let plan = draft.plan(targets: targets, unit: unit)
            let id: String
            if let createdID {
                id = createdID
            } else if let source, source.isOneTime {
                // The date already has its own run: change it in place
                // rather than leave it behind for another.
                createdID = source.id
                id = source.id
            } else if let source, draft.hasCustomSteps, draft.kind == initial.kind {
                guard let made = await sync.makeOneTimeWorkout(date: date, from: source) else { return }
                createdID = made
                id = made
            } else {
                guard let made = await sync.makeOneTimeWorkout(
                    date: date, name: draft.kind.runName, exerciseIDs: [RunPlan.exerciseID]) else { return }
                createdID = made
                id = made
            }
            if !stepsSaved {
                // The create can land while its refresh fails; fetch once more.
                if PlannedRunCreation.runSlot(in: sync.workout(id: id)) == nil { await sync.load() }
                guard let slot = PlannedRunCreation.runSlot(in: sync.workout(id: id)),
                      let version = source?.id == id ? reviewedVersion : sync.plan?.version else {
                    if sync.loadError == nil {
                        sync.loadError = "The run is on \(weekday), but its steps didn't save yet. Try again."
                    }
                    return
                }
                guard await sync.updateRunSteps(dayID: id, teID: slot.id, steps: plan,
                                                expectedVersion: version) else { return }
                stepsSaved = true
                if let source, source.id == id,
                   DayChange.runKind(named: source.name, plan: slot.runPlan) != draft.kind {
                    await sync.renameWorkoutDay(dayID: id, name: draft.kind.runName)
                }
            }
            onFinished()
        }
    }
}

/// A ride or swim for the date: distance or time, kept as a one-time
/// activity named for its amount, so a ride or swim synced that day counts.
struct DayEnduranceChangeView: View {
    @ObservedObject var sync: SyncModel
    let date: String
    let kind: PlanComposer.Kind
    let onFinished: () -> Void

    @State private var measure: PlanComposer.RunMeasure
    @State private var distance: Double
    @State private var minutes: Int
    @State private var saving = false
    /// A saved ride or swim picked instead of the amount on screen.
    @State private var savedID: String?
    private let unit = RunDistanceUnit.preferred()

    init(sync: SyncModel, date: String, kind: PlanComposer.Kind, onFinished: @escaping () -> Void) {
        self.sync = sync
        self.date = date
        self.kind = kind
        self.onFinished = onFinished
        let amounts = PlanComposer.amounts(kind, unit: RunDistanceUnit.preferred())
        _measure = State(initialValue: amounts.defaultMeasure)
        _distance = State(initialValue: amounts.defaultDistance)
        _minutes = State(initialValue: amounts.defaultMinutes)
    }

    private var weekday: String { DayChange.weekday(date) }
    private var amounts: PlanComposer.Amounts { PlanComposer.amounts(kind, unit: unit) }
    private var name: String {
        PlanComposer.enduranceName(kind, measure: measure, distance: distance, minutes: minutes, unit: unit)
    }
    private var busy: Bool { saving || sync.isRoutineMutationInFlight }

    var body: some View {
        Form {
            Section {
                HStack {
                    stepButton("minus", label: "Less") {
                        if measure == .distance {
                            distance = max(amounts.distanceRange.lowerBound, distance - amounts.distanceStep)
                        } else {
                            minutes = max(PlanComposer.minuteRange.lowerBound, minutes - PlanComposer.minuteStep)
                        }
                    }
                    Spacer()
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(measure == .distance ? PlanComposer.number(distance) : "\(minutes)")
                            .font(Theme.display(48)).foregroundStyle(Theme.text)
                            .accessibilityIdentifier("dayEndurance.amount")
                        Button {
                            measure = measure == .distance ? .time : .distance
                        } label: {
                            HStack(spacing: 3) {
                                Text(measure == .distance ? amounts.distanceLabel : "min").font(Theme.mono(17, .bold))
                                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold))
                            }
                            .foregroundStyle(Theme.accent)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(measure == .distance ? "Distance. Switch to minutes" : "Minutes. Switch to distance")
                        .accessibilityIdentifier("dayEndurance.measure")
                    }
                    Spacer()
                    stepButton("plus", label: "More") {
                        if measure == .distance {
                            distance = min(amounts.distanceRange.upperBound, distance + amounts.distanceStep)
                        } else {
                            minutes = min(PlanComposer.minuteRange.upperBound, minutes + PlanComposer.minuteStep)
                        }
                    }
                }
                .disabled(busy)
            } header: {
                Text(measure == .distance ? "How far" : "How long")
            } footer: {
                Text("Today shows it with a button to log it. A \(kind == .swim ? "swim" : "ride") synced from your watch, bike computer or Zwift counts too.")
            }
            let saved = DayChange.saved(kind, in: sync.plan, on: date)
            if !saved.isEmpty {
                Section {
                    ForEach(saved) { workout in
                        DaySavedRow(workout: workout, plan: sync.plan, selected: savedID == workout.id) {
                            savedID = savedID == workout.id ? nil : workout.id
                        }
                        .disabled(busy)
                    }
                } header: {
                    Text(kind == .swim ? "Or one of your swims" : "Or one of your rides")
                }
            }
        }
        .onChange(of: measure) { _, _ in savedID = nil }
        .onChange(of: distance) { _, _ in savedID = nil }
        .onChange(of: minutes) { _, _ in savedID = nil }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                if let error = sync.loadError {
                    Text(error).font(.footnote).foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button(saving ? "Saving…" : "Save for \(weekday)") { save() }
                    .buttonStyle(WorkoutPrimaryButtonStyle())
                    .disabled(busy)
                    .accessibilityIdentifier("dayEndurance.save")
                Text("This date only. Your week stays the same.").font(.caption).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .background(Theme.background)
        }
        .navigationTitle("\(weekday)'s \(kind == .swim ? "swim" : "ride")")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(saving)
        .tint(Theme.accent)
    }

    private func stepButton(_ glyph: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: glyph)
                .font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.accent)
                .frame(width: 44, height: 44)
                .background(Theme.surface2, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func save() {
        saving = true
        Task {
            defer { saving = false }
            if let savedID {
                if await sync.setCalendarOverride(date: date, dayID: savedID) { onFinished() }
                return
            }
            if await sync.makeOneTimeWorkout(date: date, name: name, exerciseIDs: []) != nil { onFinished() }
        }
    }
}

/// A lift, a routine at home or an activity for the date: one the member
/// has, or a new one. Saved workouts show only under their own kind.
struct DayPickView: View {
    @ObservedObject var sync: SyncModel
    let date: String
    let kind: PlanComposer.Kind
    let onFinished: () -> Void

    @State private var selectedID: String?
    @State private var typedName = ""
    @State private var saving = false
    @State private var creating = false
    @State private var createdID: String?
    @FocusState private var nameFocused: Bool

    init(sync: SyncModel, date: String, kind: PlanComposer.Kind, initialName: String? = nil,
         onFinished: @escaping () -> Void) {
        self.sync = sync
        self.date = date
        self.kind = kind
        self.onFinished = onFinished
        _typedName = State(initialValue: initialName ?? "")
    }

    private var weekday: String { DayChange.weekday(date) }
    private var workouts: [Workout] { DayChange.saved(kind, in: sync.plan, on: date) }
    private var selected: Workout? { workouts.first { $0.id == selectedID } }
    private var typed: String { typedName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var busy: Bool { saving || sync.isRoutineMutationInFlight }
    private var canSave: Bool { !busy && (selected != nil || (kind == .sport && !typed.isEmpty)) }

    private var noun: String {
        switch kind {
        case .home: return "routine"
        case .sport: return "activity"
        default: return "lift"
        }
    }

    var body: some View {
        List {
            Section {
                if workouts.isEmpty {
                    Text(kind == .sport ? "Nothing saved yet. Name one below." : "No saved \(noun)s yet. Make one below.")
                        .font(Theme.mono(13)).foregroundStyle(Theme.muted)
                }
                ForEach(workouts) { workout in row(workout) }
            } header: {
                Text("Your \(noun == "activity" ? "activities" : noun + "s")")
            }
            if kind == .sport {
                Section {
                    TextField("Soccer, yoga, a walk", text: $typedName)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.done)
                        .focused($nameFocused)
                        .disabled(busy)
                        .onChange(of: typedName) { _, value in
                            if !value.trimmingCharacters(in: .whitespaces).isEmpty { selectedID = nil }
                        }
                        .accessibilityIdentifier("dayPick.name")
                } header: {
                    Text("Or something new")
                } footer: {
                    Text("Today shows it with a button to log it once it's done.")
                }
            } else {
                Section {
                    Button {
                        creating = true
                    } label: {
                        Label(kind == .home ? "New routine at home" : "New lift", systemImage: "plus")
                            .frame(minHeight: 44)
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("dayPick.new")
                } footer: {
                    Text("It's saved with your workouts so you can use it again.")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                if let error = sync.loadError {
                    Text(error).font(.footnote).foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button(saving ? "Saving…" : "Save for \(weekday)") { save() }
                    .buttonStyle(WorkoutPrimaryButtonStyle())
                    .disabled(!canSave || sync.calendarAssignmentUnavailableReason(date: date) != nil)
                    .accessibilityIdentifier("workoutPicker.schedule")
                Text("This date only. Your week stays the same.").font(.caption).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .background(Theme.background)
        }
        .navigationTitle(kind.title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(saving)
        .tint(Theme.accent)
        .sheet(isPresented: $creating, onDismiss: assignCreated) {
            CreateWorkoutView(sync: sync, onCreated: { createdID = $0 }, equipmentFree: kind == .home,
                              completionTitle: "Save for \(weekday)")
        }
        .onChange(of: workouts.map(\.id)) { _, ids in
            if let selectedID, !ids.contains(selectedID) { self.selectedID = nil }
        }
    }

    private func row(_ workout: Workout) -> some View {
        let isSelected = selectedID == workout.id
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                selectedID = workout.id
                typedName = ""
                nameFocused = false
            } label: {
                HStack(spacing: 12) {
                    PlanItemLabel(workout: workout, plan: sync.plan)
                    Spacer(minLength: 0)
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(isSelected ? Theme.accent : Theme.dim)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityAddTraits(isSelected ? .isSelected : [])
            .accessibilityIdentifier("workoutPicker.workout.\(workout.id)")
            if isSelected, !workout.exercises.isEmpty {
                DisclosureGroup {
                    WorkoutExercisePreview(sync: sync, exercises: workout.exercises)
                        .padding(.top, 8)
                } label: {
                    Text("Preview exercises").font(.subheadline).frame(minHeight: 44)
                }
                .tint(Theme.accent)
                .accessibilityIdentifier("workoutPicker.preview")
            }
        }
    }

    private func save() {
        guard canSave else { return }
        nameFocused = false
        saving = true
        Task {
            defer { saving = false }
            if let selected {
                if await sync.setCalendarOverride(date: date, dayID: selected.id) { onFinished() }
                return
            }
            // A name the member already has uses that activity.
            if let existing = PlannedActivity.existing(named: typed, in: sync.plan), PlannedActivity.isActivity(existing) {
                if await sync.setCalendarOverride(date: date, dayID: existing.id) { onFinished() }
                return
            }
            if await sync.makeOneTimeWorkout(date: date, name: typed, exerciseIDs: []) != nil { onFinished() }
        }
    }

    /// A lift or routine made here goes on the date once its editor closes.
    private func assignCreated() {
        guard let id = createdID else { return }
        saving = true
        Task {
            defer { saving = false }
            if sync.workout(id: id) == nil { await sync.load() }
            if await sync.setCalendarOverride(date: date, dayID: id) {
                createdID = nil
                onFinished()
            }
        }
    }
}

/// A planned run at a glance: how long or far, the kind of run and its
/// target. Every step is in Details. A run planned without steps keeps its
/// one-line label. Today's card reads the figures as one line under the
/// name (`oneLine`); Details keeps them as labeled figures.
struct PlannedRunGlance: View {
    let workout: Workout
    var oneLine = false
    private let unit = RunDistanceUnit.preferred()

    var body: some View {
        let figures = DayChange.glance(workout, unit: unit)
        if figures.isEmpty, let slot = PlannedRunCreation.runSlot(in: workout) {
            Text(slot.runPrescriptionLabel(in: unit))
                .font(oneLine ? .headline : Theme.mono(13))
                .foregroundStyle(oneLine ? Theme.text : Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        } else if oneLine {
            Text(figures.map(\.value).joined(separator: " · "))
                .font(.headline.monospacedDigit()).foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(figures.map { "\($0.label) \($0.value)" }.joined(separator: ", "))
                .accessibilityIdentifier("today.runGlance")
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 20) { ForEach(figures) { figure($0) } }
                VStack(alignment: .leading, spacing: 8) { ForEach(figures) { figure($0) } }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("today.runGlance")
        }
    }

    private func figure(_ item: DayChange.Glance) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(item.label.uppercased())
                .font(Theme.mono(10, .bold)).tracking(1.5).foregroundStyle(Theme.muted)
            Text(item.value).font(.headline).foregroundStyle(Theme.text)
                .lineLimit(1).minimumScaleFactor(0.8)
        }
    }
}

/// Details, Swap and Skip on the plain foot of a planned day's card, as text
/// links so the navy above holds only the workout and its Start
/// (app-design-pass P25, P29). Swap and Skip are left out while a workout is
/// under way.
struct DayActionsRow: View {
    let showsChanges: Bool
    let onDetails: () -> Void
    let onSwap: () -> Void
    let onSkip: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 0) { actions(divided: false) }
        } else {
            HStack(spacing: 0) { actions(divided: true) }
        }
    }

    @ViewBuilder private func actions(divided: Bool) -> some View {
        action("Details", glyph: "list.bullet.clipboard", id: "today.viewWorkout", run: onDetails)
        if showsChanges {
            if divided { divider }
            action("Swap", glyph: "arrow.triangle.2.circlepath", id: "today.changeWorkout", run: onSwap)
            if divided { divider }
            action("Skip", glyph: "moon.zzz", id: "today.skipWorkout", run: onSkip)
        }
    }

    private var divider: some View {
        RaisedFill().frame(width: 1, height: 20).accessibilityHidden(true)
    }

    private func action(_ title: String, glyph: String, id: String, run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Label(title, systemImage: glyph)
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                .lineLimit(1).minimumScaleFactor(0.85)
                .frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? nil : .infinity,
                       minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }
}

/// A saved workout to pick for the date, with what it is and a check.
struct DaySavedRow: View {
    let workout: Workout
    let plan: PlanTree?
    let selected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                PlanItemLabel(workout: workout, plan: plan)
                Spacer(minLength: 0)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selected ? Theme.accent : Theme.dim)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("workoutPicker.workout.\(workout.id)")
    }
}
