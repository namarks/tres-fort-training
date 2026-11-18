import SwiftUI

/// The routine editor reloads after every plan-tree write, but an exercise or
/// name edit must not erase weekday choices that have not been saved yet.
/// Only a different plan identity or persisted weekday mapping resets them.
enum RoutineScheduleDraftPolicy {
    static func persistedIdentity(for plan: PlanTree?) -> [String] {
        guard let plan else { return [] }
        return [plan.id] + PlanSchedule.weekdayKeys.map {
            plan.schedule?.templateID(forWeekdayKey: $0) ?? ""
        }
    }

    static func persistedDraft(for plan: PlanTree?) -> [String: String] {
        guard let plan else { return [:] }
        return Dictionary(uniqueKeysWithValues: PlanSchedule.weekdayKeys.map {
            ($0, plan.schedule?.templateID(forWeekdayKey: $0) ?? "")
        })
    }

    static func reconcile(
        currentDraft: [String: String],
        loadedIdentity: [String],
        plan: PlanTree?
    ) -> (draft: [String: String], identity: [String]) {
        let identity = persistedIdentity(for: plan)
        guard identity == loadedIdentity else {
            return (persistedDraft(for: plan), identity)
        }
        let liveDayIDs = Set(plan?.availableWorkouts.map(\.id) ?? [])
        var draft = currentDraft
        for key in PlanSchedule.weekdayKeys {
            let dayID = draft[key] ?? ""
            if !dayID.isEmpty, !liveDayIDs.contains(dayID) {
                draft[key] = ""
            }
        }
        return (draft, identity)
    }
}

/// Decide whether the second half of routine bootstrap still needs to run.
/// `ensureActivePlan` is intentionally idempotent, so a retry after its
/// response or state refresh was lost returns `created == false`. An empty
/// ensured plan must still receive the requested first workout. The existing
/// plan-version CAS on `addWorkoutDay` makes concurrent retries converge on a
/// single day; a non-empty winner is only loaded, never appended to here.
enum RoutineCreationPolicy {
    static func shouldAddFirstDay(
        wasCreated: Bool,
        ensuredPlanID: String,
        loadedPlanID: String?,
        loadedDayCount: Int
    ) -> Bool {
        loadedPlanID == ensuredPlanID && (wasCreated || loadedDayCount == 0)
    }
}

/// The two sides of the Plan tab.
enum PlanSide: Hashable { case schedule, workouts }

/// Compact member-owned editor for the same plan tree and weekly schedule the
/// coach reads and edits. There is intentionally no separate "manual" plan.
/// It is the Plan tab's root, and the sheet Today opens to choose a workout.
/// Either way details and the editor push onto its one navigation stack.
struct WorkoutsView: View {
    @ObservedObject var sync: SyncModel
    var onStart: ((String) -> Void)? = nil
    var date: String? = nil
    /// The Plan tab: no Done, and two sides. Schedule is when you train;
    /// Workouts is what each saved workout contains.
    var isTabRoot = false
    /// Shows the workout on Today after the calendar starts one.
    var onShowWorkout: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss

    @State private var showArchivedWorkouts = false
    @State private var selectedTag = ""
    @State private var taggingDay: Workout?
    @State private var archivingDay: Workout?
    private var availableTags: [String] {
        Array(Set((sync.plan?.libraryWorkouts ?? []).flatMap(\.workoutTags))).sorted()
    }
    private var visibleWorkouts: [Workout] {
        let days = WorkoutLibraryPolicy.choices(plan: sync.plan, date: date ?? sync.todayString)
        return selectedTag.isEmpty ? days : days.filter { $0.workoutTags.contains(selectedTag) }
    }
    private var canReorder: Bool { selectedTag.isEmpty && date == nil
        && !(sync.plan?.trips.contains(where: { sync.todayString >= $0.start && sync.todayString <= $0.end }) ?? false) }
    @State private var renameDayName = ""
    @State private var addingDay = false
    @State private var renamingDay: Workout?
    @State private var deletingDay: Workout?
    @State private var detailTarget: IdentifiedString?
    @State private var editTarget: IdentifiedString?
    @State private var assignmentTarget: Workout?
    /// The weekday opened from Your week, and a workout it asked to open
    /// once it has closed.
    @State private var weekdayTarget: IdentifiedString?
    @State private var workoutAfterWeekday: String?
    @State private var showWeeklySchedule = false
    @State private var addingToWeek = false
    @State private var preparingWeek = false
    @State private var showCalendar = false
    @State private var showAwayDates = false
    @State private var planSide = PlanSide.schedule
    /// The block of weeks (P2): setup, the week shown, a day opened, and the
    /// week being renamed or the block being ended.
    @State private var showProgramSetup = false
    @State private var showEventBuild = false
    @State private var showKeepBuilding = false
    @State private var showBlockChooser = false
    /// The choice made in the chooser, opened once the chooser has closed.
    @State private var pickedBlockChoice: PlanBlockChoice?
    @State private var programWeek: Int?
    @State private var programDay: ProgramDayTarget?
    @State private var renamingProgramWeek: Int?
    @State private var programWeekLabel = ""
    @State private var endingProgram = false
    @State private var programTargetEdit: ProgramTargetEditRequest?
    /// The block's own workouts (P7): one opened, adding one, or choosing
    /// them for a block that never listed them.
    @State private var blockWorkout: BlockWorkoutTarget?
    @State private var addingToBlock = false
    @State private var sortingBlock = false
    /// Your week folds to one row while a block is in use; this opens it.
    @State private var showsYourWeek = false
    /// The tab stays put when a workout starts; the sheet closes.
    private var staysOpen: Bool { isTabRoot }

    var body: some View {
        Group {
            if let date {
                WorkoutDatePickerView(sync: sync, date: date)
            } else {
                NavigationStack { libraryContent }
            }
        }
    }

    // Split into small pieces so the type checker handles each chain quickly.
    private var libraryContent: some View {
        programDialogs(libraryDestinations(libraryDialogs(libraryBase)))
            .sheet(item: $assignmentTarget) { workout in
                WorkoutDateSheet(sync: sync, workout: workout)
            }
            .sheet(isPresented: $showWeeklySchedule) { WeeklyScheduleView(sync: sync) }
            .sheet(isPresented: $addingToWeek) {
                NavigationStack {
                    PlanComposerView(sync: sync, isRoot: true) { addingToWeek = false }
                }
            }
            .sheet(item: $weekdayTarget, onDismiss: {
                // Push only after the sheet is gone, onto the tab's own stack.
                if let id = workoutAfterWeekday {
                    workoutAfterWeekday = nil
                    detailTarget = IdentifiedString(id: id)
                }
            }) { target in
                WeekdayPlanSheet(sync: sync, weekdayKey: target.id) { id in
                    workoutAfterWeekday = id
                    weekdayTarget = nil
                }
            }
    }

    private var libraryBase: some View {
        Group {
            if sync.plan == nil && !sync.canCreateRoutine {
                PlanLoadRecoveryView(sync: sync)
            } else if isTabRoot {
                planHome
            } else {
                routineList
            }
        }
        .onChange(of: availableTags) { _, tags in
            if !tags.contains(selectedTag) { selectedTag = "" }
        }
        .background(Theme.background)
        .navigationTitle(isTabRoot ? "Plan" : date == nil ? "Workouts" : "Choose a workout")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { libraryToolbar }
    }

    @ToolbarContentBuilder private var libraryToolbar: some ToolbarContent {
        if !isTabRoot {
            ToolbarItem(placement: .topBarLeading) {
                Button("Done") { dismiss() }.foregroundStyle(Theme.accent)
            }
        }
        if (!isTabRoot || planSide == .workouts) && canReorder && visibleWorkouts.count > 1 {
            ToolbarItem(placement: .topBarTrailing) {
                EditButton().disabled(sync.isRoutineMutationInFlight)
            }
        }
        if isTabRoot {
            ToolbarItem(placement: .topBarTrailing) { ProfileButton() }
        }
    }

