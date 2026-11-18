import SwiftUI

/// One daily agenda for the main workout, separate workouts and activities,
/// shown once the day holds more than one of them: a single list in the
/// day's time order under the day's card, so the card's action stays at the
/// top of Today. Each row carries a short action of its own (Start, Log,
/// Open). Adding another workout is the last line of the card
/// (`AddAnotherWorkoutLine`).
struct DayWorkoutsView: View {
    @ObservedObject var sync: SyncModel
    var onLogPlannedActivity: ((String) -> Void)? = nil
    /// False when the list leads the day and the card under it holds only
    /// other ways to train, so no row is "shown above".
    var underCard = true
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var items: [DailyWorkoutAgenda.Item] { sync.dailyWorkoutAgenda }
    private static let badgeSize: CGFloat = 30

    var body: some View {
        if DailyWorkoutAgenda.showsCombinedAgenda(items) {
            VStack(alignment: .leading, spacing: 4) {
                TodaySectionLabel(text: "TODAY'S AGENDA")
                    .frame(minHeight: 28)
                    .padding(.horizontal, 4)
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 {
                            Rectangle().fill(Theme.surface2).frame(height: 1)
                                .padding(.leading, 14 + Self.badgeSize + 12)
                        }
                        agendaRow(item)
                    }
                }
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    private func agendaRow(_ item: DailyWorkoutAgenda.Item) -> some View {
        let selected = item.session.map { $0.id == sync.todaySession?.id }
            ?? (item.source == .primary && (sync.todaySession?.slot ?? 0) == 0)
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            HStack(alignment: .center, spacing: 12) {
                if item.isDone {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title3).foregroundStyle(Theme.done)
                        .frame(width: Self.badgeSize, height: Self.badgeSize)
                        .accessibilityHidden(true)
                } else {
                    PlanItemBadge(glyph: item.workout.map(PlanItemSummary.glyph) ?? "list.bullet.clipboard",
                                  size: Self.badgeSize)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
                        .lineLimit(2)
                    Text(TodayLineup.detail(item.statusLabel, minutes: item.minutes))
                        .font(.footnote.monospacedDigit()).foregroundStyle(Theme.muted)
                        .accessibilityIdentifier("today.agenda.status.\(item.id)")
                }
            }
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
            rowAction(item, selected: selected)
                .font(.subheadline.weight(.semibold))
        }
        .padding(.horizontal, 14).padding(.vertical, 4)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .background(selected ? Theme.surface2.opacity(0.6) : Color.clear)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.agenda.\(item.id)")
    }

    /// The row's one action, in a word; the row already names the workout,
    /// and VoiceOver hears the full "Start Evening Core".
    @ViewBuilder private func rowAction(_ item: DailyWorkoutAgenda.Item, selected: Bool) -> some View {
        if item.isActivity, let workout = item.workout {
            if !item.isDone, let onLogPlannedActivity {
                Button("Log") { onLogPlannedActivity(workout.name) }
                    .disabled(sync.partnerReserved)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Log \(workout.name)")
                    .accessibilityIdentifier(item.source == .primary ? "today.logPlannedActivity" : "today.extra.log.\(workout.id)")
            }
        } else if let session = item.session {
            Button(selectionTitle(selected)) { _ = sync.selectWorkout(session) }
                .tint(selected ? Theme.muted : nil)
                .frame(minWidth: 44, minHeight: 44).disabled(!sync.canSwitchWorkout)
                .accessibilityLabel("Open \(item.title), \(item.statusLabel)")
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("today.session.\(session.slot ?? 0)")
        } else if item.source == .primary {
            Button(selectionTitle(selected)) { _ = sync.selectPrimaryWorkout() }
                .tint(selected ? Theme.muted : nil)
                .frame(minWidth: 44, minHeight: 44).disabled(!sync.canSwitchWorkout)
                .accessibilityLabel("Open \(item.title)")
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("today.session.0")
        } else if let workout = item.workout {
            Button("Start") {
                Task {
                    await RestCue.requestNotificationPermissionIfNeeded()
                    _ = await sync.addAnotherWorkout(workout.id)
                }
            }
            .frame(minWidth: 44, minHeight: 44).disabled(!sync.canAddAnotherWorkout)
            .accessibilityLabel("Start \(workout.name)")
            .accessibilityIdentifier("today.scheduledAdditional.\(workout.id)")
        }
    }

    /// The workout the card over the list is showing says so; the others
    /// open in its place.
    private func selectionTitle(_ selected: Bool) -> String {
        guard selected else { return "Open" }
        return underCard ? "Shown above" : "Selected"
    }
}

