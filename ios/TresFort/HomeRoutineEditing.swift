import SwiftUI

/// Adds exercises to a routine at home from the no-equipment catalog
/// (app-design-pass P27). Tapping one adds it to the end; tapping it again
/// takes it out. The list it fills is reordered on the screen below.
struct HomeExercisePicker: View {
    @ObservedObject var sync: SyncModel
    @Binding var exercises: [ExerciseCatalog]
    var onChange: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ExercisePickerList(sync: sync, equipmentFree: true) { exercise in
                let index = exercises.firstIndex { $0.id == exercise.id }
                Button {
                    if let index { exercises.remove(at: index) } else { exercises.append(exercise) }
                    onChange()
                } label: {
                    HStack(spacing: 12) {
                        ExerciseCatalogLabel(exercise: exercise)
                        Spacer()
                        if let index {
                            Text("\(index + 1)")
                                .font(.subheadline.bold()).foregroundStyle(Theme.bg)
                                .frame(width: 28, height: 28).background(Theme.accent).clipShape(Circle())
                        } else {
                            Image(systemName: "plus.circle").foregroundStyle(Theme.accent)
                        }
                    }
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .disabled(index == nil && exercises.count >= 50)
                .accessibilityAddTraits(index == nil ? [] : [.isSelected])
                .accessibilityIdentifier("homePicker.exercise.\(exercise.id)")
            }
            .navigationTitle("Add exercises")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("homePicker.done")
                }
            }
        }
    }
}

/// One exercise's own sets and reps or hold, apart from the rest of the
/// routine, or taking it out of the routine.
struct HomeExerciseTargetSheet: View {
    let exercise: ExerciseCatalog
    @Binding var routine: HomeRoutineDraft
    var onRemove: () -> Void
    @Environment(\.dismiss) private var dismiss

    private var timed: Bool { routine.isTimed(exercise) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if !routine.circuit {
                        Stepper("Sets: \(routine.sets(for: exercise) ?? 3)", value: setsBinding,
                                in: HomeRoutineDraft.setRange)
                            .accessibilityIdentifier("homeTarget.sets")
                    }
                    if timed {
                        Stepper("Hold: \(routine.amount(for: exercise) ?? 45) sec", value: secondsBinding,
                                in: 5...HomeRoutineDraft.secondRange.upperBound, step: 5)
                            .accessibilityIdentifier("homeTarget.seconds")
                    } else {
                        Stepper("Reps: \(routine.amount(for: exercise) ?? 8)", value: repsBinding,
                                in: HomeRoutineDraft.repRange)
                            .accessibilityIdentifier("homeTarget.reps")
                    }
                } footer: {
                    Text(routine.circuit
                         ? "Only this exercise. In a circuit every exercise shares the rounds."
                         : "Only this exercise. The others keep the routine's sets and \(timed ? "holds" : "reps").")
                }
                if !(routine.overrides[exercise.id]?.isEmpty ?? true) {
                    Button("Use the routine's") { routine.overrides[exercise.id] = nil }
                        .accessibilityIdentifier("homeTarget.reset")
                }
                Button("Remove from routine", role: .destructive) {
                    onRemove()
                    dismiss()
                }
                .accessibilityIdentifier("homeTarget.remove")
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(exercise.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("homeTarget.done")
                }
            }
            .tint(Theme.accent)
        }
    }

    private var setsBinding: Binding<Int> {
        Binding(get: { routine.sets(for: exercise) ?? 3 },
                set: { routine.overrides[exercise.id, default: .init()].sets = $0 })
    }

    private var repsBinding: Binding<Int> {
        Binding(get: { routine.amount(for: exercise) ?? 8 },
                set: { routine.overrides[exercise.id, default: .init()].reps = $0 })
    }

    private var secondsBinding: Binding<Int> {
        Binding(get: { routine.amount(for: exercise) ?? 45 },
                set: { routine.overrides[exercise.id, default: .init()].seconds = $0 })
    }
}

