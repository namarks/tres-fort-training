import SwiftUI

/// One weekday of one block week, opened to change it.
struct ProgramDayTarget: Identifiable, Hashable {
    let week: Int
    let weekdayKey: String
    var id: String { "\(week).\(weekdayKey)" }
}

/// The block of weeks at the top of the Plan tab's Schedule side (P2):
/// "Week 6 of 16 · Build", a strip of the weeks, a stepper and the chosen
/// week's days. Tapping a day opens it; the week's own actions sit in a menu.
struct ProgramWeekCard: View {
    @ObservedObject var sync: SyncModel
    let program: PlanProgram
    @Binding var selectedWeek: Int
    var onDay: (ProgramDayTarget) -> Void

    private var today: String { sync.todayString }
    private var currentWeek: Int? {
        if case .current(let index) = ProgramEditing.position(of: program, today: today) { return index }
        return nil
    }
    private var week: Int { min(max(selectedWeek, 0), program.weeks.count - 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            strip
            VStack(spacing: 0) {
                ForEach(ProgramEditing.rows(program, week: week, plan: sync.plan)) { row in
                    Button { onDay(ProgramDayTarget(week: week, weekdayKey: row.weekdayKey)) } label: {
                        line(row)
                    }
                    .buttonStyle(.plain)
                    .disabled(sync.isRoutineMutationInFlight)
                    .accessibilityLabel(spoken(row))
                    .accessibilityHint("Change this day")
                    .accessibilityIdentifier("plan.block.day.\(row.weekdayKey)")
                }
            }
        }
        .padding(.vertical, 10)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 8) {
            Button { selectedWeek = max(week - 1, 0) } label: {
                Image(systemName: "chevron.left").font(.system(size: 15, weight: .bold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(week > 0 ? Theme.text : Theme.dim)
            .disabled(week == 0)
            .accessibilityLabel("Previous week")
            .accessibilityIdentifier("plan.block.previous")
            VStack(spacing: 2) {
                Text(ProgramEditing.heading(program, week: week, today: today))
                    .font(Theme.mono(15, .bold)).foregroundStyle(Theme.text)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("plan.block.heading")
                if let start = ProgramEditing.weekStart(program, index: week, today: today) {
                    Text(week == currentWeek ? "This week · from \(ProgramEditing.spokenDate(start))"
                                             : "From \(ProgramEditing.spokenDate(start))")
                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            Button { selectedWeek = min(week + 1, program.weeks.count - 1) } label: {
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(week < program.weeks.count - 1 ? Theme.text : Theme.dim)
            .disabled(week >= program.weeks.count - 1)
            .accessibilityLabel("Next week")
            .accessibilityIdentifier("plan.block.next")
        }
        .padding(.horizontal, 8)
    }

    private var strip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(program.weeks.indices, id: \.self) { index in
                        Button { selectedWeek = index } label: { chip(index) }
                            .buttonStyle(.plain)
                            .id(index)
                            .accessibilityLabel(chipLabel(index))
                            .accessibilityAddTraits(index == week ? .isSelected : [])
                            .accessibilityIdentifier("plan.block.week.\(index + 1)")
                    }
                }
                .padding(.horizontal, 16)
            }
            .onAppear { proxy.scrollTo(week, anchor: .center) }
            .onChange(of: week) { _, value in withAnimation { proxy.scrollTo(value, anchor: .center) } }
        }
    }

    private func chip(_ index: Int) -> some View {
        let selected = index == week
        // Orange marks where you are: this week of the block.
        let isNow = index == currentWeek
        return VStack(spacing: 2) {
            Text("\(index + 1)").font(Theme.mono(13, .bold))
            Text(ProgramEditing.chip(program, week: index)).font(Theme.mono(10))
                .lineLimit(1)
        }
        .frame(minWidth: 44, minHeight: 44)
        .padding(.horizontal, 4)
        .foregroundStyle(selected ? Theme.bg : Theme.text)
        .background(selected ? Theme.text : Theme.surface2, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(isNow ? Theme.accent : Color.clear, lineWidth: 2))
    }

    private func chipLabel(_ index: Int) -> String {
        var parts = ["Week \(index + 1)"]
        if let label = program.weeks[index].label { parts.append(label) }
        if index == currentWeek { parts.append("this week") }
        return parts.joined(separator: ", ")
    }

    /// The date a weekday falls on in the chosen week, so its targets read
    /// as that week sets them.
    private func date(_ weekdayKey: String) -> String? {
        guard let offset = PlanSchedule.weekdayKeys.firstIndex(of: weekdayKey),
              let start = ProgramEditing.weekStart(program, index: week, today: today) else { return nil }
        return ProgramEditing.addingDays(offset, to: start)
    }

    private func shown(_ workout: Workout, _ weekdayKey: String) -> Workout {
        guard let plan = sync.plan, let date = date(weekdayKey) else { return workout }
        return plan.workout(workout, on: date)
    }

    private func line(_ row: ProgramEditing.DayRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 12) {
                Text(row.weekdayKey.uppercased())
                    .font(Theme.mono(11, .bold)).foregroundStyle(Theme.muted)
                    .frame(width: 36, alignment: .leading)
                if let workout = row.workout, row.isEveryWeekOnly {
                    // Your week's, beside the block: read, not the block's to change.
                    PlanItemBadge(glyph: PlanItemSummary.glyph(for: workout))
                        .opacity(0.55)
                        .accessibilityHidden(true)
                    Text(workout.name).font(Theme.mono(15, .medium)).foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    EveryWeekTag()
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                        .accessibilityHidden(true)
                } else if let workout = row.workout {
                    PlanItemLabel(workout: shown(workout, row.weekdayKey), plan: sync.plan, showsWeekdays: false)
                    Spacer(minLength: 0)
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
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                        .accessibilityHidden(true)
                }
            }
            if !row.extras.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                        .font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.dim)
                    Text(row.extras.map { row.everyWeek.contains($0.id) ? "\($0.name) (every week)" : $0.name }
                        .joined(separator: " · "))
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

