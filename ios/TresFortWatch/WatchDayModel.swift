import Foundation
import WatchConnectivity
import WidgetKit

/// Holds the last day the iPhone sent and the civil date it is shown for.
/// The Watch keeps its own copy, so the app opens with the day before the
/// iPhone is in reach, and drops it when the iPhone says the account left.
/// The complication reads the same copy and reloads when it changes.
@MainActor
final class WatchDayModel: NSObject, ObservableObject {
    /// The app's one model: the screen and the background wake share it.
    static let shared = WatchDayModel()

    @Published private(set) var snapshot: WatchDaySnapshot?
    @Published private(set) var today: String

    private let defaults: UserDefaults
    /// Kept for the life of the app, which owns one model.
    private var dayObserver: NSObjectProtocol?
    /// False for a fictional day, which never listens to an iPhone.
    private var listens = false

    /// What to show now; nil asks for the iPhone.
    var screen: WatchDayScreen? {
        WatchDayPresentation.screen(snapshot, today: today)
    }

    init(defaults: UserDefaults = WatchDayStore.sharedDefaults,
         arguments: [String] = ProcessInfo.processInfo.arguments) {
        self.defaults = defaults
        today = WatchDayPresentation.todayString()
        super.init()
        #if DEBUG
        // Fictional days for simulator screenshots; no session is started.
        if let fixture = WatchDayFixtures.requested(in: arguments) {
            snapshot = fixture.snapshot(today: today)
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
        guard session.activationState == .activated,
              let received = WatchDayMessage.decode(session.receivedApplicationContext)
        else { return }
        apply(received)
    }

    func refreshToday() {
        let now = WatchDayPresentation.todayString()
        if now != today { today = now }
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
        guard activationState == .activated,
              let received = WatchDayMessage.decode(session.receivedApplicationContext)
        else { return }
        Task { @MainActor in self.apply(received) }
    }

    nonisolated func session(_ session: WCSession,
                             didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let received = WatchDayMessage.decode(applicationContext) else { return }
        Task { @MainActor in self.apply(received) }
    }
}