/// The routine's shared sets, reps, holds and rests, and whether it is done
/// as a circuit: what every exercise uses unless it has its own.
struct HomeRoutineTimingSheet: View {
    @Binding var routine: HomeRoutineDraft
    let exercises: [ExerciseCatalog]
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .body) private var fieldWidth: CGFloat = 80

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Follow as a circuit", isOn: $routine.circuit)
                        .accessibilityIdentifier("composer.home.circuit")
                    Toggle("Time every exercise", isOn: $routine.timeEveryExercise)
                        .accessibilityIdentifier("composer.home.timeEveryExercise")
                    field(routine.circuit ? "Rounds" : "Sets", text: $routine.sets, id: "sets")
                    if exercises.contains(where: routine.isTimed) {
                        field("Work or hold · seconds", text: $routine.seconds, id: "seconds")
                    }
                    if exercises.contains(where: { !routine.isTimed($0) }) {
                        field("Reps", text: $routine.reps, id: "reps")
                    }
                    if routine.circuit {
                        field("Between exercises · seconds", text: $routine.transitionRest, id: "transition")
                        field("Between rounds · seconds", text: $routine.roundRest, id: "roundRest")
                    } else {
                        field("Between sets · seconds", text: $routine.rest, id: "rest")
                    }
                } footer: {
                    Text(routine.circuit
                         ? "One set of each exercise per round, a short rest between exercises and a longer one after the last."
                         : "Finish one exercise's sets before the next, with a rest after each set. An exercise you set on its own keeps its values.")
                }
                if let message = routine.validationMessage(for: exercises) {
                    Text(message).font(.footnote).foregroundStyle(Theme.danger)
                }
                if let preview = routine.timerPreview(for: exercises) {
                    Section("Time and timer preview") {
                        RoutineTimerPreviewView(preview: preview)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Sets and rests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("composer.home.timingDone")
                }
            }
            .tint(Theme.accent)
        }
    }

    // Keep a long label out of the numeric field's touch/accessibility frame.
    private func field(_ title: String, text: Binding<String>, id: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).accessibilityHidden(true)
            Spacer(minLength: 12)
            TextField("", text: text)
                .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                .frame(width: fieldWidth)
                .frame(minHeight: 44)
                .accessibilityLabel(title)
                .accessibilityIdentifier("composer.home.timing.\(id)")
        }
    }
}

/// A routine at home as it stands on screen (app-design-pass P27): where it
/// started, its exercises in order, its timing, and which of its editors is
/// open. Add to your week and Today's Add another workout both build one.
struct HomeRoutineBuilder {
    var start: PlanComposer.HomeStart
    var exercises: [ExerciseCatalog]
    var routine: HomeRoutineDraft
    /// The member changed the list, so a catalog that loads late doesn't
    /// put the suggestion back.
    var touched = false
    var adding = false
    var editing: ExerciseCatalog?
    var editingTiming = false

    init(start: PlanComposer.HomeStart = .core, catalog: [ExerciseCatalog]) {
        self.start = start
        exercises = start.exercises(in: catalog)
        routine = HomeRoutineDraft(circuit: start == .bodyweight)
    }

    /// Starts again from a suggestion, or empty for the member's own with
    /// the catalog open so the first exercise is a tap away.
    mutating func choose(_ start: PlanComposer.HomeStart, catalog: [ExerciseCatalog]) {
        self = HomeRoutineBuilder(start: start, catalog: catalog)
        adding = start == .own
    }

    mutating func remove(_ exercise: ExerciseCatalog) {
        exercises.removeAll { $0.id == exercise.id }
        routine.overrides[exercise.id] = nil
        touched = true
    }

    /// The catalog can arrive after the screen opens.
    mutating func refill(catalog: [ExerciseCatalog]) {
        if exercises.isEmpty, start != .own, !touched { exercises = start.exercises(in: catalog) }
    }

    var isReady: Bool { !exercises.isEmpty && routine.validationMessage(for: exercises) == nil }

    /// The shared timing in a few words: "3 sets · 2 min rest",
    /// "3 rounds · circuit".
    var timingSummary: String {
        routine.circuit
            ? "\(routine.sets) rounds · circuit"
            : "\(routine.sets) sets · \(PlanComposer.restPhrase(Int(routine.rest) ?? 0)) rest"
    }

    var header: String {
        start == .own ? "Your routine" : "Suggested \(start.title.lowercased()) routine · yours to change"
    }
}

/// The routine's chips and its list: drag to reorder, swipe to remove, tap
/// one for its own sets, reps or hold, add more from the no-equipment
/// catalog, and open its shared sets and rests. Put it in a Form or List and
/// attach `homeRoutineSheets` to the screen, outside the list.
struct HomeRoutineSections: View {
    @Binding var builder: HomeRoutineBuilder
    let catalog: [ExerciseCatalog]
    var disabled = false
    var showsChips = true
    /// Runs before a chip or editor takes over, such as to drop focus.
    var beforeEditing: () -> Void = {}

