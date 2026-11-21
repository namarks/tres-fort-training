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
}