/// "Add another workout" as the last plain row of the day's card
/// (app-design-pass P29), or the retry for one whose request is still out.
/// A day with nothing planned offers its own ways to train on the card and
/// keeps this in the + menu, so there it shows only the retry.
struct AddAnotherWorkoutLine: View {
    @ObservedObject var sync: SyncModel
    var retryOnly = false
    /// False when the row is the first thing on its card.
    var ruled = true
    @State private var adding = false

    var body: some View {
        // The stack stays put while the row inside it changes, so the sheet
        // survives the request going out.
        VStack(alignment: .leading, spacing: 0) {
            if sync.pendingAdditionalWorkout != nil {
                Button(sync.isAddingWorkout ? "Adding workout…" : "Retry adding workout") {
                    Task { _ = await sync.retryAddingWorkout() }
                }
                .disabled(!sync.canAddAnotherWorkout)
                .accessibilityIdentifier("today.retryAdditionalWorkout")
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
                .todayFootRow(ruled: ruled)
            } else if !retryOnly {
                Button { adding = true } label: {
                    Label("Add another workout", systemImage: "plus")
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
                .disabled(!sync.canAddAnotherWorkout)
                .accessibilityIdentifier("today.addAnotherWorkout")
                .todayFootRow(ruled: ruled)
            }
        }
        .sheet(isPresented: $adding) { AdditionalWorkoutPicker(sync: sync) }
    }
}

/// Today's Add another workout (app-design-pass P27): build a routine
/// right now from your own exercises or a suggestion you can change, follow
/// a freestyle workout, or start a saved one.
struct AdditionalWorkoutPicker: View {
    @ObservedObject var sync: SyncModel
    /// "Add a workout" from the + menu on a day with nothing planned.
    var title = "Add another workout"
    @Environment(\.dismiss) private var dismiss
    @State private var freestyle = false
    @State private var building: PlanComposer.HomeStart?
    /// A routine being saved or started from Build one now; the sheet
    /// stays put until it lands.
    @State private var routineBusy = false
    private let unit = RunDistanceUnit.preferred()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HomeStartChips(selected: nil, disabled: sync.isAddingWorkout) { building = $0 }
                } header: {
                    Text("Build one now")
                } footer: {
                    Text("Your own exercises, or a suggestion that's yours to change. It's saved to your workouts too.")
                }
                Section {
                    Button { freestyle = true } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Freestyle workout").foregroundStyle(Theme.text)
                            Text("Pick exercises as you go").font(.caption).foregroundStyle(Theme.muted)
                        }
                        .frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("additional.freestyle")
                }
                Section("Saved workouts") {
                    ForEach((sync.plan?.libraryWorkouts ?? []).filter { !$0.exercises.isEmpty }) { workout in
                        Button {
                            Task {
                                await RestCue.requestNotificationPermissionIfNeeded()
                                if await sync.addAnotherWorkout(workout.id) { dismiss() }
                            }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: PlanItemSummary.glyph(for: workout))
                                    .foregroundStyle(Theme.muted).frame(width: 24)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(workout.name).foregroundStyle(Theme.text)
                                    Text(PlanItemSummary.detail(for: workout, unit: unit))
                                        .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                                }
                            }
                            .frame(minHeight: 44)
                        }
                        .accessibilityIdentifier("additional.workout.\(workout.id)")
                    }
                }
                if let error = sync.loadError { Text(error).foregroundStyle(Theme.danger) }
            }
            .disabled(sync.isAddingWorkout)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(sync.isAddingWorkout) } }
            .navigationDestination(item: $building) { start in
                TodayRoutineBuilderView(sync: sync, start: start, isBusy: $routineBusy) { dismiss() }
            }
            .sheet(isPresented: $freestyle) {
                FreestyleExercisePicker(sync: sync, starting: true, additional: true, onStarted: { dismiss() })
            }
        }.interactiveDismissDisabled(sync.isAddingWorkout || routineBusy)
    }
}

