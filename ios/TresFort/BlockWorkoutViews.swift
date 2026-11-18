import SwiftUI

/// The block's own workouts on the phone (docs/plans/progressive-plans P7,
/// after web-app P2): which workouts a block plans week by week, on which
/// days, and what carries on every week beside it. Every change is one
/// `PUT /api/plan/program` at the plan version on screen, through the same
/// `SyncModel.saveProgram` as the rest of the block.

/// Marks what comes from Your week inside a block.
struct EveryWeekTag: View {
    var body: some View {
        Text("EVERY WEEK")
            .font(Theme.mono(10, .bold)).foregroundStyle(Theme.muted)
            .padding(.horizontal, 5).padding(.vertical, 2)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 5))
            .accessibilityLabel("Every week")
    }
}

/// What a block's own workouts sheet or row was opened for.
struct BlockWorkoutTarget: Identifiable, Hashable {
    let workoutID: String
    /// The block week on screen, for its targets.
    let week: Int
    var id: String { workoutID }
}

/// "In this block": the block's own workouts with their days, and a way to
/// add one. For a block that never listed its workouts, one row asks which
/// workouts it plans.
struct BlockWorkoutRows: View {
    @ObservedObject var sync: SyncModel
    let program: PlanProgram
    let week: Int
    var onOpen: (BlockWorkoutTarget) -> Void
    var onAdd: () -> Void
    var onSort: () -> Void

    private var own: PlanProgram {
        BlockLayers.ownForm(program, schedule: BlockLayers.repeatingWeek(sync.plan))
    }

