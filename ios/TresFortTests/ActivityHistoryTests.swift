import XCTest
@testable import TresFort

final class ActivityHistoryTests: XCTestCase {
    private func session(_ id: String, _ date: String, _ status: String = "completed",
                         workout: String? = "lift", revision: Int = 1, kind: String? = nil,
                         started: Int? = nil, completed: Int? = nil) -> SessionRow {
        var row = SessionRow(id: id, date: date, status: status, workout_id: workout, updated_at: revision)
        row.kind = kind
        row.started_at = started
        row.completed_at = completed
        return row
    }

    private func activity(_ id: String, _ date: String, kind: String = "run", name: String? = nil,
                          source: String = "intervals", seconds: Int? = 1_537, meters: Double? = 5_296,
                          deleted: Bool = false, start: Int? = nil) -> ExternalActivity {
        var row = ExternalActivity(
            id: id, source: source, external_id: id, date: date, kind: kind, name: name,
            moving_time_sec: seconds, elapsed_time_sec: nil, distance_m: meters, average_watts: nil,
            weighted_avg_watts: nil, average_hr: nil, max_hr: nil, training_load: nil,
            intensity: nil, calories: nil, elevation_gain_m: nil, synced_at: 1, deleted_at: deleted ? 2 : nil)
        row.start_date_local_ms = start
        return row
    }

