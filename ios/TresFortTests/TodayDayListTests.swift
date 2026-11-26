import XCTest
@testable import TresFort

/// Today's day as one list (app-design-pass P30): which rows show, which
/// leads on navy, and the one line on how much each is.
final class TodayDayListTests: XCTestCase {
    private let gb = Locale(identifier: "en_GB")

    private func slot(_ id: String, name: String, modality: String = "weighted") -> TemplateExercise {
        TemplateExercise(
            id: "\(id)-slot", exercise_id: id, exercise_name: name,
            exercise_unit: "lb", order_index: 0, target_sets: 3, target_reps: 5,
            target_reps_max: nil, target_rpe: nil, rest_seconds: 60, target_weight: nil,
            cues: nil, exercise_modality: modality, exercise_laterality: nil,
            exercise_load_mode: nil, exercise_demo_slug: nil, target_duration_s: nil, is_warmup: 0)
    }

    private func workout(_ id: String, name: String, exercises: [String] = []) -> Workout {
        Workout(id: id, name: name, day_label: nil, order_index: 0,
                exercises: exercises.enumerated().map { slot("\(id)-\($0.offset)", name: $0.element) })
    }

    private func session(_ id: String, workout: String?, slot: Int, status: String,
                         kind: String = "planned") -> SessionRow {
        var row = SessionRow(slot: slot, id: id, date: "2026-11-20", status: status, workout_id: workout)
        row.kind = kind
        return row
    }

    private func items(primary: Workout?, extras: [Workout] = [], sessions: [SessionRow] = [],
                       times: [String: Int] = [:], logged: Set<String> = []) -> [DailyWorkoutAgenda.Item] {
        DailyWorkoutAgenda.items(primary: primary, extras: extras, sessions: sessions,
                                 workouts: ([primary].compactMap { $0 } + extras), times: times,
                                 loggedActivityIDs: logged)
    }

    func testAnAddOnAloneOnARestDayLeadsTheList() {
        // Nick's Friday: core beside no workout.
        let core = workout("core", name: "Core")
        let rows = TodayDayList.rows(items(primary: nil, extras: [core]))
        XCTAssertEqual(rows.map(\.title), ["Core"])
        XCTAssertEqual(TodayDayList.nextID(rows), rows[0].id)
        XCTAssertEqual(TodayDayList.detail(rows[0], unit: .miles), "No exercises yet")
        XCTAssertEqual(TodayDayList.actionTitle(rows[0]), "Start",
                       "core can be started: given exercises, or done as a routine today")
    }

    func testASportIsLoggedNotStarted() {
        let soccer = workout("soccer", name: "Soccer")
        let rows = TodayDayList.rows(items(primary: soccer))
        XCTAssertEqual(TodayDayList.detail(rows[0], unit: .miles), "Activity")
        XCTAssertEqual(TodayDayList.actionTitle(rows[0]), "Log")
        XCTAssertNil(TodayDayList.homeStart(for: soccer))
        XCTAssertEqual(TodayDayList.homeStart(for: workout("s", name: "Evening stretch")), .stretching)
        XCTAssertNil(TodayDayList.homeStart(for: workout("c", name: "Core", exercises: ["Plank"])),
                     "a core workout with exercises starts like any workout")
    }

    func testFinishedRowsShrinkAndTheFirstOpenRowLeads() {
        let lift = workout("kb", name: "Kettlebell A", exercises: ["Swing", "Goblet squat", "Press", "Row"])
        let core = workout("core", name: "Core")
        let rows = TodayDayList.rows(items(
            primary: lift, extras: [core],
            sessions: [session("kb-session", workout: "kb", slot: 0, status: "completed")],
            times: ["kb": 7 * 60, "core": 20 * 60]))
        XCTAssertEqual(rows.map(\.title), ["Kettlebell A", "Core"])
        XCTAssertEqual(TodayDayList.nextID(rows), rows[1].id)
        XCTAssertEqual(TodayDayList.detail(rows[0], unit: .miles), "Done · 4 exercises")
        XCTAssertNil(TodayDayList.actionTitle(rows[0]))
        XCTAssertEqual(TodayDayList.nextKicker(rows[1], locale: gb), "Up next · 20:00")
        XCTAssertEqual(TodayDayList.detail(rows[1], unit: .miles, showsTime: false), "No exercises yet",
                       "the next row's time is in its Up next line")
        XCTAssertEqual(TodayDayList.detail(rows[1], unit: .miles, locale: gb), "No exercises yet · 20:00")
    }

