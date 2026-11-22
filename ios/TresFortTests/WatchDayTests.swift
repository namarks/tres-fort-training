import XCTest
@testable import TresFort

/// Today on Apple Watch (docs/plans/apple-watch P4): the day the iPhone
/// builds from Today's list, what the Watch shows for it on the day and on
/// a later day, and when the iPhone sends it.
@MainActor
final class WatchDayTests: XCTestCase {
    private let gb = Locale(identifier: "en_GB")
    private let today = "2026-11-20"

    private func slot(_ id: String, name: String) -> TemplateExercise {
        TemplateExercise(
            id: "\(id)-slot", exercise_id: id, exercise_name: name,
            exercise_unit: "lb", order_index: 0, target_sets: 3, target_reps: 5,
            target_reps_max: nil, target_rpe: nil, rest_seconds: 60, target_weight: nil,
            cues: nil, exercise_modality: "weighted", exercise_laterality: nil,
            exercise_load_mode: nil, exercise_demo_slug: nil, target_duration_s: nil, is_warmup: 0)
    }

    private func workout(_ id: String, name: String, exercises: [String] = []) -> Workout {
        Workout(id: id, name: name, day_label: nil, order_index: 0,
                exercises: exercises.enumerated().map { slot("\(id)-\($0.offset)", name: $0.element) })
    }

    private func session(_ id: String, workout: String?, slot: Int, status: String) -> SessionRow {
        var row = SessionRow(slot: slot, id: id, date: today, status: status, workout_id: workout)
        row.kind = "planned"
        return row
    }

    private func rows(primary: Workout?, extras: [Workout] = [], sessions: [SessionRow] = [],
                      times: [String: Int] = [:]) -> [DailyWorkoutAgenda.Item] {
        TodayDayList.rows(DailyWorkoutAgenda.items(
            primary: primary, extras: extras, sessions: sessions,
            workouts: [primary].compactMap { $0 } + extras, times: times, loggedActivityIDs: []))
    }

    private func agenda(_ days: [(String, TrainingAgendaDay.Status, String?, [String])]) -> TrainingAgendaSnapshot {
        TrainingAgendaSnapshot(days: days.map {
            TrainingAgendaDay(date: $0.0, status: $0.1, workoutName: $0.2, exerciseNames: $0.3)
        })
    }

    private func snapshot(date: String, rows: [WatchDayRow] = [],
                          upcoming: [WatchUpcomingDay] = []) -> WatchDaySnapshot {
        WatchDaySnapshot(date: date, rows: rows, emptyTitle: "Rest day",
                         emptyDetail: "Nothing planned today.", upcoming: upcoming)
    }

    private func defaults() -> UserDefaults {
        let name = "WatchDayTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        addTeardownBlock { defaults.removePersistentDomain(forName: name) }
        return defaults
    }

    // MARK: the day the iPhone builds

    func testTheDayCarriesTodaysListInItsOwnWords() {
        let lift = workout("kb", name: "Kettlebell A", exercises: ["Swing", "Goblet squat", "Press", "Row"])
        let lower = workout("lower", name: "Lower Body", exercises: ["Back squat", "Deadlift"])
        let day = WatchDayBuilder.snapshot(
            today: today,
            rows: rows(primary: lift, extras: [lower],
                       sessions: [session("kb-session", workout: "kb", slot: 0, status: "completed")],
                       times: ["kb": 7 * 60, "lower": 17 * 60 + 30]),
            agenda: agenda([
                (today, .completed, "Kettlebell A", ["Swing"]),
                ("2026-11-21", .rest, nil, []),
                ("2026-11-22", .workout, "Upper", ["Bench press", "Row", "Press", "Pull-up"]),
            ]),
            unit: .miles, locale: gb)

        XCTAssertEqual(day.date, today)
        XCTAssertEqual(day.rows.map(\.title), ["Kettlebell A", "Lower Body"])
        XCTAssertEqual(day.rows.map(\.state), [.done, .next])
        XCTAssertEqual(day.rows[0].detail, "Done · 4 exercises")
        XCTAssertNil(day.rows[0].kicker)
        XCTAssertEqual(day.rows[1].kicker, "Up next · 17:30")
        XCTAssertEqual(day.rows[1].detail, "Back squat, Deadlift",
                       "the leading row's time sits in its Up next line")
        XCTAssertEqual(day.rows[1].glyph, "dumbbell")
        XCTAssertEqual(day.upcoming, [
            WatchUpcomingDay(date: "2026-11-21", title: "Rest day", detail: nil, isWorkout: false),
            WatchUpcomingDay(date: "2026-11-22", title: "Upper", detail: "Bench press, Row, Press +1", isWorkout: true),
        ])
    }

