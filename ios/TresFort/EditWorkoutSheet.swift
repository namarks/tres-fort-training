import SwiftUI

private struct ExerciseEditTarget: Identifiable {
    let exercise: TemplateExercise
    let version: Int
    var id: String { exercise.id }
}

/// The presentation owns its draft so SwiftUI sheet remounts cannot discard edits.
private final class ExerciseGroupEditTarget: ObservableObject, Identifiable {
    let id: String
    @Published var draft: ExerciseGroupDraft
    @Published var pending: ExerciseGroupSubmission?
    @Published var needsReview = false

    init(id: String, planID: String, members: [TemplateExercise], slots: [TemplateExercise],
         version: Int, isExisting: Bool) {
        self.id = id
        draft = ExerciseGroupDraft(groupID: id, planID: planID, version: version,
            slots: slots, members: members, isExisting: isExisting)
    }
}

private struct ExerciseReplacementTarget: Identifiable {
    let exercise: TemplateExercise
    let version: Int
    var id: String { exercise.id }
}

/// Keep unfinished input local until Save. Never round or substitute a
/// default when the member enters an exact rest duration.
struct RestSecondsDraft {
    var text: String
    private let initialSeconds: Int

    init(seconds: Int) {
        text = String(seconds)
        initialSeconds = seconds
    }

    var seconds: Int? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.allSatisfy({ $0.isASCII && $0.isNumber }),
              let seconds = Int(clean), seconds >= 0 else { return nil }
        // The server permits longer rests. Keep a saved value unchanged so
        // editing reps or rounds cannot block or silently rewrite that rest.
        guard seconds <= 3_600 || seconds == initialSeconds else { return nil }
        return seconds
    }
}

struct RestSecondsField: View {
    let title: String
    @Binding var draft: RestSecondsDraft
    let identifier: String
    var isEditable = true
    var stackAtAccessibilitySizes = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var fieldWidth: CGFloat = 80

    var body: some View {
        let stacked = stackAtAccessibilitySizes && dynamicTypeSize.isAccessibilitySize
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        VStack(alignment: .leading, spacing: 6) {
            layout {
                Text(title).accessibilityHidden(true)
                if !stacked { Spacer(minLength: 12) }
                TextField("", text: $draft.text)
                    .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    .frame(width: fieldWidth).frame(minHeight: 44)
                    .accessibilityLabel(title)
                    .accessibilityIdentifier(identifier)
                    .disabled(!isEditable)
            }
            if isEditable && draft.seconds == nil {
                Text("Enter a rest from 0 to 3,600 seconds.")
                    .font(.footnote).foregroundStyle(Theme.danger)
            }
        }
    }
}

/// In-app workout editor (#1/#2). Lets you add / remove / reorder exercises in
/// today's workout — including a prescribed warm-up (e.g. a 5-min erg) — without
/// going to Claude. It edits the active plan's DAY TEMPLATE via the REST editor
/// endpoints, so a change shows up immediately and (for a warm-up) recurs on
/// that day. The member and coach share this one prescription; either can make
/// a later change without creating a separate manual-only workout.
///
/// Reads the live day off `sync` by id (not a captured snapshot) so the list
/// reflects edits the moment `sync.load()` returns.
struct EditWorkoutSheet: View {
    @ObservedObject var sync: SyncModel
    let dayID: String
    var onDone: (() -> Void)? = nil
    /// Pushed from workout details or the library: edit is a mode of that
    /// stack, so Done pops back to it instead of closing a sheet.
    var isPushed = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var adding = false
    @State private var addPresetWarmup = false
    @State private var editingExercise: ExerciseEditTarget?
    @State private var planningRun: ExerciseEditTarget?
    @State private var replacingExercise: ExerciseReplacementTarget?
    @State private var refreshing = false
    @State private var selectingGroup = false
    @State private var selectedSlots: Set<String> = []
    @State private var editingGroup: ExerciseGroupEditTarget?
    @State private var mutationWorking = false
    @State private var reordering = false
    @State private var removingExercise: ExerciseEditTarget?

    private var day: Workout? { sync.workout(id: dayID) }

    var body: some View {
        if isPushed {
            editor.navigationBarBackButtonHidden(true)
        } else {
            NavigationStack { editor }
        }
    }