    private func spoken(_ row: ProgramEditing.DayRow) -> String {
        let day = WorkoutLibraryPolicy.weekdayNames[row.weekdayKey] ?? row.weekdayKey
        let also = row.extras.isEmpty ? "" : ". Also \(ScheduleExtras.spokenList(row.extras.map { row.everyWeek.contains($0.id) ? "\($0.name), every week" : $0.name }))"
        guard let workout = row.workout else { return "\(day): Rest" + also }
        if row.isEveryWeekOnly { return "\(day): \(workout.name), every week, beside the block" + also }
        return "\(day): " + PlanItemSummary.spoken(shown(workout, row.weekdayKey), plan: sync.plan,
                                                     unit: RunDistanceUnit.preferred(), showsWeekdays: false) + also
    }
}

/// Starts a block from Your week: a start Monday, how many weeks and whether
/// they repeat. Every week begins as a copy of Your week.
struct ProgramSetupSheet: View {
    @ObservedObject var sync: SyncModel
    @Environment(\.dismiss) private var dismiss
    @State private var start = ""
    @State private var weeks = 8
    @State private var repeats = false
    @State private var name = ""
    @State private var saving = false
    @State private var reviewedPlan: PlanTree?
    @State private var initialStart = ""
    @State private var confirmDiscard = false
    /// The workouts the block plans week by week (P7); the rest of Your week
    /// carries on beside it. Nil until the sheet has read the plan.
    @State private var picked: [String]?
    @State private var initialPicked: [String] = []
    private var dirty: Bool {
        name != "" || weeks != 8 || repeats || start != initialStart || (picked ?? initialPicked) != initialPicked
    }
    private var choicesInWeek: [BlockLayers.Placed] { BlockLayers.repeatingWorkouts(reviewedPlan) }
    private var competingBlock: Bool { sync.plan?.program != nil }
    private var samePlan: Bool { reviewedPlan != nil && reviewedPlan?.id == sync.plan?.id }
    private var needsReview: Bool { reviewedPlan?.version != sync.plan?.version }

