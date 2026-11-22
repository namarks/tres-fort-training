import Foundation

// Shared by the iPhone app, which builds and sends the day, and the Apple
// Watch app, which only shows it (docs/plans/apple-watch P4). The Watch
// never signs in, calls the Worker or decides what a day is: the iPhone
// sends a display copy of the day it already resolved, in the words Today
// uses, and clears it at every account boundary. It carries no account
// identifier, token or logged set.

/// One row of the day's list, already worded by the iPhone.
struct WatchDayRow: Codable, Equatable, Identifiable {
    enum State: String, Codable {
        /// The row that leads: under way, or the first still to do.
        case next
        /// Still to do, after the row that leads.
        case open
        case done
        /// "Not today": set aside, not missed.
        case setAside
    }

    let id: String
    let title: String
    /// How much the row is, or what was done: "Swing, press +3", "Done".
    let detail: String
    /// "Up next · 5:30 PM" on the row that leads; nil on every other row.
    let kicker: String?
    let state: State
    /// SF Symbol for what the row is.
    let glyph: String
}

/// A later day, coarse: what the iPhone's projection resolved for it.
struct WatchUpcomingDay: Codable, Equatable {
    let date: String            // YYYY-MM-DD, device-local civil date
    /// The workout's name, or what the day is: "Rest day", "Time off".
    let title: String
    let detail: String?
    /// Whether the day holds something to train.
    let isWorkout: Bool
}

struct WatchDaySnapshot: Codable, Equatable {
    static let currentVersion = 1

    var version: Int = WatchDaySnapshot.currentVersion
    /// The civil day `rows` describe: today when the iPhone wrote it.
    let date: String
    let rows: [WatchDayRow]
    /// What the day is when it holds no rows: "Rest day", "Time off".
    let emptyTitle: String
    let emptyDetail: String?
    /// The days after `date`, in order.
    let upcoming: [WatchUpcomingDay]
}

/// What the Watch shows for a civil day, from the last snapshot it holds.
struct WatchDayScreen: Equatable {
    enum Source: Equatable {
        /// The iPhone wrote this day's list today.
        case today
        /// The iPhone last wrote on an earlier day; this is the coarse entry
        /// it resolved for today back then.
        case earlier
    }

    let date: String
    let rows: [WatchDayRow]
    /// Set when the day holds no rows.
    let emptyTitle: String?
    let emptyDetail: String?
    /// The next later day with something to train.
    let comingUp: WatchUpcomingDay?
    let source: Source
}

enum WatchDayPresentation {
    /// Shown when the Watch holds nothing it can show for today.
    static let waitingTitle = "Open Très Fort on your iPhone"
    static let waitingDetail = "Your day shows here once your iPhone sends it."
    /// Under a day shown from an earlier snapshot.
    static let earlierNote = "Open Très Fort on your iPhone for today's details."

    /// The screen for `today`, or nil when the snapshot can't speak for it:
    /// none yet, written by a newer or older format, dated after today, or
    /// too old to have resolved today at all. The Watch then asks for the
    /// iPhone instead of guessing a schedule it doesn't have.
    static func screen(_ snapshot: WatchDaySnapshot?, today: String) -> WatchDayScreen? {
        guard let snapshot, snapshot.version == WatchDaySnapshot.currentVersion else { return nil }
        if snapshot.date == today {
            return WatchDayScreen(
                date: today, rows: snapshot.rows,
                emptyTitle: snapshot.rows.isEmpty ? snapshot.emptyTitle : nil,
                emptyDetail: snapshot.rows.isEmpty ? snapshot.emptyDetail : nil,
                comingUp: snapshot.upcoming.first { $0.date > today && $0.isWorkout },
                source: .today)
        }
        guard snapshot.date < today, let entry = snapshot.upcoming.first(where: { $0.date == today }) else {
            return nil
        }
        let rows = entry.isWorkout
            ? [WatchDayRow(id: "upcoming:\(entry.date)", title: entry.title, detail: entry.detail ?? "",
                           kicker: "Planned", state: .next, glyph: "calendar")]
            : []
        return WatchDayScreen(
            date: today, rows: rows,
            emptyTitle: entry.isWorkout ? nil : entry.title,
            emptyDetail: nil,
            comingUp: snapshot.upcoming.first { $0.date > today && $0.isWorkout },
            source: .earlier)
    }

    /// "Thu Nov 13" for a civil date, in the reader's own order.
    static func dateLabel(_ ymd: String, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let calendar = TrainingAgendaCalendar.calendar(timeZone: timeZone)
        guard let date = TrainingAgendaCalendar.date(from: ymd, calendar: calendar) else { return ymd }
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("EEE MMM d")
        return formatter.string(from: date)
    }

    /// "Sat" for a later day's row.
    static func weekdayLabel(_ ymd: String, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let calendar = TrainingAgendaCalendar.calendar(timeZone: timeZone)
        guard let date = TrainingAgendaCalendar.date(from: ymd, calendar: calendar) else { return ymd }
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("EEE")
        return formatter.string(from: date)
    }

    /// Today's civil date on this device, by the same rule as the iPhone.
    static func todayString(now: Date = Date(), timeZone: TimeZone = .current) -> String {
        TrainingAgendaCalendar.dateString(now, calendar: TrainingAgendaCalendar.calendar(timeZone: timeZone))
    }
}

/// What the watch face complication and the Smart Stack say about a day:
/// what is next, in the words the day's list already uses.
struct WatchComplication: Equatable {
    enum Tone: Equatable {
        /// Something to do leads the day.
        case next
        /// Everything on the day is finished or set aside.
        case finished
        /// A day with nothing to train.
        case empty
        /// The Watch holds nothing for today.
        case waiting
    }

