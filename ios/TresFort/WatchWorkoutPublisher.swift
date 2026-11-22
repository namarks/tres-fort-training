import Combine
import CryptoKit
import Foundation

// The iPhone's side of lifting from the wrist (docs/plans/apple-watch P5).
// The Watch shows the set the runner is on and its taps are requests: each
// one is applied through the guarded commands a linked iPad uses
// (`StationLinkCommandRunner`), so the iPhone acts only while its runner
// still shows what the Watch showed, and logs every set itself.

/// Words the runner's display for the wrist.
enum WatchWorkoutBuilder {
    private struct Shown: Encodable {
        let run: String
        let kind: String
        let step: WorkoutDisplayState.Step?
        let slotID: String?
        /// When a running timed set started, in milliseconds.
        let timerStart: Int?
    }

    /// Names what a tap acts on: the shown set with its exact values, or the
    /// place between sets, in one run of one workout (`run`). A rest and the
    /// ready set it leads to share one token, because the Watch ends a rest
    /// on its own clock while the iPhone may still be asleep. A running
    /// timer is named by its start too, so Stop & log for a hold cancelled
    /// on the iPhone never stops the one started after it.
    static func token(for display: WorkoutDisplayState, run: String) -> String {
        let kind = display.phase == .ready || display.phase == .rest ? "set" : display.phase.rawValue
        let timerStart = display.phase == .active
            ? display.timedStartDate.map { Int(($0.timeIntervalSince1970 * 1_000).rounded()) } : nil
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        guard let bytes = try? encoder.encode(Shown(run: run, kind: kind, step: display.current,
                                                    slotID: display.currentSlotID, timerStart: timerStart)) else {
            // Never equal to anything the Watch holds.
            return UUID().uuidString
        }
        return SHA256.hash(data: bytes).prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    static func state(_ display: WorkoutDisplayState, date: String, run: String) -> WatchWorkoutState {
        let words = betweenSets(display)
        return WatchWorkoutState(
            date: date,
            phase: WatchWorkoutState.Phase(rawValue: display.phase.rawValue) ?? .blocked,
            workoutName: display.workoutName,
            token: token(for: display, run: run),
            set: display.current.map(set),
            restEndDate: display.restEndDate,
            timedEndDate: display.timedEndDate,
            timedStartDate: display.timedStartDate,
            title: words?.title,
            message: words?.message)
    }

    static func set(_ step: WorkoutDisplayState.Step) -> WatchWorkoutSet {
        let needsWeight = step.needsWeight == true
        // A hold with no load (a plank) shows its time alone; one that
        // carries a load shows both.
        let unloadedHold = step.durationSeconds != nil && step.weight == 0
        return WatchWorkoutSet(
            exerciseName: step.exerciseName,
            position: position(of: step),
            showsLoad: needsWeight || (step.weight != nil && !unloadedHold),
            weight: needsWeight || unloadedHold ? nil : step.weight,
            weightUnit: step.weightUnit.rawValue,
            weightStep: weightStep(step.weightUnit),
            allowsAssistance: step.isBodyweight,
            isPerHand: step.isPerHand,
            reps: step.reps,
            isPerSide: step.isUnilateral,
            durationSeconds: step.durationSeconds,
            effort: effort(step))
    }

    /// The runner's small step on the iPhone.
    static func weightStep(_ unit: WeightUnit) -> Double { unit == .kg ? 2.5 : 5 }

    static func position(of step: WorkoutDisplayState.Step) -> String {
        if let group = step.groupTitle, let round = step.roundNumber {
            return "\(group) · Round \(round)" + (step.totalRounds.map { " of \($0)" } ?? "")
        }
        let set = "Set \(step.setNumber)" + (step.totalSets.map { " of \($0)" } ?? "")
        return (step.isWarmup ? "Warm-up · " : "") + set
    }

    static func effort(_ step: WorkoutDisplayState.Step) -> String? {
        if let effort = step.rpe { return "RPE " + SetValueFormatter.number(effort) }
        return step.targetRPE.map { "Target RPE " + SetValueFormatter.number($0) }
    }

    /// A place with no set to act on. Choosing an exercise, review and
    /// Finish stay on the iPhone.
    static func betweenSets(_ display: WorkoutDisplayState) -> (title: String, message: String)? {
        switch display.phase {
        case .ready, .active, .rest:
            return nil
        case .exerciseComplete:
            return ("Exercise complete", "Choose the next exercise on your iPhone.")
        case .review:
            return ("Sets complete", "Review and finish on your iPhone.")
        case .finished:
            return ("Workout complete", display.message ?? "Workout saved.")
        case .paused:
            return ("Workout paused", "Open the workout on your iPhone to continue.")
        case .blocked:
            return ("Check your iPhone", display.message ?? "Check the workout on your iPhone.")
        }
    }
}

@MainActor
extension SyncModel {
    /// What the Watch shows of the workout: nothing unless this account's
    /// own runner is open. A partner workout has its own controls.
    func watchWorkoutState(displayUnit: WeightUnit) -> WatchWorkoutState? {
        guard running, !isPartnerWorkout, terminalActionTarget != nil else { return nil }
        return WatchWorkoutBuilder.state(WorkoutDisplayState.project(sync: self, displayUnit: displayUnit),
                                         date: todayString, run: watchWorkoutRun)
    }

