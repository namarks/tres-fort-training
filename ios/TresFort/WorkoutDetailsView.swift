import SwiftUI

/// A saved workout is always opened by its explicit identity. A stale selection
/// must never fall through to the runner's last workout or the first library row.
/// Pushed from the library it uses that navigation stack and its Back button;
/// presented on its own it brings a stack and Done. Edit always pushes the
/// editor onto the same stack instead of stacking another sheet.
struct WorkoutDetailsView: View {
    @ObservedObject var sync: SyncModel
    let workoutID: String
    var date: String? = nil
    var onStart: ((String) -> Void)? = nil
    var isPushed = false
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var saving = false
    @State private var refreshing = false
    @State private var copying = false
    /// After "Change for today only" the screen shows the one-time copy, so
    /// Edit and Start act on what the date now holds.
    @State private var copyID: String?
    /// Edit on a date's lift or routine asks: this day, or the saved one.
    @State private var choosingEdit = false
    /// Edit on a date's run opens the run screen for that day.
    @State private var editingRunForDay = false
    private let unit = RunDistanceUnit.preferred()

    private var shownID: String { copyID ?? workoutID }
    /// The workout as it reads on its date, with a block week's targets;
    /// editors still open the workout itself.
    private var workout: Workout? {
        date.flatMap { sync.workout(id: shownID, on: $0) } ?? sync.workout(id: shownID)
    }
    /// The workout on the runner (open or minimized) continues from here; it
    /// is never restarted. Another workout can't replace it until it ends.
    private var isOnRunner: Bool { sync.running && sync.selectedDayID == shownID }
    private var anotherIsRunning: Bool { sync.running && !isOnRunner }
    private var canResume: Bool {
        isOnRunner || (sync.hasResumableWorkout && sync.resumableCheckpoint?.selectedDayID == shownID)
    }

    /// The date a saved workout can be changed for, only (docs/plans/
    /// workout-library P3): the date it was opened for, when it is that
    /// date's workout and the date can still change.
    private func changeDate(for workout: Workout) -> String? {
        guard !workout.isOneTime, !workout.isArchived, let date,
              sync.previewWorkout(forDateString: date)?.id == workout.id,
              sync.calendarAssignmentUnavailableReason(date: date) == nil else { return nil }
        return date
    }

    private func dayName(_ ymd: String) -> String {
        ymd == sync.todayString ? "today" : DateLabel.long(ymd)
    }

