import SwiftUI

struct CompletedWorkoutFeedbackEntry: View {
    @ObservedObject var sync: SyncModel
    let session: SessionRow
    // The opening tap owns this draft. A nested sheet/menu remount must not
    // construct a new editor from the saved baseline and lose unsaved edits.
    @State private var presentation: CompletedWorkoutFeedbackEditor?
    @State private var message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            let feedback = WorkoutFeedback(notes: session.notes, perceivedFatigue: session.perceived_fatigue)
            if !feedback.isEmpty { SavedWorkoutFeedbackView(feedback: feedback) }
            Button {
                if let captured = sync.completedWorkoutFeedbackTarget(for: session) {
                    presentation = CompletedWorkoutFeedbackEditor(target: captured,
                        transcriber: WorkoutFeedbackTranscriberFactory.make())
                    message = nil
                } else {
                    message = "Refresh this completed record before editing its feedback."
                }
            } label: {
                Label(feedback.isEmpty ? "Add workout feedback" : "Edit workout feedback", systemImage: "text.bubble")
                    .frame(minHeight: 44).contentShape(Rectangle())
            }
            .accessibilityIdentifier("feedback.completed.open.\(session.slot ?? 0)")
            if let message { Text(message).font(.caption).foregroundStyle(Theme.muted) }
        }
        .sheet(item: $presentation) { model in
            CompletedWorkoutFeedbackSheet(sync: sync, model: model) { message = $0 }
        }
    }
}

struct CompletedWorkoutFeedbackSheet: View {
    @ObservedObject var sync: SyncModel
    @ObservedObject var model: CompletedWorkoutFeedbackEditor
    let onDone: (String) -> Void

    var body: some View {
        CompletedWorkoutFeedbackForm(sync: sync, model: model, editor: model.fields, onDone: onDone)
    }
}

private struct CompletedWorkoutFeedbackForm: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var sync: SyncModel
    @ObservedObject var model: CompletedWorkoutFeedbackEditor
    @ObservedObject var editor: WorkoutFeedbackEditor
    @FocusState private var typing: Bool
    let onDone: (String) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("For \(DateLabel.long(model.target.date)) · completed workout \(model.target.slot + 1)")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                    Text("Save changes only the note and fatigue rating. Your completed workout and sets stay recorded.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                if let conflict = model.conflict {
                    Section { Text("Feedback changed elsewhere. Review both versions before choosing what to keep.") }
                    Section("Your version") {
                        conflictVersion(WorkoutFeedback(notes: editor.text.isEmpty ? nil : editor.text,
                                                        perceivedFatigue: editor.fatigue))
                    }
                    Section("Saved version") {
                        conflictVersion(WorkoutFeedback(notes: conflict.notes,
                                                        perceivedFatigue: conflict.perceived_fatigue))
                    }
                    Section {
                        Button("Keep saved feedback") { onDone("Kept saved feedback."); dismiss() }
                            .accessibilityIdentifier("feedback.completed.keepSaved")
                        Button("Use my feedback") {
                            Task {
                                if await model.useMine(using: sync.saveCompletedWorkoutFeedback) { saved() }
                            }
                        }
                        .accessibilityIdentifier("feedback.completed.useMine")
                        .disabled(model.isSaving)
                    }
                } else {
                    WorkoutFeedbackFields(editor: editor, typing: $typing, inlineFatigue: true).disabled(model.isLocked)
                }
                if let message = model.message {
                    Section { Text(message).foregroundStyle(Theme.danger) }
                }
                if model.submission != nil && !model.isSaving && !model.unavailable {
                    Text("Your submitted version stays fixed until the save is confirmed. Closing discards this local retry; reopen the record to check what was saved.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
            }
            .scrollContentBackground(.hidden).background(Theme.background).tint(Theme.accent)
            .navigationTitle(model.conflict == nil ? "Workout feedback" : "Review feedback")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { typing = false }
                        .accessibilityIdentifier("feedback.keyboardDone")
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editor.stop(); dismiss() }.disabled(model.isSaving)
                        .accessibilityIdentifier("feedback.completed.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.conflict == nil {
                        Button(model.isSaving ? "Saving…" : model.submission == nil ? "Save feedback" : "Retry save") {
                            Task { if await model.save(using: sync.saveCompletedWorkoutFeedback) { saved() } }
                        }
                        .disabled(model.isSaving || model.unavailable || editor.isRecording || editor.isStarting || editor.isFinalizing
                                  || editor.fatigue.map { !(1...10).contains($0) } == true)
                        .accessibilityIdentifier("feedback.completed.save")
                    }
                }
            }
        }
        .interactiveDismissDisabled(model.isSaving)
        .onChange(of: scenePhase) { _, phase in if phase == .background { editor.interrupt() } }
        .onDisappear { editor.stop() }
    }

    @ViewBuilder private func conflictVersion(_ feedback: WorkoutFeedback) -> some View {
        SavedWorkoutFeedbackView(feedback: feedback)
        if feedback.notes?.isEmpty != false { Text("No note").foregroundStyle(Theme.muted) }
        if feedback.perceivedFatigue == nil { Text("Fatigue: Not rated").foregroundStyle(Theme.muted) }
    }

    private func saved() {
        onDone("Feedback saved.")
        dismiss()
    }
}