    var body: some View {
        if BlockLayers.isLayered(program) {
            ForEach(BlockLayers.workouts(own, plan: sync.plan)) { workout in
                let days = BlockLayers.days(own, workoutID: workout.id)
                Button { onOpen(BlockWorkoutTarget(workoutID: workout.id, week: week)) } label: {
                    HStack(spacing: 12) {
                        PlanItemBadge(glyph: PlanItemSummary.glyph(for: workout))
                            .accessibilityHidden(true)
                        Text(workout.name).font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(days.varies ? "Varies" : BlockLayers.daysLabel(days.days))
                            .font(Theme.mono(13)).foregroundStyle(Theme.muted)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(sync.isRoutineMutationInFlight)
                .accessibilityLabel("\(workout.name), \(days.varies ? "days differ by week" : BlockLayers.daysLabel(days.days))")
                .accessibilityHint("Change its days or take it out of the block")
                .accessibilityIdentifier("plan.block.workout.\(workout.id)")
            }
            Button(action: onAdd) {
                Label("Add a workout to the block", systemImage: "plus")
                    .font(Theme.mono(15, .bold))
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .disabled(sync.isRoutineMutationInFlight)
            .accessibilityIdentifier("plan.block.addWorkout")
        } else {
            Button(action: onSort) {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Choose the block's own workouts", systemImage: "checklist")
                        .font(Theme.mono(15, .bold))
                    Text("Then what you do every week carries on beside the block.")
                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .disabled(sync.isRoutineMutationInFlight)
            .accessibilityIdentifier("plan.block.sort")
        }
    }
}

/// One of the block's own workouts: its days in every week of the block,
/// its week targets, or out of the block.
struct BlockWorkoutSheet: View {
    @ObservedObject var sync: SyncModel
    let target: BlockWorkoutTarget
    @Environment(\.dismiss) private var dismiss
    @State private var targetEdit: ProgramTargetEditRequest?
    @State private var confirmRemove = false

    private var program: PlanProgram? { sync.plan?.program }
    private var own: PlanProgram? {
        program.map { BlockLayers.ownForm($0, schedule: BlockLayers.repeatingWeek(sync.plan)) }
    }
    private var workout: Workout? { sync.plan?.availableWorkouts.first { $0.id == target.workoutID } }
    private var days: (days: [String], varies: Bool) {
        own.map { BlockLayers.days($0, workoutID: target.workoutID) } ?? ([], false)
    }

    var body: some View {
        NavigationStack {
            List {
                if let own, let workout {
                    Section {
                        HStack(spacing: 6) {
                            ForEach(PlanSchedule.weekdayKeys, id: \.self) { day in dayToggle(day, own: own) }
                        }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    } header: {
                        Text("Days in every week of the block")
                    } footer: {
                        Text(daysFooter(own))
                    }
                    Section {
                        Button("Edit week \(target.week + 1) targets") {
                            targetEdit = ProgramTargetEditRequest(week: target.week, workoutID: workout.id)
                        }
                        .disabled(sync.isRoutineMutationInFlight)
                        .accessibilityIdentifier("plan.blockWorkout.targets")
                        ProgramTargetsWebLink(week: target.week)
                    }
                    Section {
                        Button("Remove from block", role: .destructive) { confirmRemove = true }
                            .disabled(sync.isRoutineMutationInFlight)
                            .accessibilityIdentifier("plan.blockWorkout.remove")
                    } footer: {
                        Text("It leaves every week of the block, with the targets the block gave it. It stays in Workouts.")
                    }
                } else {
                    Section { Text("This workout is no longer in the block.").foregroundStyle(Theme.muted) }
                }
                if let error = sync.loadError {
                    Section {
                        Text(error).foregroundStyle(Theme.danger)
                            .accessibilityIdentifier("plan.blockWorkout.error")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .sheet(item: $targetEdit) { request in ProgramTargetEditorSheet(sync: sync, request: request) }
            .confirmationDialog("Remove \(workout?.name ?? "this workout") from the block?",
                                isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("Remove from block", role: .destructive) { Task { await remove() } }
                Button("Cancel", role: .cancel) {}
            }
            .navigationTitle(workout?.name ?? "Workout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func dayToggle(_ day: String, own: PlanProgram) -> some View {
        let on = !days.varies && days.days.contains(day)
        let next = on ? days.days.filter { $0 != day } : PlanSchedule.weekdayKeys.filter { days.days.contains($0) || $0 == day }
        let blocked = next.isEmpty || !BlockLayers.fullDays(own, workoutID: target.workoutID, days: next).isEmpty
        let name = WorkoutLibraryPolicy.weekdayNames[day] ?? day
        return Button { Task { await place(on: next) } } label: {
            Text(String(name.prefix(3)))
                .font(Theme.mono(13, .bold))
                .frame(maxWidth: .infinity, minHeight: 44)
                .foregroundStyle(on ? Theme.bg : Theme.text)
                .background(on ? Theme.text : Theme.surface2, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .disabled(blocked || sync.isRoutineMutationInFlight)
        .accessibilityLabel(name)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("plan.blockWorkout.day.\(day)")
    }

    private func daysFooter(_ own: PlanProgram) -> String {
        var lines: [String] = []
        if days.varies {
            lines.append("The weeks differ now (\(BlockLayers.daysLabel(days.days))). Choosing a day puts it on the same days in all of them.")
        }
        let crowded = PlanSchedule.weekdayKeys.filter { BlockLayers.dayFull(own, day: $0, workoutID: target.workoutID) }
        if !crowded.isEmpty {
            lines.append("\(BlockLayers.daysLabel(crowded)) already \(crowded.count == 1 ? "has" : "have") five workouts in some weeks.")
        }
        if days.days.count == 1 && !days.varies { lines.append("To take it out of the block, choose Remove from block.") }
        lines.append("To change one week only, tap that day in the block.")
        return lines.joined(separator: " ")
    }

    private func place(on next: [String]) async {
        guard let plan = sync.plan, let own, !next.isEmpty else { return }
        let changed = BlockLayers.placing(own, workoutID: target.workoutID, on: next)
        guard changed != own else { return }
        await sync.saveProgram(changed, expectedVersion: plan.version)
    }

    private func remove() async {
        guard let plan = sync.plan, let own, let workout else { return }
        if await sync.saveProgram(BlockLayers.removing(own, workout: workout), expectedVersion: plan.version) {
            dismiss()
        }
    }
}

/// One more workout in the block: one Your week holds moves in on its days;
/// any other goes on the days chosen.
struct AddToBlockSheet: View {
    @ObservedObject var sync: SyncModel
    @Environment(\.dismiss) private var dismiss
    @State private var chosen: String?
    @State private var days: [String] = []

    private var program: PlanProgram? { sync.plan?.program }
    private var own: PlanProgram? {
        program.map { BlockLayers.ownForm($0, schedule: BlockLayers.repeatingWeek(sync.plan)) }
    }
    private var choices: [Workout] {
        guard let own else { return [] }
        let inBlock = Set(BlockLayers.workouts(own, plan: sync.plan).map(\.id))
        return (sync.plan?.libraryWorkouts ?? []).filter { !inBlock.contains($0.id) }
    }
    private var everyWeek: [String] {
        chosen.map { BlockLayers.everyWeekDays(BlockLayers.repeatingWeek(sync.plan), workoutID: $0) } ?? []
    }
    private var placing: [String] { everyWeek.isEmpty ? days : everyWeek }
    private var full: [String] {
        guard let own, let chosen else { return [] }
        return BlockLayers.fullDays(own, workoutID: chosen, days: placing)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(choices) { workout in
                        Button {
                            chosen = workout.id
                            days = []
                        } label: {
                            HStack {
                                PlanItemLabel(workout: workout, plan: sync.plan, showsWeekdays: true)
                                Spacer(minLength: 0)
                                if chosen == workout.id {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.text)
                                        .accessibilityHidden(true)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(chosen == workout.id ? .isSelected : [])
                        .accessibilityIdentifier("plan.addToBlock.workout.\(workout.id)")
                    }
                } header: {
                    Text("Workout")
                } footer: {
                    if choices.isEmpty { Text("Every saved workout is already in the block.") }
                }
                if chosen != nil {
                    Section {
                        if everyWeek.isEmpty {
                            HStack(spacing: 6) {
                                ForEach(PlanSchedule.weekdayKeys, id: \.self) { day in dayToggle(day) }
                            }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        } else {
                            Text(BlockLayers.daysLabel(everyWeek)).font(Theme.mono(15, .bold))
                        }
                    } header: {
                        Text("Days in every week of the block")
                    } footer: {
                        if !everyWeek.isEmpty {
                            Text("It is in Your week on \(BlockLayers.daysLabel(everyWeek)). It moves into the block on the same days, and leaves Your week.")
                        } else if !full.isEmpty {
                            Text("\(BlockLayers.daysLabel(full)) already \(full.count == 1 ? "has" : "have") five workouts in some weeks.")
                                .foregroundStyle(Theme.danger)
                        }
                    }
                    Section {
                        Button { Task { await add() } } label: {
                            Text("Add to block").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(WorkoutPrimaryButtonStyle())
                        .disabled(placing.isEmpty || !full.isEmpty || sync.isRoutineMutationInFlight)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        .accessibilityIdentifier("plan.addToBlock.save")
                    }
                }
                if let error = sync.loadError {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Add to the block")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func dayToggle(_ day: String) -> some View {
        let on = days.contains(day)
        let name = WorkoutLibraryPolicy.weekdayNames[day] ?? day
        return Button {
            days = on ? days.filter { $0 != day } : PlanSchedule.weekdayKeys.filter { days.contains($0) || $0 == day }
        } label: {
            Text(String(name.prefix(3)))
                .font(Theme.mono(13, .bold))
                .frame(maxWidth: .infinity, minHeight: 44)
                .foregroundStyle(on ? Theme.bg : Theme.text)
                .background(on ? Theme.text : Theme.surface2, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("plan.addToBlock.day.\(day)")
    }

    private func add() async {
        guard let plan = sync.plan, let own, let chosen, !placing.isEmpty, full.isEmpty else { return }
        let next = BlockLayers.adding(own, workoutID: chosen, on: placing)
        if await sync.saveProgram(next, expectedVersion: plan.version) { dismiss() }
    }
}

/// A block made before blocks kept their own workouts apart (or by an AI
/// coach or the event builder): say which workouts are the block's own.
struct SortBlockSheet: View {
    @ObservedObject var sync: SyncModel
    @Environment(\.dismiss) private var dismiss
    @State private var picked: [String]?

    private var program: PlanProgram? { sync.plan?.program }
    private var inBlock: [Workout] { program.map { BlockLayers.workouts($0, plan: sync.plan) } ?? [] }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Right now this block has its own copy of every day, so a change to Your week doesn't reach its weeks. Switch on the workouts the block plans week by week. They leave Your week; everything else carries on beside the block and follows Your week from then on.")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                }
                Section {
                    ForEach(inBlock) { workout in
                        Toggle(isOn: Binding(
                            get: { (picked ?? []).contains(workout.id) },
                            set: { on in
                                var next = (picked ?? []).filter { $0 != workout.id }
                                if on { next.append(workout.id) }
                                picked = next
                            }
                        )) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(workout.name).font(Theme.mono(15, .medium)).lineLimit(1)
                                if let program {
                                    Text(BlockLayers.daysLabel(BlockLayers.days(program, workoutID: workout.id).days)
                                         + ((picked ?? []).contains(workout.id) ? "" : " · every week"))
                                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                                }
                            }
                        }
                        .accessibilityIdentifier("plan.sortBlock.pick.\(workout.id)")
                    }
                } header: {
                    Text("What the block plans week by week")
                } footer: {
                    if dropsTargets {
                        Text("A workout switched off goes back to its own targets every week; the week-by-week targets this block gave it are removed.")
                    }
                }
                Section {
                    Button { Task { await save() } } label: {
                        Text("Keep these as the block's own").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(WorkoutPrimaryButtonStyle())
                    .disabled((picked ?? []).isEmpty || sync.isRoutineMutationInFlight)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    .accessibilityIdentifier("plan.sortBlock.save")
                }
                if let error = sync.loadError {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("The block's workouts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
            .onAppear {
                guard picked == nil, let program else { return }
                picked = BlockLayers.suggestedSorting(program, plan: sync.plan)
            }
        }
    }

    private var dropsTargets: Bool {
        guard let program else { return false }
        let targeted = Set(program.weeks.flatMap { ($0.targets ?? [:]).keys })
        return inBlock.contains { workout in
            !(picked ?? []).contains(workout.id) && workout.exercises.contains { targeted.contains($0.id) }
        }
    }

    private func save() async {
        guard let plan = sync.plan, let program, let picked, !picked.isEmpty else { return }
        let next = BlockLayers.sorting(program, picked: picked, plan: plan)
        if await sync.saveProgram(next, expectedVersion: plan.version) { dismiss() }
    }
}