    private var editor: some View {
        VStack(spacing: 0) {
            if let day {
                Text(day.one_time_date.map { "Edits apply to \(DateLabel.long($0)) only. Your saved workouts and your week stay as they are." }
                     ?? "Edits apply to this saved workout whenever you use it. Completed records stay unchanged.")
                    .font(.footnote).foregroundStyle(Theme.muted)
                    .padding(.horizontal, 16).padding(.vertical, 10)
            }
            if day == nil || sync.workoutEditorRefreshNeeded {
                refreshError(sync.loadError)
            }
            Group {
                if let day, !day.exercises.isEmpty {
                    list(day)
                } else {
                    emptyState
                }
            }
            .disabled(day == nil || sync.workoutEditorRefreshNeeded || mutationWorking)
        }
        .background(Theme.background)
        .navigationTitle(reordering ? "Reorder exercises" : day.map { "Edit \($0.name)" } ?? "Workout unavailable")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !reordering {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { if let onDone { onDone() } else { dismiss() } }.foregroundStyle(Theme.accent)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if reordering {
                    Button("Done") { reordering = false }
                        .accessibilityLabel("Done reordering")
                        .accessibilityIdentifier("editor.doneReordering")
                } else {
                    Menu {
                        Button { addPresetWarmup = false; adding = true } label: {
                            Label("Add exercise", systemImage: "plus")
                        }
                        Button { addPresetWarmup = true; adding = true } label: {
                            Label("Add warm-up", systemImage: "flame")
                        }
                        Button {
                            selectedSlots = []
                            selectingGroup = true
                        } label: {
                            Label("Group exercises", systemImage: "checkmark.circle")
                        }
                        Button {
                            reordering = true
                        } label: {
                            Label("Reorder exercises", systemImage: "arrow.up.arrow.down")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle").foregroundStyle(Theme.accent)
                    }
                    .accessibilityLabel("Workout actions")
                    .accessibilityIdentifier("editor.actions")
                    .disabled(day == nil || sync.workoutEditorRefreshNeeded || mutationWorking || selectingGroup)
                }
            }
        }
        .sheet(isPresented: $adding) {
            AddExerciseSheet(sync: sync, dayID: dayID, presetWarmup: addPresetWarmup)
        }
        .sheet(item: $editingExercise) { target in
            NavigationStack {
                EditExerciseTargetView(
                    sync: sync,
                    dayID: dayID,
                    slot: target.exercise, expectedVersion: target.version)
            }
        }
        .sheet(item: $planningRun) { target in
            NavigationStack {
                RunPlanEditorView(
                    sync: sync,
                    dayID: dayID,
                    slot: target.exercise, expectedVersion: target.version)
            }
        }
        .sheet(item: $replacingExercise) { target in
            ReplaceExerciseSheet(sync: sync, dayID: dayID, target: target)
        }
        .sheet(item: $editingGroup) { target in
            EditExerciseGroupSheet(sync: sync, dayID: dayID, target: target)
        }
        .alert("Remove \(removingExercise?.exercise.exercise_name ?? "exercise")?",
               isPresented: Binding(get: { removingExercise != nil }, set: { if !$0 { removingExercise = nil } }),
               presenting: removingExercise) { target in
            Button("Remove exercise", role: .destructive) { removeSlot(target.id, expectedVersion: target.version) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text(day?.isOneTime == true
                 ? "This removes the exercise from this day's workout. Previously logged sets stay in your history."
                 : "This removes the exercise from this saved workout. Previously logged sets stay in your history.")
        }
        .safeAreaInset(edge: .bottom) {
            if selectingGroup { selectionBar }
        }
        .onChange(of: sync.plan?.version) {
            selectedSlots = []
            selectingGroup = false
        }
    }

    private func refreshError(_ error: String?) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Workout details may be out of date.")
                    .font(Theme.mono(12, .bold))
                    .foregroundStyle(Theme.danger)
                Text(error ?? "Refresh to load the latest workout details.")
                    .font(Theme.mono(11))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            Button(refreshing ? "Refreshing…" : "Refresh") {
                refreshing = true
                Task {
                    await sync.load()
                    refreshing = false
                }
            }
            .font(Theme.mono(12, .bold))
            .foregroundStyle(Theme.accent)
            .disabled(refreshing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.surface)
        .accessibilityIdentifier("editWorkoutRefreshError")
    }