    private var choices: [String] { ProgramEditing.startChoices(today: sync.todayString) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name (optional)", text: $name)
                        .accessibilityIdentifier("plan.blockSetup.name")
                    Picker("Starts", selection: $start) {
                        ForEach(Array(choices.enumerated()), id: \.element) { index, monday in
                            Text(index == 0 ? "This week (\(ProgramEditing.spokenDate(monday)))"
                                 : index == 1 ? "Next week (\(ProgramEditing.spokenDate(monday)))"
                                 : ProgramEditing.spokenDate(monday))
                                .tag(monday)
                        }
                    }
                    .accessibilityIdentifier("plan.blockSetup.start")
                    Stepper(value: $weeks, in: 1...ProgramEditing.maxWeeks) {
                        Text(weeks == 1 ? "1 week" : "\(weeks) weeks").font(Theme.mono(15, .bold))
                    }
                    .accessibilityIdentifier("plan.blockSetup.weeks")
                    Toggle("Repeat when it ends", isOn: $repeats)
                        .accessibilityIdentifier("plan.blockSetup.repeat")
                } footer: {
                    Text(repeats
                         ? "After the last week, the block starts over."
                         : "After the last week, what you do every week carries on by itself.")
                }
                if !choicesInWeek.isEmpty {
                    Section {
                        ForEach(choicesInWeek) { item in
                            Toggle(isOn: Binding(
                                get: { (picked ?? []).contains(item.workout.id) },
                                set: { on in
                                    var next = (picked ?? []).filter { $0 != item.workout.id }
                                    if on { next.append(item.workout.id) }
                                    picked = next
                                }
                            )) {
                                HStack(spacing: 6) {
                                    Text(item.workout.name).font(Theme.mono(15, .medium)).lineLimit(1)
                                    Text(BlockLayers.daysLabel(item.days))
                                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                                }
                            }
                            .accessibilityIdentifier("plan.blockSetup.pick.\(item.workout.id)")
                        }
                    } header: {
                        Text("What the block plans week by week")
                    } footer: {
                        Text("Switched on: planned in the block, week by week, on the same days to start. Switched off: carries on every week beside it, block or not.")
                    }
                }
                if competingBlock {
                    Section {
                        Text("A block has been saved since you started. Your choices are kept here, but cannot replace that block. Cancel to return to the saved block.")
                            .foregroundStyle(Theme.danger)
                    }
                } else if !samePlan && reviewedPlan != nil {
                    Section { Text("The active plan changed. Your choices are kept here, but cannot be saved to another plan.").foregroundStyle(Theme.danger) }
                } else if needsReview, let current = sync.plan, let previous = reviewedPlan {
                    Section("Review your usual week") {
                        Text("Your plan changed. Review the current week before copying it into your new block. Your name, dates and week count are kept.")
                        ForEach(["mon", "tue", "wed", "thu", "fri", "sat", "sun"], id: \.self) { day in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(WorkoutLibraryPolicy.weekdayNames[day] ?? day).font(.headline)
                                Text("Previously reviewed: \(weekDescription(previous, day: day))")
                                Text("Current: \(weekDescription(current, day: day))")
                            }
                        }
                        Button("Use current week with my choices") { reviewedPlan = current }
                            .accessibilityIdentifier("plan.blockSetup.review")
                    }
                }
                if let error = sync.loadError {
                    Section {
                        Text(error).foregroundStyle(Theme.danger)
                            .accessibilityIdentifier("plan.blockSetup.error")
                    }
                }
                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        Text("Start the block").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(WorkoutPrimaryButtonStyle())
                    .disabled(saving || sync.isRoutineMutationInFlight || !samePlan || needsReview || competingBlock || start.isEmpty)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    .accessibilityIdentifier("plan.blockSetup.save")
                }
            }
            .disabled(saving)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Plan a block")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { if dirty { confirmDiscard = true } else { dismiss() } }.foregroundStyle(Theme.accent).disabled(saving)
                }
            }
            .onAppear {
                guard reviewedPlan == nil else { return }
                start = choices.first ?? ""
                initialStart = start
                reviewedPlan = sync.plan
                initialPicked = BlockLayers.suggested(sync.plan)
                picked = initialPicked
            }
            .alert("Discard block draft?", isPresented: $confirmDiscard) {
                Button("Keep editing", role: .cancel) { }
                Button("Discard draft", role: .destructive) { dismiss() }
            }
        }
        .interactiveDismissDisabled(saving || dirty)
    }

    private func weekDescription(_ plan: PlanTree, day: String) -> String {
        let primary = plan.schedule?.week[day] ?? nil
        let ids = (primary.map { [$0] } ?? []) + (plan.schedule?.extras?[day] ?? [])
        let names = ids.map { id in plan.workouts.first(where: { $0.id == id })?.name ?? "Unavailable workout" }
        return names.isEmpty ? "Rest" : names.joined(separator: " + ")
    }

    private func save() async {
        guard let plan = reviewedPlan, samePlan, !needsReview, !competingBlock, !start.isEmpty else { return }
        saving = true
        defer { saving = false }
        // Its own workouts are picked from the week reviewed here; one
        // removed since then is left out.
        let program = BlockLayers.newBlock(from: plan, start: start, weeks: weeks, repeats: repeats,
                                           name: name, picked: picked ?? [])
        if await sync.saveProgram(program, expectedVersion: plan.version) { dismiss() }
    }
}

/// One weekday of one block week: choose a workout or rest, for this week
/// only or for this week and the ones after.
struct ProgramDaySheet: View {
    @ObservedObject var sync: SyncModel
    let program: PlanProgram
    let target: ProgramDayTarget
    @Environment(\.dismiss) private var dismiss
    @State private var scope = ProgramEditing.Scope.thisWeek
    @State private var targetEdit: ProgramTargetEditRequest?

