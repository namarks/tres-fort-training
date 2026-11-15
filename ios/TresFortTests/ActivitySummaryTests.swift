import XCTest
@testable import TresFort

final class ActivitySummaryTests: XCTestCase {
    private func session(_ id: String, _ date: String, workout: String? = "lift",
                         minutes: Int? = nil) -> SessionRow {
        var row = SessionRow(id: id, date: date, status: "completed", workout_id: workout, updated_at: 1)
        if let minutes {
            row.started_at = 1_000
            row.completed_at = 1_000 + minutes * 60_000
        }
        return row
    }

    private func activity(_ id: String, _ date: String, kind: String = "run", name: String? = nil,
                          seconds: Int? = 1_800, meters: Double? = 5_000, load: Double? = nil) -> ExternalActivity {
        ExternalActivity(
            id: id, source: "intervals", external_id: id, date: date, kind: kind, name: name,
            moving_time_sec: seconds, elapsed_time_sec: nil, distance_m: meters, average_watts: nil,
            weighted_avg_watts: nil, average_hr: nil, max_hr: nil, training_load: nil,
            intensity: nil, calories: nil, elevation_gain_m: nil, synced_at: 1, deleted_at: nil,
            effective_load: load)
    }

    private func logged(_ id: String, _ date: String, type: String = "other", title: String? = "Soccer",
                        minutes: Int? = 90) -> ActivityRow {
        ActivityRow(id: id, user_id: "user", date: date, type: type, title: title,
                    duration_minutes: minutes, notes: nil, logged_at: 1, source: "ios", deleted_at: nil)
    }

    private func entries(sessions: [SessionRow] = [], activities: [ExternalActivity] = [],
                         logged: [ActivityRow] = [], today: String = "2026-11-07",
                         runOnly: Set<String> = []) -> [ActivityHistory.Entry] {
        ActivityHistory(sessions: sessions, activities: activities, logged: logged, today: today,
                        unit: .miles, setCount: { _ in 10 },
                        workout: { id in id.map { .init(name: "Kettlebell A", isRunOnly: runOnly.contains($0)) } })
            .entries
    }

    // Today is Saturday 2026-11-07; the week runs Monday Nov 2 to Sunday Nov 8.

    func testThisWeekCountsLiftsRunsAndSportsByDay() {
        let summary = ActivitySummary(entries: entries(
            sessions: [session("s1", "2026-11-04", minutes: 38)],
            activities: [activity("r1", "2026-11-05", seconds: 1_800, meters: 5_894, load: 40),
                         activity("r2", "2026-11-06", seconds: 1_905, meters: 5_491, load: 36)],
            logged: [logged("l1", "2026-11-02")]), today: "2026-11-07")
        XCTAssertEqual(summary.days.map(\.date).first, "2026-11-02")
        XCTAssertEqual(summary.days.count, 7)
        XCTAssertEqual(summary.days[0].seconds[.sport], 90 * 60, "Soccer on Monday counts")
        XCTAssertEqual(summary.days[2].seconds[.strength], 38 * 60)
        XCTAssertEqual(summary.days[3].seconds[.endurance], 1_800)
        XCTAssertTrue(summary.days[5].isToday)
        XCTAssertTrue(summary.days[6].isFuture)
        let week = try! XCTUnwrap(summary.thisWeek)
        XCTAssertEqual(week.sessions, 4)
        XCTAssertEqual(week.totalSeconds, 90 * 60 + 38 * 60 + 1_800 + 1_905)
        XCTAssertEqual(summary.distance, .init(meters: 5_894 + 5_491, kind: "run"))
        XCTAssertEqual(summary.load, 76)
    }

    func testUnknownLoadStaysUnknownAndASwimWeekShowsSwimDistance() {
        let summary = ActivitySummary(entries: entries(
            activities: [activity("w1", "2026-11-03", kind: "swim", meters: 2_000)],
            logged: [logged("l1", "2026-11-04")]), today: "2026-11-07")
        XCTAssertNil(summary.load, "Nothing this week has a load, so it isn't zero")
        XCTAssertEqual(summary.distance, .init(meters: 2_000, kind: "swim"))
    }

