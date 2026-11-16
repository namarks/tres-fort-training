import SwiftUI

struct WorkoutTagsSheet: View {
    @ObservedObject var sync: SyncModel
    let workout: Workout
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var savedText = ""
    @State private var planID: String?
    @State private var version = 0
    @State private var saving = false
    @State private var confirmDiscard = false
    @State private var initialized = false
    private var current: Workout? { sync.workout(id: workout.id) }
    private var sameDocument: Bool {
        planID != nil && sync.plan?.id == planID && current != nil
            && current?.isArchived == workout.isArchived
    }
    private var needsReview: Bool { version != (sync.plan?.version ?? 0) }
    private var dirty: Bool { text != savedText }
    private var tags: [String] {
        text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
    }
    private var valid: Bool {
        tags.count <= 12 && tags.allSatisfy { $0.utf16.count <= 32 && !$0.unicodeScalars.contains { $0.value < 32 || $0.value == 127 } }
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("travel, quick, bodyweight", text: $text, axis: .vertical)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("workoutTags.input")
                } header: { Text("Tags for \(workout.name)") }
                  footer: { Text("Separate tags with commas. Up to 12 tags, 32 characters each. Travel workouts appear first when choosing a workout during a trip.") }
                if !valid { Text("Use up to 12 short tags.").foregroundStyle(Theme.danger) }
                if !sameDocument && initialized {
                    Text("This workout is no longer available in the same plan or its archive status changed. Your tags are kept here; no change has been sent.")
                        .foregroundStyle(Theme.danger)
                } else if needsReview && initialized {
                    Section("Review changed tags") {
                        Text("The plan changed. Your proposed tags are kept above.")
                        LabeledContent("Current saved", value: (current?.workoutTags.isEmpty == false ? current!.workoutTags.joined(separator: ", ") : "None"))
                        Button("Use my tags with latest workout") {
                            savedText = current?.workoutTags.joined(separator: ", ") ?? ""
                            version = sync.plan?.version ?? 0
                        }
                        .accessibilityIdentifier("workoutTags.review")
                    }
                }
                if let error = sync.loadError { Text(error).foregroundStyle(Theme.danger) }
            }
            .disabled(saving)
            .navigationTitle("Workout tags")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { if dirty { confirmDiscard = true } else { dismiss() } }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard sameDocument, !needsReview else { return }
                        saving = true
                        Task {
                            let accepted = await sync.saveWorkoutTags(dayID: workout.id, tags: tags, expectedVersion: version)
                            saving = false
                            if accepted { dismiss() }
                        }
                    }
                    .disabled(!valid || saving || sync.isRoutineMutationInFlight || version == 0 || needsReview || !sameDocument)
                    .accessibilityIdentifier("workoutTags.save")
                }
            }
            .onAppear {
                guard !initialized else { return }
                text = (current ?? workout).workoutTags.joined(separator: ", ")
                savedText = text
                planID = sync.plan?.id
                version = sync.plan?.version ?? 0
                initialized = true
            }
            .alert("Discard tag changes?", isPresented: $confirmDiscard) {
                Button("Keep editing", role: .cancel) { }
                Button("Discard changes", role: .destructive) { dismiss() }
            }
        }
        .interactiveDismissDisabled(saving || dirty)
    }
}