    /// The block as it is now: a conflict reloads it, so the sheet shows
    /// what the next pick will change.
    private var block: PlanProgram { sync.plan?.program ?? program }
    private var layered: Bool { BlockLayers.isLayered(block) }
    /// What the day holds: in a layered block only the block's own count,
    /// and Your week's are listed apart.
    private var day: (own: [String], standing: [String]) {
        BlockLayers.split(block, schedule: BlockLayers.repeatingWeek(sync.plan), week: target.week,
                          day: target.weekdayKey)
    }
    private var current: String? {
        if layered { return day.own.first }
        return block.weeks.indices.contains(target.week) ? (block.weeks[target.week].week[target.weekdayKey] ?? nil) : nil
    }
    private var standingWorkouts: [Workout] {
        let live = sync.plan?.availableWorkouts ?? []
        return day.standing.compactMap { id in live.first { $0.id == id } }
    }
    private var pickable: [Workout] {
        let standing = Set(day.standing)
        return (sync.plan?.libraryWorkouts ?? []).filter { !standing.contains($0.id) }
    }
    private var hasLaterWeeks: Bool { target.week < block.weeks.count - 1 }
    private var dayName: String { WorkoutLibraryPolicy.weekdayNames[target.weekdayKey] ?? target.weekdayKey }

    var body: some View {
        NavigationStack {
            List {
                if hasLaterWeeks {
                    Section {
                        Picker("Change", selection: $scope) {
                            ForEach(ProgramEditing.Scope.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("plan.blockDay.scope")
                    } footer: {
                        Text(scope == .thisWeek
                             ? "Only week \(target.week + 1) changes."
                             : "Weeks \(target.week + 1) to \(block.weeks.count) change.")
                    }
                }
                if layered && !standingWorkouts.isEmpty {
                    Section {
                        ForEach(standingWorkouts) { workout in
                            HStack(spacing: 8) {
                                Text(workout.name).font(Theme.mono(15, .medium)).foregroundStyle(Theme.muted)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                                EveryWeekTag()
                            }
                            .frame(minHeight: 44)
                            .accessibilityElement(children: .combine)
                        }
                    } header: {
                        Text("Every week")
                    } footer: {
                        Text("These carry on beside the block. Change them in Your week.")
                    }
                }
                Section {
                    choice(nil, title: layered ? "Nothing from the block" : "Rest", systemImage: "moon.zzz")
                    ForEach(pickable) { workout in
                        Button { Task { await pick(workout.id) } } label: {
                            HStack {
                                PlanItemLabel(workout: workout, plan: sync.plan, showsWeekdays: false)
                                Spacer(minLength: 0)
                                if current == workout.id {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.text)
                                        .accessibilityHidden(true)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(sync.isRoutineMutationInFlight)
                        .accessibilityAddTraits(current == workout.id ? .isSelected : [])
                        .accessibilityIdentifier("plan.blockDay.workout.\(workout.id)")
                    }
                } header: {
                    Text("\(dayName), week \(target.week + 1)")
                }
                Section("Week-specific targets") {
                    Button("Edit week targets") { targetEdit = ProgramTargetEditRequest(week: target.week, workoutID: current) }
                        .accessibilityIdentifier("plan.blockDay.editTargets")
                    ProgramTargetsWebLink(week: target.week)
                }
                if let error = sync.loadError {
                    Section {
                        Text(error).foregroundStyle(Theme.danger)
                            .accessibilityIdentifier("plan.blockDay.error")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .sheet(item: $targetEdit) { request in ProgramTargetEditorSheet(sync: sync, request: request) }
            .navigationTitle(dayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func choice(_ id: String?, title: String, systemImage: String) -> some View {
        Button { Task { await pick(id) } } label: {
            HStack(spacing: 12) {
                Image(systemName: systemImage).foregroundStyle(Theme.dim).frame(width: 30)
                    .accessibilityHidden(true)
                Text(title).font(Theme.mono(15, .medium)).foregroundStyle(Theme.text)
                Spacer(minLength: 0)
                if current == id {
                    Image(systemName: "checkmark").foregroundStyle(Theme.text).accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(sync.isRoutineMutationInFlight)
        .accessibilityIdentifier("plan.blockDay.rest")
    }

    private func pick(_ workoutID: String?) async {
        // Ended elsewhere, or now too short for this week: nothing to change.
        guard let plan = sync.plan, let live = plan.program, live.weeks.indices.contains(target.week) else {
            dismiss(); return
        }
        let change = ProgramEditing.dayChange(target.weekdayKey, to: workoutID, week: target.week,
                                              scope: hasLaterWeeks ? scope : .thisWeek, in: live, plan: plan)
        if change.after == change.before { dismiss(); return }
        if await sync.saveProgram(change.after, expectedVersion: plan.version) { dismiss() }
    }
}