    var body: some View {
        Section {
            if showsChips { chips }
            ForEach(builder.exercises) { exercise in
                Button {
                    beforeEditing()
                    builder.editing = exercise
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "line.3.horizontal")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.dim)
                            .accessibilityHidden(true)
                        Text(exercise.name).font(Theme.mono(14, .bold)).foregroundStyle(Theme.text)
                        Spacer()
                        Text(builder.routine.targetLabel(for: exercise))
                            .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    }
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(disabled)
                .accessibilityElement(children: .combine)
                .accessibilityHint("Sets its own sets, reps or hold")
                .accessibilityIdentifier("composer.home.exercise.\(exercise.id)")
            }
            .onMove { from, to in
                builder.exercises.move(fromOffsets: from, toOffset: to)
                builder.touched = true
            }
            .onDelete { offsets in
                for index in offsets { builder.routine.overrides[builder.exercises[index].id] = nil }
                builder.exercises.remove(atOffsets: offsets)
                builder.touched = true
            }
            .moveDisabled(disabled)
            .deleteDisabled(disabled)
            Button {
                beforeEditing()
                builder.adding = true
            } label: {
                Label("Add exercise", systemImage: "plus").frame(minHeight: 44)
            }
            .foregroundStyle(Theme.accent)
            .disabled(disabled)
            .accessibilityIdentifier("composer.home.add")
            if !builder.exercises.isEmpty {
                Button {
                    beforeEditing()
                    builder.editingTiming = true
                } label: {
                    HStack {
                        Label("Sets and rests", systemImage: "timer")
                        Spacer()
                        Text(builder.timingSummary).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.muted)
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .foregroundStyle(Theme.accent)
                .disabled(disabled)
                .accessibilityIdentifier("composer.home.timing")
            }
        } header: {
            Text(builder.header)
        } footer: {
            if builder.exercises.isEmpty {
                Text("Add the exercises you want: core, stretches, push-ups and squats, all with no equipment.")
            } else if let message = builder.routine.validationMessage(for: builder.exercises) {
                Text(message).foregroundStyle(Theme.danger)
            } else {
                Text("Drag to reorder, swipe to remove, or tap one for its own sets, reps or hold. Today guides each set with timers.")
            }
        }
    }

    private var chips: some View {
        HomeStartChips(selected: builder.start, disabled: disabled) { start in
            beforeEditing()
            builder.choose(start, catalog: catalog)
        }
    }
}

/// Your own first, then the suggestions, so a suggestion reads as one
/// choice among others (P27).
struct HomeStartChips: View {
    var selected: PlanComposer.HomeStart?
    var disabled = false
    var onChoose: (PlanComposer.HomeStart) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(PlanComposer.HomeStart.chipOrder) { start in
                    let on = start == selected
                    Button { onChoose(start) } label: {
                        HStack(spacing: 4) {
                            if start == .own { Image(systemName: "plus").font(.system(size: 12, weight: .bold)) }
                            Text(start.title)
                        }
                    }
                    .font(Theme.mono(13, .bold))
                    .foregroundStyle(on ? Theme.onAccent : start == .own ? Theme.accent : Theme.text)
                    .padding(.horizontal, 12).frame(minHeight: 36)
                    .background(on ? Theme.accent : Theme.surface2, in: Capsule())
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? [.isSelected] : [])
                    .accessibilityIdentifier("composer.home.\(start.rawValue)")
                }
            }
            .padding(.vertical, 2)
        }
        .disabled(disabled)
    }
}

extension View {
    /// The routine's editors: the catalog, one exercise's own targets, and
    /// the shared sets and rests. Attach it outside the list, so a row that
    /// scrolls away doesn't close them.
    func homeRoutineSheets(sync: SyncModel, builder: Binding<HomeRoutineBuilder>) -> some View {
        self
            .sheet(isPresented: builder.adding) {
                HomeExercisePicker(sync: sync, exercises: builder.exercises) { builder.wrappedValue.touched = true }
            }
            .sheet(item: builder.editing) { exercise in
                HomeExerciseTargetSheet(exercise: exercise, routine: builder.routine) {
                    builder.wrappedValue.remove(exercise)
                }
                .presentationDetents([.medium])
            }
            .sheet(isPresented: builder.editingTiming) {
                HomeRoutineTimingSheet(routine: builder.routine, exercises: builder.wrappedValue.exercises)
            }
            .onChange(of: sync.catalog.count) { _, _ in
                builder.wrappedValue.refill(catalog: sync.catalog)
            }
    }
}
