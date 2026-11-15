import SwiftUI

/// Captures the workout shown when a session-only sheet opens. A later
/// account/session change must not silently retarget the sheet's action.
struct SessionExerciseActionTarget: Identifiable {
    let id = UUID()
    let session: WorkoutTerminalActionTarget
}

struct SessionWarmupDraft: Identifiable {
    let id = UUID()
    let session: WorkoutTerminalActionTarget
    let exercise: TemplateExercise
}

struct SessionExercisePicker: View {
    @ObservedObject var sync: SyncModel
    let target: WorkoutTerminalActionTarget
    var onAdded: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ExercisePickerList(sync: sync) { exercise in
                let isOutdoorRun = exercise.id == RunPlan.exerciseID
                Button {
                    if sync.addSessionExercise(exercise, expected: target) { dismiss(); onAdded?() }
                    else { error = sync.loadError ?? "This workout changed. Close this sheet and choose again." }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            ExerciseCatalogLabel(exercise: exercise)
                            if isOutdoorRun {
                                Text("Start outdoor runs from Today.")
                                    .font(.caption).foregroundStyle(Theme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer()
                        if !isOutdoorRun {
                            Image(systemName: sync.exercises.contains(where: { $0.exercise_id == exercise.id })
                                  ? "arrow.turn.up.left" : "plus.circle")
                                .accessibilityHidden(true)
                        }
                    }
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .disabled(isOutdoorRun || !sync.canAddSessionExercise)
                .accessibilityIdentifier("session.exercise.\(exercise.id)")
            }
            .navigationTitle("Add to this workout")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Add an exercise for this session only. Choosing one already here returns to it. Your saved workout stays unchanged.")
                    if let error { Text(error).foregroundStyle(Theme.danger) }
                }
                .font(.footnote).padding().frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface)
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct SessionWarmupSheet: View {
    @ObservedObject var sync: SyncModel
    let draft: SessionWarmupDraft
    var onLogged: (() -> Void)? = nil

    var body: some View {
        let ex = draft.exercise
        SetValuesEditor(title: "Log warm-up", values: SetCorrectionValues(
            weight: 0, reps: ex.target_reps, rpe: nil, durationSeconds: nil),
            timed: false, allowsAssistance: ex.allowsAssistance,
            storedUnit: ex.targetWeightUnit, unilateral: ex.isUnilateral,
            loadIsKnown: ex.isBodyweight,
            saveTitle: "Log warm-up",
            helpText: "Record a warm-up you have already done for \(ex.exercise_name). It won't count toward working sets or change your saved workout.",
            repsRange: 1...1000, rpeRange: 1...10) { values in
                let accepted = sync.logWarmup(expected: ex, expectedSession: draft.session,
                    values: SessionWarmupValues(weight: values.weight, reps: values.reps, rpe: values.rpe))
                if accepted { onLogged?() }
                return accepted
            }
    }
}

struct SessionAddSetSheet: View {
    @ObservedObject var sync: SyncModel
    let target: WorkoutTerminalActionTarget
    @Environment(\.dismiss) private var dismiss
    var onAdded: (() -> Void)? = nil

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(sync.exercises.filter { sync.canAddSessionSet(for: $0) }) { exercise in
                        let setNumber = sync.sessionNextSetNumber(for: exercise)
                        Button {
                            if sync.addSessionSet(expected: exercise, expectedSetNumber: setNumber, expectedSession: target) {
                                dismiss(); onAdded?()
                            }
                        } label: {
                            Label(exercise.exercise_name, systemImage: "plus.circle")
                                .frame(minHeight: 44)
                        }
                        .accessibilityIdentifier("session.addSet.\(exercise.id)")
                    }
                } footer: {
                    Text("Add one set to this session, then enter what you do in the runner. Your saved workout stays unchanged. Extra sets are available for exercises outside a superset or circuit.")
                }
                if let error = sync.loadError { Text(error).foregroundStyle(Theme.danger) }
            }
            .navigationTitle("Add a set")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct SessionRestEditor: View {
    @ObservedObject var sync: SyncModel
    let target: RestEditTarget
    @Environment(\.dismiss) private var dismiss
    @State private var seconds: String
    @State private var remainingSets = false
    @State private var error: String?

    init(sync: SyncModel, target: RestEditTarget) {
        self.sync = sync; self.target = target
        _seconds = State(initialValue: String(target.seconds))
    }

    private var value: Int? {
        guard let value = Int(seconds), (0...3600).contains(value) else { return nil }
        return value
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Seconds") {
                        TextField("Seconds", text: $seconds)
                            .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("rest.duration.seconds")
                    }
                    if target.allowsRemainingSets {
                        Picker("Apply to", selection: $remainingSets) {
                            Text("This rest only").tag(false)
                            Text("Remaining sets of this exercise").tag(true)
                        }
                        .accessibilityIdentifier("rest.duration.scope")
                    }
                } header: {
                    Text(target.exerciseName)
                } footer: {
                    Text(remainingSets
                        ? "Restart this rest from now and use this duration after the remaining sets of this exercise. Your saved workout stays unchanged."
                        : "Restart this rest from now. Later rests and your saved workout stay unchanged.")
                }
                if !target.allowsRemainingSets {
                    Text("Only this countdown can be changed here. Group transition and round rests are adjusted one countdown at a time.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                if value == nil { Text("Enter 0 to 3,600 seconds.").foregroundStyle(Theme.danger) }
                if let error { Text(error).foregroundStyle(Theme.danger) }
            }
            .navigationTitle("Change rest")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        guard let value else { return }
                        if sync.setRest(seconds: value, forRemainingSets: remainingSets, expected: target) { dismiss() }
                        else { error = "This rest changed. Close this sheet and review the current timer." }
                    }
                    .disabled(value == nil)
                    .accessibilityIdentifier("rest.duration.apply")
                }
            }
        }
    }
}
