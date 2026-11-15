import SwiftUI

/// Edits a local proposal. Going back retains every field, including unfinished
/// input; only the final workout Save writes to the server.
struct LiftingTargetEditor: View {
    @Binding var draft: LiftingExerciseDraft
    @ScaledMetric(relativeTo: .body) private var fieldWidth: CGFloat = 80

    var body: some View {
        Form {
            Section {
                numberField("Sets", text: $draft.sets, id: "sets")
                if draft.isTimed {
                    numberField("Work or hold · seconds", text: $draft.seconds, id: "seconds")
                } else {
                    numberField(draft.exercise.laterality == "unilateral" ? "Reps · each side" : "Reps", text: $draft.reps, id: "reps")
                    numberField("Up to · optional", text: $draft.repsMax, id: "repsMax")
                }
                RestSecondsField(title: "Between sets · seconds", draft: $draft.rest, identifier: "createWorkout.target.rest")
            } header: { Text("Targets") } footer: {
                Text("These targets are a draft until you save the complete workout.")
            }
            if draft.exercise.modality != "cardio" {
                SlotLoadSection(load: $draft.load, allowsAssistance: draft.load.allowsAssistance,
                    isPerHand: draft.exercise.load_mode == "per_hand", defaultRPE: 8)
            } else {
                Section("Effort") {
                    Toggle("Target effort (RPE)", isOn: Binding(get: { draft.load.rpe != nil },
                        set: { draft.load.rpe = $0 ? 8 : nil }))
                    if let rpe = draft.load.rpe {
                        Stepper("RPE \(SetValueFormatter.number(rpe))", value: Binding(get: { rpe }, set: { draft.load.rpe = $0 }), in: 1...10, step: 0.5)
                    }
                }
            }
            Section {
                Toggle("Warm-up", isOn: $draft.warmup).accessibilityIdentifier("createWorkout.target.warmup")
                TextField("Cues · optional", text: $draft.cues, axis: .vertical)
                    .accessibilityIdentifier("createWorkout.target.cues")
            }
            if let message = draft.validationMessage {
                Text(message).foregroundStyle(Theme.danger).accessibilityIdentifier("createWorkout.target.validation")
            }
        }
        .tint(Theme.accent)
        .scrollContentBackground(.hidden).background(Theme.background)
        .navigationTitle(draft.exercise.name).navigationBarTitleDisplayMode(.inline)
    }

    private func numberField(_ title: String, text: Binding<String>, id: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).accessibilityHidden(true)
            Spacer(minLength: 12)
            TextField("", text: text).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                .frame(width: fieldWidth).frame(minHeight: 44)
                .accessibilityLabel(title).accessibilityIdentifier("createWorkout.target.\(id)")
        }
    }
}