/// A routine built and started right now from Today (P27): the same list as
/// Add to your week, then Start. It is saved to the library first, so the
/// new workout starts from a real saved workout and can be done again.
struct TodayRoutineBuilderView: View {
    @ObservedObject var sync: SyncModel
    /// Tells the sheet a save or start is in flight, so it can't be swiped
    /// away while the request is still out.
    @Binding var isBusy: Bool
    var onStarted: () -> Void
    @State private var home: HomeRoutineBuilder
    @State private var typedName = ""
    /// The save in flight, kept until it lands so a retry sends the same
    /// request and can't make a second routine.
    @State private var request: WorkoutPrescriptionRequest?
    /// Saved but not started yet: Start again only starts it.
    @State private var savedID: String?
    @State private var saving = false
    @State private var hadUncertainAttempt = false
    @State private var needsLibraryReview = false
    @FocusState private var nameFocused: Bool

    init(sync: SyncModel, start: PlanComposer.HomeStart, isBusy: Binding<Bool>,
         onStarted: @escaping () -> Void) {
        _sync = ObservedObject(wrappedValue: sync)
        _isBusy = isBusy
        _home = State(initialValue: HomeRoutineBuilder(start: start, catalog: sync.catalog))
        self.onStarted = onStarted
    }

    private var locked: Bool { request != nil || savedID != nil }
    private var busy: Bool { saving || sync.isAddingWorkout }
    private var autoName: String { PlanComposer.availableName(home.start.defaultName, in: sync.plan) }
    private var cleanTyped: String { typedName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var name: String { cleanTyped.isEmpty ? autoName : cleanTyped }
    private var takenBy: Workout? {
        guard !locked else { return nil }
        return PlannedActivity.existing(named: name, in: sync.plan)
    }
    private var canStart: Bool {
        !busy && !needsLibraryReview && sync.canAddAnotherWorkout && takenBy == nil
            && (locked || home.isReady)
    }

    var body: some View {
        List {
            HomeRoutineSections(builder: $home, catalog: sync.catalog, disabled: locked || busy) {
                nameFocused = false
            }
            Section {
                TextField(autoName, text: $typedName)
                    .textInputAutocapitalization(.sentences)
                    .submitLabel(.done)
                    .focused($nameFocused)
                    .disabled(locked || busy)
                    .accessibilityIdentifier("additional.routine.name")
            } header: {
                Text("Name · optional")
            } footer: {
                Text("Saved to your workouts, so you can do it again from Saved or rename it later.")
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Build a workout").navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(busy)
        .interactiveDismissDisabled(busy)
        .onChange(of: busy, initial: true) { _, now in isBusy = now }
        .onDisappear { isBusy = false }
        .safeAreaInset(edge: .bottom, spacing: 0) { startBar }
        .homeRoutineSheets(sync: sync, builder: $home)
    }

    private var startBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = sync.loadError {
                Text(error).font(.footnote).foregroundStyle(Theme.danger)
                if needsLibraryReview {
                    Text("The first try may have saved. Check Saved workouts before making it again.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
            }
            if let taken = takenBy {
                Text("You already have a workout named \(taken.name). Type another name.")
                    .font(.footnote).foregroundStyle(Theme.danger)
            }
            Button(busy ? "Starting…" : "Start") { start() }
                .buttonStyle(WorkoutPrimaryButtonStyle())
                .disabled(!canStart)
                .accessibilityIdentifier("additional.routine.start")
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(Theme.background)
    }

    private func start() {
        nameFocused = false
        if let savedID {
            saving = true
            Task {
                defer { saving = false }
                await begin(savedID)
            }
            return
        }
        guard let plan = sync.plan,
              let pending = request ?? home.routine.request(name: name, exercises: home.exercises,
                                                            planID: plan.id, version: plan.version)
        else { return }
        request = pending
        saving = true
        Task {
            defer { saving = false }
            switch await sync.saveWorkoutPrescription(request: pending) {
            case let .saved(receipt):
                savedID = receipt.workout_id
                self.request = nil
                await begin(receipt.workout_id)
            case .reviewDraft:
                // Rejected before saving: nothing was made, so a fresh
                // request may go once the screen shows the current plan.
                if hadUncertainAttempt { needsLibraryReview = true } else { self.request = nil }
            case .needsReview:
                needsLibraryReview = true
            case .retrySameRequest:
                hadUncertainAttempt = true
            }
        }
    }

    /// Starts the saved routine as today's next workout.
    private func begin(_ id: String) async {
        // Creation can be acknowledged while its refresh fails. Recover the
        // saved identity before starting it.
        if sync.workout(id: id) == nil { await sync.load() }
        guard sync.workout(id: id) != nil else {
            sync.loadError = "Your workout is saved, but couldn't be loaded to start it. Try again."
            return
        }
        await RestCue.requestNotificationPermissionIfNeeded()
        if await sync.addAnotherWorkout(id) { onStarted() }
    }
}