    func testAnEmptyDaySaysWhatItIs() {
        let rest = WatchDayBuilder.snapshot(today: today, rows: [], agenda: agenda([(today, .rest, nil, [])]),
                                            unit: .miles)
        XCTAssertTrue(rest.rows.isEmpty)
        XCTAssertEqual(rest.emptyTitle, "Rest day")
        XCTAssertEqual(rest.emptyDetail, "Nothing planned today.")

        let away = WatchDayBuilder.snapshot(today: today, rows: [], agenda: agenda([(today, .unavailable, nil, [])]),
                                            unit: .miles)
        XCTAssertEqual(away.emptyTitle, "Time off")
        XCTAssertNil(away.emptyDetail)
    }

    func testOnlyAFewLaterDaysTravel() {
        let days = (0..<14).map { offset -> (String, TrainingAgendaDay.Status, String?, [String]) in
            (String(format: "2026-12-%02d", offset + 1), .workout, "Upper", [])
        }
        let day = WatchDayBuilder.snapshot(today: "2026-12-01", rows: [], agenda: agenda(days), unit: .miles)
        XCTAssertEqual(day.upcoming.count, WatchDayBuilder.upcomingDayCount)
        XCTAssertEqual(day.upcoming.first?.date, "2026-12-02")
        XCTAssertNil(day.upcoming.first?.detail, "a workout with no named exercises has no second line")
    }

    // MARK: what the Watch shows

    func testTheWatchShowsTheDayTheIPhoneWroteToday() throws {
        let row = WatchDayRow(id: "primary", title: "Lower Body", detail: "Back squat, Deadlift",
                              kicker: "Up next", state: .next, glyph: "dumbbell")
        let later = WatchUpcomingDay(date: "2026-11-22", title: "Upper", detail: nil, isWorkout: true)
        let screen = try XCTUnwrap(WatchDayPresentation.screen(
            snapshot(date: today, rows: [row], upcoming: [
                WatchUpcomingDay(date: "2026-11-21", title: "Rest day", detail: nil, isWorkout: false), later,
            ]), today: today))

        XCTAssertEqual(screen.source, .today)
        XCTAssertEqual(screen.rows, [row])
        XCTAssertNil(screen.emptyTitle, "a day with rows is not a rest day")
        XCTAssertEqual(screen.comingUp, later, "coming up skips days with nothing to train")
    }

    func testARestDayShowsItsOwnWords() throws {
        let screen = try XCTUnwrap(WatchDayPresentation.screen(snapshot(date: today), today: today))
        XCTAssertTrue(screen.rows.isEmpty)
        XCTAssertEqual(screen.emptyTitle, "Rest day")
        XCTAssertEqual(screen.emptyDetail, "Nothing planned today.")
        XCTAssertNil(screen.comingUp)
    }