    func testAWorkoutUnderWayLeadsOverOneStillToDo() {
        let lift = workout("kb", name: "Kettlebell A", exercises: ["Swing"])
        let mobility = workout("mob", name: "Mobility", exercises: ["Cat cow"])
        let rows = TodayDayList.rows(DailyWorkoutAgenda.items(
            primary: lift, extras: [], sessions: [session("mob-session", workout: "mob", slot: 1, status: "in_progress")],
            workouts: [lift, mobility], times: [:], loggedActivityIDs: []))
        XCTAssertEqual(rows.map(\.title), ["Kettlebell A", "Mobility"])
        XCTAssertEqual(TodayDayList.nextID(rows), "session:mob-session")
        XCTAssertEqual(TodayDayList.nextKicker(rows[1]), "In progress")
        XCTAssertEqual(TodayDayList.actionTitle(rows[1]), "Continue")
        XCTAssertEqual(TodayDayList.detail(rows[1], unit: .miles), "In progress · Cat cow")
    }

    func testASetAsideAddOnReadsNotTodayAndNothingLeads() {
        let core = workout("core", name: "Core")
        let rows = TodayDayList.rows(items(
            primary: nil, extras: [core],
            sessions: [session("core-today", workout: "core", slot: 1, status: "skipped")]))
        XCTAssertEqual(rows.map(\.title), ["Core"])
        XCTAssertEqual(TodayDayList.detail(rows[0], unit: .miles), "Not today")
        XCTAssertNil(TodayDayList.nextID(rows))
        XCTAssertFalse(TodayDayList.hasOpenRow(rows))
        XCTAssertNil(TodayDayList.actionTitle(rows[0]))
    }

    func testARestDayPlaceholderIsNotARow() {
        let mobility = workout("mob", name: "Mobility", exercises: ["Cat cow"])
        // Mobility added for later on a day with nothing planned: the main
        // workout's empty place isn't listed.
        let rows = TodayDayList.rows(DailyWorkoutAgenda.items(
            primary: nil, extras: [], sessions: [session("mob-session", workout: "mob", slot: 1, status: "planned")],
            workouts: [mobility], times: [:], loggedActivityIDs: []))
        XCTAssertEqual(rows.map(\.title), ["Mobility"])
        XCTAssertEqual(TodayDayList.actionTitle(rows[0]), "Start")
        XCTAssertEqual(TodayDayList.detail(rows[0], unit: .miles), "Cat cow")
    }

    func testALiftReadsItsExercises() {
        let lift = workout("kb", name: "Kettlebell A", exercises: ["Swing", "Goblet squat", "Press", "Row", "Carry"])
        let rows = TodayDayList.rows(items(primary: lift))
        XCTAssertEqual(TodayDayList.detail(rows[0], unit: .miles), "Swing, Goblet squat, Press +2")
        XCTAssertEqual(TodayDayList.nextKicker(rows[0]), "Up next")
    }

    func testALoggedActivityReadsLogged() {
        let walk = workout("walk", name: "Walk")
        let rows = TodayDayList.rows(items(primary: nil, extras: [walk], logged: ["walk"]))
        XCTAssertEqual(TodayDayList.detail(rows[0], unit: .miles), "Logged")
        XCTAssertNil(TodayDayList.nextID(rows))
    }

    func testARequestSavedBeforeLaterExistedStillStartsNow() throws {
        let old = #"{"id":"a","date":"2026-11-20","workoutID":"kb","firstExerciseID":null}"#
        let request = try JSONDecoder().decode(AdditionalWorkoutRequest.self, from: Data(old.utf8))
        XCTAssertTrue(request.startsNow)
        let later = AdditionalWorkoutRequest(id: "b", date: "2026-11-20", workoutID: "kb", firstExerciseID: nil, later: true)
        let roundTrip = try JSONDecoder().decode(AdditionalWorkoutRequest.self, from: JSONEncoder().encode(later))
        XCTAssertFalse(roundTrip.startsNow)
        XCTAssertEqual(roundTrip, later)
    }

    // MARK: finished activities off the plan (P33)

    private func activity(_ id: String, kind: String = "run", name: String? = "Run", sport: String? = nil,
                          date: String = "2026-11-20", seconds: Int? = 2_100, meters: Double? = 5_600,
                          deleted: Bool = false, start: Int? = nil,
                          attribution: String? = nil) -> ExternalActivity {
        var row = ExternalActivity(
            id: id, source: "intervals", external_id: id, date: date, kind: kind, name: name,
            moving_time_sec: seconds, elapsed_time_sec: nil, distance_m: meters, average_watts: nil,
            weighted_avg_watts: nil, average_hr: nil, max_hr: nil, training_load: nil,
            intensity: nil, calories: nil, elevation_gain_m: nil, synced_at: 1, deleted_at: deleted ? 2 : nil)
        row.sport = sport
        row.start_date_local_ms = start
        row.source_attribution = attribution
        return row
    }

