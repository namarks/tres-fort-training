import SwiftUI

/// One daily agenda for the main workout, separate workouts and activities.
/// The selected workout's detailed start/runner/recap stays immediately below.
struct DayWorkoutsView: View {
    @ObservedObject var sync: SyncModel
    var onLogPlannedActivity: ((String) -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var adding = false

    private var items: [DailyWorkoutAgenda.Item] { sync.dailyWorkoutAgenda }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if DailyWorkoutAgenda.showsCombinedAgenda(items) {
                TodaySectionLabel(text: "TODAY'S AGENDA")
                ForEach(items) { item in
                    agendaRow(item)
                }
            }
            if sync.pendingAdditionalWorkout != nil {
                Button(sync.isAddingWorkout ? "Adding workout…" : "Retry adding workout") {
                    Task { _ = await sync.retryAddingWorkout() }
                }.disabled(!sync.canAddAnotherWorkout).frame(minHeight: 44)
                    .accessibilityIdentifier("today.retryAdditionalWorkout")
            } else {
                Button { adding = true } label: {
                    Label("Add another workout", systemImage: "plus")
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
                .disabled(!sync.canAddAnotherWorkout)
                .accessibilityIdentifier("today.addAnotherWorkout")
            }
        }
        .sheet(isPresented: $adding) { AdditionalWorkoutPicker(sync: sync) }
    }

    private func agendaRow(_ item: DailyWorkoutAgenda.Item) -> some View {
        let selected = item.session.map { $0.id == sync.todaySession?.id }
            ?? (item.source == .primary && (sync.todaySession?.slot ?? 0) == 0)
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: item.isDone ? "checkmark.circle.fill"
                      : item.workout.map(PlanItemSummary.glyph) ?? "list.bullet.clipboard")
                    .foregroundStyle(item.isDone ? Theme.done : Theme.accent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title).font(.headline).foregroundStyle(Theme.text)
                    Text(TodayLineup.detail(item.statusLabel, minutes: item.minutes))
                        .font(.subheadline.monospacedDigit()).foregroundStyle(Theme.muted)
                        .accessibilityIdentifier("today.agenda.status.\(item.id)")
                }
            }
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
            rowAction(item, selected: selected)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? Theme.surface2 : Theme.surface, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.agenda.\(item.id)")
    }

    @ViewBuilder private func rowAction(_ item: DailyWorkoutAgenda.Item, selected: Bool) -> some View {
        if item.isActivity, let workout = item.workout {
            if !item.isDone, let onLogPlannedActivity {
                Button("Log \(workout.name)") { onLogPlannedActivity(workout.name) }
                    .disabled(sync.partnerReserved)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier(item.source == .primary ? "today.logPlannedActivity" : "today.extra.log.\(workout.id)")
            }
        } else if let session = item.session {
            Button(selected ? "Selected" : "Open") { _ = sync.selectWorkout(session) }
                .frame(minWidth: 44, minHeight: 44).disabled(!sync.canSwitchWorkout)
                .accessibilityLabel("Open \(item.title), \(item.statusLabel)")
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("today.session.\(session.slot ?? 0)")
        } else if item.source == .primary {
            Button(selected ? "Selected" : "Open") { _ = sync.selectPrimaryWorkout() }
                .frame(minWidth: 44, minHeight: 44).disabled(!sync.canSwitchWorkout)
                .accessibilityLabel("Open \(item.title)")
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("today.session.0")
        } else if let workout = item.workout {
            Button("Start \(workout.name)") {
                Task {
                    await RestCue.requestNotificationPermissionIfNeeded()
                    _ = await sync.addAnotherWorkout(workout.id)
                }
            }
            .frame(minHeight: 44).disabled(!sync.canAddAnotherWorkout)
            .accessibilityIdentifier("today.scheduledAdditional.\(workout.id)")
        }
    }
}

struct AdditionalWorkoutPicker: View {
    @ObservedObject var sync: SyncModel
    @Environment(\.dismiss) private var dismiss
    @State private var freestyle = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button("Freestyle workout") { freestyle = true }
                        .frame(minHeight: 44).accessibilityIdentifier("additional.freestyle")
                }
                Section("Saved workouts") {
                    ForEach((sync.plan?.libraryWorkouts ?? []).filter { !$0.exercises.isEmpty }) { workout in
                        Button {
                            Task {
                                await RestCue.requestNotificationPermissionIfNeeded()
                                if await sync.addAnotherWorkout(workout.id) { dismiss() }
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(workout.name).foregroundStyle(Theme.text)
                                Text("\(workout.exercises.count) exercises").font(.caption).foregroundStyle(Theme.muted)
                            }.frame(minHeight: 44)
                        }
                        .accessibilityIdentifier("additional.workout.\(workout.id)")
                    }
                }
                if let error = sync.loadError { Text(error).foregroundStyle(Theme.danger) }
            }
            .disabled(sync.isAddingWorkout)
            .navigationTitle("Add another workout").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(sync.isAddingWorkout) } }
            .sheet(isPresented: $freestyle) {
                FreestyleExercisePicker(sync: sync, starting: true, additional: true, onStarted: { dismiss() })
            }
        }.interactiveDismissDisabled(sync.isAddingWorkout)
    }
}