    func testTheKindWithTheMostTimeSetsTheDistance() {
        // Two hours in the pool beat a longer-distance half hour walk.
        let summary = ActivitySummary(entries: entries(
            activities: [activity("w1", "2026-11-03", kind: "swim", seconds: 3_600, meters: 2_500),
                         activity("w2", "2026-11-05", kind: "swim", seconds: 3_600, meters: 2_500),
                         activity("k1", "2026-11-04", kind: "walk", seconds: 1_800, meters: 3_200)]),
            today: "2026-11-07")
        XCTAssertEqual(summary.distance, .init(meters: 5_000, kind: "swim"))
    }

    func testRideDistanceShowsWhenItIsTheMostDistance() {
        let summary = ActivitySummary(entries: entries(
            activities: [activity("r1", "2026-11-03", meters: 5_000),
                         activity("b1", "2026-11-04", kind: "ride", meters: 30_000)]), today: "2026-11-07")
        XCTAssertEqual(summary.distance?.kind, "ride")
    }

    func testStreakCountsAnyTrainingAndAnEmptyCurrentWeekKeepsIt() {
        // Runs only in the two weeks before this one, nothing yet this week.
        let summary = ActivitySummary(entries: entries(
            activities: [activity("r1", "2026-10-29"), activity("r2", "2026-10-21")],
            logged: [logged("l1", "2026-10-12")]), today: "2026-11-07")
        XCTAssertEqual(summary.streak, 3, "Weeks of Oct 26, Oct 19 and Oct 12, all without a workout")
        let broken = ActivitySummary(entries: entries(
            activities: [activity("r1", "2026-10-21")]), today: "2026-11-07")
        XCTAssertEqual(broken.streak, 0, "A missed full week ends the streak")
    }

    func testChangeComparesWithTheSameDaysLastWeek() {
        // Last week: 30 minutes by Saturday, then a long run on Sunday that
        // must not count against this Saturday.
        let summary = ActivitySummary(entries: entries(
            activities: [activity("old", "2026-10-27", seconds: 1_800),
                         activity("sunday", "2026-11-01", seconds: 7_200),
                         activity("now", "2026-11-03", seconds: 3_600)]), today: "2026-11-07")
        XCTAssertEqual(summary.changeSeconds, 1_800)
        XCTAssertEqual(ActivitySummary.changeText(summary.changeSeconds), "30m more than this time last week")
        XCTAssertEqual(ActivitySummary.changeText(-4_920), "1h 22m less than this time last week")
        XCTAssertEqual(ActivitySummary.changeText(20), "Same as this time last week")
    }

    func testWeeksSplitTimeByKindAndAverageLeavesOutThisWeek() {
        let summary = ActivitySummary(entries: entries(
            sessions: [session("s1", "2026-10-28", minutes: 40)],
            activities: [activity("r1", "2026-10-29", seconds: 1_200)],
            logged: [logged("l1", "2026-11-02", minutes: 60)]), today: "2026-11-07", weekCount: 3)
        XCTAssertEqual(summary.weeks.map(\.start), ["2026-10-19", "2026-10-26", "2026-11-02"])
        XCTAssertEqual(summary.weeks[1].seconds[.strength], 2_400)
        XCTAssertEqual(summary.weeks[1].seconds[.endurance], 1_200)
        XCTAssertEqual(summary.weeks[2].seconds[.sport], 3_600)
        XCTAssertEqual(summary.weeks[2].end, "2026-11-07")
        XCTAssertEqual(summary.averageWeekSeconds, (0 + 3_600) / 2)
    }

    func testAWorkoutLeftOpenForHoursAddsNoTime() {
        let summary = ActivitySummary(entries: entries(
            sessions: [session("s1", "2026-11-03", minutes: 9 * 60)]), today: "2026-11-07")
        XCTAssertEqual(summary.thisWeek?.sessions, 1)
        XCTAssertEqual(summary.thisWeek?.totalSeconds, 0)
        XCTAssertEqual(summary.days[1].sessions, 1, "The day still shows it trained")
        let long = ActivitySummary(entries: entries(
            logged: [logged("l1", "2026-11-03", title: "Hike", minutes: 5 * 60)]), today: "2026-11-07")
        XCTAssertEqual(long.thisWeek?.totalSeconds, 5 * 3_600, "A logged duration counts in full")
    }