    func testALaterDayFallsBackToWhatTheIPhoneResolvedForIt() throws {
        let stale = snapshot(date: today, rows: [
            WatchDayRow(id: "primary", title: "Lower Body", detail: "Done", kicker: nil, state: .done, glyph: "dumbbell"),
        ], upcoming: [
            WatchUpcomingDay(date: "2026-11-21", title: "Rest day", detail: nil, isWorkout: false),
            WatchUpcomingDay(date: "2026-11-22", title: "Upper", detail: "Bench press, Row", isWorkout: true),
            WatchUpcomingDay(date: "2026-11-24", title: "Tempo run", detail: nil, isWorkout: true),
        ])

        let restDay = try XCTUnwrap(WatchDayPresentation.screen(stale, today: "2026-11-21"))
        XCTAssertEqual(restDay.source, .earlier)
        XCTAssertTrue(restDay.rows.isEmpty, "yesterday's rows never show as today's")
        XCTAssertEqual(restDay.emptyTitle, "Rest day")
        XCTAssertEqual(restDay.comingUp?.title, "Upper")

        let workoutDay = try XCTUnwrap(WatchDayPresentation.screen(stale, today: "2026-11-22"))
        XCTAssertEqual(workoutDay.rows.map(\.title), ["Upper"])
        XCTAssertEqual(workoutDay.rows.first?.state, .next)
        XCTAssertEqual(workoutDay.rows.first?.kicker, "Planned")
        XCTAssertNil(workoutDay.emptyTitle)
        XCTAssertEqual(workoutDay.comingUp?.title, "Tempo run")
    }

    func testTheWatchAsksForTheIPhoneWhenItCannotSpeakForToday() {
        XCTAssertNil(WatchDayPresentation.screen(nil, today: today))
        let old = snapshot(date: "2026-11-01", upcoming: [
            WatchUpcomingDay(date: "2026-11-02", title: "Upper", detail: nil, isWorkout: true),
        ])
        XCTAssertNil(WatchDayPresentation.screen(old, today: today), "today is past what the snapshot resolved")
        XCTAssertNil(WatchDayPresentation.screen(snapshot(date: "2026-11-21"), today: today),
                     "a snapshot dated after today is not today's")
        var newer = snapshot(date: today)
        newer.version = WatchDaySnapshot.currentVersion + 1
        XCTAssertNil(WatchDayPresentation.screen(newer, today: today))
    }

    func testDateLabelsFollowTheCivilDate() {
        let us = Locale(identifier: "en_US")
        let zone = TimeZone(identifier: "Pacific/Auckland")!
        XCTAssertEqual(WatchDayPresentation.dateLabel("2026-11-13", locale: us, timeZone: zone), "Fri, Nov 13")
        XCTAssertEqual(WatchDayPresentation.weekdayLabel("2026-11-14", locale: us, timeZone: zone), "Sat")
        XCTAssertEqual(WatchDayPresentation.dateLabel("not a date", locale: us), "not a date")
    }

    // MARK: on the wire and on the Watch

    func testADayAndAClearSurviveTheTrip() throws {
        let day = snapshot(date: today, rows: [
            WatchDayRow(id: "primary", title: "Lower Body", detail: "Back squat", kicker: "Up next",
                        state: .next, glyph: "dumbbell"),
        ])
        let bytes = try XCTUnwrap(WatchDayMessage.encode(day))
        XCTAssertEqual(WatchDayMessage.encode(day), bytes, "equal days encode to equal bytes")
        XCTAssertEqual(WatchDayMessage.decode(WatchDayMessage.context(day: bytes)), .day(day))
        XCTAssertEqual(WatchDayMessage.decode(WatchDayMessage.clearedContext), .cleared)
        XCTAssertNil(WatchDayMessage.decode([:]))
        XCTAssertNil(WatchDayMessage.decode([WatchDayMessage.versionKey: 99, WatchDayMessage.clearedKey: true]),
                     "another format changes nothing on the Watch")
        XCTAssertNil(WatchDayMessage.decode([WatchDayMessage.versionKey: 1, WatchDayMessage.dayKey: Data("x".utf8)]))
    }

    func testTheWatchKeepsAndClearsItsCopy() {
        let store = defaults()
        XCTAssertNil(WatchDayStore.load(from: store))
        let day = snapshot(date: today)
        XCTAssertTrue(WatchDayStore.save(day, to: store))
        XCTAssertFalse(WatchDayStore.save(day, to: store), "an unchanged day is not a change")
        XCTAssertEqual(WatchDayStore.load(from: store), day)
        XCTAssertTrue(WatchDayStore.save(nil, to: store))
        XCTAssertNil(WatchDayStore.load(from: store))
        XCTAssertFalse(WatchDayStore.save(nil, to: store))
    }