    /// Wall-clock milliseconds for a time on a civil date, written as if UTC.
    private func wallClock(_ date: String, _ hour: Int, _ minute: Int = 0) -> Int {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let parts = date.split(separator: "-").compactMap { Int($0) }
        let day = utc.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2],
                                                hour: hour, minute: minute))!
        return Int(day.timeIntervalSince1970 * 1_000)
    }

    private func logged(_ id: String, _ date: String, type: String = "other", title: String? = "Soccer",
                        minutes: Int? = 90, deleted: Bool = false) -> ActivityRow {
        ActivityRow(id: id, user_id: "user", date: date, type: type, title: title,
                    duration_minutes: minutes, notes: nil, logged_at: 1, source: "ios",
                    deleted_at: deleted ? 2 : nil)
    }

    private func history(sessions: [SessionRow] = [], activities: [ExternalActivity] = [],
                         logged: [ActivityRow] = [], today: String = "2026-11-03",
                         sets: [String: Int] = [:],
                         workouts: [String: ActivityHistory.WorkoutInfo] = [
                            "lift": .init(name: "Kettlebell A", isRunOnly: false),
                            "tempo": .init(name: "Tempo run", isRunOnly: true),
                         ],
                         hidden: Set<String> = [],
                         timeZone: TimeZone = TimeZone(identifier: "America/Los_Angeles")!) -> ActivityHistory {
        ActivityHistory(sessions: sessions, activities: activities, logged: logged, today: today,
                        unit: .miles, setCount: { sets[$0] ?? 0 },
                        workout: { id in id.flatMap { workouts[$0] } },
                        isHidden: { hidden.contains($0) },
                        timeZone: timeZone)
    }

    func testListsWorkoutsRunsAndLoggedActivitiesNewestFirst() {
        let result = history(
            sessions: [session("s1", "2026-11-02", started: 1_000, completed: 2_701_000)],
            activities: [activity("r1", "2026-11-01", name: "Easy run")],
            logged: [logged("l1", "2026-11-02")],
            sets: ["s1": 12])
        XCTAssertEqual(result.entries.map(\.id), ["workout:s1", "logged:l1", "activity:r1"])
        let workout = result.entries[0]
        XCTAssertEqual(workout.title, "Kettlebell A")
        XCTAssertEqual(workout.category, .workouts)
        XCTAssertEqual(workout.details, ["12 sets", "45m"])
        let run = result.entries[2]
        XCTAssertEqual(run.title, "Easy run")
        XCTAssertEqual(run.category, .runs)
        XCTAssertEqual(Array(run.details.prefix(2)), ["3.3 mi", "25m"])
        XCTAssertTrue(run.details.last?.hasSuffix("/mi") == true)
        let soccer = result.entries[1]
        XCTAssertEqual(soccer.title, "Soccer")
        XCTAssertEqual(soccer.category, .other)
        XCTAssertEqual(soccer.details, ["1h 30m", "Other"])
    }

    func testEntriesOnOneDateEachOpenThemselves() {
        // A workout and a run on one date: tapping the run must open the run,
        // not the workout listed above it.
        let result = history(
            sessions: [session("s1", "2026-11-02")],
            activities: [activity("r1", "2026-11-02"), activity("r2", "2026-11-02", name: "Second run")],
            logged: [logged("l1", "2026-11-02")],
            sets: ["s1": 12])
        let focus = Dictionary(uniqueKeysWithValues: result.entries.map { ($0.id, $0.focus) })
        XCTAssertEqual(focus.count, 4)
        XCTAssertEqual(focus["workout:s1"], .some(nil), "A workout opens its whole date")
        XCTAssertEqual(focus["activity:r1"], .activity("r1"))
        XCTAssertEqual(focus["activity:r2"], .activity("r2"))
        XCTAssertEqual(focus["logged:l1"], .logged("l1"))
        let opened = result.entries.map {
            ActivityHistoryDay(entryID: $0.id, date: $0.date, focus: $0.focus)
        }
        XCTAssertEqual(Set(opened).count, opened.count, "No two rows push the same value")
    }

    func testOnlyFinishedOrStartedWorkoutsUpToTodayAppearOnce() {
        let result = history(sessions: [
            session("done", "2026-11-01"),
            session("done", "2026-11-01"),
            session("gone", "2026-11-01"),
            session("gone", "2026-11-01", "discarded", revision: 2),
            session("planned", "2026-11-02", "planned"),
            session("skipped", "2026-11-02", "skipped"),
            session("live", "2026-11-03", "in_progress"),
            session("empty-live", "2026-11-03", "in_progress"),
            session("future", "2026-11-04"),
        ], sets: ["live": 3, "done": 5])
        XCTAssertEqual(result.entries.map(\.id), ["workout:live", "workout:done"])
        XCTAssertTrue(result.entries[0].inProgress)
        XCTAssertEqual(result.entries[0].details, ["3 sets"], "No duration until it ends")
    }

    func testFinishedRunWorkoutIsListedOnceAsItsRun() {
        let result = history(
            sessions: [session("run-workout", "2026-11-01", workout: "tempo"),
                       session("no-run-yet", "2026-10-30", workout: "tempo")],
            activities: [activity("recorded", "2026-11-01", name: "Tempo run", source: "recording")],
            sets: ["run-workout": 1, "no-run-yet": 1])
        XCTAssertEqual(result.entries.map(\.id), ["activity:recorded", "workout:no-run-yet"])
        XCTAssertTrue(result.entries[0].hasRoute, "A run recorded in the app has a route map")
        XCTAssertEqual(result.entries[1].title, "Tempo run")
    }

    func testDeletedFutureAndHiddenTripActivitiesStayOut() {
        let result = history(
            activities: [activity("deleted", "2026-11-01", deleted: true),
                         activity("future", "2026-11-04"),
                         activity("trip", "2026-10-20"),
                         activity("ride", "2026-10-21", kind: "ride", meters: 30_000)],
            logged: [logged("deleted", "2026-11-01", deleted: true),
                     logged("trip", "2026-10-20")],
            hidden: ["2026-10-20"])
        XCTAssertEqual(result.entries.map(\.id), ["activity:ride"])
        XCTAssertEqual(result.entries[0].title, "Ride")
        XCTAssertEqual(result.entries[0].hasRoute, false)
    }

    func testFreestyleAndRemovedWorkoutsKeepAReadableTitle() {
        let result = history(sessions: [
            session("free", "2026-11-02", workout: nil, kind: "freestyle"),
            session("removed", "2026-11-01", workout: "deleted-workout"),
        ], sets: ["free": 1, "removed": 2])
        XCTAssertEqual(result.entries.map(\.title), ["Freestyle workout", "Workout"])
        XCTAssertEqual(result.entries[0].details, ["1 set"])
    }

    func testCategoriesAndMonthsFollowTheFilter() {
        let result = history(
            sessions: [session("s1", "2026-11-02"), session("s2", "2026-10-28")],
            activities: [activity("r1", "2026-11-01"), activity("w1", "2026-10-02", kind: "hike")],
            logged: [logged("lift", "2026-09-30", type: "lift", title: nil, minutes: nil)],
            sets: ["s1": 1, "s2": 1])
        XCTAssertEqual(result.categories, [.workouts, .runs, .walks])
        XCTAssertEqual(result.months().map(\.id), ["2026-11", "2026-10", "2026-09"])
        XCTAssertEqual(result.months().map { $0.entries.count }, [2, 2, 1])
        let workouts = result.months(in: .workouts)
        XCTAssertEqual(workouts.map(\.id), ["2026-11", "2026-10", "2026-09"])
        XCTAssertEqual(workouts.flatMap(\.entries).map(\.id), ["workout:s1", "workout:s2", "logged:lift"])
        XCTAssertEqual(workouts.last?.entries.first?.title, "Lift (other)")
        XCTAssertEqual(result.months(in: .runs).flatMap(\.entries).map(\.id), ["activity:r1"])
        XCTAssertTrue(result.months(in: .swims).isEmpty)
    }

    func testMonthAndDayTitles() {
        XCTAssertEqual(ActivityHistory.monthTitle("2026-11"), "November 2026")
        XCTAssertFalse(ActivityHistory.dayTitle("2026-11-02").isEmpty)
        XCTAssertEqual(ActivityHistory.dayTitle("not-a-date"), "not-a-date")
    }

    func testEntriesOnOneDateFollowTheirStartTimes() {
        // A big Apple Health import brings several workouts a date. They are
        // listed by when they started, newest first like the dates, and a
        // workout's start (a real instant) is read on the member's clock.
        let la = TimeZone(identifier: "America/Los_Angeles")!
        let wall = wallClock("2026-11-02", 18)
        let liftStart = wall - la.secondsFromGMT(for: Date(timeIntervalSince1970: Double(wall) / 1_000)) * 1_000
        let result = history(
            sessions: [session("lift", "2026-11-02", started: liftStart, completed: liftStart + 3_600_000)],
            activities: [activity("walk", "2026-11-02", kind: "walk", source: "healthkit",
                                  start: wallClock("2026-11-02", 12, 30)),
                         activity("run", "2026-11-02", source: "healthkit", start: wallClock("2026-11-02", 7)),
                         activity("ride", "2026-11-02", kind: "ride", source: "healthkit",
                                  start: wallClock("2026-11-02", 21)),
                         activity("unknown", "2026-11-02", kind: "swim")],
            logged: [logged("soccer", "2026-11-02")],
            sets: ["lift": 10])
        XCTAssertEqual(result.entries.map(\.id), [
            "activity:ride", "workout:lift", "activity:walk", "activity:run",
            "activity:unknown", "logged:soccer",
        ])
        XCTAssertEqual(result.entries[1].startMs, wallClock("2026-11-02", 18))
        XCTAssertNil(result.entries.last?.startMs, "A logged activity has no known start")
    }

    func testCalendarListShowsOneMonthWithEachDayInOrder() {
        let result = history(
            sessions: [session("lift", "2026-10-30", started: wallClock("2026-10-30", 9) + 8 * 3_600_000)],
            activities: [activity("evening", "2026-10-30", source: "healthkit", start: wallClock("2026-10-30", 19)),
                         activity("morning", "2026-10-30", kind: "walk", source: "healthkit",
                                  start: wallClock("2026-10-30", 6)),
                         activity("early", "2026-10-02", source: "healthkit", start: wallClock("2026-10-02", 8)),
                         activity("november", "2026-11-01", source: "healthkit"),
                         activity("last-year", "2025-10-15", source: "healthkit")],
            logged: [logged("soccer", "2026-10-30")],
            sets: ["lift": 4])
        let october = result.days(inMonth: "2026-10")
        XCTAssertEqual(october.map(\.id), ["2026-10-30", "2026-10-02"],
                       "Only the month shown, newest date first, never last year's October")
        XCTAssertEqual(october[0].entries.map(\.id),
                       ["activity:morning", "workout:lift", "activity:evening", "logged:soccer"],
                       "A day reads earliest first; untimed entries last")
        XCTAssertEqual(result.days(inMonth: "2025-10").map(\.id), ["2025-10-15"])
        XCTAssertTrue(result.days(inMonth: "2026-09").isEmpty)
        let run = october[0].entries[2]
        XCTAssertEqual(Array(run.details.prefix(2)), ["3.3 mi", "25m"], "Rows carry distance and time")
    }

    func testActivityStartDecodesAndOlderPayloadsStillDecode() throws {
        let json = """
        [{"id":"healthkit:A","source":"healthkit","external_id":"A","date":"2026-11-02","kind":"run",
          "name":"Running","moving_time_sec":1500,"elapsed_time_sec":1500,"distance_m":5000,
          "average_watts":null,"weighted_avg_watts":null,"average_hr":150,"max_hr":171,
          "training_load":null,"intensity":null,"calories":300,"elevation_gain_m":null,
          "synced_at":1,"deleted_at":null,"start_date_local_ms":1793689200000},
         {"id":"healthkit:B","source":"healthkit","external_id":"B","date":"2026-11-02","kind":"run",
          "name":null,"moving_time_sec":null,"elapsed_time_sec":null,"distance_m":null,
          "average_watts":null,"weighted_avg_watts":null,"average_hr":null,"max_hr":null,
          "training_load":null,"intensity":null,"calories":null,"elevation_gain_m":null,
          "synced_at":1,"deleted_at":null}]
        """
        let rows = try JSONDecoder().decode([ExternalActivity].self, from: Data(json.utf8))
        XCTAssertEqual(rows.map(\.start_date_local_ms), [1_793_689_200_000, nil])
    }
}