    func testFamiliesFollowTheKind() {
        XCTAssertEqual(ActivityHistory.Family.forKind("run"), .endurance)
        XCTAssertEqual(ActivityHistory.Family.forKind("row"), .endurance)
        XCTAssertEqual(ActivityHistory.Family.forKind("strength"), .strength)
        XCTAssertEqual(ActivityHistory.Family.forKind("other"), .sport)
        XCTAssertEqual(ActivityHistory.Family.forKind("yoga"), .sport)
        let runWorkout = entries(sessions: [session("s1", "2026-11-03", workout: "tempo")], runOnly: ["tempo"])
        XCTAssertEqual(runWorkout.first?.family, .endurance, "A run workout without its run is still a run")
    }

    // MARK: - Highlights

    func testHighlightsPickTheFastestAndLongestRecentRun() {
        let list = entries(activities: [
            activity("tempo", "2026-11-05", name: "Tempo Run", seconds: 1_814, meters: 5_894),
            activity("zone", "2026-11-01", name: "Zone 3", seconds: 1_537, meters: 5_296),
            activity("long", "2026-10-24", seconds: 2_394, meters: 6_787),
            activity("sprint", "2026-11-06", seconds: 200, meters: 1_000),
            activity("old", "2026-09-01", seconds: 1_000, meters: 10_000),
            activity("ride", "2026-11-04", kind: "ride", seconds: 1_000, meters: 20_000),
        ])
        let highlights = ActivityHighlights(entries: list, today: "2026-11-07")
        XCTAssertEqual(highlights.fastestRun?.entryID, "activity:zone",
                       "Short runs and runs older than 30 days don't count")
        XCTAssertEqual(highlights.longestRun?.entryID, "activity:long")
        XCTAssertEqual(highlights.longestRun?.focus, .activity("long"))
        XCTAssertNil(highlights.newBest)
    }

    private func set(_ id: String, session: String, exercise: String = "swing", weight: Double, reps: Int = 10,
                     unit: String = "kg", warmup: Bool = false, logged: Int) -> SetLog {
        SetLog(id: id, session_id: session, exercise_id: exercise, template_exercise_id: nil, set_index: 1,
               weight: weight, reps: reps, rpe: nil, is_warmup: warmup ? 1 : 0, logged_at: logged,
               duration_s: nil, is_timed: 0, deleted_at: nil, weight_unit: unit)
    }

    func testNewBestIsARecentSetHeavierThanEveryEarlierOne() {
        let dates = ["a": "2026-09-10", "b": "2026-10-20", "c": "2026-11-04"]
        let sets = [
            set("1", session: "a", weight: 20, logged: 1),
            set("2", session: "b", weight: 20, reps: 12, logged: 2),
            set("3", session: "c", weight: 24, reps: 12, logged: 3),
            set("4", session: "c", weight: 32, warmup: true, logged: 4),
            set("5", session: "c", exercise: "first-time", weight: 50, logged: 5),
        ]
        let highlights = ActivityHighlights(entries: [], sets: sets, sessionDates: dates, today: "2026-11-07")
        let best = try! XCTUnwrap(highlights.newBest)
        XCTAssertEqual(best.exerciseID, "swing", "A first-ever set has nothing to beat, and warm-ups don't count")
        XCTAssertEqual(best.weight, 24)
        XCTAssertEqual(best.reps, 12)
        XCTAssertEqual(best.previousWeight, 20)
        XCTAssertEqual(best.date, "2026-11-04")
    }

