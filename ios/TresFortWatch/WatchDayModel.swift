import Foundation
import WatchConnectivity
import WatchKit
import WidgetKit

/// Holds the last day the iPhone sent and the civil date it is shown for.
/// The Watch keeps its own copy, so the app opens with the day before the
/// iPhone is in reach, and drops it when the iPhone says the account left.
/// The complication reads the same copy and reloads when it changes.
///
/// It also holds the set the iPhone's runner is on during a lifting workout
/// and sends the wearer's taps to the iPhone (P5). That state is never
/// stored: the iPhone keeps the workout.
@MainActor
final class WatchDayModel: NSObject, ObservableObject {
    /// The app's one model: the screen and the background wake share it.
    static let shared = WatchDayModel()

    @Published private(set) var snapshot: WatchDaySnapshot?
    @Published private(set) var today: String
    /// What the iPhone's runner shows, as last received.
    @Published private(set) var workout: WatchWorkoutState?
    /// Whether a tap can reach the iPhone now.
    @Published private(set) var isReachable = false
    /// A tap is on its way to the iPhone; the controls wait for its answer.
    @Published private(set) var isSending = false
    /// Why the iPhone didn't apply the last tap. Cleared by the next state.
    @Published private(set) var notice: String?
    /// Counts what the iPhone has sent that changed the day or the workout
    /// here, or said the account left. The context is the iPhone's latest
    /// word; an answer to a tap sent before the last one is older, so what
    /// it says the runner shows is dropped.
    private var changesFromIPhone = 0
    #if DEBUG
    /// A fictional workout answers its own taps; no iPhone is involved.
    private var workoutFixture: WatchWorkoutFixtures?
    /// A fictional day, whose Start opens the fictional workout.
    private var isFictional = false
    #endif

    private let defaults: UserDefaults
    /// Kept for the life of the app, which owns one model.
    private var dayObserver: NSObjectProtocol?
    /// False for a fictional day, which never listens to an iPhone.
    private var listens = false

    /// What to show now; nil asks for the iPhone.
    var screen: WatchDayScreen? {
        WatchDayPresentation.screen(snapshot, today: today)
    }

    /// The running workout to show today, or nil for the day's list.
    var shownWorkout: WatchWorkoutState? {
        WatchWorkoutPresentation.shown(workout, today: today)
    }