    private var selectionBar: some View {
        let actionsLayout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout())
        return VStack(spacing: 8) {
            Text("Choose two or more adjacent exercises.")
                .font(Theme.mono(12)).foregroundStyle(Theme.muted)
            actionsLayout {
                Button("Cancel selection") { selectingGroup = false; selectedSlots = [] }
                    .foregroundStyle(Theme.muted)
                    .frame(minHeight: 44)
                if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                Button("Group as superset") {
                    guard let plan = sync.plan, let day,
                          let members = ExerciseGroupBlock.selectedMembers(selectedSlots, in: day.exercises) else { return }
                    editingGroup = ExerciseGroupEditTarget(id: UUID().uuidString,
                        planID: plan.id, members: members, slots: day.exercises, version: plan.version, isExisting: false)
                }
                .font(Theme.mono(13, .bold)).foregroundStyle(Theme.accent)
                .frame(minHeight: 44)
                .disabled(day.flatMap { ExerciseGroupBlock.selectedMembers(selectedSlots, in: $0.exercises) } == nil
                          || sync.workoutEditorRefreshNeeded)
            }
            .frame(minHeight: 44)
        }
        .padding(16).background(Theme.surface)
    }

    private func list(_ day: Workout) -> some View {
        let blocks = ExerciseGroupBlock.blocks(day.exercises)
        return List {
            ForEach(blocks) { block in
                if block.isGroup {
                    groupCard(block)
                        .deleteDisabled(true)
                        .moveDisabled(!reordering)
                        .listRowBackground(Theme.surface)
                } else {
                    exerciseRow(block.members[0])
                        .deleteDisabled(true)
                        .moveDisabled(!reordering)
                        .listRowBackground(Theme.surface)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if !selectingGroup && !reordering {
                                Button("Remove", role: .destructive) {
                                    removingExercise = ExerciseEditTarget(exercise: block.members[0], version: sync.plan?.version ?? 0)
                                }
                            }
                        }
                }
            }
            .onMove { offsets, newOffset in
                guard let source = offsets.first, offsets.count == 1, let version = sync.plan?.version else { return }
                let moved = blocks[source]
                var reordered = blocks
                reordered.move(fromOffsets: offsets, toOffset: newOffset)
                guard let destination = ExerciseGroupBlock.slotDestination(of: moved.id, in: reordered),
                      destination != ExerciseGroupBlock.slotDestination(of: moved.id, in: blocks) else { return }
                mutationWorking = true
                Task {
                    if let groupID = moved.groupID {
                        _ = await sync.saveExerciseGroup(dayID: dayID, groupID: groupID,
                            memberIDs: moved.members.map(\.id), expectedVersion: version,
                            roundRest: moved.roundRest, transitionRest: moved.transitionRest,
                            targetSets: moved.rounds, orderIndex: destination)
                    } else {
                        await sync.moveSlot(dayID: dayID, teID: moved.members[0].id, toIndex: destination, expectedVersion: version)
                    }
                    mutationWorking = false
                }
            }
            if let error = sync.loadError, !sync.workoutEditorRefreshNeeded {
                Text(error).font(Theme.mono(12)).foregroundStyle(Theme.danger)
            }
        }
        .scrollContentBackground(.hidden)
        .environment(\.editMode, .constant(reordering ? .active : .inactive))
    }

    private func groupCard(_ block: ExerciseGroupBlock) -> some View {
        let headerLayout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout())
        return VStack(alignment: .leading, spacing: 12) {
            headerLayout {
                Text(block.title).font(Theme.mono(16, .bold)).foregroundStyle(Theme.accent)
                    .accessibilityIdentifier("editor.group.\(block.letter ?? "")")
                if block.isWarmup { WarmupTag() }
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
                Button {
                    guard let plan = sync.plan, let day, let groupID = block.groupID else { return }
                    editingGroup = ExerciseGroupEditTarget(id: groupID, planID: plan.id, members: block.members,
                        slots: day.exercises, version: plan.version, isExisting: true)
                } label: {
                    Text("Edit group")
                        .font(Theme.mono(12, .bold)).foregroundStyle(Theme.accent)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Edit \(block.title)")
                .disabled(selectingGroup || reordering)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("\(block.rounds) rounds")
                Text("Round rest: \(block.roundRest)s")
                Text("Transition rest: \(block.transitionRest)s")
            }
            .font(Theme.mono(12)).foregroundStyle(Theme.muted)
            ForEach(Array(block.members.enumerated()), id: \.element.id) { index, member in
                if index > 0 { Divider().overlay(Theme.dim.opacity(0.3)) }
                exerciseRow(member, label: block.memberLabel(at: index))
            }
        }
        .padding(.vertical, 6)
    }

    private func exerciseRow(_ ex: TemplateExercise, label: String? = nil) -> some View {
        HStack(spacing: 8) {
            if selectingGroup && ex.group_id == nil {
                Button {
                    if selectedSlots.contains(ex.id) { selectedSlots.remove(ex.id) }
                    else { selectedSlots.insert(ex.id) }
                } label: {
                    Image(systemName: selectedSlots.contains(ex.id) ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(Theme.accent).frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Select \(ex.exercise_name)")
                .accessibilityValue(selectedSlots.contains(ex.id) ? "Selected" : "Not selected")
                .accessibilityIdentifier("editor.select.\(ex.id)")
            }
            Button {
                let target = ExerciseEditTarget(exercise: ex, version: sync.plan?.version ?? 0)
                // A run's sets and loads don't apply; it opens its step plan instead.
                if ex.isOutdoorRun { planningRun = target } else { editingExercise = target }
            } label: {
                let layout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 10))
                layout {
                    if let label { Text(label).font(Theme.mono(13, .bold)).foregroundStyle(Theme.accent) }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(ex.exercise_name).font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                        Text(slotSummary(ex))
                            .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    }
                    if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                    if ex.isWarmup { WarmupTag() }
                    if !reordering && !selectingGroup && !dynamicTypeSize.isAccessibilitySize {
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.dim)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(selectingGroup || reordering)
            .accessibilityIdentifier("editor.slot.\(ex.id)")
            if !selectingGroup && !reordering {
                Menu {
                    // Steps stay on a run, so a run with steps can't become another exercise.
                    if ex.run_steps == nil {
                        Button("Replace with…", systemImage: "arrow.triangle.2.circlepath") {
                            guard let plan = sync.plan,
                                  let current = plan.workouts.first(where: { $0.id == dayID })?
                                    .exercises.first(where: { $0.id == ex.id }) else { return }
                            replacingExercise = ExerciseReplacementTarget(exercise: current, version: plan.version)
                        }
                    }
                    Button("Remove exercise", role: .destructive) {
                        removingExercise = ExerciseEditTarget(exercise: ex, version: sync.plan?.version ?? 0)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(Theme.accent).frame(width: 44, height: 44)
                }
                .disabled(selectingGroup)
                .accessibilityLabel("Options for \(ex.exercise_name)")
            }
        }
    }

    /// Targets and rest for a lift; a run's planned steps.
    private func slotSummary(_ ex: TemplateExercise) -> String {
        if ex.isOutdoorRun { return ex.runPrescriptionLabel(in: .preferred()) }
        return ex.group_id == nil ? "\(ex.targetLabel) · \(ex.rest_seconds)s rest" : ex.targetLabel
    }

    private func removeSlot(_ id: String, expectedVersion: Int) {
        mutationWorking = true
        Task {
            await sync.deleteSlot(dayID: dayID, teID: id, expectedVersion: expectedVersion)
            mutationWorking = false
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Text(day == nil ? "Workout not loaded" : "No exercises yet")
                .font(.title3.weight(.bold)).foregroundStyle(Theme.text)
            Text(day == nil ? "Refresh to load this workout, or close the editor if it was removed."
                 : "Use Workout actions to add an exercise or a warm-up.")
                .font(Theme.mono(13)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct EditExerciseGroupSheet: View {
    @ObservedObject var sync: SyncModel
    let dayID: String
    @ObservedObject var target: ExerciseGroupEditTarget
    @Environment(\.dismiss) private var dismiss
    @State private var working = false
    @State private var confirmingDiscard = false
    @State private var reviewVersion: Int?

    private var currentSlots: [TemplateExercise]? { sync.workout(id: dayID)?.exercises }
    private var stale: Bool {
        target.needsReview || sync.workoutEditorRefreshNeeded
            || sync.plan?.id != target.draft.planID || sync.plan?.version != target.draft.reviewedVersion
    }
    private var unavailable: String? {
        target.draft.unavailableReason(planID: sync.plan?.id, slots: currentSlots)
    }
    private var locked: Bool { working || target.pending != nil || !sync.canEditExerciseGroups }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(Array(target.draft.memberIDs.enumerated()), id: \.element) { index, id in
                        memberRow(id, index: index)
                    }
                } header: { Text("Exercises in order") } footer: {
                    Text("Removing an exercise from this group keeps it in your workout, immediately after the group. A group needs at least two exercises; use Ungroup to keep them all as separate exercises.")
                }
                .disabled(locked)
                if target.draft.isExisting {
                    Section("Add from this workout") {
                        ForEach(target.draft.availableMembers) { member in
                            Button {
                                target.draft.memberIDs.append(member.id)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Label(member.exercise_name, systemImage: "plus.circle")
                                    Text(target.draft.memberContext(member.id))
                                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                                }
                                .frame(minHeight: 44)
                            }
                            .accessibilityLabel("Add \(member.exercise_name). \(target.draft.memberContext(member.id))")
                            .accessibilityIdentifier("group.add.\(member.id)")
                        }
                        if target.draft.availableMembers.isEmpty {
                            Text("All eligible exercises are selected. Exercises in other groups cannot be added.")
                                .foregroundStyle(Theme.muted)
                        }
                    }
                    .disabled(locked)
                }
                Section {
                    Stepper("\(target.draft.rounds) rounds", value: $target.draft.rounds,
                            in: 1...target.draft.maximumRounds)
                        .accessibilityIdentifier("group.rounds")
                    RestSecondsField(title: "Between rounds · seconds", draft: $target.draft.roundRest,
                                     identifier: "group.roundRest", stackAtAccessibilitySizes: true)
                    RestSecondsField(title: "Between exercises · seconds", draft: $target.draft.transitionRest,
                                     identifier: "group.transitionRest", stackAtAccessibilitySizes: true)
                } footer: {
                    Text("Perform one set of each exercise per round. Transition rest is between exercises; round rest follows the last exercise. Individual rests are kept for ungrouping.")
                }
                .disabled(locked)
                if target.pending != nil && !working {
                    Section {
                        Text("The save could not be confirmed. Retry sends exactly the same group, order and targets.")
                        Button("Retry save") { submit(target.pending!) }
                            .frame(minHeight: 44).accessibilityIdentifier("group.retry")
                            .disabled(!sync.canEditExerciseGroups)
                    }
                } else if stale {
                    reviewSection
                }
                if let unavailable {
                    Section { Text(unavailable).foregroundStyle(Theme.danger) }
                }
                Section {
                    Button(working ? "Saving…" : "Save group") {
                        guard let request = target.draft.submission else { return }
                        submit(request)
                    }
                    .frame(minHeight: 44).accessibilityIdentifier("group.save")
                    .disabled(locked || stale || unavailable != nil || target.draft.submission == nil)
                    if target.draft.isExisting {
                        Button("Ungroup") {
                            submit(ExerciseGroupSubmission(memberIDs: [], expectedVersion: target.draft.reviewedVersion,
                                roundRest: 0, transitionRest: 0, rounds: 0, orderIndex: 0))
                        }
                        .frame(minHeight: 44).accessibilityIdentifier("group.ungroup")
                        .disabled(locked || stale || sync.plan?.id != target.draft.planID
                            || !(currentSlots?.contains { $0.group_id == target.id } ?? false))
                    }
                }
                if let error = sync.loadError {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
            }
            .readableColumn()
            .scrollContentBackground(.hidden).background(Theme.background)
            .navigationTitle(target.draft.isExisting ? "Edit group" : "New group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        if target.draft.isDirty || target.pending != nil { confirmingDiscard = true }
                        else { dismiss() }
                    }.disabled(working)
                }
            }
        }
        .interactiveDismissDisabled(working || target.draft.isDirty || target.pending != nil)
        .alert("Discard your changes?", isPresented: $confirmingDiscard) {
            Button("Keep editing", role: .cancel) { }
            Button("Discard changes", role: .destructive) { dismiss() }
        } message: {
            Text(target.pending == nil ? "Your unsaved group changes will be discarded."
                 : "The last save may have reached the server. Reopen the workout to check its saved group.")
        }
        .tint(Theme.accent)
    }

    private func memberRow(_ id: String, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(index + 1). \(target.draft.member(id)?.exercise_name ?? "Unavailable exercise")")
                .font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                .accessibilityIdentifier("group.member.\(id)")
            Text(target.draft.memberContext(id))
                .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                .accessibilityIdentifier("group.memberContext.\(id)")
            if target.draft.isExisting {
                HStack(spacing: 12) {
                    Button { target.draft.move(id, by: -1) } label: {
                        Image(systemName: "arrow.up").frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(index == 0).accessibilityLabel("Move \(target.draft.member(id)?.exercise_name ?? "exercise") \(index + 1) up")
                    .accessibilityIdentifier("group.up.\(id)")
                    Button { target.draft.move(id, by: 1) } label: {
                        Image(systemName: "arrow.down").frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(index == target.draft.memberIDs.count - 1).accessibilityLabel("Move \(target.draft.member(id)?.exercise_name ?? "exercise") \(index + 1) down")
                    .accessibilityIdentifier("group.down.\(id)")
                    Spacer(minLength: 0)
                    Button("Remove") { target.draft.memberIDs.removeAll { $0 == id } }
                        .frame(minHeight: 44).accessibilityLabel("Remove \(target.draft.member(id)?.exercise_name ?? "exercise") \(index + 1) from group")
                        .accessibilityIdentifier("group.remove.\(id)")
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private var reviewSection: some View {
        Section {
            Text("The workout changed. Your proposed members, order and targets are kept here.")
            if let slots = currentSlots, sync.plan?.id == target.draft.planID {
                Text("Currently saved group") .font(Theme.mono(13, .bold))
                ForEach(Array(slots.filter { $0.group_id == target.id }.enumerated()), id: \.element.id) { index, member in
                    Text("\(index + 1). \(ExerciseGroupDraft.reviewLabel(member, in: slots))")
                }
                if let first = slots.first(where: { $0.group_id == target.id }) {
                    Text("\(first.target_sets) rounds · \(first.group_rest_seconds ?? 0)s between rounds · \(first.group_transition_seconds ?? 0)s between exercises")
                        .foregroundStyle(Theme.muted)
                }
                Text("Your selection in the current workout").font(Theme.mono(13, .bold))
                ForEach(target.draft.memberIDs, id: \.self) { id in
                    if let current = slots.first(where: { $0.id == id }) {
                        Text(ExerciseGroupDraft.reviewLabel(current, in: slots))
                        if let before = target.draft.member(id), !ExerciseGroupDraft.sameIdentity(before, current) {
                            Text("Previously: \(before.exercise_name) · \(target.draft.memberContext(id))")
                                .foregroundStyle(Theme.muted)
                        }
                    } else {
                        Text("\(target.draft.member(id)?.exercise_name ?? "Selected exercise") is no longer available.")
                            .foregroundStyle(Theme.danger)
                    }
                }
            }
            if let reviewVersion, sync.plan?.version == reviewVersion, !sync.workoutEditorRefreshNeeded {
                Button("Keep my changes") {
                    guard let slots = currentSlots,
                          target.draft.review(planID: sync.plan?.id, version: reviewVersion, slots: slots) else { return }
                    target.needsReview = false
                    self.reviewVersion = nil
                }
                .frame(minHeight: 44).accessibilityIdentifier("group.keepChanges")
                .disabled(locked || sync.plan?.id != target.draft.planID
                    || (target.draft.isExisting && !(currentSlots?.contains { $0.group_id == target.id } ?? false)))
            } else {
                Button(working ? "Refreshing…" : "Review latest workout") {
                    working = true
                    Task { @MainActor in
                        await sync.loadAfterMutation()
                        working = false
                        guard sync.canEditExerciseGroups, !sync.workoutEditorRefreshNeeded,
                              sync.loadError == nil else { return }
                        reviewVersion = sync.plan?.version
                    }
                }
                .frame(minHeight: 44).accessibilityIdentifier("group.reviewLatest")
                .disabled(locked)
            }
        }
    }

    private func submit(_ request: ExerciseGroupSubmission) {
        guard sync.canEditExerciseGroups else { return }
        target.pending = request
        working = true
        Task { @MainActor in
            let result: ExerciseGroupWriteResult
            if request.isClear {
                result = await sync.clearExerciseGroupResult(dayID: dayID, groupID: target.id,
                    expectedVersion: request.expectedVersion)
            } else {
                result = await sync.saveExerciseGroupResult(dayID: dayID, groupID: target.id,
                    memberIDs: request.memberIDs, expectedVersion: request.expectedVersion,
                    roundRest: request.roundRest, transitionRest: request.transitionRest,
                    targetSets: request.rounds, orderIndex: request.orderIndex)
            }
            working = false
            guard sync.canEditExerciseGroups else { return }
            switch result {
            case .saved: dismiss()
            case .reviewRequired: target.pending = nil; target.needsReview = true; reviewVersion = nil
            case .retry: break
            case .unavailable: break
            }
        }
    }
}

private struct ReplaceExerciseSheet: View {
    @ObservedObject var sync: SyncModel
    let dayID: String
    let target: ExerciseReplacementTarget
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var selected: ExerciseCatalog?

    private var choices: [ExerciseCatalog] {
        ExerciseSearchPolicy.results(sync.catalog, query: query, region: .all)
            .filter { $0.id != target.exercise.exercise_id }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(target.exercise.exercise_name).font(Theme.mono(15, .bold))
                    Text("\(target.exercise.targetLabel) · \(target.exercise.rest_seconds)s rest")
                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                } footer: {
                    Text("Choose a movement, then review its targets before saving. Logged sets keep their original exercise.")
                }
                Section("Choose replacement") {
                    ForEach(choices) { exercise in
                        Button { selected = exercise } label: {
                            ExerciseCatalogLabel(exercise: exercise)
                        }
                        .accessibilityIdentifier("replacement.exercise.\(exercise.id)")
                    }
                    if choices.isEmpty { Text("No matching exercises.").foregroundStyle(Theme.muted) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .searchable(text: $query, prompt: "Search exercises")
            .navigationTitle("Replace with…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } }
            }
            .sheet(item: $selected) { exercise in
                NavigationStack {
                    EditExerciseTargetView(sync: sync, dayID: dayID, slot: target.exercise,
                        expectedVersion: target.version, replacement: exercise, onSaved: { dismiss() })
                }
            }
        }
        .tint(Theme.accent)
    }
}

/// Small "WARM-UP" pill used wherever a warm-up slot is shown.
struct WarmupTag: View {
    var body: some View {
        Text("WARM-UP")
            .font(Theme.mono(9, .bold)).tracking(1)
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(Theme.accent.opacity(0.15))
            .clipShape(Capsule())
    }
}

// MARK: - Add exercise (catalog picker → configure → add)

private struct AddExerciseSheet: View {
    @ObservedObject var sync: SyncModel
    let dayID: String
    let presetWarmup: Bool
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ExercisePickerList(sync: sync) { ex in
                NavigationLink {
                    ConfigureExerciseView(
                        sync: sync, dayID: dayID, exercise: ex,
                        presetWarmup: presetWarmup, onDone: { dismiss() })
                } label: {
                    ExerciseCatalogLabel(exercise: ex)
                }
            }
            .navigationTitle(presetWarmup ? "Add warm-up" : "Add exercise")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.muted)
                }
            }
        }
    }
}

