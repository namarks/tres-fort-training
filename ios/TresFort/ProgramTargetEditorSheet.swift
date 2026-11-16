import SwiftUI

struct ProgramTargetEditRequest: Identifiable {
    let id = UUID()
    let week: Int
    var workoutID: String? = nil
    var lighter = false
}

/// A small phone editor for a reviewed block week. The full cross-week grid
/// remains available on the web, using the same stored week targets.
struct ProgramTargetEditorSheet: View {
    @ObservedObject var sync: SyncModel
    let request: ProgramTargetEditRequest
    @Environment(\.dismiss) private var dismiss
    @State private var source: PlanTree?
    @State private var workoutID = ""
    @State private var slotID = ""
    @State private var field = ProgramTargetEditing.Field.sets
    @State private var value = ""
    @State private var useSaved = false
    @State private var later = false
    @State private var setsPercent = "20"
    @State private var loadPercent = "10"
    @State private var changed = false
    @State private var saving = false
    @State private var discard = false
    @State private var targetEdited = false
    @State private var confirmSelection = false
    @State private var pendingSelection: (() -> Void)?

    private var program: PlanProgram? { source?.program }
    private var workouts: [Workout] {
        guard let source, let program else { return [] }
        return ProgramTargetEditing.workouts(program, week: request.week, plan: source)
    }
    private var workout: Workout? { workouts.first { $0.id == workoutID } }
    private var slots: [TemplateExercise] { workout?.exercises.filter(ProgramTargetEditing.isWorkingLift) ?? [] }
    private var slot: TemplateExercise? { slots.first { $0.id == slotID } }
    private var unavailable: Bool {
        guard let source, let live = sync.plan, let p = program, let current = live.program else { return true }
        return !sync.canContinueWorkoutCreation || source.id != live.id || p.id != current.id
            || !current.weeks.indices.contains(request.week)
    }
    private var selectionChanged: Bool {
        guard !request.lighter, source != nil, let old = slot, let oldWorkout = workout,
              let live = sync.plan, let currentWorkout = live.libraryWorkouts.first(where: { $0.id == oldWorkout.id }),
              let current = currentWorkout.exercises.first(where: { $0.id == old.id }) else {
            return !request.lighter && source != nil && slot != nil
        }
        func meaning(_ value: TemplateExercise) -> String {
            [value.id, value.exercise_id, String(value.isTimed), value.targetWeightUnit.rawValue,
             value.exercise_load_mode ?? "", value.exercise_laterality ?? "", value.group_id ?? ""].joined(separator: "|")
        }
        guard meaning(old) == meaning(current) else { return true }
        if let group = old.group_id {
            return oldWorkout.exercises.filter { $0.group_id == group }.map(meaning)
                != currentWorkout.exercises.filter { $0.group_id == group }.map(meaning)
        }
        return false
    }
    private var stale: Bool { source?.version != sync.plan?.version }
    private var number: Double? { Double(value.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var valid: Bool {
        if request.lighter {
            return [setsPercent, loadPercent].allSatisfy {
                guard let n = Double($0), n.isFinite else { return false }; return n >= 0 && n <= 90
            }
        }
        guard let slot else { return false }
        return useSaved || number.map { ProgramTargetEditing.valid($0, field: field, slot: slot) } == true
    }
    private var preview: ProgramTargetEditing.Preview? {
        guard let source, let program, valid else { return nil }
        if request.lighter {
            return ProgramTargetEditing.lighter(program, week: request.week, plan: source,
                workoutID: workoutID.isEmpty ? nil : workoutID,
                setsPercent: Double(setsPercent) ?? 0, loadPercent: Double(loadPercent) ?? 0)
        }
        guard let slot, let workout else { return nil }
        return ProgramTargetEditing.setting(field, value: useSaved ? nil : number, slot: slot, workout: workout,
                                             week: request.week, later: later, in: program)
    }
    var body: some View {
        NavigationStack {
            Form {
                scopeSection
                if unavailable {
                    Text("This account, plan or block is no longer available. Your unfinished values have not been applied.")
                        .foregroundStyle(Theme.danger)
                } else if selectionChanged {
                    Text("This movement or group changed elsewhere. Your typed values are kept, but cannot be applied to the changed movement. Cancel and reopen its latest targets.")
                        .foregroundStyle(Theme.danger)
                } else if stale {
                    Section("Plan changed") {
                        Text("Your values are kept. Review them against the latest saved week before saving.")
                        Button("Review latest week with my values") { source = sync.plan }
                            .disabled(saving)
                            .accessibilityIdentifier("plan.targets.reviewLatest")
                    }
                }
                if !workouts.isEmpty {
                    choices
                    if request.lighter { lighterControls } else { targetControls }
                    previewSection
                } else {
                    Text("Schedule a lifting workout in this block week first. Warm-ups and cardio are not changed here.")
                }
                if let error = sync.loadError { Text(error).foregroundStyle(Theme.danger) }
            }
            .disabled(saving)
            .scrollContentBackground(.hidden).background(Theme.background)
            .navigationTitle(request.lighter ? "Make week lighter" : "Week targets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { if changed { discard = true } else { dismiss() } }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(unavailable || selectionChanged || stale || !valid || preview?.changes.isEmpty != false || saving || sync.isRoutineMutationInFlight)
                        .accessibilityIdentifier("plan.targets.save")
                }
            }
            .confirmationDialog("Discard unfinished week changes?", isPresented: $discard, titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
            .confirmationDialog("Discard the unfinished target before switching?", isPresented: $confirmSelection, titleVisibility: .visible) {
                Button("Discard target and switch", role: .destructive) {
                    let action = pendingSelection; pendingSelection = nil; action?()
                }
                Button("Keep editing", role: .cancel) { pendingSelection = nil }
            }
            .onAppear {
                guard source == nil else { return }
                source = sync.plan
                workoutID = request.lighter ? (request.workoutID ?? "") : (request.workoutID ?? workouts.first?.id ?? "")
                slotID = slots.first?.id ?? ""
                seedValue()
            }
        }
        .interactiveDismissDisabled(changed || saving)
    }
    private var scopeSection: some View {
        Section {
            if let program {
                Text(ProgramTargetEditing.scope(program, week: request.week, later: !request.lighter && later))
                    .accessibilityIdentifier("plan.targets.scopeExplanation")
                if !request.lighter && request.week < program.weeks.count - 1 {
                    Toggle("Also apply to later weeks in this block", isOn: Binding(get: { later }, set: { later = $0; changed = true }))
                        .accessibilityIdentifier("plan.targets.later")
                }
            }
        } footer: {
            Text("Applies wherever the workout appears in those block weeks. Saved workouts and history stay unchanged. Finish in-progress workouts before changing their targets; other weeks remain editable. Finish or sync workouts started on another device first. Use the runner for session-only changes.")
        }
    }
    private var choices: some View {
        Section {
            Picker("Workout", selection: Binding(get: { workoutID }, set: {
                let next = $0
                changeSelection { workoutID = next; slotID = slots.first?.id ?? ""; seedValue(); changed = true }
            })) {
                if request.lighter { Text("All lifting workouts").tag("") }
                ForEach(workouts) { Text($0.name).tag($0.id) }
            }.pickerStyle(.menu).accessibilityIdentifier("plan.targets.workout")
            if !request.lighter {
                Picker("Movement", selection: Binding(get: { slotID }, set: { next in changeSelection { slotID = next; seedValue(); changed = true } })) {
                    ForEach(slots) { Text("\($0.order_index + 1). \($0.exercise_name)").tag($0.id) }
                }.pickerStyle(.menu).accessibilityIdentifier("plan.targets.movement")
            }
        }
    }
    @ViewBuilder private var targetControls: some View {
        if let slot, let program {
            Section {
                Picker("Target", selection: Binding(get: { field }, set: { next in changeSelection { field = next; seedValue(); changed = true } })) {
                    ForEach(ProgramTargetEditing.fields(slot)) { Text($0.title).tag($0) }
                }.pickerStyle(.menu).accessibilityIdentifier("plan.targets.field")
                Text("Saved workout: \(ProgramTargetEditing.text(slot, field: field))")
                Text("Week \(request.week + 1): \(ProgramTargetEditing.text(slot.applying(program.weeks[request.week].targets?[slot.id]), field: field))")
                Toggle("Use saved workout target", isOn: Binding(get: { useSaved }, set: { useSaved = $0; changed = true; targetEdited = true }))
                    .accessibilityIdentifier("plan.targets.useSaved")
                if !useSaved {
                    TextField(field == .load ? "Load (\(slot.targetWeightUnit.rawValue))" : field.title,
                              text: Binding(get: { value }, set: { value = $0; changed = true; targetEdited = true }))
                        .keyboardType(field == .load && slot.allowsAssistance ? .numbersAndPunctuation : .decimalPad)
                        .accessibilityIdentifier("plan.targets.value")
                }
                if !valid { Text("Enter a valid target, or use the saved workout target.").foregroundStyle(Theme.danger) }
                if field == .sets && slot.group_id != nil { Text("Rounds change for every movement in this group.") }
                if field == .load && slot.allowsAssistance { Text("Negative load means assistance; zero means bodyweight.") }
            } footer: { Text("Using the saved target removes this field's week override. Mixed cardio or warm-up groups keep their shared rounds.") }
        }
    }
    private var lighterControls: some View {
        Section {
            TextField("Fewer sets or rounds (%)", text: Binding(get: { setsPercent }, set: { setsPercent = $0; changed = true }))
                .keyboardType(.decimalPad).accessibilityIdentifier("plan.targets.lighterSets")
            TextField("Lighter load (%)", text: Binding(get: { loadPercent }, set: { loadPercent = $0; changed = true }))
                .keyboardType(.decimalPad).accessibilityIdentifier("plan.targets.lighterLoad")
            if !valid { Text("Use percentages from 0 to 90.").foregroundStyle(Theme.danger) }
        } footer: {
            Text("Use 0 to keep a target. Sets round down, with at least one. Assistance increases; unknown and zero loads stay unchanged. Warm-ups and cardio stay unchanged; mixed cardio groups keep their rounds.")
        }
    }
    private var previewSection: some View {
        Section("Review changes") {
            if let preview, !preview.changes.isEmpty {
                ForEach(preview.changes) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.workout).font(.caption).foregroundStyle(Theme.muted)
                        Text(row.exercise)
                        Text("\(row.field): \(row.before) → \(row.after)").font(.subheadline)
                    }.accessibilityElement(children: .combine)
                }
            } else { Text("No targets would change.").foregroundStyle(Theme.muted) }
        }.accessibilityIdentifier("plan.targets.preview")
    }
    private func changeSelection(_ action: @escaping () -> Void) {
        if targetEdited && !request.lighter { pendingSelection = action; confirmSelection = true }
        else { action() }
    }
    private func seedValue() {
        targetEdited = false
        guard let slot, let program, program.weeks.indices.contains(request.week) else { value = ""; return }
        if !ProgramTargetEditing.fields(slot).contains(field) { field = slot.isTimed ? .duration : .reps }
        let current = slot.applying(program.weeks[request.week].targets?[slot.id])
        let raw = ProgramTargetEditing.value(current, field: field)
        let input = field == .load ? raw.map { current.targetWeightUnit.convert($0, to: slot.targetWeightUnit) } : raw
        value = input.map(WeightUnit.text) ?? ""
        useSaved = false
    }
    private func save() {
        guard !unavailable, !selectionChanged, !stale, let source, let preview, !preview.changes.isEmpty else { return }
        saving = true
        Task {
            let accepted = await sync.saveProgram(preview.program, expectedVersion: source.version)
            saving = false
            if accepted && sync.canContinueWorkoutCreation { dismiss() }
        }
    }
}
