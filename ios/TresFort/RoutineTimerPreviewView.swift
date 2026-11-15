import SwiftUI

struct RoutineTimerPreviewView: View {
    let preview: RoutineTimerPreview
    @State private var stepIndex = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(preview.timeSummary).font(.headline)
                .accessibilityIdentifier("routinePreview.duration")
            Text(preview.timeExplanation).font(.footnote).foregroundStyle(Theme.muted)
            if !preview.steps.isEmpty {
                let step = preview.steps[safePreviewIndex]
                VStack(alignment: .leading, spacing: 8) {
                    Text("Step \(safePreviewIndex + 1) of \(preview.steps.count) · \(step.context)")
                        .font(.caption).foregroundStyle(Theme.muted)
                    Text(step.title).font(.headline)
                        .accessibilityIdentifier("routinePreview.stepTitle")
                    Text(step.target).font(.body)
                        .accessibilityIdentifier("routinePreview.stepTarget")
                    Text(step.instruction).font(.footnote).foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12).background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12))
                HStack {
                    Button("Previous step") { stepIndex = max(0, safePreviewIndex - 1) }
                        .frame(minHeight: 44)
                        .disabled(safePreviewIndex == 0)
                        .accessibilityIdentifier("routinePreview.previous")
                    Spacer(minLength: 12)
                    Button("Next step") { stepIndex = min(preview.steps.count - 1, safePreviewIndex + 1) }
                        .frame(minHeight: 44)
                        .disabled(safePreviewIndex + 1 == preview.steps.count)
                        .accessibilityIdentifier("routinePreview.next")
                }
                .buttonStyle(.bordered)
                Text("No rest follows the final set. Previewing does not start or log a workout.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
        }
        .foregroundStyle(Theme.text)
        .onChange(of: preview) { _, _ in stepIndex = 0 }
    }

    private var safePreviewIndex: Int { min(stepIndex, max(0, preview.steps.count - 1)) }
}
