import SwiftUI

/// Select exercises locally, then save one complete library workout.
/// Keep the observed version on an uncertain retry so a lost response cannot
/// quietly append a second workout after the first creation committed.
struct CreateWorkoutView: View {
    @ObservedObject var sync: SyncModel
    var onStart: ((String) -> Void)? = nil
    /// The new workout's ID once saved, so a weekday can use it.
    var onCreated: ((String) -> Void)? = nil
    /// Lists only exercises done with no equipment, for a routine at home
    /// (app-design-pass P24).
    var equipmentFree = false
    /// Creation inside the week composer finishes with scheduling, rather
    /// than opening another details screen after the member has reviewed it.
    var completionTitle: String?
    var scheduleSummary: String?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var selectedExercises: [ExerciseCatalog] = []
    @State private var reviewing = false
    @State private var creating = false
    @State private var refreshing = false
    @State private var createdID: String?
    @State private var liftingDraft = LiftingWorkoutDraft()
    @State private var reviewedAuthority: LiftingCreationAuthority?
    @State private var needsAuthorityReview = false
    @State private var confirmingClose = false
    @AppStorage(WeightUnit.preferenceKey) private var preferredUnit = WeightUnit.lb.rawValue
    @State private var hadUncertainAttempt = false
    @State private var needsLibraryReview = false
    @State private var homeDraft = HomeRoutineDraft()
    @State private var prescriptionRequest: WorkoutPrescriptionRequest?
    @ScaledMetric(relativeTo: .body) private var timingFieldWidth: CGFloat = 80

    /// `initialExercises` opens straight on the review with them chosen,
    /// so a routine that starts from a set list is a tap from saving;
    /// Back still adds or removes exercises.
    init(sync: SyncModel, onStart: ((String) -> Void)? = nil, onCreated: ((String) -> Void)? = nil,
         initialName: String = "", initialExercises: [ExerciseCatalog] = [], equipmentFree: Bool = false,
         initialCircuit: Bool = false, completionTitle: String? = nil, scheduleSummary: String? = nil) {
        _sync = ObservedObject(wrappedValue: sync)
        self.onStart = onStart
        self.onCreated = onCreated
        self.equipmentFree = equipmentFree
        self.completionTitle = completionTitle
        self.scheduleSummary = scheduleSummary
        _name = State(initialValue: initialName)
        _selectedExercises = State(initialValue: initialExercises)
        _reviewing = State(initialValue: !initialExercises.isEmpty)
        _homeDraft = State(initialValue: HomeRoutineDraft(circuit: initialCircuit))
        var draft = LiftingWorkoutDraft()
        let unit = WeightUnit(rawValue: UserDefaults.standard.string(forKey: WeightUnit.preferenceKey) ?? "") ?? .lb
        for exercise in initialExercises { draft.include(exercise, unit: unit) }
        _liftingDraft = State(initialValue: draft)
        _reviewedAuthority = State(initialValue: initialExercises.isEmpty ? nil : LiftingCreationAuthority(planID: sync.plan?.id, version: sync.plan?.version ?? 0))
    }

