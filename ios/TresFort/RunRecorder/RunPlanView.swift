import SwiftUI

/// A planned run laid out the way running watches show a structured
/// workout: the total first, then one row per step with its type, its
/// distance or time and its target, and each repeat as a block of the steps
/// it repeats.
struct RunPlanStepsView: View {
    let plan: RunPlan
    let unit: RunDistanceUnit
    var size: CGFloat = 13

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let total = RunPlanFormat.total(plan, unit: unit) {
                Text("TOTAL  " + total)
                    .font(Theme.mono(12, .bold)).tracking(1).foregroundStyle(Theme.muted)
            }
            ForEach(Array(plan.items.enumerated()), id: \.offset) { _, item in
                switch item {
                case .step(let step):
                    RunPlanStepRow(step: step, unit: unit, size: size)
                case .repeated(let times, let steps):
                    VStack(alignment: .leading, spacing: 6) {
                        Label(RunPlanFormat.repeatTitle(times), systemImage: "repeat")
                            .font(Theme.mono(12, .bold)).tracking(1).foregroundStyle(Theme.text)
                        ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                            RunPlanStepRow(step: step, unit: unit, size: size)
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.dim, lineWidth: 1))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("runPlan.steps")
    }
}

/// One step: a colored bar for its type, then the type, the amount and the
/// target ("No target" when it has none).
struct RunPlanStepRow: View {
    let step: RunPlan.Step
    let unit: RunDistanceUnit
    var size: CGFloat = 13

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 4)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(RunPlanFormat.kindTitle(step.kind).uppercased())
                    .font(Theme.mono(11, .bold)).tracking(1).foregroundStyle(color)
                Text(RunPlanFormat.amount(step, unit: unit))
                    .font(Theme.mono(size + 2, .bold)).foregroundStyle(Theme.text)
                Text(step.target.map { RunPlanFormat.targetTitle($0, unit: unit) } ?? "No target")
                    .font(Theme.mono(size)).foregroundStyle(Theme.muted)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var color: Color {
        switch step.kind {
        case .warmup, .cooldown: return Theme.muted
        case .work: return Theme.accent
        case .recovery: return Theme.done
        }
    }
}

/// What an outdoor run slot asks for: its steps, or a one-line label for a
/// run planned without them. Reads the recorder's miles-or-kilometers choice.
struct PlannedRunPrescription: View {
    let exercise: TemplateExercise
    var size: CGFloat = 13
    @AppStorage(RunDistanceUnit.preferenceKey) private var unitRaw = RunDistanceUnit.miles.rawValue
    private var unit: RunDistanceUnit { RunDistanceUnit(rawValue: unitRaw) ?? .miles }

    var body: some View {
        if let plan = exercise.runPlan {
            RunPlanStepsView(plan: plan, unit: unit, size: size)
        } else {
            Text(exercise.runPrescriptionLabel(in: unit))
                .font(Theme.mono(size)).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The plan on the recorder's start screen. Following it step by step while
/// recording comes later; for now the member reads it before starting.
struct PlannedRunCard: View {
    let run: PlannedRun
    let unit: RunDistanceUnit
    /// About eight lines; more scroll.
    static let maxStepsHeight: CGFloat = 170

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(run.workoutName.uppercased())
                .font(Theme.mono(12, .bold)).tracking(1).foregroundStyle(Theme.accent)
            if let plan = run.plan {
                // A long plan scrolls inside the card, so the recorder's
                // controls below it stay on screen.
                ViewThatFits(in: .vertical) {
                    RunPlanStepsView(plan: plan, unit: unit)
                    ScrollView { RunPlanStepsView(plan: plan, unit: unit) }
                        .accessibilityIdentifier("runRecorder.plannedRun.scroll")
                }
                .frame(maxHeight: Self.maxStepsHeight)
            } else {
                Text(run.durationSeconds.map { "Run · " + RunPlanFormat.duration($0) } ?? "Run at your own pace")
                    .font(Theme.mono(13)).foregroundStyle(Theme.muted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("runRecorder.plannedRun")
    }
}
