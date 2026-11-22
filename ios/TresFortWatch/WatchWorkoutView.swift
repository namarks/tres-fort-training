import SwiftUI
import WatchKit

/// A lifting workout on the wrist (docs/plans/apple-watch P5): the set the
/// iPhone's runner is on, one button for what to do next, and the crown for
/// the load and reps. Every tap is a request to the iPhone, which logs the
/// set or says why not; nothing here changes until the iPhone answers.
struct WatchWorkoutView: View {
    @ObservedObject var model: WatchDayModel
    let state: WatchWorkoutState

    var body: some View {
        // The rest ends on the Watch's own clock, so the screen is read
        // again each second.
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            content(at: timeline.date)
        }
        .tint(WatchTheme.signal)
    }

    @ViewBuilder private func content(at now: Date) -> some View {
        if let set = state.set, let primary = WatchWorkoutPresentation.primary(state, at: now) {
            if primary == .stopTimer {
                WatchTimedSetView(model: model, state: state, set: set)
                    .id(state.token)
            } else {
                // One view through a rest and the set it leads to, so a
                // load changed while resting is still there to log.
                WatchSetView(model: model, state: state, set: set, primary: primary,
                             restEnd: primary == .endRest ? state.restEndDate : nil)
                    .id(state.token)
            }
        } else {
            WatchBetweenSetsView(state: state)
        }
    }
}

/// The set to do, or the rest before it.
struct WatchSetView: View {
    private enum Field { case weight, reps, duration }

    @ObservedObject var model: WatchDayModel
    let state: WatchWorkoutState
    let set: WatchWorkoutSet
    let primary: WatchWorkoutPresentation.Primary
    /// Set while the rest is counting down.
    let restEnd: Date?

    @State private var draft: WatchSetDraft
    @FocusState private var focus: Field?
    /// Just after the button changes what it does, it waits: a second tap
    /// on End rest must not log the set.
    @State private var settling = false

    init(model: WatchDayModel, state: WatchWorkoutState, set: WatchWorkoutSet,
         primary: WatchWorkoutPresentation.Primary, restEnd: Date?) {
        self.model = model
        self.state = state
        self.set = set
        self.primary = primary
        self.restEnd = restEnd
        _draft = State(initialValue: WatchSetDraft(set))
    }

    private var canSend: Bool {
        guard model.isReachable, !model.isSending, !settling else { return false }
        // A set whose load isn't chosen can't be logged; its rest can end.
        return primary == .endRest || !set.showsLoad || draft.weight != nil
    }

