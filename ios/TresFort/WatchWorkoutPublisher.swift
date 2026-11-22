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

/// What the wrist's Start does for a row of Today's list.
enum WatchDayStart: Equatable {
    /// The day's own workout: start it, or continue the one under way.
    case primary
    /// A workout beside the day's own that is already on today's list.
    case listed(sessionID: String)
    /// A workout planned beside the day's own and not begun: it starts as
    /// a new session.
    case scheduled(workoutID: String)
}

@MainActor
extension SyncModel {
    /// The Start the wrist may ask for on a row of Today's list, by the
    /// rules of Today's own button (`TodayView.rowActions`); nil when the
    /// row has nothing to start now, or starts on the iPhone only: an
    /// activity is logged there, and a run opens the iPhone's recorder
    /// until the Watch records runs (apple-watch P2).
    func watchStart(for item: DailyWorkoutAgenda.Item) -> WatchDayStart? {
        guard !running, !isPartnerWorkout, !partnerReserved,
              !item.isDone, item.status != "skipped", !item.isActivity else { return nil }
        if let workout = item.workout, workout.exercises.count == 1, workout.exercises[0].isOutdoorRun {
            return nil
        }
        if let session = item.session, (session.slot ?? 0) > 0 {
            return canSwitchWorkout ? .listed(sessionID: session.id) : nil
        }
        guard let workout = item.workout, !workout.exercises.isEmpty else { return nil }
        if item.source == .primary {
            let blocked = currentWorkoutScope.slot == 0 && blocksNewWorkoutStart && !hasResumableWorkout
            return blocked ? nil : .primary
        }
        return canAddAnotherWorkout ? .scheduled(workoutID: workout.id) : nil
    }

    /// Starts what the wrist asked for through the steps Today's own button
    /// takes (`TodayView.startPrimary`, `startListed`, and a planned add-on's
    /// `addAnotherWorkout`). It never asks for notification permission: the
    /// iPhone may be locked in a pocket. Returns whether this account's
    /// runner is open.
    func performWatchStart(_ start: WatchDayStart) async -> Bool {
        guard !running else { return false }
        switch start {
        case .primary:
            if currentWorkoutScope.slot != 0, !selectPrimaryWorkout() { return false }
            guard !(blocksNewWorkoutStart && !hasResumableWorkout) else { return false }
            if hasResumableWorkout { resumeWorkout() } else { startToday() }
        case .listed(let sessionID):
            guard let session = sessions(on: todayString).first(where: { $0.id == sessionID }) else { return false }
            _ = startListedSession(session)
        case .scheduled(let workoutID):
            _ = await addAnotherWorkout(workoutID)
        }
        return running && !isPartnerWorkout
    }
}

/// Applies a tap from the Watch to the iPhone's runner.
@MainActor
enum WatchWorkoutCommandRunner {
    static let chooseWeight = "Choose a weight for this set first."
    static let openApp = "Open Très Fort on your iPhone, then try again."
    static let dayChanged = "Your day changed on your iPhone. Check Today, then try again."
    static let startOnPhone = "This workout can’t start from your Watch now. Start it on your iPhone."

    /// What the Watch is told when no signed-in account can take its tap.
    static func noAccount(_ command: WatchWorkoutCommand) -> String {
        command.action == .start ? openApp : StationLinkCommandReceipt.openWorkout
    }

    /// Start on the wrist's leading row: opens that workout on the runner,
    /// or says why not. A Start for a runner already open (the Watch's day
    /// was behind, or its first Start's answer was lost) answers with what
    /// the runner shows.
    static func start(_ command: WatchWorkoutCommand, to sync: SyncModel,
                      displayUnit: WeightUnit) async -> WatchWorkoutReceipt {
        if sync.running {
            guard let state = sync.watchWorkoutState(displayUnit: displayUnit) else {
                return .refused(command, StationLinkCommandReceipt.openWorkout)
            }
            return .accepted(command, state: state)
        }
        let today = sync.todayString
        // The row the Watch showed, as Today lists it now.
        guard let item = TodayDayList.rows(sync.dailyWorkoutAgenda).first(where: {
            WatchWorkoutPresentation.startToken(date: today, rowID: $0.id) == command.token
        }) else { return .refused(command, dayChanged) }
        guard let start = sync.watchStart(for: item), await sync.performWatchStart(start),
              let state = sync.watchWorkoutState(displayUnit: displayUnit)
        else { return .refused(command, startOnPhone) }
        return .accepted(command, state: state)
    }

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

        if command.action == .start { return await start(command, to: sync, displayUnit: displayUnit) }
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
        case .start:
            // Answered above.
            return refused(StationLinkCommandReceipt.movedOn)
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
                return .refused(command, WatchWorkoutCommandRunner.noAccount(command))
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
