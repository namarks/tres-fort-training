import Foundation
import WatchConnectivity

// The iPhone's side of Today on Apple Watch (docs/plans/apple-watch P4).
// `TrainingAgendaPublisher` hands the day here after each published change
// and clears it at every account boundary, exactly as it does for the Today
// widget. The day travels as WatchConnectivity's application context: only
// the latest value is kept, and the Watch gets it the next time it wakes.

/// Builds the day the Watch shows from the same rows Today's list shows.
enum WatchDayBuilder {
    /// Later days the Watch can fall back on before the iPhone writes again.
    static let upcomingDayCount = 6

    static func snapshot(today: String, rows: [DailyWorkoutAgenda.Item], agenda: TrainingAgendaSnapshot,
                         unit: RunDistanceUnit, locale: Locale = .current) -> WatchDaySnapshot {
        let nextID = TodayDayList.nextID(rows)
        let dayRows = rows.map { item -> WatchDayRow in
            let leads = item.id == nextID
            let state: WatchDayRow.State = leads ? .next
                : item.isDone ? .done
                : item.status == "skipped" ? .setAside : .open
            return WatchDayRow(
                id: item.id, title: item.title,
                detail: TodayDayList.detail(item, unit: unit, showsTime: !leads, locale: locale),
                kicker: leads ? TodayDayList.nextKicker(item, locale: locale) : nil,
                state: state,
                glyph: item.workout.map(PlanItemSummary.glyph)
                    ?? (item.session?.isFreestyle == true ? "figure.strengthtraining.traditional" : "list.bullet.clipboard"))
        }
        let empty = emptyDay(agenda.day(for: today)?.status)
        let upcoming = agenda.days.filter { $0.date > today }.prefix(upcomingDayCount).map(upcomingDay)
        return WatchDaySnapshot(date: today, rows: dayRows, emptyTitle: empty.title,
                                emptyDetail: empty.detail, upcoming: Array(upcoming))
    }

    /// What a day with no rows is, in the Today widget's words.
    static func emptyDay(_ status: TrainingAgendaDay.Status?) -> (title: String, detail: String?) {
        switch status {
        case .some(.unavailable): return ("Time off", nil)
        case .some(.light): return ("Light training", nil)
        default: return ("Rest day", "Nothing planned today.")
        }
    }

    static func upcomingDay(_ day: TrainingAgendaDay) -> WatchUpcomingDay {
        switch day.status {
        case .workout, .inProgress:
            return WatchUpcomingDay(
                date: day.date, title: day.workoutName ?? "Workout",
                detail: day.exerciseNames.count > 1 ? PlanItemSummary.contents(day.exerciseNames) : nil,
                isWorkout: true)
        case .completed:
            return WatchUpcomingDay(date: day.date, title: day.workoutName ?? "Workout", detail: "Done", isWorkout: false)
        case .skipped:
            return WatchUpcomingDay(date: day.date, title: TodayDayList.skippedLabel, detail: nil, isWorkout: false)
        case .rest, .unavailable, .light:
            return WatchUpcomingDay(date: day.date, title: emptyDay(day.status).title, detail: nil, isWorkout: false)
        }
    }
}

@MainActor
extension SyncModel {
    /// Today as the Watch shows it, beside the agenda the widget reads.
    func watchDaySnapshot(agenda: TrainingAgendaSnapshot) -> WatchDaySnapshot {
        WatchDayBuilder.snapshot(today: todayString, rows: TodayDayList.rows(dailyWorkoutAgenda),
                                 agenda: agenda, unit: RunDistanceUnit.preferred())
    }
}

/// Where `TrainingAgendaPublisher` hands the day. nil clears it: the account
/// is leaving, so nothing it published may stay on the wrist.
@MainActor
protocol WatchDayPublishing: AnyObject {
    func publish(_ snapshot: WatchDaySnapshot?)
}

/// What the sender needs of WatchConnectivity, so tests can stand in for it.
protocol WatchDayChannel: AnyObject {
    /// A paired Watch with the Watch app installed, and an activated session.
    var canSend: Bool { get }
    /// Called, on any queue, whenever `canSend` may have become true.
    var onReady: (() -> Void)? { get set }
    /// Called, on any queue, when the Watch at the other end may no longer
    /// hold what was sent: another Watch became the active one, or the Watch
    /// app was installed again. A context belongs to one Watch.
    var onCounterpartChanged: (() -> Void)? { get set }
    func send(_ context: [String: Any]) throws
}

/// Keeps the Watch's copy of the day current. It holds only the latest day
/// wanted, sends it when a Watch with the app can take it, and never sends
/// the same bytes twice.
@MainActor
final class WatchDaySender: WatchDayPublishing {
    private struct Wanted: Equatable {
        /// The encoded day, or nil for "cleared".
        let day: Data?
    }

    private let channel: WatchDayChannel
    private var wanted: Wanted?
    private var sent: Wanted?

    init(channel: WatchDayChannel) {
        self.channel = channel
        channel.onReady = { [weak self] in
            Task { @MainActor in self?.flush() }
        }
        channel.onCounterpartChanged = { [weak self] in
            Task { @MainActor in self?.resend() }
        }
    }

    func publish(_ snapshot: WatchDaySnapshot?) {
        let next: Wanted
        if let snapshot {
            guard let bytes = WatchDayMessage.encode(snapshot) else { return }
            next = Wanted(day: bytes)
        } else {
            next = Wanted(day: nil)
        }
        guard next != wanted else { return }
        wanted = next
        flush()
    }

    /// What was sent went to a Watch that may not be the one listening now,
    /// so the latest value, a clear included, goes out again.
    private func resend() {
        sent = nil
        flush()
    }

    private func flush() {
        guard let wanted, wanted != sent, channel.canSend else { return }
        let context = wanted.day.map(WatchDayMessage.context(day:)) ?? WatchDayMessage.clearedContext
        do {
            try channel.send(context)
            sent = wanted
        } catch {
            // The Watch went out of reach between the check and the send.
            // The next readiness change sends the latest value.
        }
    }
}

/// The app's one WatchConnectivity session.
final class WatchSessionChannel: NSObject, WCSessionDelegate, WatchDayChannel {
    private let session: WCSession
    var onReady: (() -> Void)?
    var onCounterpartChanged: (() -> Void)?

    init(session: WCSession = .default) {
        self.session = session
        super.init()
        session.delegate = self
        session.activate()
    }

    var canSend: Bool {
        session.activationState == .activated && session.isPaired && session.isWatchAppInstalled
    }

    func send(_ context: [String: Any]) throws {
        try session.updateApplicationContext(context)
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        onReady?()
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// Another Watch became the active one: follow it. It has not had
    /// what the earlier Watch was sent; activation then sends the latest.
    func sessionDidDeactivate(_ session: WCSession) {
        onCounterpartChanged?()
        session.activate()
    }

    /// The Watch was paired or unpaired, or the Watch app installed or
    /// removed, after launch. A newly installed app holds nothing yet.
    func sessionWatchStateDidChange(_ session: WCSession) {
        onCounterpartChanged?()
    }
}

@MainActor
enum WatchDayLink {
    /// The sender for this process, made on first use. nil on a device that
    /// can't pair a Watch (iPad) and in the App Store build, which doesn't
    /// carry the Watch app until the owner says it ships.
    static let shared: WatchDaySender? = makeShared()

    private static func makeShared() -> WatchDaySender? {
        #if APP_STORE_BUILD
        return nil
        #else
        guard WCSession.isSupported() else { return nil }
        return WatchDaySender(channel: WatchSessionChannel())
        #endif
    }
}