    init(defaults: UserDefaults = WatchDayStore.sharedDefaults,
         arguments: [String] = ProcessInfo.processInfo.arguments) {
        self.defaults = defaults
        today = WatchDayPresentation.todayString()
        super.init()
        #if DEBUG
        // Fictional days and workouts for simulator screenshots; no session
        // is started.
        let workoutFixture = WatchWorkoutFixtures.requested(in: arguments)
        if let workoutFixture {
            self.workoutFixture = workoutFixture
            workout = workoutFixture.state(today: today, now: Date())
            isReachable = workoutFixture != .outOfReach
            notice = workoutFixture.notice
        }
        if let fixture = WatchDayFixtures.requested(in: arguments) ?? workoutFixture.map({ _ in WatchDayFixtures.today }) {
            // Start shows on a day with no workout open, as the iPhone
            // sends it.
            snapshot = fixture.snapshot(today: today, offersStart: workoutFixture == nil)
            isFictional = true
            if workoutFixture == nil { isReachable = true }
            return
        }
        #endif
        snapshot = WatchDayStore.load(from: defaults)
        dayObserver = NotificationCenter.default.addObserver(
            forName: .NSCalendarDayChanged, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refreshToday() }
        }
        guard WCSession.isSupported() else { return }
        listens = true
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// The system woke the app in the background because the iPhone sent
    /// something. Stay awake until the session has handed it over, so the
    /// complication changes without the app being opened; the wait is
    /// bounded because a background wake is short.
    func receivePending() async {
        guard listens else { return }
        let session = WCSession.default
        for _ in 0..<30 {
            if session.activationState == .activated, !session.hasContentPending { break }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        guard session.activationState == .activated else { return }
        apply(context: session.receivedApplicationContext)
    }

    func refreshToday() {
        let now = WatchDayPresentation.todayString()
        if now != today { today = now }
        if listens { setReachable(WCSession.default.isReachable) }
    }

    /// A tap on the workout screen: ask the iPhone, and wait for its answer.
    /// Nothing changes on the Watch until the iPhone says what its runner
    /// shows now.
    func send(_ command: WatchWorkoutCommand) {
        guard !isSending, shownWorkout?.token == command.token else { return }
        deliver(command)
    }

    /// Start on the row that leads: ask the iPhone to open that workout on
    /// its runner. The Watch shows it once the iPhone says it is open.
    func start(_ row: WatchDayRow) {
        guard !isSending, let start = row.start, screen?.source == .today else { return }
        deliver(WatchWorkoutCommand(id: UUID(), action: .start, token: start.token))
    }

    private func deliver(_ command: WatchWorkoutCommand) {
        #if DEBUG
        if isFictional, command.action == .start {
            workoutFixture = .ready
            finish(command, with: .accepted(command, state: WatchWorkoutFixtures.ready.state(today: today, now: Date())),
                   sentIn: changesFromIPhone)
            return
        }
        if let workoutFixture {
            let answer = workoutFixture.answer(command, to: workout, today: today, now: Date())
            finish(command, with: answer, sentIn: changesFromIPhone)
            return
        }
        #endif
        guard listens, WCSession.default.activationState == .activated, WCSession.default.isReachable,
              let message = WatchWorkoutMessage.encode(command) else {
            isReachable = false
            fail(WatchWorkoutPresentation.outOfReach(command.action))
            return
        }
        isSending = true
        notice = nil
        let sentIn = changesFromIPhone
        WCSession.default.sendMessageData(message, replyHandler: { [weak self] data in
            let receipt = WatchWorkoutMessage.receipt(from: data)
            Task { @MainActor in self?.finish(command, with: receipt, sentIn: sentIn) }
        }, errorHandler: { [weak self] _ in
            Task { @MainActor in self?.finish(command, with: nil, sentIn: sentIn) }
        })
    }

    private func finish(_ command: WatchWorkoutCommand, with receipt: WatchWorkoutReceipt?, sentIn: Int) {
        isSending = false
        // The iPhone has sent a newer day or workout since the tap left, or
        // said the account left or the workout closed. This answer is older
        // than that: it must not bring back what the iPhone took away.
        let isLatest = sentIn == changesFromIPhone
        guard let receipt, receipt.id == command.id else {
            if isLatest { fail(WatchWorkoutPresentation.noAnswer(command.action)) }
            return
        }
        // The iPhone says what its runner shows after the tap. A refusal
        // with nothing to show keeps the screen and says why.
        if isLatest, receipt.accepted || receipt.state != nil { setWorkout(receipt.state) }
        if receipt.accepted {
            notice = nil
            WKInterfaceDevice.current().play(command.action == .endRest ? .click : .success)
        } else if isLatest {
            fail(receipt.message ?? WatchWorkoutPresentation.noAnswer(command.action))
        }
    }

    /// The wearer has read why the last tap wasn't applied.
    func clearNotice() {
        if notice != nil { notice = nil }
    }

    private func fail(_ message: String) {
        notice = message
        WKInterfaceDevice.current().play(.failure)
    }

    private func setWorkout(_ state: WatchWorkoutState?) {
        guard state != workout else { return }
        // A reason belongs to the set it was given for.
        if state?.token != workout?.token { notice = nil }
        workout = state
    }

    private func setReachable(_ reachable: Bool) {
        if reachable != isReachable { isReachable = reachable }
    }

    /// The day and the running workout travel in one context.
    private func apply(context: [String: Any]) {
        if let received = WatchDayMessage.decode(context) {
            let dayBefore = snapshot, workoutBefore = workout
            apply(received)
            setWorkout(WatchWorkoutMessage.workout(in: context))
            if received == .cleared || dayBefore != snapshot || workoutBefore != workout { changesFromIPhone += 1 }
        }
    }

    private func apply(_ received: WatchDayMessage.Received) {
        let changed: Bool
        switch received {
        case .day(let day):
            changed = WatchDayStore.save(day, to: defaults)
            if day != snapshot { snapshot = day }
        case .cleared:
            changed = WatchDayStore.save(nil, to: defaults)
            if snapshot != nil { snapshot = nil }
        }
        refreshToday()
        // The complication reads the stored copy; an unchanged one is not
        // worth a reload from its daily budget.
        if changed { WidgetCenter.shared.reloadTimelines(ofKind: WatchDayStore.complicationKind) }
    }
}

extension WatchDayModel: WCSessionDelegate {
    /// The latest context can have arrived while the app was not running.
    nonisolated func session(_ session: WCSession,
                             activationDidCompleteWith activationState: WCSessionActivationState,
                             error: Error?) {
        guard activationState == .activated else { return }
        let context = session.receivedApplicationContext
        let reachable = session.isReachable
        Task { @MainActor in
            self.apply(context: context)
            self.setReachable(reachable)
        }
    }

    nonisolated func session(_ session: WCSession,
                             didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(context: applicationContext) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in self.setReachable(reachable) }
    }
}