    // MARK: when the iPhone sends

    func testTheSenderSendsEachDayOnceAndClearsAtTheBoundary() {
        let channel = ChannelStub()
        channel.canSend = true
        let sender = WatchDaySender(channel: channel)
        let day = snapshot(date: today)

        sender.publish(day)
        sender.publish(day)
        XCTAssertEqual(channel.sent.count, 1, "an unchanged day is sent once")
        XCTAssertEqual(WatchDayMessage.decode(channel.sent[0]), .day(day))

        sender.publish(nil)
        sender.publish(nil)
        XCTAssertEqual(channel.sent.count, 2)
        XCTAssertEqual(WatchDayMessage.decode(channel.sent[1]), .cleared)

        sender.publish(day)
        XCTAssertEqual(channel.sent.count, 3, "the same day after a clear is sent again")
    }

    func testTheSenderHoldsTheLatestDayUntilAWatchCanTakeIt() async {
        let channel = ChannelStub()
        let sender = WatchDaySender(channel: channel)
        sender.publish(snapshot(date: "2026-11-19"))
        let latest = snapshot(date: today)
        sender.publish(latest)
        XCTAssertTrue(channel.sent.isEmpty, "no paired Watch with the app yet")

        channel.canSend = true
        channel.onReady?()
        for _ in 0..<50 where channel.sent.isEmpty { await Task.yield() }
        XCTAssertEqual(channel.sent.count, 1, "only the latest day is sent")
        XCTAssertEqual(WatchDayMessage.decode(channel.sent[0]), .day(latest))

        channel.onReady?()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(channel.sent.count, 1)
    }

    func testAnotherWatchGetsTheLatestDayAndTheClear() async {
        let channel = ChannelStub()
        channel.canSend = true
        let sender = WatchDaySender(channel: channel)
        let day = snapshot(date: today)
        sender.publish(day)
        XCTAssertEqual(channel.sent.count, 1)

        // The member switches to a second Watch: the session deactivates
        // (nothing can be sent) and then activates for the new Watch.
        channel.canSend = false
        channel.onCounterpartChanged?()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(channel.sent.count, 1)
        channel.canSend = true
        channel.onReady?()
        for _ in 0..<50 where channel.sent.count < 2 { await Task.yield() }
        XCTAssertEqual(channel.sent.count, 2, "the new Watch has not had the unchanged day")
        XCTAssertEqual(WatchDayMessage.decode(channel.sent[1]), .day(day))

        // Signed out, then another Watch: it must not keep an earlier day.
        sender.publish(nil)
        XCTAssertEqual(channel.sent.count, 3)
        channel.onCounterpartChanged?()
        for _ in 0..<50 where channel.sent.count < 4 { await Task.yield() }
        XCTAssertEqual(channel.sent.count, 4)
        XCTAssertEqual(WatchDayMessage.decode(channel.sent[3]), .cleared)
    }

    func testAFailedSendIsRetriedWhenTheWatchIsBack() async {
        let channel = ChannelStub()
        channel.canSend = true
        channel.fails = true
        let sender = WatchDaySender(channel: channel)
        let day = snapshot(date: today)
        sender.publish(day)
        XCTAssertTrue(channel.sent.isEmpty)

        channel.fails = false
        channel.onReady?()
        for _ in 0..<50 where channel.sent.isEmpty { await Task.yield() }
        XCTAssertEqual(channel.sent.count, 1)
        XCTAssertEqual(WatchDayMessage.decode(channel.sent[0]), .day(day))
    }
}

private final class ChannelStub: WatchDayChannel {
    struct Unreachable: Error {}
    var canSend = false
    var fails = false
    var onReady: (() -> Void)?
    var onCounterpartChanged: (() -> Void)?
    private(set) var sent: [[String: Any]] = []

    func send(_ context: [String: Any]) throws {
        if fails { throw Unreachable() }
        sent.append(context)
    }
}