    /// Names this run of this workout: its place in the day and when the
    /// runner started it, which a restored runner keeps. A workout discarded
    /// and started again, or another workout with the same exercises, is
    /// another run, so a tap meant for the earlier one is refused.
    var watchWorkoutRun: String {
        let scope = currentWorkoutScope
        let started = workoutStart.map { Int($0.timeIntervalSince1970.rounded(.down)) } ?? 0
        return "\(scope.date)#\(scope.slot)#\(started)"
    }
}

/// Applies a tap from the Watch to the iPhone's runner.
@MainActor
enum WatchWorkoutCommandRunner {
    static let chooseWeight = "Choose a weight for this set first."

    /// The unit the iPhone shows loads in, which the Watch shows too.
    static func displayUnit(_ settings: UserDefaults = .standard) -> WeightUnit {
        settings.string(forKey: WeightUnit.preferenceKey).flatMap(WeightUnit.init(rawValue:)) ?? .lb
    }

    static func apply(_ command: WatchWorkoutCommand, to sync: SyncModel,
                      displayUnit: WeightUnit) async -> WatchWorkoutReceipt {
        func now() -> WatchWorkoutState? { sync.watchWorkoutState(displayUnit: displayUnit) }
        func refused(_ message: String) -> WatchWorkoutReceipt { .refused(command, message, state: now()) }
        func project() -> WorkoutDisplayState { WorkoutDisplayState.project(sync: sync, displayUnit: displayUnit) }
        /// One guarded Station command for what the runner shows now; nil
        /// when the iPhone applied it, else why not.
        func station(_ action: StationLinkCommand.Action, _ display: WorkoutDisplayState) async -> String? {
            let receipt = await StationLinkCommandRunner.apply(
                StationLinkCommand(action, step: display.current, phase: display.phase,
                                   currentSlotID: display.currentSlotID), to: sync)
            return receipt.accepted ? nil : receipt.message ?? StationLinkCommandReceipt.movedOn
        }

        guard sync.running, !sync.isPartnerWorkout, sync.terminalActionTarget != nil else {
            return refused(StationLinkCommandReceipt.openWorkout)
        }
        var display = project()
        // The Watch showed something else: another set, other values, a
        // choice made since on the iPhone, or another run of the workout.
        guard command.token == WatchWorkoutBuilder.token(for: display, run: sync.watchWorkoutRun) else {
            return refused(StationLinkCommandReceipt.movedOn)
        }

        switch command.action {
        case .endRest:
            if let reason = await station(.endRest, display) { return refused(reason) }
        case .stopTimer:
            if let reason = await station(.stopTimer, display) { return refused(reason) }
        case .logSet, .startTimer:
            // The Watch offers the set once the rest's end has passed on its
            // own clock; the iPhone's rest may still be open.
            if display.phase == .rest {
                if let reason = await station(.endRest, display) { return refused(reason) }
                display = project()
            }
            guard let step = display.current else { return refused(StationLinkCommandReceipt.movedOn) }
            if step.needsWeight == true, command.weight == nil { return refused(chooseWeight) }
            if let values = changedValues(command, from: step) {
                if let reason = await station(.setValues(values, unit: step.weightUnit), display) {
                    return refused(reason)
                }
                display = project()
            }
            let action: StationLinkCommand.Action = command.action == .logSet ? .logSet : .startTimer
            if let reason = await station(action, display) { return refused(reason) }
        }
        // A logged set keeps its slot in flight for one more turn (the
        // runner's double-tap guard), which projects as blocked. Answer with
        // what the runner shows once that guard lets go.
        if let slot = display.currentSlotID {
            for _ in 0..<10 where sync.setSlotsInFlight.contains(slot) { await Task.yield() }
        }
        return .accepted(command, state: now())
    }