    var body: some View {
        Group {
            if let createdID {
                WorkoutDetailsView(sync: sync, workoutID: createdID, onStart: onStart)
            } else {
                NavigationStack {
                    ExercisePickerList(sync: sync, equipmentFree: equipmentFree) { exercise in
                        let selectedIndex = selectedExercises.firstIndex { $0.id == exercise.id }
                        Button {
                            if let selectedIndex { selectedExercises.remove(at: selectedIndex) }
                            else {
                                liftingDraft.include(exercise, unit: WeightUnit(rawValue: preferredUnit) ?? .lb)
                                selectedExercises.append(exercise)
                            }
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    ExerciseCatalogLabel(exercise: exercise)
                                    if !equipmentFree && exercise.id == RunPlan.exerciseID {
                                        Text("Add a planned run from your weekly setup.")
                                            .font(.caption).foregroundStyle(Theme.muted)
                                    }
                                }
                                Spacer()
                                if let selectedIndex {
                                    Text("\(selectedIndex + 1)")
                                        .font(.subheadline.bold()).foregroundStyle(Theme.bg)
                                        .frame(width: 28, height: 28).background(Theme.accent).clipShape(Circle())
                                } else {
                                    Image(systemName: "plus.circle").foregroundStyle(Theme.accent)
                                }
                            }.frame(minHeight: 44).contentShape(Rectangle())
                        }
                        .disabled((!equipmentFree && exercise.id == RunPlan.exerciseID) || (selectedIndex == nil && selectedExercises.count >= 50))
                        .accessibilityAddTraits(selectedIndex == nil ? [] : [.isSelected])
                        .accessibilityIdentifier("exercisePicker.exercise.\(exercise.id)")
                    }
                    .navigationTitle("Add exercises")
                    .navigationBarTitleDisplayMode(.inline)
                    .safeAreaInset(edge: .bottom) {
                        Button {
                            if !equipmentFree && reviewedAuthority == nil {
                                reviewedAuthority = currentAuthority
                            }
                            reviewing = true
                        } label: {
                            Text("Review workout (\(selectedExercises.count))")
                                .font(.headline).foregroundStyle(Theme.bg)
                                .frame(maxWidth: .infinity, minHeight: 48)
                        }
                            .buttonStyle(.borderedProminent).tint(Theme.accent)
                            .disabled(selectedExercises.isEmpty)
                            .accessibilityIdentifier("createWorkout.review")
                            .padding().background(Theme.background)
                    }
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { closeSetup() } } }
                    .navigationDestination(isPresented: $reviewing) { reviewForm }
                }
            }
        }
        // RootView retires this view when its account/feature-session key
        // changes. Temporary local-storage unavailability must keep the draft.
        .interactiveDismissDisabled(creating || hasUnsavedDraft)
        .alert(prescriptionRequest == nil ? "Discard workout draft?" : "Close workout setup?", isPresented: $confirmingClose) {
            Button("Keep editing", role: .cancel) { }
            Button(prescriptionRequest == nil ? "Discard workout" : "Close setup", role: .destructive) { dismiss() }
        } message: {
            Text(prescriptionRequest == nil
                 ? "Your exercise selection and targets have not been saved."
                 : "The save may have completed. Check your workout library before creating another workout.")
        }
    }

    private var suggestedName: String {
        ExerciseSearchPolicy.defaultName(existingNames: sync.plan?.workouts.map(\.name) ?? [])
    }

    private var reviewForm: some View {
        Form {
            if let scheduleSummary {
                Section("Your week") { Text(scheduleSummary).foregroundStyle(Theme.text) }
            }
            if equipmentFree { homeTiming }
            Section {
                ForEach(selectedExercises) { exercise in
                    if equipmentFree {
                        HStack {
                            ExerciseCatalogLabel(exercise: exercise)
                            Spacer()
                            Text(homeDraft.targetLabel(for: exercise)).font(.caption).foregroundStyle(Theme.muted)
                        }
                    } else {
                        HStack {
                            NavigationLink {
                                LiftingTargetEditor(draft: targetBinding(for: exercise))
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(exercise.name).foregroundStyle(Theme.text)
                                    Text(liftingDraft.targets[exercise.id]?.summary ?? "Review targets")
                                        .font(.caption).foregroundStyle(Theme.muted)
                                }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                            }
                            .accessibilityIdentifier("createWorkout.targets.\(exercise.id)")
                            .disabled(creationLocked)
                            Menu {
                                Button("Move up") { move(exercise, by: -1) }
                                    .disabled(selectedExercises.first?.id == exercise.id)
                                Button("Move down") { move(exercise, by: 1) }
                                    .disabled(selectedExercises.last?.id == exercise.id)
                                Button("Remove exercise", role: .destructive) { selectedExercises.removeAll { $0.id == exercise.id } }
                            } label: {
                                Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle())
                            }
                            .accessibilityLabel("Order for \(exercise.name)")
                            .accessibilityIdentifier("createWorkout.order.\(exercise.id)")
                            .disabled(creationLocked)
                        }
                    }
                }
                .onDelete { selectedExercises.remove(atOffsets: $0) }
                .deleteDisabled(creationLocked)
            } header: { Text("Exercises · in workout order") } footer: {
                Text(equipmentFree
                     ? "These targets and rests are saved together. You can change individual exercises later from the workout."
                     : "Tap an exercise to review its sets, reps, weight and rest. Use its menu to change the order. Empty weights stay unset until you choose a load.")
            }
            // The name is optional and comes last: the workout is saved under
            // a name of its own either way (app-design-pass P27).
            Section {
                TextField(suggestedName, text: $name)
                    .accessibilityIdentifier("createWorkout.name")
                    .disabled(creationLocked)
            } header: { Text("Name · optional") } footer: {
                Text("Rename it any time from Workouts.")
            }
            if !equipmentFree, let message = liftingDraft.validationMessage(for: selectedExercises) {
                Text(message).font(.footnote).foregroundStyle(Theme.danger)
            }
            if name.trimmingCharacters(in: .whitespacesAndNewlines).count > 200 {
                Text("Keep the workout name within 200 characters.").font(.footnote).foregroundStyle(Theme.danger)
            }
            if equipmentFree {
                Section("How the timers work") {
                    Text(homeDraft.circuit
                         ? "Do one set of each exercise per round. Transition rest follows each exercise; round rest follows the last."
                         : "Finish the sets of one exercise before moving to the next. Rest follows each set.")
                    Text("Tap Start for each timed set. When its timer finishes, the set logs automatically. Rest ending gives a cue; tap Start when you're ready for the next set.")
                }
                if let preview = homeDraft.timerPreview(for: selectedExercises) {
                    Section("Time and timer preview") {
                        RoutineTimerPreviewView(preview: preview)
                    }
                }
                if let message = homeDraft.validationMessage(for: selectedExercises) {
                    Text(message).font(.footnote).foregroundStyle(Theme.danger)
                }
            }
            if requiresAuthorityReview {
                Section("Review the current plan") {
                    Text("Refresh the current plan, then review your targets before saving. Your proposals stay here.")
                    Button(refreshing ? "Refreshing…" : "Refresh plan for review") {
                        refreshing = true
                        Task {
                            defer { refreshing = false }
                            guard sync.canContinueWorkoutCreation else { return }
                            await sync.load()
                            guard sync.canContinueWorkoutCreation, sync.hasVerifiedPlanState,
                                  !sync.isUsingCachedState, !sync.isLoading, sync.loadError == nil else { return }
                            reviewedAuthority = currentAuthority
                            needsAuthorityReview = false
                        }
                    }
                    .disabled(refreshing || creating)
                    .accessibilityIdentifier("createWorkout.reviewCurrentPlan")
                }
            }
            if let error = sync.loadError {
                Text(error).foregroundStyle(Theme.danger)
                if prescriptionRequest != nil {
                    Text(needsLibraryReview
                         ? "The earlier request may have saved. Close this screen and check your workout library before creating another workout."
                         : "Retry uses the same request to avoid saving a duplicate workout.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
            }
            if sync.plan == nil && !sync.canCreateRoutine {
                Button(refreshing ? "Refreshing…" : "Refresh training plan") {
                    refreshing = true
                    Task { await sync.load(); refreshing = false }
                }
                .disabled(creating || refreshing)
                .accessibilityIdentifier("createWorkout.refreshPlan")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .safeAreaInset(edge: .bottom) { creationButton.padding().background(Theme.background) }
        .navigationTitle("Review workout")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(creationLocked)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Cancel") { closeSetup() }.disabled(creating) } }
    }

    private var creationLocked: Bool { creating || prescriptionRequest != nil }

    private var currentAuthority: LiftingCreationAuthority {
        LiftingCreationAuthority(planID: sync.plan?.id, version: sync.plan?.version ?? 0)
    }

    private var requiresAuthorityReview: Bool {
        !equipmentFree && prescriptionRequest == nil && (needsAuthorityReview || reviewedAuthority != currentAuthority)
    }

    private var hasUnsavedDraft: Bool {
        !equipmentFree && createdID == nil && (!selectedExercises.isEmpty || !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private func closeSetup() {
        if hasUnsavedDraft { confirmingClose = true } else { dismiss() }
    }

    private func targetBinding(for exercise: ExerciseCatalog) -> Binding<LiftingExerciseDraft> {
        Binding(get: { liftingDraft.targets[exercise.id] ?? LiftingExerciseDraft(exercise: exercise, unit: WeightUnit(rawValue: preferredUnit) ?? .lb) },
                set: { liftingDraft.targets[exercise.id] = $0 })
    }

    private func move(_ exercise: ExerciseCatalog, by delta: Int) {
        guard let index = selectedExercises.firstIndex(where: { $0.id == exercise.id }),
              selectedExercises.indices.contains(index + delta) else { return }
        selectedExercises.swapAt(index, index + delta)
    }

    @ViewBuilder private var homeTiming: some View {
        Section("Sets and timing") {
            Toggle("Follow as a circuit", isOn: $homeDraft.circuit)
                .accessibilityIdentifier("createWorkout.circuit")
            Toggle("Time every exercise", isOn: $homeDraft.timeEveryExercise)
                .accessibilityIdentifier("createWorkout.timeEveryExercise")
            secondsField(homeDraft.circuit ? "Rounds" : "Sets", text: $homeDraft.sets, id: "sets")
            if selectedExercises.contains(where: homeDraft.isTimed) {
                secondsField("Work or hold · seconds", text: $homeDraft.seconds, id: "seconds")
            }
            if selectedExercises.contains(where: { !homeDraft.isTimed($0) }) {
                secondsField("Reps", text: $homeDraft.reps, id: "reps")
            }
            if homeDraft.circuit {
                secondsField("Between exercises · seconds", text: $homeDraft.transitionRest, id: "transition")
                secondsField("Between rounds · seconds", text: $homeDraft.roundRest, id: "roundRest")
            } else {
                secondsField("Between sets · seconds", text: $homeDraft.rest, id: "rest")
            }
        }
        .disabled(creationLocked)
    }

    // Keep a long label out of the numeric field's touch/accessibility frame.
    private func secondsField(_ title: String, text: Binding<String>, id: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).accessibilityHidden(true)
            Spacer(minLength: 12)
            TextField("", text: text)
                .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                .frame(width: timingFieldWidth)
                .frame(minHeight: 44)
                .accessibilityLabel(title)
                .accessibilityIdentifier("createWorkout.timing.\(id)")
        }
    }

    private var creationButton: some View {
        Button(creationButtonTitle) {
            creating = true
            Task {
                defer { creating = false }
                await create()
            }
        }
        .buttonStyle(WorkoutPrimaryButtonStyle())
        .disabled(creating || refreshing || needsLibraryReview || requiresAuthorityReview || sync.isRoutineMutationInFlight
                  || selectedExercises.isEmpty || (equipmentFree && homeDraft.validationMessage(for: selectedExercises) != nil)
                  || (!equipmentFree && liftingDraft.validationMessage(for: selectedExercises) != nil)
                  || name.trimmingCharacters(in: .whitespacesAndNewlines).count > 200
                  || (sync.plan == nil && !sync.canCreateRoutine))
        .accessibilityIdentifier("createWorkout.create")
    }

    private var creationButtonTitle: String {
        creating ? "Saving…" : creationLocked ? "Retry save" : completionTitle ?? "Save workout"
    }

    private func create() async {
        if let request = prescriptionRequest {
            await savePrescription(request)
            return
        }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let chosenName = cleanName.isEmpty ? suggestedName : cleanName
        let request: WorkoutPrescriptionRequest?
        if equipmentFree {
            // Keep the existing home-routine creation authority unchanged.
            guard sync.canContinueWorkoutCreation else { return }
            let planID: String
            let version: Int
            if let plan = sync.plan { planID = plan.id; version = plan.version }
            else if let result = await sync.ensureRoutinePlan(name: "My Training") {
                guard sync.canContinueWorkoutCreation else { return }
                planID = result.plan.id; version = result.plan.version
            } else { return }
            request = homeDraft.request(name: chosenName, exercises: selectedExercises, planID: planID, version: version)
        } else {
            // The prescribed endpoint also creates an absent plan atomically.
            guard !requiresAuthorityReview, let reviewedAuthority else { return }
            request = liftingDraft.request(name: chosenName, exercises: selectedExercises,
                planID: reviewedAuthority.planID, version: reviewedAuthority.version)
        }
        guard let request else { return }
        prescriptionRequest = request
        await savePrescription(request)
    }

    private func savePrescription(_ request: WorkoutPrescriptionRequest) async {
        guard sync.canContinueWorkoutCreation else { return }
        let outcome = await sync.saveWorkoutPrescription(request: request)
        guard sync.canContinueWorkoutCreation else { return }
        switch outcome {
        case let .saved(receipt):
            onCreated?(receipt.workout_id)
            if completionTitle != nil { dismiss() }
            else { createdID = receipt.workout_id }
        case .reviewDraft:
            if hadUncertainAttempt { needsLibraryReview = true }
            else {
                prescriptionRequest = nil
                if !equipmentFree { needsAuthorityReview = true }
            }
        case .needsReview:
            // A changed receipt may describe an already saved workout; never
            // invent new IDs and risk a duplicate after an uncertain reply.
            needsLibraryReview = true
        case .retrySameRequest: hadUncertainAttempt = true
        }
    }
}