    func testNewBestComparesPhysicalLoadAcrossUnits() {
        let dates = ["a": "2026-09-10", "b": "2026-11-04"]
        // 45 lb is about 20.4 kg: 20 kg is lighter, so no new best.
        let lighter = [set("1", session: "a", weight: 45, unit: "lb", logged: 1),
                       set("2", session: "b", weight: 20, logged: 2)]
        XCTAssertNil(ActivityHighlights(entries: [], sets: lighter, sessionDates: dates, today: "2026-11-07").newBest)
        let heavier = [set("1", session: "a", weight: 40, unit: "lb", logged: 1),
                       set("2", session: "b", weight: 20, logged: 2)]
        let best = ActivityHighlights(entries: [], sets: heavier, sessionDates: dates, today: "2026-11-07").newBest
        XCTAssertEqual(best?.previousUnit, .lb)
        XCTAssertEqual(best?.unit, .kg)
    }

    func testABestOlderThanTheWindowIsNotAHighlight() {
        let dates = ["a": "2026-08-01", "b": "2026-09-01"]
        let sets = [set("1", session: "a", weight: 20, logged: 1), set("2", session: "b", weight: 24, logged: 2)]
        XCTAssertNil(ActivityHighlights(entries: [], sets: sets, sessionDates: dates, today: "2026-11-07").newBest)
    }

    func testTimedExercisesNeverCountAsLoadedBests() {
        let dates = ["a": "2026-10-01", "b": "2026-11-04"]
        let sets = [set("1", session: "a", exercise: "carry", weight: 20, logged: 1),
                    set("2", session: "b", exercise: "carry", weight: 30, logged: 2)]
        let highlights = ActivityHighlights(entries: [], sets: sets, sessionDates: dates, today: "2026-11-07",
                                            countsAsLoaded: { $0 != "carry" })
        XCTAssertNil(highlights.newBest)
    }

    func testProfileInitials() {
        XCTAssertEqual(ProfileButton.initials("Nick Marks"), "NM")
        XCTAssertEqual(ProfileButton.initials("  nick  "), "N")
        XCTAssertEqual(ProfileButton.initials("Ana María de la Cruz"), "AM")
        XCTAssertNil(ProfileButton.initials(""))
        XCTAssertNil(ProfileButton.initials(nil))
    }

    // MARK: Weeks chart axes (P23)

    func testTheTimeAxisCountsInRoundStepsThatNeverRepeat() {
        // An hour and ten minutes at most: 0, 30m, 1h, 1h 30m, not 0h, 0h, 1h, 1h.
        let marks = ActivitySummary.axisMinutes(busiestSeconds: 70 * 60)
        XCTAssertEqual(marks, [0, 30, 60, 90])
        XCTAssertEqual(marks.map(ActivitySummary.axisLabel), ["0", "30m", "1h", "1h 30m"])
        XCTAssertEqual(ActivitySummary.axisMinutes(busiestSeconds: 20 * 60), [0, 15, 30])
        XCTAssertEqual(ActivitySummary.axisMinutes(busiestSeconds: 7 * 3_600), [0, 120, 240, 360, 480])
        XCTAssertEqual(ActivitySummary.axisMinutes(busiestSeconds: 0), [0, 15])
        for seconds in [1, 59 * 60, 3_600, 3 * 3_600 + 1, 30 * 3_600] {
            let labels = ActivitySummary.axisMinutes(busiestSeconds: seconds).map(ActivitySummary.axisLabel)
            XCTAssertEqual(Set(labels).count, labels.count, "No two marks read the same at \(seconds)s")
            XCTAssertLessThanOrEqual(labels.count, 5)
        }
    }

    func testEveryOtherWeekIsDatedEndingWithThisWeek() {
        let starts = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12",
                      "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]
        let labels = ActivitySummary.axisWeekLabels(starts, every: 2)
        XCTAssertEqual(labels.count, 4)
        XCTAssertEqual(labels["2026-11-09"], "This week")
        XCTAssertEqual(labels["2026-10-26"], "Oct 26")
        XCTAssertEqual(labels["2026-09-28"], "Sep 28")
        XCTAssertNil(labels["2026-09-21"])
        XCTAssertNil(labels["2026-11-02"])
        XCTAssertEqual(ActivitySummary.axisWeekLabels(starts, every: 4).keys.sorted(), ["2026-10-12", "2026-11-09"])
        XCTAssertTrue(ActivitySummary.axisWeekLabels([], every: 2).isEmpty)
    }
}
