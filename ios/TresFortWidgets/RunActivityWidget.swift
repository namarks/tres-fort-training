import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

private let accent = BrandPalette.liveAccent

/// A recorded run on the Lock Screen and in the Dynamic Island. Finishing
/// takes a pause first, so a pocket tap can't end the run.
struct RunActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RunActivityAttributes.self) { ctx in
            ActivityFamilyLayout {
                wristLayout(ctx)
            } standard: {
                lockScreenLayout(ctx)
            }
            .activityBackgroundTint(BrandPalette.liveBackground)
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(lapTitle(ctx.state), systemImage: "figure.run")
                        .font(.caption).foregroundStyle(accent).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    islandNumber(ctx.state)
                        .font(.system(.title2, design: .rounded)).bold()
                        .monospacedDigit().foregroundStyle(accent)
                        .frame(maxWidth: 96)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack {
                        Text(islandDetail(ctx.state))
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        controls(ctx)
                    }
                }
            } compactLeading: {
                Image(systemName: "figure.run").foregroundStyle(accent)
            } compactTrailing: {
                islandNumber(ctx.state).monospacedDigit().foregroundStyle(accent).frame(maxWidth: 52)
            } minimal: {
                Image(systemName: ctx.state.isPaused ? "pause.fill" : "figure.run").foregroundStyle(accent)
            }
            .keylineTint(accent)
        }
        .watchSmartStackFamily()
    }

    /// Lock Screen and banner (P8). A planned step's time left leads,
    /// with the pace or heart rate against its target and what's next.
    /// Without a step, the run's time leads and the bar counts to the next
    /// whole mile or kilometer. The content takes the dark-mode colors,
    /// since the activity sits on navy.
    private func lockScreenLayout(_ ctx: ActivityViewContext<RunActivityAttributes>) -> some View {
        let state = ctx.state
        let lap = state.lap
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                Text(lapTitle(state))
                    .font(.system(size: 12, weight: .heavy)).tracking(1)
                    .foregroundStyle(BrandPalette.signal).lineLimit(1)
                Spacer(minLength: 8)
                controls(ctx)
            }
            HStack(alignment: .lastTextBaseline) {
                if let lap, lap.planned {
                    lapLeft(lap, state)
                        .font(.system(size: 56, weight: .heavy, design: .rounded))
                        .monospacedDigit().foregroundStyle(accent)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Text("LEFT").font(.system(size: 11, weight: .bold)).foregroundStyle(BrandPalette.muted)
                } else {
                    clock(state)
                        .font(.system(size: 56, weight: .heavy, design: .rounded))
                        .monospacedDigit().foregroundStyle(accent)
                        .lineLimit(1).minimumScaleFactor(0.6)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    reading(state)
                    if let lap, let target = lap.target {
                        Text((lap.verdict.map { lap.onTarget ? "✓ " : "\($0) · " } ?? "") + target)
                            .font(.caption.bold())
                            .foregroundStyle(lap.onTarget ? BrandPalette.done : BrandPalette.muted)
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                }
            }
            lapBar(lap, state).padding(.top, 8)
            HStack {
                if let lap, lap.planned {
                    if let next = lap.next {
                        (Text("Next ").foregroundStyle(BrandPalette.muted) + Text(next).foregroundStyle(BrandPalette.text))
                            .lineLimit(1)
                    } else {
                        Text("Last step").foregroundStyle(BrandPalette.muted)
                    }
                    Spacer(minLength: 8)
                    HStack(spacing: 4) {
                        clock(state)
                        Text("· " + distance(state))
                    }
                    .foregroundStyle(BrandPalette.muted).lineLimit(1)
                } else {
                    if let lap {
                        Text("\(lap.left) to \(lap.title.lowercased())").foregroundStyle(BrandPalette.muted).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Text(distance(state)).foregroundStyle(BrandPalette.text).lineLimit(1)
                }
            }
            .font(.footnote).monospacedDigit()
            .padding(.top, 8)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .environment(\.colorScheme, .dark)
    }

    /// "RUN · REP 2 OF 4", "PAUSED · RUN · REP 2 OF 4", or "RUN" without a
    /// planned step.
    private func lapTitle(_ state: RunActivityAttributes.ContentState) -> String {
        let title = state.lap.flatMap { $0.planned ? $0.title : nil } ?? "RUN"
        return state.isPaused ? "PAUSED · " + title : title
    }

    /// A timed step counts down on its own; a distance step, or any step
    /// while paused, shows what was left at the last update.
    @ViewBuilder private func lapLeft(_ lap: RunActivityAttributes.Lap,
                                      _ state: RunActivityAttributes.ContentState) -> some View {
        if let range = lap.timerRange(state) {
            Text(timerInterval: range, countsDown: true)
        } else {
            Text(lap.left)
        }
    }

    @ViewBuilder private func lapBar(_ lap: RunActivityAttributes.Lap?,
                                     _ state: RunActivityAttributes.ContentState) -> some View {
        Group {
            if let lap, let range = lap.timerRange(state) {
                ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
            } else {
                ProgressView(value: lap?.fraction ?? 0)
            }
        }
        .progressViewStyle(.linear)
        .tint(BrandPalette.signal)
        .labelsHidden()
    }

    /// The pace, or the heart rate when the step's target is one.
    @ViewBuilder private func reading(_ state: RunActivityAttributes.ContentState) -> some View {
        if state.lap?.targetIsHeartRate == true {
            (Text(state.heartRate.map { "\(Int($0.rounded()))" } ?? "–")
             + Text(" bpm").font(.caption2.bold()).foregroundStyle(BrandPalette.muted))
                .font(.system(size: 26, weight: .heavy, design: .rounded)).monospacedDigit()
                .foregroundStyle(BrandPalette.text)
        } else {
            (Text(RunFormat.pace(state.currentPace))
             + Text(" /\(state.unit.abbreviation)").font(.caption2.bold()).foregroundStyle(BrandPalette.muted))
                .font(.system(size: 26, weight: .heavy, design: .rounded)).monospacedDigit()
                .foregroundStyle(BrandPalette.text)
        }
    }

    /// Apple Watch Smart Stack: a planned step's time left first, else the
    /// run's time, then distance and pace, then the same controls as the
    /// Lock Screen (Finish only while paused).
    private func wristLayout(_ ctx: ActivityViewContext<RunActivityAttributes>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(lapTitle(ctx.state))
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                Text(distance(ctx.state))
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    .monospacedDigit()
            }
            Group {
                if let lap = ctx.state.lap, lap.planned {
                    lapLeft(lap, ctx.state)
                } else {
                    clock(ctx.state)
                }
            }
            .font(.system(size: 30, weight: .heavy, design: .rounded))
            .monospacedDigit().foregroundStyle(accent)
            HStack(spacing: 6) {
                Text(pace(ctx.state))
                    .font(.caption2).foregroundStyle(.secondary)
                    .monospacedDigit().lineLimit(1)
                Spacer(minLength: 0)
                controls(ctx, font: .caption2.bold())
            }
        }
    }

    /// The Dynamic Island's number: a timed step's countdown, else the
    /// run's time.
    @ViewBuilder private func islandNumber(_ state: RunActivityAttributes.ContentState) -> some View {
        if let lap = state.lap, lap.planned {
            lapLeft(lap, state)
        } else {
            clock(state)
        }
    }

    @ViewBuilder private func clock(_ state: RunActivityAttributes.ContentState) -> some View {
        if let paused = state.pausedSeconds {
            Text(RunFormat.duration(paused))
        } else {
            Text(state.clockStart, style: .timer)
        }
    }

    private func distance(_ state: RunActivityAttributes.ContentState) -> String {
        "\(RunFormat.distance(state.meters, in: state.unit)) \(state.unit.abbreviation)"
    }

    /// "Next 2 min recovery · 2.31 mi", or distance and pace.
    private func islandDetail(_ state: RunActivityAttributes.ContentState) -> String {
        if let lap = state.lap, lap.planned, let next = lap.next {
            return "Next \(next) · \(distance(state))"
        }
        return "\(distance(state)) · \(pace(state))"
    }

    private func pace(_ state: RunActivityAttributes.ContentState) -> String {
        "\(RunFormat.pace(state.currentPace)) /\(state.unit.abbreviation)"
    }

    private func controls(_ ctx: ActivityViewContext<RunActivityAttributes>,
                          font: Font = .caption.bold()) -> some View {
        let id = ctx.attributes.recordingID
        return HStack {
            if ctx.state.isPaused {
                Button("Resume", intent: RunRecorderControlIntent(recordingID: id, action: .resume))
                Button("Finish", intent: RunRecorderControlIntent(recordingID: id, action: .finish))
            } else {
                Button("Pause", intent: RunRecorderControlIntent(recordingID: id, action: .pause))
            }
        }
        .font(font).buttonStyle(.bordered).tint(accent)
    }
}