    var body: some View {
        Group {
            if isPushed { content } else { NavigationStack { content } }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let workout {
                    Text(workout.isArchived ? "Archived workout"
                         : workout.one_time_date.map { "Just for " + DateLabel.long($0) }
                         ?? date.map { "For " + DateLabel.long($0) } ?? "Saved workout")
                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    if let plan = PlannedRunCreation.runSlot(in: workout)?.runPlan,
                       PlannedRunCreation.isRun(workout), workout.exercises.count == 1 {
                        // A run: its figures, then every step with its target.
                        PlannedRunGlance(workout: workout)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                        RunPlanStepsView(plan: plan, unit: unit, size: 14)
                    } else {
                        WorkoutExercisePreview(sync: sync, exercises: workout.exercises)
                    }
                    if workout.exercises.isEmpty {
                        Text(workout.isArchived ? "No exercises saved in this archived workout." : "An activity, with no sets to log. On its day, Today offers to log it. Edit it to add exercises instead.")
                            .foregroundStyle(Theme.muted)
                    }
                    Text(workout.isArchived ? "Restore this workout from the library to use it again."
                         : workout.isOneTime ? "Just for this day. Edit changes this day only; your saved workouts and your week stay as they are."
                         : changeDate(for: workout) != nil ? "Edit changes this day only, or your saved \(workout.name) if you choose."
                         : "Edit changes this saved workout wherever you use it. Completed records stay unchanged.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                } else {
                    Text("This workout is not loaded. Refresh to check for it, or choose another workout from the library.")
                        .foregroundStyle(Theme.muted)
                    Button(refreshing ? "Refreshing…" : "Refresh workout") {
                        refreshing = true
                        Task { await sync.load(); refreshing = false }
                    }
                    .disabled(refreshing)
                    .frame(minHeight: 44)
                }
                if let error = sync.loadError {
                    Text(error).font(.footnote).foregroundStyle(Theme.danger)
                }
            }
            .padding(20)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let workout, !workout.isArchived, onStart != nil || date != nil {
                primaryAction(for: workout)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(Theme.background)
                    .overlay(alignment: .top) { Divider() }
            }
        }
        .background(Theme.background)
        .foregroundStyle(Theme.text)
        .navigationTitle(workout?.name ?? "Workout unavailable")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !isPushed {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
            if let workout, !workout.isArchived {
                ToolbarItem(placement: .primaryAction) {
                    Button(copying ? "Copying…" : "Edit") { edit(workout) }
                        .disabled(copying || sync.isRoutineMutationInFlight)
                        .accessibilityIdentifier("workoutDetails.edit")
                }
            }
        }
        .navigationDestination(isPresented: $editing) {
            EditWorkoutSheet(sync: sync, dayID: shownID, isPushed: true)
        }
        .navigationDestination(isPresented: $editingRunForDay) {
            if let workout, let date {
                DayRunChangeView(sync: sync, date: date, source: workout, offersSavedEdit: true) {
                    editingRunForDay = false
                    dismiss()
                }
            }
        }
        .confirmationDialog("Edit \(workout?.name ?? "this workout")", isPresented: $choosingEdit,
                            titleVisibility: .visible) {
            if let workout, let changeDate = changeDate(for: workout) {
                Button("Change for \(dayName(changeDate)) only") { copyForDay(workout, date: changeDate) }
                    .accessibilityIdentifier("workoutDetails.changeOnce")
                Button("Edit your saved \(workout.name)") { editing = true }
                    .accessibilityIdentifier("workoutDetails.editSaved")
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("A change for one day leaves your saved workout and your week as they are.")
        }
    }

    /// Edit (app-design-pass P25): the only way in to changing a workout.
    /// On a date that can still change, a run opens the run screen for that
    /// day and a lift or routine asks whether to change that day or the
    /// saved workout. Anywhere else it edits the workout shown.
    private func edit(_ workout: Workout) {
        guard changeDate(for: workout) != nil else {
            editing = true
            return
        }
        if DayChange.holding(workout) == .run, PlannedRunCreation.isRun(workout) {
            editingRunForDay = true
        } else {
            choosingEdit = true
        }
    }

    private func copyForDay(_ workout: Workout, date: String) {
        copying = true
        Task {
            if let id = await sync.makeOneTimeWorkout(date: date, from: workout) {
                copyID = id
                editing = true
            }
            copying = false
        }
    }

    @ViewBuilder
    private func primaryAction(for workout: Workout) -> some View {
        VStack(spacing: 8) {
            if let onStart {
                Button(canResume ? "Continue workout" : "Start this workout") { onStart(workout.id) }
                    .buttonStyle(WorkoutPrimaryButtonStyle())
                    .disabled(workout.exercises.isEmpty || anotherIsRunning
                        || (sync.blocksNewWorkoutStart && !canResume)
                        || sync.todayIsCompleted || sync.isRoutineMutationInFlight)
                    .accessibilityIdentifier("workoutDetails.start")
                Text(anotherIsRunning ? "Finish the workout in progress before starting another."
                     : "Today only. Weekly schedule unchanged.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            } else if let date {
                Button(saving ? "Saving…" : "Schedule for " + DateLabel.long(date)) {
                    saving = true
                    Task {
                        let accepted = await sync.setCalendarOverride(date: date, dayID: workout.id)
                        saving = false
                        if accepted { dismiss() }
                    }
                }
                .buttonStyle(WorkoutPrimaryButtonStyle())
                .disabled(saving || sync.isRoutineMutationInFlight
                    || sync.calendarAssignmentUnavailableReason(date: date) != nil)
                .accessibilityIdentifier("workoutDetails.schedule")
                Text("This date only. Weekly schedule unchanged.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
        }
    }
}

/// The app's one primary action style: full width, accent fill, bold system text,
/// and a muted fill when disabled. `.large` is for the set runner's main
/// action (log, start, finish), which wants a bigger target, not another look.
struct WorkoutPrimaryButtonStyle: ButtonStyle {
    enum Size { case regular, large }
    var size: Size = .regular
    /// Still available but not the loudest thing on screen (logging during
    /// rest, stopping a timed set): signal outline instead of a signal fill.
    var quiet = false
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12)
        configuration.label
            .font(size == .large ? .title3.weight(.bold) : .headline)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: size == .large ? 58 : 48)
            .foregroundStyle(!isEnabled ? Theme.muted : quiet ? Theme.signal : Theme.onSignal)
            .background(isEnabled && !quiet ? Theme.signalFill : Theme.surface2)
            .overlay(shape.strokeBorder(Theme.signal.opacity(isEnabled && quiet ? 0.6 : 0), lineWidth: 1))
            .clipShape(shape)
            .contentShape(shape)
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct WeeklyScheduleView: View {
    @ObservedObject var sync: SyncModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft: [String: String] = [:]
    @State private var savedDraft: [String: String] = [:]
    @State private var loadedPlanID = ""
    @State private var loadedVersion = 0
    @State private var saving = false
    @State private var confirmDiscard = false
    @State private var scheduleChanged = false
    private let names = ["mon": "Monday", "tue": "Tuesday", "wed": "Wednesday",
                         "thu": "Thursday", "fri": "Friday", "sat": "Saturday", "sun": "Sunday"]

    private var hasChanges: Bool { draft != savedDraft }
    private var planWasReplaced: Bool { !loadedPlanID.isEmpty && sync.plan?.id != loadedPlanID }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(PlanSchedule.weekdayKeys, id: \.self) { key in
                        Picker(names[key] ?? key, selection: Binding(
                            get: { draft[key] ?? "" }, set: { draft[key] = $0 })) {
                            Text("Rest").tag("")
                            ForEach(sync.plan?.libraryWorkouts ?? []) { workout in
                                Text(workout.name).tag(workout.id)
                            }
                        }
                        .accessibilityIdentifier("weeklySchedule.\(key)")
                    }
                } footer: {
                    Text("Repeats each week. Workouts assigned to specific dates stay in place.")
                }
                .disabled(saving || sync.isRoutineMutationInFlight || sync.plan == nil || planWasReplaced)
                if planWasReplaced {
                    Text("The active plan changed. Reopen this schedule to review it.")
                        .foregroundStyle(Theme.danger)
                } else if scheduleChanged {
                    Text("The schedule changed elsewhere. Your choices are still here. Review them before saving to replace the current weekly schedule.")
                        .foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("weeklySchedule.conflict")
                }
                if let error = sync.loadError {
                    Text(error).foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("weeklySchedule.error")
                }
            }
            .navigationTitle("Weekly schedule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if hasChanges { confirmDiscard = true } else { dismiss() }
                    }
                    .disabled(saving)
                    .accessibilityIdentifier("weeklySchedule.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { save() }
                        .disabled(!hasChanges || saving || sync.isRoutineMutationInFlight
                            || sync.plan == nil || planWasReplaced)
                        .accessibilityIdentifier("weeklySchedule.save")
                }
            }
            .alert("Discard schedule changes?", isPresented: $confirmDiscard) {
                Button("Keep editing", role: .cancel) {}
                Button("Discard changes", role: .destructive) { dismiss() }
            } message: {
                Text("Your weekly schedule has not been saved.")
            }
            .task(id: [sync.plan?.id ?? "", String(sync.plan?.version ?? 0)]) {
                // An external refresh must not replace an unsaved draft. Saving
                // uses its loaded version so concurrent edits still conflict.
                guard !saving, !hasChanges else { return }
                savedDraft = RoutineScheduleDraftPolicy.persistedDraft(for: sync.plan)
                draft = savedDraft
                loadedPlanID = sync.plan?.id ?? ""
                loadedVersion = sync.plan?.version ?? 0
            }
        }
        .interactiveDismissDisabled(hasChanges || saving)
    }

    private func save() {
        saving = true
        Task {
            let accepted = await sync.saveRecurringSchedule(draft,
                expectedPlanID: loadedPlanID, expectedVersion: loadedVersion)
            if accepted {
                dismiss()
            } else if let plan = sync.plan, plan.id == loadedPlanID {
                let latest = RoutineScheduleDraftPolicy.persistedDraft(for: plan)
                scheduleChanged = scheduleChanged || plan.version != loadedVersion || latest != savedDraft
                savedDraft = latest
                loadedVersion = plan.version
            }
            saving = false
        }
    }
}
