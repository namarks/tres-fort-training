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