private struct ConfigureExerciseView: View {
    private enum TargetMode: String, CaseIterable {
        case reps = "Reps"
        case hold = "Hold"
    }

    // Plain reference (not @ObservedObject): this view only *triggers* an edit
    // and dismisses; it doesn't re-render off sync's published state, so it
    // needs no observation — which also keeps the custom init wrapper-free.
    let sync: SyncModel
    let dayID: String
    let exercise: ExerciseCatalog
    let presetWarmup: Bool
    let onDone: () -> Void

    @State private var isWarmup: Bool
    @State private var sets = 3
    @State private var reps = 8
    @State private var repsMax = 12
    @State private var usesRepRange = false
    @State private var minutes = 5
    @State private var seconds = 45
    @State private var rest = RestSecondsDraft(seconds: 120)
    @State private var working = false
    @State private var expectedVersion: Int?
    @State private var targetMode: TargetMode
    @State private var load: SlotLoadDraft

    init(sync: SyncModel, dayID: String, exercise: ExerciseCatalog,
         presetWarmup: Bool, onDone: @escaping () -> Void) {
        self.sync = sync
        _expectedVersion = State(initialValue: sync.plan?.version)
        self.dayID = dayID
        self.exercise = exercise
        self.presetWarmup = presetWarmup
        self.onDone = onDone
        _isWarmup = State(initialValue: presetWarmup)
        _targetMode = State(initialValue: exercise.modality == "timed" ? .hold : .reps)
        // A new slot starts in the member's lb/kg choice with no target.
        let unit = WeightUnit(rawValue: UserDefaults.standard.string(forKey: WeightUnit.preferenceKey) ?? "") ?? .lb
        _load = State(initialValue: SlotLoadDraft(
            weight: nil, unit: unit, rpe: nil,
            allowsAssistance: exercise.modality == "bw" || exercise.modality == "timed"))
    }