    var body: some View {
        // The page has about 150 points under the clock on every Watch, so
        // nothing sits under the button: what stops it is said in its place.
        VStack(alignment: .leading, spacing: 5) {
            header
            HStack(spacing: 6) {
                if set.showsLoad {
                    WatchValueTile(
                        value: WatchWorkoutPresentation.loadText(draft.weight, of: set),
                        label: WatchWorkoutPresentation.loadLabel(draft.weight, of: set),
                        name: "Load", isFocused: focus == .weight,
                        onStep: { draft.stepWeight($0, of: set) })
                        .focused($focus, equals: .weight)
                        .onTapGesture { focus = .weight }
                        .accessibilityIdentifier("watch.workout.load")
                }
                if let seconds = draft.durationSeconds {
                    WatchValueTile(
                        value: WatchWorkoutPresentation.clock(seconds), label: "time",
                        name: "Time", isFocused: focus == .duration,
                        onStep: { draft.stepDuration($0) })
                        .focused($focus, equals: .duration)
                        .onTapGesture { focus = .duration }
                        .accessibilityIdentifier("watch.workout.time")
                } else if let reps = draft.reps {
                    WatchValueTile(
                        value: "\(reps)", label: WatchWorkoutPresentation.repsLabel(set),
                        name: "Reps", isFocused: focus == .reps,
                        onStep: { draft.stepReps($0) })
                        .focused($focus, equals: .reps)
                        .onTapGesture { focus = .reps }
                        .accessibilityIdentifier("watch.workout.reps")
                }
            }
            if let blocker {
                WatchActionNotice(text: blocker)
            } else {
                Button(WatchWorkoutPresentation.title(primary)) {
                    model.send(draft.command(WatchWorkoutPresentation.action(primary), token: state.token, set: set))
                }
                .buttonStyle(WatchPrimaryButtonStyle())
                .disabled(!canSend)
                .accessibilityIdentifier("watch.workout.primary")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 2)
        .onChange(of: primary) { _, _ in settle() }
        .modifier(WatchDeadlineHaptic(deadline: restEnd))
    }

    @ViewBuilder private var header: some View {
        if let restEnd {
            WatchLabel(text: "Rest · \(set.position)", color: WatchTheme.signal)
            HStack(alignment: .center, spacing: 8) {
                WatchCountdown(end: restEnd)
                    .font(WatchTheme.number(26))
                    .foregroundStyle(WatchTheme.text)
                    .lineLimit(1)
                    .fixedSize()
                    .accessibilityIdentifier("watch.workout.rest")
                VStack(alignment: .leading, spacing: 0) {
                    Text(set.exerciseName)
                        .font(.footnote)
                        .foregroundStyle(WatchTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if let effort = set.effort {
                        Text(effort)
                            .font(.caption2)
                            .foregroundStyle(WatchTheme.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            // The effort sits beside the set's place where both fit.
            if let effort = set.effort {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) {
                        WatchLabel(text: set.position)
                        Spacer(minLength: 0)
                        WatchLabel(text: effort)
                    }
                    WatchLabel(text: set.position)
                }
            } else {
                WatchLabel(text: set.position)
            }
            Text(set.exerciseName)
                .font(WatchTheme.display(26))
                .foregroundStyle(WatchTheme.text)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .accessibilityIdentifier("watch.workout.exercise")
        }
    }

    /// Why the button can't act now, shown where the button is.
    private var blocker: String? {
        if !model.isReachable { return WatchWorkoutPresentation.outOfReachShort }
        if primary != .endRest, set.showsLoad, draft.weight == nil { return WatchWorkoutPresentation.chooseWeight }
        return nil
    }

    private func settle() {
        settling = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            settling = false
        }
    }
}

/// A timed set while its timer runs.
struct WatchTimedSetView: View {
    @ObservedObject var model: WatchDayModel
    let state: WatchWorkoutState
    let set: WatchWorkoutSet

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            WatchLabel(text: set.position, color: WatchTheme.signal)
            Text(set.exerciseName)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(WatchTheme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Group {
                if let end = state.timedEndDate {
                    WatchCountdown(end: end)
                } else if let start = state.timedStartDate {
                    // An open hold counts up until it is stopped.
                    Text(start, style: .timer)
                } else {
                    Text(WatchWorkoutPresentation.clock(set.durationSeconds ?? 0))
                }
            }
            .font(WatchTheme.number(40))
            .monospacedDigit()
            .foregroundStyle(WatchTheme.text)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .accessibilityIdentifier("watch.workout.timer")
            if model.isReachable {
                Button(WatchWorkoutPresentation.title(.stopTimer)) {
                    model.send(WatchWorkoutCommand(id: UUID(), action: .stopTimer, token: state.token))
                }
                .buttonStyle(WatchPrimaryButtonStyle())
                .disabled(model.isSending)
                .accessibilityIdentifier("watch.workout.primary")
            } else {
                WatchActionNotice(text: WatchWorkoutPresentation.outOfReachShort)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 2)
        .modifier(WatchDeadlineHaptic(deadline: state.timedEndDate))
    }
}

/// Between sets where the wrist has nothing to do: the next exercise,
/// review and Finish are chosen on the iPhone.
struct WatchBetweenSetsView: View {
    let state: WatchWorkoutState

    private var isDone: Bool {
        state.phase == .review || state.phase == .finished || state.phase == .exerciseComplete
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: isDone ? "checkmark.circle.fill" : "iphone")
                    .font(.title3)
                    .foregroundStyle(isDone ? WatchTheme.done : WatchTheme.signal)
                    .accessibilityHidden(true)
                Text(state.title ?? state.workoutName)
                    .font(WatchTheme.display(28))
                    .foregroundStyle(WatchTheme.text)
                    .fixedSize(horizontal: false, vertical: true)
                if let message = state.message {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(WatchTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("watch.workout.between")
        }
    }
}

/// A load, reps or time. Tap it and turn the crown: one click of the crown
/// is one step.
struct WatchValueTile: View {
    let value: String
    let label: String
    /// What the number is, for VoiceOver.
    let name: String
    let isFocused: Bool
    let onStep: (Int) -> Void

    /// The crown counts clicks from where it was; only the change matters.
    @State private var crown = 0.0

    var body: some View {
        VStack(spacing: 0) {
            Text(value)
                .font(WatchTheme.number(26))
                .foregroundStyle(WatchTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            WatchLabel(text: label)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .background(WatchTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(isFocused ? WatchTheme.signal : Color.clear, lineWidth: 2))
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .focusable()
        .focusEffectDisabled()
        .digitalCrownRotation($crown, from: -100_000, through: 100_000, by: 1, sensitivity: .medium,
                              isContinuous: false, isHapticFeedbackEnabled: true)
        .onChange(of: crown) { old, new in
            let steps = Int(new.rounded()) - Int(old.rounded())
            if steps != 0 { onStep(steps) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
        .accessibilityValue("\(value) \(label)")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: onStep(1)
            case .decrement: onStep(-1)
            @unknown default: break
            }
        }
    }
}

/// Counts down to `end` and stays at zero after it.
struct WatchCountdown: View {
    let end: Date

    var body: some View {
        Text(timerInterval: min(Date(), end)...end, countsDown: true)
            .monospacedDigit()
    }
}

/// The one thing to do next, on the brand's orange.
struct WatchPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(WatchTheme.display(22))
            .tracking(0.8)
            .foregroundStyle(WatchTheme.onSignal)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(WatchTheme.signalFill.opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.4),
                        in: Capsule())
            .contentShape(Capsule())
    }
}

/// Why the iPhone didn't apply the last tap, over whichever page is shown.
struct WatchNoticeAlert: ViewModifier {
    @ObservedObject var model: WatchDayModel

    func body(content: Content) -> some View {
        content.alert(model.notice ?? "", isPresented: Binding(
            get: { model.notice != nil },
            set: { if !$0 { model.clearNotice() } })) {
            Button("OK") { model.clearNotice() }
        }
    }
}

/// What stops the button, in the button's place: the iPhone is out of
/// reach, or the set has no load yet.
struct WatchActionNotice: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(WatchTheme.text)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(WatchTheme.surface, in: Capsule())
            .accessibilityIdentifier("watch.workout.notice")
    }
}

/// A tap on the wrist when a rest or a timed set reaches its end, while the
/// app is in front. With the app away, the iPhone's own notification for
/// the same moment reaches the Watch.
struct WatchDeadlineHaptic: ViewModifier {
    let deadline: Date?

    func body(content: Content) -> some View {
        content.task(id: deadline) {
            guard let deadline else { return }
            let wait = deadline.timeIntervalSinceNow
            guard wait > 0 else { return }
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            // A sleep that outlived the moment (the wrist was down) says
            // nothing late.
            guard !Task.isCancelled, abs(deadline.timeIntervalSinceNow) < 2 else { return }
            WKInterfaceDevice.current().play(.notification)
        }
    }
}