    private func libraryDialogs(_ content: some View) -> some View {
        content
            .sheet(isPresented: $addingDay) {
                CreateWorkoutView(sync: sync, onStart: onStart.map { start in
                    { id in
                        // The tab stays put and only its sheet closes.
                        if staysOpen { addingDay = false } else { dismiss() }
                        start(id)
                    }
                })
            }
            .alert("Rename workout", isPresented: Binding(
                get: { renamingDay != nil },
                set: { if !$0 { renamingDay = nil } }
            )) {
                TextField("Workout name", text: $renameDayName)
                Button("Save") { renameDay() }
                    .disabled(
                        sync.isRoutineMutationInFlight
                            || renameDayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Cancel", role: .cancel) { renamingDay = nil }
            }
            .alert(
                "Delete \(deletingDay?.name ?? "this workout")?",
                isPresented: Binding(
                    get: { deletingDay != nil },
                    set: { if !$0 { deletingDay = nil } }
                )
            ) {
                Button("Delete workout", role: .destructive) { deleteWorkout() }
                    .disabled(
                        sync.isRoutineMutationInFlight
                            || (sync.running && sync.selectedDayID == deletingDay?.id))
                Button("Cancel", role: .cancel) { deletingDay = nil }
            } message: {
                Text("Past sessions and logged sets stay in your history. Recurring weekdays using this workout become rest days.")
            }
            .sheet(item: $taggingDay) { workout in
                WorkoutTagsSheet(sync: sync, workout: workout)
            }
            .alert("Archive \(archivingDay?.name ?? "this workout")?", isPresented: Binding(
                get: { archivingDay != nil }, set: { if !$0 { archivingDay = nil } }
            )) {
                Button("Archive workout", role: .destructive) {
                    guard let day = archivingDay else { return }
                    archivingDay = nil
                    Task { await sync.setWorkoutArchived(dayID: day.id, archived: true) }
                }
                Button("Cancel", role: .cancel) { archivingDay = nil }
            } message: {
                Text("Completed workouts and logged sets stay in your history. Weekly and planned date assignments become rest. You can restore this workout later.")
            }
    }

    private func programDialogs(_ content: some View) -> some View {
        content
            .sheet(isPresented: $showBlockChooser, onDismiss: openPickedBlockChoice) {
                PlanBlockChooserSheet(hasBlock: sync.plan?.program != nil) { choice in
                    pickedBlockChoice = choice
                    showBlockChooser = false
                }
            }
            .sheet(item: $programTargetEdit) { request in ProgramTargetEditorSheet(sync: sync, request: request) }
            .sheet(item: $blockWorkout) { target in BlockWorkoutSheet(sync: sync, target: target) }
            .sheet(isPresented: $addingToBlock) { AddToBlockSheet(sync: sync) }
            .sheet(isPresented: $sortingBlock) { SortBlockSheet(sync: sync) }
            .sheet(isPresented: $showProgramSetup) { ProgramSetupSheet(sync: sync) }
            .sheet(isPresented: $showEventBuild) { EventBuildSheet(sync: sync) }
            .sheet(isPresented: $showKeepBuilding) { EventBuildSheet(sync: sync, keepBuilding: true) }
            .sheet(item: $programDay) { target in
                if let program = sync.plan?.program {
                    ProgramDaySheet(sync: sync, program: program, target: target)
                }
            }
            .alert("Name week \((renamingProgramWeek ?? 0) + 1)", isPresented: Binding(
                get: { renamingProgramWeek != nil }, set: { if !$0 { renamingProgramWeek = nil } }
            )) {
                TextField("Base, Build, Easy week, Taper", text: $programWeekLabel)
                Button("Save") {
                    guard let index = renamingProgramWeek else { return }
                    renamingProgramWeek = nil
                    editProgram { ProgramEditing.relabeling(week: index, to: programWeekLabel, in: $0) }
                }
                Button("Cancel", role: .cancel) { renamingProgramWeek = nil }
            }
            .confirmationDialog("End this block?", isPresented: $endingProgram, titleVisibility: .visible) {
                Button("End block", role: .destructive) {
                    guard let version = sync.plan?.version else { return }
                    Task { await sync.saveProgram(nil, expectedVersion: version) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(BlockLayers.isLayered(sync.plan?.program)
                     ? "The block's own workouts stop and what you do every week carries on. They stay in Workouts, and past workouts stay in your history."
                     : "Your week takes over again. Past workouts stay in your history.")
            }
    }

    /// One whole-block edit at the plan version on screen.
    private func editProgram(_ change: (PlanProgram) -> PlanProgram?) {
        guard let plan = sync.plan, let program = plan.program, let next = change(program),
              next != program else { return }
        Task { await sync.saveProgram(next, expectedVersion: plan.version) }
    }

    /// The block's week menu: name it, copy it over the next, grow or shrink
    /// the block, or end it.
    private func programMenu(_ program: PlanProgram, week: Int) -> some View {
        Menu {
            Button("Edit week targets") { programTargetEdit = ProgramTargetEditRequest(week: week) }
                .accessibilityIdentifier("plan.block.editTargets")
            Button("Make week lighter") { programTargetEdit = ProgramTargetEditRequest(week: week, lighter: true) }
                .accessibilityIdentifier("plan.block.lighten")
            Divider()
            Button {
                programWeekLabel = program.weeks[week].label ?? ""
                renamingProgramWeek = week
            } label: { Label("Name week \(week + 1)", systemImage: "character.cursor.ibeam") }
            if week < program.weeks.count - 1 {
                Button {
                    editProgram { ProgramEditing.copyingToNext(week: week, in: $0) }
                } label: { Label("Copy to week \(week + 2)", systemImage: "doc.on.doc") }
            }
            Button {
                editProgram { ProgramEditing.addingWeek(to: $0) }
                programWeek = program.weeks.count
            } label: { Label("Add a week", systemImage: "plus") }
            .disabled(program.weeks.count >= ProgramEditing.maxWeeks)
            if program.weeks.count > 1 {
                Button {
                    editProgram { ProgramEditing.removingLastWeek(from: $0) }
                    if week >= program.weeks.count - 1 { programWeek = program.weeks.count - 2 }
                } label: { Label("Remove the last week", systemImage: "minus") }
            }
            Divider()
            Button(role: .destructive) { endingProgram = true } label: {
                Label("End block", systemImage: "xmark.circle")
            }
        } label: {
            Label("Edit weeks", systemImage: "ellipsis.circle")
                .font(Theme.mono(14, .bold))
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
        }
        .disabled(sync.isRoutineMutationInFlight)
        .accessibilityIdentifier("plan.block.menu")
    }

    /// A section header that marks the one schedule in use today.
    private func scheduleHeader(_ title: String, inUse: Bool) -> some View {
        HStack(spacing: 6) {
            Text(title)
            if inUse {
                Text("· In use now").foregroundStyle(Theme.accent)
                    .accessibilityIdentifier("plan.inUseNow")
            }
        }
    }

    @ViewBuilder private func programSection(_ program: PlanProgram) -> some View {
        let week = min(max(programWeek ?? ProgramEditing.openingWeek(program, today: sync.todayString), 0),
                       program.weeks.count - 1)
        Section {
            if let event = sync.plan?.event,
               let line = EventBuilding.raceDayLine(event, program: program, today: sync.todayString) {
                Text(line)
                    .font(Theme.mono(12, .bold)).foregroundStyle(Theme.muted)
                    .accessibilityIdentifier("plan.block.raceDay")
            }
            ProgramWeekCard(sync: sync, program: program, selectedWeek: Binding(
                get: { week }, set: { programWeek = $0 }
            )) { programDay = $0 }
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            programMenu(program, week: week)
            ProgramTargetsWebLink(week: week)
        } header: {
            scheduleHeader(program.name ?? "Your block",
                           inUse: ProgramEditing.isInUse(program, today: sync.todayString))
        } footer: {
            Text(ProgramEditing.status(program, today: sync.todayString)
                 + (BlockLayers.isLayered(program)
                    ? " Tap a day to change the block's workouts for this week or this week and after."
                    : " Tap a day to change it for this week or this week and after."))
        }
        // What the block plans week by week, apart from what repeats every week.
        Section {
            BlockWorkoutRows(sync: sync, program: program, week: week,
                             onOpen: { blockWorkout = $0 },
                             onAdd: { addingToBlock = true },
                             onSort: { sortingBlock = true })
        } header: {
            Text("In this block")
        } footer: {
            if BlockLayers.isLayered(program) {
                Text("Every-week workouts carry on beside the block. Change them in Your week.")
            }
        }
    }

    private func libraryDestinations(_ content: some View) -> some View {
        content
            .navigationDestination(item: $detailTarget) { target in
                WorkoutDetailsView(sync: sync, workoutID: target.id, date: date,
                                   onStart: onStart.map { start in
                    { id in
                        // The tab stays put for next time; a sheet closes.
                        if staysOpen { detailTarget = nil } else { dismiss() }
                        start(id)
                    }
                }, isPushed: true)
            }
            .navigationDestination(item: $editTarget) { target in
                EditWorkoutSheet(sync: sync, dayID: target.id, isPushed: true)
            }
            .navigationDestination(isPresented: $showCalendar) {
                HistoryView(sync: sync, onStartWorkout: {
                    showCalendar = false
                    onShowWorkout?()
                })
            }
            .navigationDestination(isPresented: $showAwayDates) { AwayDatesView(sync: sync) }
            .navigationDestination(isPresented: $showArchivedWorkouts) { ArchivedWorkoutsView(sync: sync) }
    }

    private var archivedCount: Int {
        sync.plan?.workouts.filter(\.isArchived).count ?? 0
    }

    /// The Plan tab. Schedule answers when you train: the repeating week with
    /// the one action that changes it, the calendar and away dates. Workouts
    /// answers what you do: the saved workouts and making a new one.
    private var planHome: some View {
        List {
            Section {
                Picker("Plan", selection: $planSide) {
                    Text("Schedule").tag(PlanSide.schedule)
                    Text("Workouts").tag(PlanSide.workouts)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("plan.side")
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
            if planSide == .schedule {
                scheduleSections
            } else {
                workoutsSection
                archivedSection
            }
            if let error = sync.loadError {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
        }
        .scrollContentBackground(.hidden)
    }

    @ViewBuilder private var scheduleSections: some View {
        let program = sync.plan?.program
        let blockInUse = program.map { ProgramEditing.isInUse($0, today: sync.todayString) } ?? false
        // Exactly one schedule is in use on any day: it leads, marked so.
        if let program, blockInUse {
            programSection(program)
            if !showsYourWeek { foldedYourWeek(program) }
        }
        if !blockInUse || showsYourWeek { yourWeekSection(program, blockInUse: blockInUse) }
        if let program, !blockInUse { programSection(program) }
        if FirstRunSetup.hasWeek(sync.plan), program == nil { nextStepsSection }
        Section {
            // Every day opens on its own. This edits all seven at once.
            if !(sync.plan?.libraryWorkouts.isEmpty ?? true) {
                planLink("Edit all days", systemImage: "calendar.day.timeline.left", id: "library.weeklySchedule") {
                    showWeeklySchedule = true
                }
                .disabled(sync.isRoutineMutationInFlight || sync.plan == nil)
            }
            if !(sync.plan?.libraryWorkouts.isEmpty ?? true),
               !FirstRunSetup.hasWeek(sync.plan) || program != nil {
                // One way in to every kind of block: your own mix first, the
                // run builders as starting points, and a coach prompt.
                planLink("Plan a block", systemImage: "rectangle.split.3x1", id: "plan.planBlock") {
                    showBlockChooser = true
                }
                .disabled(sync.isRoutineMutationInFlight || sync.plan == nil)
            }
            planLink("Calendar", systemImage: "calendar", id: "plan.calendar") { showCalendar = true }
            planLink("Away dates", systemImage: "airplane",
                     detail: nextAwayDates.map(AwayDatesText.range), id: "plan.awayDates") {
                showAwayDates = true
            }
            .disabled(sync.plan == nil)
        }
    }

    private var nextStepsSection: some View {
        Section {
            Text("Your week repeats until you change it. Keep using it for as long as it works for you.")
                .font(.subheadline).foregroundStyle(Theme.muted)
            Text("When you want different weeks, a training block starts from this routine. Choose each week's workouts in the app. Use the web block editor for week-specific sets, reps, load and time, including easier weeks. Review the targets before training.")
                .font(.subheadline).foregroundStyle(Theme.muted)
            planLink("Explore a training block", systemImage: "rectangle.split.3x1", id: "plan.planBlock") {
                showBlockChooser = true
            }
            .disabled(sync.isRoutineMutationInFlight)
            ProgramTargetsWebLink(hasBlock: false)
            planLink("Adjust saved workout targets", systemImage: "slider.horizontal.3", id: "plan.nextSteps.workouts") {
                planSide = .workouts
            }
        } header: {
            Text("Build on your week")
        } footer: {
            Text("Saved workout edits apply whenever that workout is used. Block targets apply to their weeks. Opening either editor leaves your plan unchanged until you save.")
        }
    }

    /// Your week: the repeating week, used whenever no block is in use.
    @ViewBuilder private func yourWeekSection(_ program: PlanProgram?, blockInUse: Bool) -> some View {
        Section {
            PlanWeekSummary(sync: sync) { day in
                withWeekPlan { weekdayTarget = IdentifiedString(id: day) }
            }
                .disabled(preparingWeek || sync.isRoutineMutationInFlight)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            // One sheet adds a run, lift, sport or saved workout to any days.
            Button { withWeekPlan { addingToWeek = true } } label: {
                if preparingWeek {
                    ProgressView().tint(Theme.onSignal)
                } else {
                    Label("Add to your week", systemImage: "plus")
                }
            }
            .buttonStyle(WorkoutPrimaryButtonStyle())
            .disabled(preparingWeek || sync.isRoutineMutationInFlight)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            .accessibilityIdentifier("plan.add")
            if blockInUse {
                Button("Hide Your week") { showsYourWeek = false }
                    .font(Theme.mono(14, .bold)).foregroundStyle(Theme.muted)
                    .accessibilityIdentifier("plan.yourWeek.hide")
            }
        } header: {
            scheduleHeader("Your week", inUse: program != nil && !blockInUse)
        } footer: {
            if let program {
                Text(blockInUse
                     ? ProgramEditing.yourWeekWhileInUse(program)
                        + (BlockLayers.isLayered(program) ? ". Tap a day to change it." : ". A new block starts from it.")
                     : ProgramEditing.yourWeekBesideBlock(program, today: sync.todayString))
            } else {
                Text("Tap a day to swap it, or Add to put something new on one or more days. To change a single date, use the calendar.")
            }
        }
    }

    /// Viewing an empty week is read-only. An explicit Add or weekday tap
    /// creates the missing plan, using the same bootstrap as first-run setup.
    private func withWeekPlan(_ open: @escaping () -> Void) {
        guard !preparingWeek, !sync.isRoutineMutationInFlight else { return }
        if sync.plan != nil { open(); return }
        guard sync.canCreateRoutine else { return }
        preparingWeek = true
        Task {
            defer { preparingWeek = false }
            guard await sync.ensureRoutinePlan(name: "My Training") != nil, sync.plan != nil else { return }
            open()
        }
    }

    /// Your week as one row while a block is in use, saying when it applies.
    private func foldedYourWeek(_ program: PlanProgram) -> some View {
        Section {
            Button { showsYourWeek = true } label: {
                HStack(spacing: 12) {
                    Image(systemName: "calendar").foregroundStyle(Theme.muted).frame(width: 30)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Your week").font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                        Text(ProgramEditing.yourWeekWhileInUse(program))
                            .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("plan.yourWeek.folded")
        }
    }

    private func openPickedBlockChoice() {
        guard let choice = pickedBlockChoice else { return }
        pickedBlockChoice = nil
        switch choice {
        case .ownWeek: showProgramSetup = true
        case .event: showEventBuild = true
        case .keepBuilding: showKeepBuilding = true
        }
    }

    private func planLink(_ title: String, systemImage: String, detail: String? = nil,
                          id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Label(title, systemImage: systemImage)
                    .font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                Spacer()
                if let detail {
                    Text(detail).font(Theme.mono(13)).foregroundStyle(Theme.muted)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    /// The workout library sheet Today opens.
    private var routineList: some View {
        List {
            workoutsSection
            archivedSection

            if let error = sync.loadError {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
        }
        .scrollContentBackground(.hidden)
    }

    @ViewBuilder private var archivedSection: some View {
        if date == nil && archivedCount > 0 {
            Section {
                Button { showArchivedWorkouts = true } label: {
                    HStack(spacing: 12) {
                        Label("Archived workouts", systemImage: "archivebox")
                            .font(Theme.mono(13, .bold)).foregroundStyle(Theme.text)
                        Spacer()
                        Text("\(archivedCount)")
                            .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("library.archived")
            } footer: {
                Text("Workouts you put away. Restore one to use it again.")
            }
        }
    }

    @ViewBuilder private var workoutsSection: some View {
        Section {
            if !availableTags.isEmpty {
                Picker("Tag", selection: $selectedTag) {
                    Text("All tags").tag("")
                    ForEach(availableTags, id: \.self) { Text($0).tag($0) }
                }
                .accessibilityIdentifier("library.tagFilter")
            }
            if visibleWorkouts.isEmpty {
                Text(selectedTag.isEmpty ? "Choose exercises to build a workout." : "No workouts with this tag.")
                    .font(Theme.mono(12)).foregroundStyle(Theme.muted)
            } else {
                ForEach(visibleWorkouts) { day in
                    HStack(spacing: 0) {
                        Button {
                            detailTarget = IdentifiedString(id: day.id)
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(day.name)
                                        .font(Theme.mono(15, .bold))
                                        .foregroundStyle(Theme.text)
                                    Text(WorkoutLibraryPolicy.scheduleBadge(workoutID: day.id, plan: sync.plan))
                                        .font(Theme.mono(10, .bold)).foregroundStyle(Theme.accent)
                                        .accessibilityIdentifier("workoutSchedule-\(day.id)")
                                    if !day.workoutTags.isEmpty {
                                        Text(day.workoutTags.joined(separator: " · "))
                                            .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                                            .accessibilityIdentifier("workoutTags-\(day.id)")
                                    }
                                    Text(WeekdayPlanSheet.detail(for: day))
                                        .font(Theme.mono(11)).foregroundStyle(Theme.muted)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.muted)
                                    .accessibilityHidden(true)
                            }
                            .padding(.leading, 16)
                            .padding(.trailing, 8)
                            .padding(.vertical, 14)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("library.workout.\(day.id)")
                        .accessibilityHint("Opens workout details")
                        .disabled(sync.isRoutineMutationInFlight)

                        Menu {
                            Button("Edit tags", systemImage: "tag") { taggingDay = day }
                            Button("Use on a date", systemImage: "calendar.badge.plus") {
                                assignmentTarget = day
                            }
                            Button("Unschedule", systemImage: "calendar.badge.minus") {
                                Task { await sync.unscheduleWorkout(workoutID: day.id) }
                            }
                            .disabled(!WorkoutLibraryPolicy.isScheduled(workoutID: day.id, plan: sync.plan))
                            Button("Archive workout", systemImage: "archivebox") { archivingDay = day }
                                .disabled(sync.running && sync.selectedDayID == day.id)
                            Button("Edit exercises") {
                                editTarget = IdentifiedString(id: day.id)
                            }
                            Button("Rename") {
                                renameDayName = day.name
                                renamingDay = day
                            }
                            Button("Delete workout", role: .destructive) {
                                deletingDay = day
                            }
                            .disabled(sync.running && sync.selectedDayID == day.id)
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .font(.system(size: 18))
                                .foregroundStyle(Theme.muted)
                                .frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .padding(.trailing, 4)
                        .disabled(sync.isRoutineMutationInFlight)
                        .accessibilityLabel("Actions for \(day.name)")
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Theme.surface)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        // Confirm first; a destructive swipe role would animate
                        // the row away before the member chooses to delete it.
                        Button {
                            deletingDay = day
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        .tint(.red)
                        .disabled(sync.isRoutineMutationInFlight
                            || (sync.running && sync.selectedDayID == day.id))
                    }
                    .moveDisabled(sync.isRoutineMutationInFlight || !canReorder)
                }
                .onMove(perform: moveDays)
            }

            Button {
                addingDay = true
            } label: {
                Label("Add workout", systemImage: "plus.circle.fill")
                    .font(Theme.mono(13, .bold))
                    .foregroundStyle(Theme.accent)
            }
            .disabled(sync.isRoutineMutationInFlight)
            // The Plan tab edits the week on its Schedule side. The library
            // sheet keeps this route to the same editor.
            if !isTabRoot {
                Button {
                    showWeeklySchedule = true
                } label: {
                    Label("Weekly schedule", systemImage: "calendar.badge.clock")
                        .font(Theme.mono(13, .bold))
                        .foregroundStyle(Theme.accent)
                }
                .disabled(sync.isRoutineMutationInFlight || sync.plan == nil)
                .accessibilityIdentifier("library.weeklySchedule")
            }
        } header: {
            Text("Workouts")
        } footer: {
            Text("Saved workouts you can put on any day. Open one to view its exercises, start it, or edit it.")
        }
    }

    private var nextAwayDates: PlanTrip? {
        sync.plan?.awayDates.first { $0.end >= sync.todayString }
    }

    private func renameDay() {
        guard !sync.isRoutineMutationInFlight, let day = renamingDay else { return }
        let name = renameDayName
        renamingDay = nil
        Task { await sync.renameWorkoutDay(dayID: day.id, name: name) }
    }

    private func deleteWorkout() {
        guard !sync.isRoutineMutationInFlight, let day = deletingDay else { return }
        deletingDay = nil
        Task { await sync.deleteWorkoutDay(dayID: day.id) }
    }

    private func moveDays(from offsets: IndexSet, to destination: Int) {
        guard !sync.isRoutineMutationInFlight,
              let source = offsets.first,
              canReorder,
              let days = sync.plan?.libraryWorkouts,
              days.indices.contains(source)
        else { return }
        var reordered = days
        let movedID = days[source].id
        reordered.move(fromOffsets: offsets, toOffset: destination)
        guard let target = reordered.firstIndex(where: { $0.id == movedID }) else { return }
        let remaining = (sync.plan?.workouts ?? []).filter { $0.id != movedID }
        let following = reordered.dropFirst(target + 1).first
        let fullIndex = following.flatMap { next in remaining.firstIndex { $0.id == next.id } } ?? remaining.count
        Task { await sync.moveWorkoutDay(dayID: movedID, toIndex: fullIndex) }
    }
}
