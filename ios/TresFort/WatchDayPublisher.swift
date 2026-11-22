import Foundation
import WatchConnectivity

// The iPhone's side of Today on Apple Watch (docs/plans/apple-watch P4).
// `TrainingAgendaPublisher` hands the day here after each published change
// and clears it at every account boundary, exactly as it does for the Today
// widget. The day travels as WatchConnectivity's application context: only
// the latest value is kept, and the Watch gets it the next time it wakes.
// A running workout's state rides in the same context, and the Watch's taps
// come back through the same session (P5, `WatchWorkoutPublisher`).

/// Builds the day the Watch shows from the same rows Today's list shows.
enum WatchDayBuilder {
    /// Later days the Watch can fall back on before the iPhone writes again.
    static let upcomingDayCount = 6

    /// `start` is the Start on the row that leads when the wrist can start
    /// it; nil when it can't.
    static func snapshot(today: String, rows: [DailyWorkoutAgenda.Item], agenda: TrainingAgendaSnapshot,
                         unit: RunDistanceUnit, locale: Locale = .current,
                         start: WatchDayRow.Start? = nil) -> WatchDaySnapshot {
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
                    ?? (item.session?.isFreestyle == true ? "figure.strengthtraining.traditional" : "list.bullet.clipboard"),
                start: leads ? start : nil)
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
        let rows = TodayDayList.rows(dailyWorkoutAgenda)
        // Start on the wrist, where the row that leads is a lifting workout
        // this iPhone can open now (`watchStart`).
        let leading = TodayDayList.nextID(rows).flatMap { id in rows.first { $0.id == id } }
        let start = leading.flatMap { item -> WatchDayRow.Start? in
            guard watchStart(for: item) != nil, let title = TodayDayList.actionTitle(item) else { return nil }
            return WatchDayRow.Start(title: title, token: watchStartToken(for: item))
        }
        return WatchDayBuilder.snapshot(today: todayString, rows: rows, agenda: agenda,
                                        unit: RunDistanceUnit.preferred(), start: start)
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
    /// Called, on any queue, with a message the Watch sent and the way to
    /// answer it. Every message gets one answer; nil says it wasn't
    /// understood.
    var onMessage: ((Data, @escaping (Data?) -> Void) -> Void)? { get set }
    func send(_ context: [String: Any]) throws
}

/// Keeps the Watch's copy of the day, and of a running workout, current. It
/// holds only the latest of each, sends them when a Watch with the app can
/// take them, and never sends the same bytes twice. The two travel in one
/// application context, because WatchConnectivity keeps only the latest.
@MainActor
final class WatchDaySender: WatchDayPublishing, WatchWorkoutPublishing {
    private struct Wanted: Equatable {
        /// The encoded day, or nil for "cleared".
        var day: Data?
        /// The encoded workout state, or nil for none. Never kept beside a
        /// cleared day: the account that ran it has left.
        var workout: Data?
    }

    private let channel: WatchDayChannel
    /// nil until a day, or a clear, has been asked for.
    private var wanted: Wanted?
    private var sent: Wanted?
    /// A workout handed over before the first day waits here for it.
    private var workout: Data?
    var onWorkoutCommand: ((WatchWorkoutCommand) async -> WatchWorkoutReceipt)?

    init(channel: WatchDayChannel) {
        self.channel = channel
        channel.onReady = { [weak self] in
            Task { @MainActor in self?.flush() }
        }
        channel.onCounterpartChanged = { [weak self] in
            Task { @MainActor in self?.resend() }
        }
        channel.onMessage = { [weak self] message, reply in
            Task { @MainActor in
                guard let self else { return reply(nil) }
                reply(await self.answer(message))
            }
        }
    }

    func publish(_ snapshot: WatchDaySnapshot?) {
        let next: Wanted
        if let snapshot {
            guard let bytes = WatchDayMessage.encode(snapshot) else { return }
            next = Wanted(day: bytes, workout: workout)
        } else {
            // The account is leaving: its workout leaves the wrist with its day.
            workout = nil
            next = Wanted(day: nil, workout: nil)
        }
        guard next != wanted else { return }
        wanted = next
        flush()
    }

    func publishWorkout(_ state: WatchWorkoutState?) {
        let bytes = state.flatMap { WatchWorkoutMessage.encode($0) }
        guard bytes != workout else { return }
        workout = bytes
        // A workout rides beside a day. Before the first day, or after a
        // clear, it waits for the next day.
        guard var next = wanted, next.day != nil else { return }
        next.workout = bytes
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
        var context = wanted.day.map(WatchDayMessage.context(day:)) ?? WatchDayMessage.clearedContext
        if let workout = wanted.workout { context[WatchWorkoutMessage.workoutKey] = workout }
        do {
            try channel.send(context)
            sent = wanted
        } catch {
            // The Watch went out of reach between the check and the send.
            // The next readiness change sends the latest value.
        }
    }

    /// A tap on the Watch. With no signed-in account to take it, the Watch
    /// is told to open the app on the iPhone.
    private func answer(_ message: Data) async -> Data? {
        guard let command = WatchWorkoutMessage.command(from: message) else { return nil }
        let receipt = await onWorkoutCommand?(command)
            ?? .refused(command, WatchWorkoutCommandRunner.noAccount(command))
        return WatchWorkoutMessage.encode(receipt)
    }
}

/// The app's one WatchConnectivity session.
final class WatchSessionChannel: NSObject, WCSessionDelegate, WatchDayChannel {
    private let session: WCSession
    var onReady: (() -> Void)?
    var onCounterpartChanged: (() -> Void)?
    var onMessage: ((Data, @escaping (Data?) -> Void) -> Void)?

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

    /// A tap on the Watch, which waits for the answer. An empty answer
    /// tells it the message wasn't understood.
    func session(_ session: WCSession, didReceiveMessageData messageData: Data,
                 replyHandler: @escaping (Data) -> Void) {
        guard let onMessage else { return replyHandler(Data()) }
        onMessage(messageData) { replyHandler($0 ?? Data()) }
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