    /// Cardio ergs (rowing/bike/ski, treadmill) are logged by minutes.
    private var isCardio: Bool { exercise.modality == "cardio" }
    /// Timed catalog rows are intrinsically holds. Until the slot schema has
    /// an explicit modality override, offering Reps would still execute them
    /// as seconds in TemplateExercise.isTimed.
    private var canChooseMeasure: Bool {
        ExercisePrescriptionPolicy.canChooseMeasure(for: exercise.modality)
    }
    private var isHold: Bool {
        exercise.modality == "timed" || targetMode == .hold
    }

    var body: some View {
        Form {
            Section {
                Toggle("Warm-up", isOn: $isWarmup)
                    .tint(Theme.accent)
            } header: {
                if let workout = sync.plan?.workouts.first(where: { $0.id == dayID }) {
                    Text("Saved workout · \(workout.name)")
                        .textCase(nil).accessibilityIdentifier("exercisePicker.savedWorkout")
                }
            } footer: {
                Text("Warm-up sets stay out of your working-set totals and session intensity.")
            }

            if isCardio {
                Section {
                    Stepper("\(minutes) min", value: $minutes, in: 1...60)
                } header: {
                    Text("Duration")
                } footer: {
                    if exercise.id == RunPlan.exerciseID {
                        Text("After adding the run, tap it in the workout to plan steps with pace or heart rate targets.")
                    }
                }
            } else if canChooseMeasure {
                Section("Measure") {
                    Picker("Measure", selection: $targetMode) {
                        ForEach(TargetMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }

            if !isCardio && isHold {
                Section("Hold") {
                    Stepper("\(sets) set\(sets == 1 ? "" : "s")", value: $sets, in: 1...10)
                    Stepper("\(seconds)s each", value: $seconds, in: 5...300, step: 5)
                }
            } else if !isCardio {
                Section("Target") {
                    Stepper("\(sets) set\(sets == 1 ? "" : "s")", value: $sets, in: 1...10)
                    Stepper((usesRepRange ? "\(reps) reps minimum" : "\(reps) reps")
                            + (exercise.laterality == "unilateral" ? " per side" : ""),
                            value: $reps, in: 1...30)
                    Toggle("Rep range", isOn: $usesRepRange)
                        .tint(Theme.accent)
                    if usesRepRange {
                        Stepper("Up to \(max(reps, repsMax)) reps"
                                + (exercise.laterality == "unilateral" ? " per side" : ""),
                                value: Binding(
                                    get: { max(reps, repsMax) },
                                    set: { repsMax = max(reps, $0) }),
                                in: reps...30)
                    }
                }
            }

            if !isCardio {
                SlotLoadSection(load: $load, allowsAssistance: load.allowsAssistance,
                                isPerHand: exercise.load_mode == "per_hand", defaultRPE: 8)
            }

            Section("Rest between sets") {
                RestSecondsField(title: "Between sets · seconds", draft: $rest,
                                 identifier: "slot.newRest")
            }

            Section {
                Button {
                    guard let restSeconds = rest.seconds else { return }
                    Task {
                        working = true
                        let durationS: Int? = isCardio ? minutes * 60 : (isHold ? seconds : nil)
                        let targetRepsMax = !isCardio && !isHold && usesRepRange
                            ? max(reps, repsMax)
                            : nil
                        let saved = await sync.addExerciseToDay(
                            dayID,
                            exercise: exercise.id,
                            isWarmup: isWarmup,
                            targetSets: isCardio ? 1 : sets,
                            targetReps: isCardio ? 1 : (isHold ? seconds : reps),
                            targetRepsMax: targetRepsMax,
                            restSeconds: restSeconds,
                            targetDurationS: durationS,
                            load: isCardio ? [:] : load.changedFields,
                            expectedVersion: expectedVersion)
                        working = false
                        if saved { onDone() }
                    }
                } label: {
                    Text(working ? "Adding…" : "Add to workout")
                        .font(Theme.mono(15, .bold))
                        .frame(maxWidth: .infinity)
                }
                .disabled(working || rest.seconds == nil || (!isCardio && !load.isValid))
            }

            if let error = sync.loadError {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(exercise.name)
        .navigationBarTitleDisplayMode(.inline)
        .tint(Theme.accent)
    }
}

enum ExercisePrescriptionPolicy {
    static let ordinaryRepUpperBound = 1_000

    static func canChooseMeasure(for modality: String) -> Bool {
        modality != "timed" && modality != "cardio"
    }

    static func initialEditableReps(
        targetReps: Int,
        isTimed: Bool,
        modality: String
    ) -> Int {
        if isTimed, canChooseMeasure(for: modality) { return 8 }
        return max(1, targetReps)
    }

    static func editableRepUpperBound(
        reps: Int,
        repsMax: Int?
    ) -> Int {
        max(ordinaryRepUpperBound, reps, repsMax ?? 0)
    }
}

// MARK: - Edit an existing prescription

private struct EditExerciseTargetView: View {
    @ObservedObject var sync: SyncModel
    let dayID: String
    let slot: TemplateExercise
    let sourceSlot: TemplateExercise
    let sourcePlanID: String?
    let replacement: ExerciseCatalog?
    let onSaved: (() -> Void)?
    @State private var reviewedVersion: Int
    @State private var confirmingDiscard = false
    @State private var reviewedAfterConflict = false
    @Environment(\.dismiss) private var dismiss

    @State private var isWarmup: Bool
    @State private var sets: Int
    @State private var reps: Int
    @State private var repsMax: Int
    @State private var usesRepRange: Bool
    @State private var usesHold: Bool
    @State private var seconds: Int
    @State private var rest: RestSecondsDraft
    @State private var load: SlotLoadDraft
    @State private var working = false
    private let repUpperBound: Int

    init(sync: SyncModel, dayID: String, slot source: TemplateExercise, expectedVersion: Int,
         replacement: ExerciseCatalog? = nil, onSaved: (() -> Void)? = nil) {
        self.sync = sync
        self.dayID = dayID
        self.sourceSlot = source
        self.sourcePlanID = sync.plan?.id
        self.replacement = replacement
        self.onSaved = onSaved
        let slot = replacement.map { ExerciseReplacementDraft.slot(source, with: $0) } ?? source
        self.slot = slot
        _reviewedVersion = State(initialValue: expectedVersion)
        let initialReps = ExercisePrescriptionPolicy.initialEditableReps(
            targetReps: slot.target_reps,
            isTimed: slot.isTimed,
            modality: slot.exercise_modality)
        let initialRepsMax = slot.isTimed
            ? initialReps
            : max(initialReps, slot.target_reps_max ?? initialReps)
        self.repUpperBound = ExercisePrescriptionPolicy.editableRepUpperBound(
            reps: initialReps,
            repsMax: initialRepsMax)
        _isWarmup = State(initialValue: slot.isWarmup)
        _sets = State(initialValue: max(1, slot.target_sets))
        _reps = State(initialValue: initialReps)
        _repsMax = State(initialValue: initialRepsMax)
        _usesRepRange = State(initialValue: !slot.isTimed && slot.target_reps_max != nil)
        _usesHold = State(initialValue: slot.isTimed)
        _seconds = State(initialValue: slot.holdSeconds)
        _rest = State(initialValue: RestSecondsDraft(seconds: slot.rest_seconds))
        _load = State(initialValue: SlotLoadDraft(slot: slot))
    }

    private var currentSlot: TemplateExercise? {
        sync.workout(id: dayID)?.exercises.first { $0.id == sourceSlot.id }
    }
    private var stale: Bool {
        sync.plan?.id != sourcePlanID || sync.plan?.version != reviewedVersion || sync.workoutEditorRefreshNeeded
    }
    private var canReviewLatest: Bool {
        guard sync.plan?.id == sourcePlanID, let currentSlot else { return false }
        return currentSlot.exercise_id == sourceSlot.exercise_id
            && currentSlot.group_id == sourceSlot.group_id
            && (!isGrouped || (currentSlot.target_sets == slot.target_sets
                && currentSlot.rest_seconds == slot.rest_seconds))
            && (replacement == nil || currentSlot.isWarmup == sourceSlot.isWarmup)
            && (replacement == nil || currentSlot.run_steps == nil)
    }
    private var isDirty: Bool {
        let initialReps = ExercisePrescriptionPolicy.initialEditableReps(
            targetReps: slot.target_reps, isTimed: slot.isTimed, modality: slot.exercise_modality)
        let initialMax = slot.isTimed ? initialReps : max(initialReps, slot.target_reps_max ?? initialReps)
        return replacement != nil || isWarmup != slot.isWarmup || sets != max(1, slot.target_sets)
            || reps != initialReps || repsMax != initialMax
            || usesRepRange != (!slot.isTimed && slot.target_reps_max != nil)
            || usesHold != slot.isTimed || seconds != slot.holdSeconds
            || rest.text != String(slot.rest_seconds) || !load.changedFields.isEmpty || !load.isValid
    }

    private var isGrouped: Bool { slot.group_id != nil }
    /// A grouped member's inactive ordinary rest belongs to the saved slot;
    /// editing its other targets must preserve that value for ungrouping.
    private var restToSave: Int? { isGrouped ? slot.rest_seconds : rest.seconds }
    private var isCardio: Bool { slot.exercise_modality == "cardio" }
    private var intrinsicallyTimed: Bool { slot.exercise_modality == "timed" }
    private var canChooseMeasure: Bool {
        ExercisePrescriptionPolicy.canChooseMeasure(for: slot.exercise_modality)
    }
    private var isHold: Bool { intrinsicallyTimed || usesHold }
    private var durationText: String {
        let minutes = seconds / 60
        let remainder = seconds % 60
        if minutes == 0 { return "\(seconds)s" }
        if remainder == 0 { return "\(minutes) min" }
        return "\(minutes)m \(remainder)s"
    }

    var body: some View {
        Form {
            if replacement != nil { replacementSummary }
            if stale { conflictReview }
            Section {
                Toggle("Warm-up", isOn: $isWarmup).tint(Theme.accent)
                    .disabled(replacement != nil)
            } footer: {
                Text("Warm-up sets stay out of working-set totals and session intensity.")
            }

            if isCardio {
                Section("Duration") {
                    Stepper("\(sets) \(isGrouped ? "rounds" : "sets")", value: $sets, in: 1...max(10, slot.target_sets))
                        .disabled(isGrouped)
                    Stepper(durationText, value: $seconds, in: 1...7_200, step: 15)
                }
            } else if canChooseMeasure {
                Section("Measure") {
                    Picker("Measure", selection: $usesHold) {
                        Text("Reps").tag(false)
                        Text("Hold").tag(true)
                    }
                    .pickerStyle(.segmented)
                }
            }

            if !isCardio && isHold {
                Section("Hold") {
                    Stepper("\(sets) \(isGrouped ? "rounds" : "sets")", value: $sets, in: 1...max(10, slot.target_sets))
                        .disabled(isGrouped)
                    Stepper("\(seconds)s each", value: $seconds, in: 1...7_200, step: 5)
                }
            } else if !isCardio {
                Section("Target") {
                    Stepper("\(sets) \(isGrouped ? "rounds" : "sets")", value: $sets, in: 1...max(10, slot.target_sets))
                        .disabled(isGrouped)
                    Stepper((usesRepRange ? "\(reps) reps minimum" : "\(reps) reps")
                            + (slot.isUnilateral ? " per side" : ""),
                            value: $reps, in: 1...repUpperBound)
                    Toggle("Rep range", isOn: $usesRepRange).tint(Theme.accent)
                    if usesRepRange {
                        Stepper(
                            "Up to \(max(reps, repsMax)) reps" + (slot.isUnilateral ? " per side" : ""),
                            value: Binding(
                                get: { max(reps, repsMax) },
                                set: { repsMax = max(reps, $0) }),
                            in: reps...repUpperBound)
                    }
                }
            }

            if slot.showsLoadControl { loadSection }

            Section {
                RestSecondsField(title: "Between sets · seconds", draft: $rest,
                                 identifier: "slot.ordinaryRest", isEditable: !isGrouped)
            } header: {
                Text(isGrouped ? "Individual rest · inactive" : "Rest between sets")
            } footer: {
                if isGrouped {
                    Text("Rounds and rest are set on the group. This individual rest returns when you ungroup.")
                }
            }

            Section {
                Button {
                    save()
                } label: {
                    Text(working ? "Saving…" : replacement == nil ? "Save targets" : "Save replacement")
                        .font(Theme.mono(15, .bold))
                        .frame(maxWidth: .infinity)
                }
                .disabled(working || stale || currentSlot == nil || restToSave == nil || !load.isValid)
            }

            if let error = sync.loadError {
                Section { Text(error).foregroundStyle(Theme.danger) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(slot.exercise_name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") {
                    if isDirty { confirmingDiscard = true } else { dismiss() }
                }.foregroundStyle(Theme.muted).disabled(working)
            }
        }
        .interactiveDismissDisabled(working || isDirty)
        .alert("Discard your changes?", isPresented: $confirmingDiscard) {
            Button("Discard changes", role: .destructive) { dismiss() }
            Button("Keep editing", role: .cancel) {}
        }
        .tint(Theme.accent)
    }

    private var replacementSummary: some View {
        Section("Review replacement") {
            Text("From: \(sourceSlot.exercise_name) · \(ExerciseReplacementDraft.summary(sourceSlot))")
            Text("\(ExerciseReplacementDraft.loadMeaning(sourceSlot)) → \(ExerciseReplacementDraft.loadMeaning(slot))")
                .font(.footnote).foregroundStyle(Theme.muted)
            if let replacement, ExerciseReplacementDraft.resetsLoad(sourceSlot, with: replacement) {
                Text("The load is cleared because this movement uses weight differently. Choose a target or leave it unspecified.")
                    .font(.footnote)
            }
            Text("Review all targets below. Week-specific exercise targets will reset to these saved targets; group rounds stay unchanged. Logged sets stay unchanged.")
                .font(.footnote).foregroundStyle(Theme.muted)
        }
    }

    private var conflictReview: some View {
        Section("Workout changed · draft kept") {
            if let currentSlot {
                Text("Currently saved: \(currentSlot.exercise_name) · \(ExerciseReplacementDraft.summary(currentSlot))")
                Text("Your proposed values are kept below. Review them against the current targets before saving.")
                    .font(.footnote).foregroundStyle(Theme.muted)
                if canReviewLatest && !sync.workoutEditorRefreshNeeded {
                    Button("Use my draft with these targets") {
                        if let version = sync.plan?.version { reviewedVersion = version; reviewedAfterConflict = true }
                    }
                    .disabled(working)
                } else {
                    Text("The exercise or group changed. Keep this draft open while reviewing it; close and reopen the editor to change the new exercise or group.")
                        .font(.footnote).foregroundStyle(Theme.danger)
                }
            } else {
                Text("This exercise is no longer in the workout. Your draft remains visible, but cannot be saved to a different exercise.")
                    .font(.footnote).foregroundStyle(Theme.danger)
            }
            if sync.workoutEditorRefreshNeeded {
                Button("Refresh current targets") {
                    working = true
                    Task { await sync.load(); working = false }
                }.disabled(working)
            }
        }
    }

    private var loadSection: some View {
        SlotLoadSection(load: $load, allowsAssistance: slot.allowsAssistance,
                        isPerHand: slot.isPerHand, defaultRPE: slot.target_rpe ?? 8)
    }

    private func save() {
        guard !stale, currentSlot != nil, load.isValid, let restSeconds = restToSave else { return }
        working = true
        Task {
            let durationS: Int? = (isCardio || isHold) ? seconds : nil
            let rangeMax = !isCardio && !isHold && usesRepRange
                ? max(reps, repsMax)
                : nil
            let saved: Bool
            if let replacement {
                var targets = load.reviewedFields
                targets["target_reps"] = isCardio ? slot.target_reps : (isHold ? seconds : reps)
                targets["target_reps_max"] = rangeMax.map { $0 as Any } ?? NSNull()
                targets["target_duration_s"] = durationS.map { $0 as Any } ?? NSNull()
                if !isGrouped {
                    targets["target_sets"] = sets
                    targets["rest_seconds"] = restSeconds
                }
                saved = await sync.replaceSlot(dayID: dayID, teID: slot.id, exercise: replacement.id,
                    targets: targets, expectedVersion: reviewedVersion)
            } else {
                saved = await sync.updateSlot(
                    dayID: dayID, teID: slot.id, isWarmup: isWarmup, targetSets: sets,
                    targetReps: isCardio ? slot.target_reps : (isHold ? seconds : reps),
                    targetRepsMax: rangeMax, restSeconds: restSeconds,
                    targetDurationS: durationS, load: reviewedAfterConflict ? load.reviewedFields : load.changedFields,
                    expectedVersion: reviewedVersion)
            }
            working = false
            if saved { if let onSaved { onSaved() } else { dismiss() } }
        }
    }
}

/// Target weight (in the slot's own lb or kg) and target effort, so a member
/// can prescribe a load without the coach, when adding or editing an exercise.
struct SlotLoadSection: View {
    @Binding var load: SlotLoadDraft
    let allowsAssistance: Bool
    let isPerHand: Bool
    let defaultRPE: Double

    var body: some View {
        Section {
            HStack(spacing: 12) {
                TextField("No target", text: $load.text)
                    .keyboardType(allowsAssistance ? .numbersAndPunctuation : .decimalPad)
                    .accessibilityLabel("Target weight in \(load.unit.rawValue)")
                    .accessibilityIdentifier("slot.targetWeight")
                WeightUnitPicker(selection: Binding(get: { load.unit }, set: { load.select($0) }),
                                 identifier: "slot.weightUnit")
                    .fixedSize()
            }
            if !load.isValid {
                Text(allowsAssistance ? "Enter a number, such as 20 or -20." : "Enter a weight of 0 or more.")
                    .font(.footnote).foregroundStyle(Theme.danger)
            }
            Toggle("Target effort (RPE)", isOn: Binding(
                get: { load.rpe != nil },
                set: { load.rpe = $0 ? defaultRPE : nil }))
                .tint(Theme.accent)
                .accessibilityIdentifier("slot.targetEffort")
            if let rpe = load.rpe {
                Stepper("RPE \(SetValueFormatter.number(rpe))",
                        value: Binding(get: { rpe }, set: { load.rpe = $0 }),
                        in: 1...10, step: 0.5)
                    .accessibilityIdentifier("slot.targetRPE")
            }
        } header: {
            Text(isPerHand ? "Weight · each hand" : "Weight")
        } footer: {
            Text(allowsAssistance
                 ? "Enter 0 for bodyweight, added load as a positive number and assistance as a negative one. Leave it empty to start from your last set."
                 : "Each set starts at this weight. Leave it empty to start from your last set.")
        }
    }
}
