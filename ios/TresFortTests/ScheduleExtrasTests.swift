import XCTest
@testable import TresFort

/// A weekday holds activities beside its main workout: morning stretching,
/// core before bed (docs/plans/app-design-pass P14).
final class ScheduleExtrasTests: XCTestCase {
    private func slot(_ id: String) -> TemplateExercise {
        TemplateExercise(id: id, exercise_id: "swing", exercise_name: "Swing",
            exercise_unit: "lb", order_index: 0, target_sets: 3, target_reps: 5,
            target_reps_max: nil, target_rpe: nil, rest_seconds: 90,
            target_weight: nil, cues: nil, exercise_modality: "barbell",
            exercise_laterality: nil, exercise_load_mode: nil, exercise_demo_slug: nil,
            target_duration_s: nil, is_warmup: 0)
    }

    private func plan(_ schedule: String) -> PlanTree {
        PlanTree(id: "p", name: "Week", version: 4, workouts: [
            Workout(id: "kb", name: "Kettlebell A", day_label: nil, order_index: 0, exercises: [slot("1")]),
            Workout(id: "stretch", name: "Morning stretching", day_label: nil, order_index: 1, exercises: []),
            Workout(id: "core", name: "Core before bed", day_label: nil, order_index: 2, exercises: []),
        ], meta: #"{"schedule":"# + schedule + "}")
    }

    func testDecodesExtrasAndKeepsOnlyLiveOnes() {
        let week = plan(#"{"version":2,"week":{"mon":"kb"},"extras":{"mon":["stretch","gone","core"]}}"#)
        XCTAssertEqual(week.schedule?.extraIDs(forWeekdayKey: "mon"), ["stretch", "gone", "core"])
        XCTAssertEqual(ScheduleExtras.current(week), ["mon": ["stretch", "core"]])
        XCTAssertEqual(ScheduleExtras.workouts(on: "mon", plan: week).map(\.name),
                       ["Morning stretching", "Core before bed"])
        XCTAssertEqual(PlanItemSummary.weekdays(using: "stretch", plan: week), ["mon"],
                       "A saved activity says which days hold it, beside a workout too")
        XCTAssertEqual(plan(#"{"version":1,"week":{"mon":"kb"}}"#).schedule?.extras, nil)
    }

    func testAddingKeepsTheDaysWorkoutAndFillsRestDays() {
        let week = plan(#"{"version":1,"week":{"mon":"kb","thu":"kb"},"extras":{"thu":["core"]}}"#)
        let write = ScheduleExtras.adding("stretch", to: ["mon", "tue", "thu"], plan: week)
        XCTAssertEqual(write.week["mon"], "kb", "Monday keeps its workout")
        XCTAssertEqual(write.week["tue"], "stretch", "A rest day takes the activity as its workout")
        XCTAssertEqual(write.week["thu"], "kb")
        XCTAssertEqual(write.extras, ["mon": ["stretch"], "thu": ["core", "stretch"]])

        let again = ScheduleExtras.adding("core", to: ["thu"], plan: week)
        XCTAssertEqual(again.extras, ["thu": ["core"]], "Adding one that is there changes nothing")
    }

    func testRemovingTakesOneOffOneDay() {
        let week = plan(#"{"version":1,"week":{"mon":"kb"},"extras":{"mon":["stretch","core"],"wed":["core"]}}"#)
        XCTAssertEqual(ScheduleExtras.removing("core", from: "mon", plan: week),
                       ["mon": ["stretch"], "wed": ["core"]])
        XCTAssertEqual(ScheduleExtras.removing("stretch", from: "wed", plan: week),
                       ["mon": ["stretch", "core"], "wed": ["core"]])
    }

    func testUnscheduleReachesExtrasIncludingFullWorkouts() {
        let week = plan(#"{"version":1,"week":{"mon":"kb","tue":"stretch"},"extras":{"mon":["stretch","core"],"thu":["stretch"],"fri":["kb"]}}"#)
        XCTAssertEqual(ScheduleExtras.removingEverywhere("stretch", plan: week), ["mon": ["core"], "fri": ["kb"]])
        XCTAssertTrue(WorkoutLibraryPolicy.isScheduled(workoutID: "core", plan: week),
                      "An activity only beside a workout still counts as scheduled")
        XCTAssertEqual(ScheduleExtras.current(week)["fri"], ["kb"], "A full workout keeps its place beside the main workout")
        XCTAssertEqual(ScheduleExtras.workoutIDs(week), ["stretch", "core", "kb"])
    }

    func testAFullDayIsCaughtBeforeSaving() {
        let week = PlanTree(id: "p", name: "Week", version: 1, workouts: [
            Workout(id: "kb", name: "Kettlebell A", day_label: nil, order_index: 0, exercises: [slot("1")]),
        ] + (1...5).map { Workout(id: "a\($0)", name: "A\($0)", day_label: nil, order_index: $0, exercises: []) },
            meta: #"{"schedule":{"version":1,"week":{"mon":"kb"},"extras":{"mon":["a1","a2","a3","a4"]}}}"#)
        XCTAssertEqual(ScheduleExtras.fullDays(adding: "a5", to: ["mon"], plan: week), ["mon"])
        XCTAssertEqual(ScheduleExtras.fullDays(adding: "a5", to: ["tue"], plan: week), [])
    }

    func testNotesAndSpokenLists() {
        let week = plan(#"{"version":1,"week":{"mon":"kb"}}"#)
        XCTAssertEqual(ScheduleExtras.alongsideNote(["mon", "tue"], with: "stretch", plan: week),
                       "Goes alongside Kettlebell A on Monday.")
        XCTAssertNil(ScheduleExtras.alongsideNote(["tue"], with: "stretch", plan: week))
        XCTAssertEqual(ScheduleExtras.spokenList(["Yoga"]), "Yoga")
        XCTAssertEqual(ScheduleExtras.spokenList(["Yoga", "Walk", "Core"]), "Yoga, Walk and Core")
    }

    func testTodayShowsExtrasOnlyOnTodayAndLaterOutsideTrips() {
        let schedule = PlanSchedule(version: 1, week: ["mon": "kb"], extras: ["mon": ["stretch"]])
        let live: Set<String> = ["kb", "stretch"]
        XCTAssertEqual(CalendarProjection.extras(dateString: "2026-05-18", today: "2026-05-18",
                                                 schedule: schedule, templateIDs: live), ["stretch"])
        XCTAssertEqual(CalendarProjection.extras(dateString: "2026-05-11", today: "2026-05-18",
                                                 schedule: schedule, templateIDs: live), [])
        let trip = TripRange(id: "t", start: "2026-05-18", end: "2026-05-18", type: "travel", canTrainLight: true)
        XCTAssertEqual(CalendarProjection.extras(dateString: "2026-05-18", today: "2026-05-18",
                                                 schedule: schedule, templateIDs: live, trips: [trip]), [])
    }
}