    /// Small capitals over the title: "Up next · 5:30 PM", "Today".
    let kicker: String
    let title: String
    let detail: String?
    /// SF Symbol for the round and corner complications.
    let glyph: String
    /// One line beside the time on a watch face.
    let inline: String
    let tone: Tone

    static let waiting = WatchComplication(
        kicker: "Très Fort", title: "Open on iPhone", detail: nil,
        glyph: "iphone", inline: "Très Fort", tone: .waiting)
}

extension WatchComplication {
    init(_ screen: WatchDayScreen?, locale: Locale = .current, timeZone: TimeZone = .current) {
        guard let screen else {
            self = .waiting
            return
        }
        if let next = screen.rows.first(where: { $0.state == .next }) {
            self = WatchComplication(
                kicker: next.kicker ?? "Up next", title: next.title,
                detail: next.detail.isEmpty ? nil : next.detail,
                glyph: next.glyph, inline: next.title, tone: .next)
            return
        }
        let later = screen.comingUp.map {
            "\(WatchDayPresentation.weekdayLabel($0.date, locale: locale, timeZone: timeZone)) · \($0.title)"
        }
        if let title = screen.emptyTitle {
            self = WatchComplication(kicker: "Today", title: title, detail: later,
                                     glyph: "calendar", inline: title, tone: .empty)
            return
        }
        // Rows, and none leads: each is finished or set aside.
        let title = screen.rows.contains { $0.state == .done } ? "Done today" : "Nothing left today"
        self = WatchComplication(kicker: "Today", title: title, detail: later,
                                 glyph: "checkmark", inline: title, tone: .finished)
    }
}

/// When the complication changes without the app: at each midnight the
/// Watch's copy still covers, then once more to ask for the iPhone.
enum WatchDayTimeline {
    struct Entry: Equatable {
        let date: Date
        let screen: WatchDayScreen?
    }

    static func entries(snapshot: WatchDaySnapshot?, now: Date, calendar: Calendar) -> [Entry] {
        let today = TrainingAgendaCalendar.dateString(now, calendar: calendar)
        var entries = [Entry(date: now, screen: WatchDayPresentation.screen(snapshot, today: today))]
        // A copy that can't speak for today can't speak for a later day.
        guard entries[0].screen != nil, let snapshot,
              var start = TrainingAgendaCalendar.date(from: today, calendar: calendar)
        else { return entries }
        // One step past the last day the copy covers ends on "ask the iPhone".
        for _ in 0...snapshot.upcoming.count {
            guard let next = calendar.date(byAdding: .day, value: 1, to: start) else { break }
            start = next
            let day = TrainingAgendaCalendar.dateString(next, calendar: calendar)
            let screen = WatchDayPresentation.screen(snapshot, today: day)
            entries.append(Entry(date: next, screen: screen))
            if screen == nil { break }
        }
        return entries
    }
}

/// What travels from the iPhone to the Watch as WatchConnectivity's
/// application context: the latest day, or word that the account left.
enum WatchDayMessage {
    static let versionKey = "v"
    static let dayKey = "day"
    static let clearedKey = "cleared"

    enum Received: Equatable {
        case day(WatchDaySnapshot)
        case cleared
    }

    /// Sorted keys make equal snapshots encode to equal bytes, so an
    /// unchanged day is never sent twice.
    static func encode(_ snapshot: WatchDaySnapshot) -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try? encoder.encode(snapshot)
    }

    static func context(day bytes: Data) -> [String: Any] {
        [versionKey: WatchDaySnapshot.currentVersion, dayKey: bytes]
    }

    static var clearedContext: [String: Any] {
        [versionKey: WatchDaySnapshot.currentVersion, clearedKey: true]
    }

    /// nil for a context this build doesn't understand, which changes
    /// nothing on the Watch.
    static func decode(_ context: [String: Any]) -> Received? {
        guard context[versionKey] as? Int == WatchDaySnapshot.currentVersion else { return nil }
        if context[clearedKey] as? Bool == true { return .cleared }
        guard let bytes = context[dayKey] as? Data,
              let snapshot = try? JSONDecoder().decode(WatchDaySnapshot.self, from: bytes),
              snapshot.version == WatchDaySnapshot.currentVersion
        else { return nil }
        return .day(snapshot)
    }
}

/// The Watch's own copy of the last day it received, so the app opens with
/// it before the iPhone is in reach. It lives in the Watch's App Group so
/// the complication reads the same copy.
enum WatchDayStore {
    static let snapshotKey = "com.nmarkspdx.tresfort.watch-day.v1"
    /// The Watch's group has the iPhone's identifier but its own storage:
    /// nothing is shared between the two devices through it.
    static let appGroupID = "group.com.nmarkspdx.tresfort"
    static let complicationKind = "WatchNextComplication"

    static var sharedDefaults: UserDefaults { UserDefaults(suiteName: appGroupID) ?? .standard }

    static func load(from defaults: UserDefaults) -> WatchDaySnapshot? {
        guard let data = defaults.data(forKey: snapshotKey),
              let snapshot = try? JSONDecoder().decode(WatchDaySnapshot.self, from: data),
              snapshot.version == WatchDaySnapshot.currentVersion
        else { return nil }
        return snapshot
    }

    /// Returns whether the stored value changed.
    @discardableResult
    static func save(_ snapshot: WatchDaySnapshot?, to defaults: UserDefaults) -> Bool {
        guard let snapshot else {
            guard defaults.object(forKey: snapshotKey) != nil else { return false }
            defaults.removeObject(forKey: snapshotKey)
            return true
        }
        guard let data = WatchDayMessage.encode(snapshot) else { return false }
        guard defaults.data(forKey: snapshotKey) != data else { return false }
        defaults.set(data, forKey: snapshotKey)
        return true
    }
}