    private func logged(_ id: String, type: String = "pilates", title: String? = nil,
                        minutes: Int? = 45) -> ActivityRow {
        ActivityRow(id: id, user_id: "user", date: "2026-11-20", type: type, title: title,
                    duration_minutes: minutes, notes: nil, logged_at: 1, source: "ios", deleted_at: nil)
    }

    private func runWorkout(_ id: String, name: String) -> Workout {
        Workout(id: id, name: name, day_label: nil, order_index: 0,
                exercises: [slot(RunPlan.exerciseID, name: "Outdoor run", modality: "timed")])
    }

    private func done(_ rows: [DailyWorkoutAgenda.Item], activities: [ExternalActivity] = [],
                      logged: [ActivityRow] = []) -> [ActivityHistory.Entry] {
        TodayDoneActivities.entries(rows: rows, activities: activities, logged: logged,
                                    today: "2026-11-20", unit: .miles)
    }

    func testARunRecordedOffThePlanShowsAsDoneBesideTheDaysOwnRows() {
        // Nick's Thursday: core planned, a run recorded with nothing planned for it.
        let core = workout("core", name: "Core")
        let rows = TodayDayList.rows(items(primary: core))
        let entries = done(rows, activities: [activity("i1")])
        XCTAssertEqual(entries.map(\.title), ["Run"])
        XCTAssertEqual(entries.first?.focus, .activity("i1"), "tapping it opens that run's own record")
        XCTAssertTrue(TodayDoneActivities.detail(entries[0]).hasPrefix("Done · 3.5 mi · 35m"),
                      TodayDoneActivities.detail(entries[0]))
        XCTAssertEqual(TodayDayList.nextID(rows), rows[0].id, "core still leads: the run doesn't change the plan")
    }

    func testMergedCopiesOtherDatesAndDeletedRowsStayOut() {
        let entries = done([], activities: [
            activity("shown"),
            activity("merged", deleted: true),
            activity("yesterday", date: "2026-11-19"),
        ])
        XCTAssertEqual(entries.map(\.focus), [.activity("shown")])
    }

    func testAPlannedActivityKeepsTheWorkoutThatLoggedIt() {
        let soccer = workout("soccer", name: "Soccer")
        let match = activity("match", kind: "other", name: "Evening Soccer", sport: "soccer", meters: nil)
        let rows = TodayDayList.rows(items(primary: soccer, logged: ["soccer"]))
        XCTAssertEqual(rows.first?.status, "logged")
        XCTAssertEqual(done(rows, activities: [match], logged: [logged("p1", title: "Soccer")]).count, 0,
                       "Soccer's row already says Logged; the match isn't listed twice")
        XCTAssertEqual(done(rows, activities: [match, activity("run")]).map(\.focus), [.activity("run")])
    }

    func testAFinishedRunWorkoutKeepsItsRunAndASecondRunStillShows() {
        let tempo = runWorkout("tempo", name: "Tempo run")
        let rows = TodayDayList.rows(items(
            primary: tempo, sessions: [session("t", workout: "tempo", slot: 0, status: "completed")]))
        let planned = activity("planned", name: "Tempo run", start: 1_000)
        let extra = activity("extra", name: "Shakeout", seconds: 900, meters: 2_000, start: 2_000)
        XCTAssertEqual(done(rows, activities: [planned, extra]).map(\.focus), [.activity("extra")])

        // Still to do, the planned run claims nothing.
        let open = TodayDayList.rows(items(primary: tempo))
        XCTAssertEqual(done(open, activities: [planned]).map(\.focus), [.activity("planned")])
    }

    func testDoneActivitiesReadInTheOrderTheyHappenedWithTheirAttribution() {
        let morning = activity("am", name: "Morning ride", start: 1_000, attribution: "Garmin Forerunner 945")
        let evening = activity("pm", name: "Evening run", start: 5_000)
        let entries = done([], activities: [evening, morning], logged: [logged("pilates")])
        XCTAssertEqual(entries.map(\.title), ["Morning ride", "Evening run", "Pilates"],
                       "earliest first; an activity logged by hand has no start and comes last")
        XCTAssertEqual(entries[0].attribution, "Garmin Forerunner 945")
        XCTAssertEqual(entries[2].focus, .logged("pilates"))
        XCTAssertEqual(TodayDoneActivities.detail(entries[2]), "Done · 45m")
    }
}