    /// The set's values with the crown's changes, or nil when the Watch
    /// changed nothing the set shows.
    static func changedValues(_ command: WatchWorkoutCommand,
                              from step: WorkoutDisplayState.Step) -> SetCorrectionValues? {
        let showsLoad = step.weight != nil || step.needsWeight == true
        let weight = showsLoad ? command.weight : nil
        let reps = step.durationSeconds == nil ? command.reps : nil
        let duration = step.durationSeconds == nil ? nil : command.durationSeconds
        let loadChanged = weight.map { new in step.weight.map { abs($0 - new) > 0.000_001 } ?? true } ?? false
        let repsChanged = reps.map { $0 != step.reps } ?? false
        let durationChanged = duration.map { $0 != step.durationSeconds } ?? false
        guard loadChanged || repsChanged || durationChanged else { return nil }
        let seconds = duration ?? step.durationSeconds
        return SetCorrectionValues(weight: weight ?? step.weight ?? 0,
                                   reps: reps ?? step.reps ?? seconds ?? 0,
                                   rpe: step.rpe, durationSeconds: seconds)
    }
}

/// Where the workout's state goes, and where the Watch's taps come from.
@MainActor
protocol WatchWorkoutPublishing: AnyObject {
    /// nil when no workout is open, or the account is leaving.
    func publishWorkout(_ state: WatchWorkoutState?)
    /// Answers a tap from the Watch. The signed-in account's tab shell sets
    /// it; with none, the Watch is told to open the app on the iPhone.
    var onWorkoutCommand: ((WatchWorkoutCommand) async -> WatchWorkoutReceipt)? { get set }
}

/// Keeps the Watch's copy of the running workout current and answers its
/// taps for one signed-in account. Like the Today publisher, the tab shell
/// owns one, and the feature-session boundary retires it.
@MainActor
final class WatchWorkoutPublisher {
    private weak var sync: SyncModel?
    private let watch: WatchWorkoutPublishing?
    private let settings: UserDefaults
    private var cancellables: Set<AnyCancellable> = []
    /// Whether the last state handed over was a workout, so an idle model's
    /// changes cost nothing.
    private var published = false
    private(set) var isRetired = false

    init(sync: SyncModel, auth: AuthModel, watch: WatchWorkoutPublishing? = nil,
         settings: UserDefaults = .standard) {
        self.sync = sync
        self.watch = watch ?? WatchDayLink.shared
        self.settings = settings
        guard let watch = self.watch else { return }
        // objectWillChange fires before the mutation lands; read on the next
        // main-actor turn. A short throttle keeps a burst of changes to one
        // projection without making the wrist lag behind a logged set.
        sync.objectWillChange
            .throttle(for: .milliseconds(250), scheduler: RunLoop.main, latest: true)
            .sink { [weak self] _ in Task { @MainActor in self?.refresh() } }
            .store(in: &cancellables)
        watch.onWorkoutCommand = { [weak self] command in
            guard let self, !self.isRetired, let sync = self.sync else {
                return .refused(command, StationLinkCommandReceipt.openWorkout)
            }
            let receipt = await WatchWorkoutCommandRunner.apply(
                command, to: sync, displayUnit: WatchWorkoutCommandRunner.displayUnit(self.settings))
            // The context carries the same state for a Watch that missed
            // the answer.
            self.refresh()
            return receipt
        }
        auth.observeFeatureSessionBoundary { [weak self] in
            self?.retire()
            return false
        }
        Task { @MainActor [weak self] in self?.refresh() }
    }

    func refresh() {
        guard !isRetired, let sync, let watch else { return }
        guard sync.running || published else { return }
        let state = sync.watchWorkoutState(displayUnit: WatchWorkoutCommandRunner.displayUnit(settings))
        published = state != nil
        watch.publishWorkout(state)
    }

    /// The account is leaving: its workout may not stay on the wrist.
    func retire() {
        guard !isRetired else { return }
        isRetired = true
        cancellables = []
        published = false
        watch?.publishWorkout(nil)
    }
}
