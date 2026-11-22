import Foundation
import WatchConnectivity

/// Holds the last day the iPhone sent and the civil date it is shown for.
/// The Watch keeps its own copy, so the app opens with the day before the
/// iPhone is in reach, and drops it when the iPhone says the account left.
@MainActor
final class WatchDayModel: NSObject, ObservableObject {
    @Published private(set) var snapshot: WatchDaySnapshot?
    @Published private(set) var today: String

    private let defaults: UserDefaults
    /// Kept for the life of the app, which owns one model.
    private var dayObserver: NSObjectProtocol?

    /// What to show now; nil asks for the iPhone.
    var screen: WatchDayScreen? {
        WatchDayPresentation.screen(snapshot, today: today)
    }

    init(defaults: UserDefaults = .standard,
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
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func refreshToday() {
        let now = WatchDayPresentation.todayString()
        if now != today { today = now }
    }

    private func apply(_ received: WatchDayMessage.Received) {
        switch received {
        case .day(let day):
            WatchDayStore.save(day, to: defaults)
            if day != snapshot { snapshot = day }
        case .cleared:
            WatchDayStore.save(nil, to: defaults)
            if snapshot != nil { snapshot = nil }
        }
        refreshToday()
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
