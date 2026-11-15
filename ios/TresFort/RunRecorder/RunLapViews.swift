import SwiftUI

/// A page of the recorder while a run records (docs/plans/run-recorder P8).
/// A planned run opens on its step and swipes to the numbers, the map and
/// the plan; a run without a plan swipes between the numbers and the map.
enum RunPage: String, CaseIterable, Identifiable {
    case step
    case numbers
    case map
    case plan

    var id: String { rawValue }

    var title: String {
        switch self {
        case .step: "Step"
        case .numbers: "Numbers"
        case .map: "Map"
        case .plan: "Plan"
        }
    }

    static func pages(planned: Bool) -> [RunPage] {
        planned ? [.step, .numbers, .map, .plan] : [.numbers, .map]
    }
}

/// The page names above the pages: the one showing is underlined, and a
/// tap goes to a page, as a swipe does.
struct RunPageTabs: View {
    let pages: [RunPage]
    @Binding var selection: RunPage

    var body: some View {
        HStack(spacing: 4) {
            ForEach(pages) { page in
                Button {
                    selection = page
                } label: {
                    Text(page.title.uppercased())
                        .font(Theme.mono(12, .bold)).tracking(1)
                        .foregroundStyle(page == selection ? Theme.text : Theme.muted)
                        .padding(.horizontal, 8)
                        .frame(minHeight: 32)
                        .overlay(alignment: .bottom) {
                            if page == selection {
                                Capsule().fill(Theme.signal).frame(height: 2).padding(.horizontal, 8)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(page == selection ? .isSelected : [])
                .accessibilityIdentifier("runRecorder.page.\(page.rawValue)")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// How far through a lap: an orange bar on a raised track.
struct RunLapBar: View {
    let fraction: Double
    var height: CGFloat = 8

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RaisedFill()
                Rectangle().fill(Theme.signal)
                    .frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: height)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }
}

/// The step page: the step's time or distance left as the biggest number
/// on the screen, the pace or heart rate against its target, and what's
/// next. Once the plan is done it says so and the next whole mile or
/// kilometer takes over.
struct RunStepPage: View {
    @ObservedObject var model: RunRecorderModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(spacing: 8) {
                if let lap = model.lapStatus(at: context.date) {
                    card(lap, at: context.date)
                }
                RunTotalsRow(model: model, date: context.date)
            }
        }
    }

    private var paused: Bool { model.phase == .paused }

    private func card(_ lap: RunLapStatus, at date: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                Text(lap.planned ? lap.title : "PLAN DONE")
                    .font(Theme.mono(12, .heavy)).tracking(1.5)
                    .foregroundStyle(Theme.signal)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: 0)
                if let position = lap.position {
                    Text(position).font(Theme.mono(12, .semibold)).foregroundStyle(Theme.muted)
                }
                if lap.planned {
                    Button("Skip") { model.skipPlanStep() }
                        .font(Theme.mono(13, .bold))
                        .buttonStyle(.bordered)
                        .tint(Theme.text)
                        .frame(minHeight: 44)
                        .accessibilityLabel("Skip this step")
                        .accessibilityIdentifier("runRecorder.skipStep")
                }
            }
            VStack(spacing: 6) {
                Text(lap.left)
                    .font(Theme.number(132))
                    .foregroundStyle(paused ? Theme.muted : Theme.text)
                    .monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.4)
                    .accessibilityIdentifier("runRecorder.stepLeft")
                Text(lap.planned ? "LEFT OF \(lap.whole)" : "TO \(lap.title)")
                    .font(Theme.mono(11, .bold)).tracking(2)
                    .foregroundStyle(Theme.muted)
                if !lap.planned {
                    Text("Keep going or end the run.")
                        .font(.callout).foregroundStyle(Theme.text)
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
            RunLapBar(fraction: lap.fraction)
            if lap.planned {
                reading(lap, at: date).padding(.top, 14)
                RaisedFill().frame(height: 1).padding(.vertical, 12)
                nextLine(lap)
            }
        }
        .frame(maxHeight: .infinity)
        .heroCard(padding: 16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("runRecorder.planStep")
    }

    /// The pace, or the heart rate for a heart rate target, and where it
    /// sits against the target.
    private func reading(_ lap: RunLapStatus, at date: Date) -> some View {
        let isHeartRate = lap.isHeartRateTarget
        let value = model.targetValue(lap.target, at: date)
        let verdict = RunLapStatus.verdict(value, target: lap.target)
        let shown: String
        if isHeartRate {
            shown = value.map { "\(Int($0.rounded()))" } ?? "–"
        } else {
            shown = RunFormat.pace(model.run.flatMap { RunPace.fresh($0, at: date, unit: model.unit) })
        }
        return HStack(alignment: .lastTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(isHeartRate ? "HEART RATE" : "PACE /\(model.unit.abbreviation.uppercased())")
                    .font(Theme.mono(11, .bold)).tracking(1).foregroundStyle(Theme.muted)
                Text(shown)
                    .font(Theme.number(44)).monospacedDigit()
                    .foregroundStyle(Theme.text)
                    .lineLimit(1).minimumScaleFactor(0.5)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                if let target = lap.target {
                    Text("Target " + RunPlanFormat.target(target, unit: model.unit))
                        .font(Theme.mono(13)).foregroundStyle(Theme.muted)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                if let verdict {
                    Label(verdict.text.uppercased(),
                          systemImage: verdict.isOnTarget ? "checkmark" : verdictIcon(verdict))
                        .font(Theme.mono(13, .bold))
                        .foregroundStyle(verdict.isOnTarget ? Theme.done : Theme.signal)
                        .accessibilityIdentifier("runRecorder.verdict")
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func verdictIcon(_ verdict: RunLapStatus.Verdict) -> String {
        switch verdict {
        case .speedUp, .pickItUp: "arrow.up"
        case .easeOff: "arrow.down"
        case .onTarget: "checkmark"
        }
    }

    private func nextLine(_ lap: RunLapStatus) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(lap.next == nil ? "LAST STEP" : "NEXT")
                .font(Theme.mono(11, .bold)).tracking(1.5).foregroundStyle(Theme.muted)
            if let next = lap.next {
                Text(next).font(Theme.mono(15)).foregroundStyle(Theme.text).lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Time, distance and heart rate in three tiles under the step.
struct RunTotalsRow: View {
    @ObservedObject var model: RunRecorderModel
    let date: Date

    var body: some View {
        let run = model.run
        HStack(spacing: 8) {
            tile(RunFormat.duration(run?.activeSeconds(at: date) ?? 0), "Time")
            tile(RunFormat.distance(run?.distanceMeters ?? 0, in: model.unit), model.unit.title)
            tile(heartRate, "HR")
        }
    }

    private var heartRate: String {
        guard let sample = model.latestHeartRate,
              date.timeIntervalSince(sample.timestamp) < RunRecorderModel.heartRateFreshness else { return "–" }
        return "\(Int(sample.beatsPerMinute.rounded()))"
    }

    private func tile(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(Theme.number(22)).monospacedDigit()
                .foregroundStyle(Theme.text)
                .lineLimit(1).minimumScaleFactor(0.5)
            Text(label.uppercased()).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 56)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }
}

/// The lap in one line above the other pages, so the time left never
/// leaves the screen: the step's time or distance left and what's next,
/// or the distance to the next whole mile or kilometer.
struct RunLapStrip: View {
    @ObservedObject var model: RunRecorderModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            if let lap = model.lapStatus(at: context.date) {
                VStack(spacing: 8) {
                    HStack(alignment: .center, spacing: 12) {
                        Text(lap.left)
                            .font(Theme.number(lap.planned ? 40 : 28)).monospacedDigit()
                            .foregroundStyle(model.phase == .paused ? Theme.muted : Theme.text)
                            .lineLimit(1).minimumScaleFactor(0.5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(lap.title)
                                .font(Theme.mono(12, .heavy)).tracking(1)
                                .foregroundStyle(Theme.signal).lineLimit(1)
                            Text(detail(lap))
                                .font(Theme.mono(13)).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    RunLapBar(fraction: lap.fraction, height: 4)
                }
                .heroCard(padding: 12, cornerRadius: 14)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("runRecorder.lapStrip")
            }
        }
    }

    private func detail(_ lap: RunLapStatus) -> String {
        guard lap.planned else { return "to go" }
        return lap.next.map { "left · Next " + $0 } ?? "left · last step"
    }
}

/// The plan page: every step in order, the ones run checked off and the
/// current one marked, scrolled to the current step.
struct RunPlanProgressList: View {
    @ObservedObject var model: RunRecorderModel

    var body: some View {
        let steps = model.planSteps
        let current = model.run?.plan?.progress.stepIndex ?? 0
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                        row(step, index: index, current: current)
                            .id(index)
                        if index < steps.count - 1 { Divider().overlay(Theme.dim) }
                    }
                }
                .padding(.horizontal, 12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
            }
            .onAppear { proxy.scrollTo(min(current, max(steps.count - 1, 0)), anchor: .center) }
            .onChange(of: current) { _, index in
                withAnimation { proxy.scrollTo(min(index, max(steps.count - 1, 0)), anchor: .center) }
            }
        }
        .accessibilityIdentifier("runRecorder.planList")
    }

    private func row(_ step: RunPlan.ExpandedStep, index: Int, current: Int) -> some View {
        let isCurrent = index == current
        let isDone = index < current
        return HStack(spacing: 10) {
            Image(systemName: isDone ? "checkmark.circle.fill" : (isCurrent ? "play.circle.fill" : "circle"))
                .foregroundStyle(isDone ? Theme.done : (isCurrent ? Theme.signal : Theme.dim))
                .accessibilityLabel(isDone ? "Done" : (isCurrent ? "Now" : "To come"))
            VStack(alignment: .leading, spacing: 2) {
                Text(title(step))
                    .font(Theme.mono(11, .bold)).tracking(1)
                    .foregroundStyle(isCurrent ? Theme.signal : Theme.muted)
                Text(RunPlanFormat.text(step.step, unit: model.unit))
                    .font(Theme.mono(15, isCurrent ? .bold : .medium))
                    .foregroundStyle(isDone ? Theme.muted : Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    private func title(_ step: RunPlan.ExpandedStep) -> String {
        var text = RunPlanFormat.kindTitle(step.step.kind).uppercased()
        if let round = step.round, let rounds = step.rounds { text += " · REP \(round) OF \(rounds)" }
        return text
    }
}
