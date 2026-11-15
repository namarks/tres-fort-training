import XCTest
@testable import TresFort

/// Anything a weekday holds can have an optional time of day, with a
/// reminder then (docs/plans/app-design-pass P19).
final class ScheduleTimesTests: XCTestCase {
    private func plan(_ schedule: String) -> PlanTree {
        PlanTree(id: "p", name: "Week", version: 4, workouts: [
            Workout(id: "run", name: "Easy run", day_label: nil, order_index: 0, exercises: []),
            Workout(id: "core", name: "Core before bed", day_label: nil, order_index: 1, exercises: []),
        ], meta: #"{"schedule":"# + schedule + "}")
    }

    func testReadsTimesAndKeepsOnlyWhatTheDayHolds() {
        let week = plan(#"{"version":1,"week":{"mon":"run"},"extras":{"mon":["core"]},"times":{"mon":{"run":"07:00","core":"21:30"},"tue":{"run":"06:00"}}}"#)
        XCTAssertEqual(ScheduleTimes.minutes("run", on: "mon", plan: week), 420)
        XCTAssertEqual(ScheduleTimes.minutes("core", on: "mon", plan: week), 21 * 60 + 30)
        XCTAssertNil(ScheduleTimes.minutes("core", on: "wed", plan: week))
        XCTAssertEqual(ScheduleTimes.minutes("run", onDate: "2026-05-18", plan: week), 420, "2026-05-18 is a Monday")
        XCTAssertEqual(ScheduleTimes.current(week), ["mon": ["run": "07:00", "core": "21:30"]],
                       "Tuesday's time is for a run Tuesday no longer holds")
        XCTAssertNil(plan(#"{"version":1,"week":{"mon":"run"}}"#).schedule?.times)
    }

    func testSettingAndClearingOneTime() {
        let week = plan(#"{"version":1,"week":{"mon":"run"},"extras":{"mon":["core"]},"times":{"mon":{"run":"07:00"}}}"#)
        XCTAssertEqual(ScheduleTimes.setting(21 * 60, for: "core", on: "mon", plan: week),
                       ["mon": ["run": "07:00", "core": "21:00"]])
        XCTAssertEqual(ScheduleTimes.setting(nil, for: "run", on: "mon", plan: week), [:],
                       "Clearing the last time sends an empty map, which clears them")
    }

    func testSameTimeEveryDayItsOn() {
        let week = plan(#"{"version":1,"week":{"mon":"run"},"extras":{"mon":["core"],"tue":["core"],"wed":["core"]},"times":{"mon":{"run":"07:00"}}}"#)
        XCTAssertEqual(PlanItemSummary.weekdays(using: "core", plan: week), ["mon", "tue", "wed"])
        XCTAssertTrue(ScheduleTimes.isSameEveryDay("core", plan: week), "no day has a time yet")
        XCTAssertEqual(ScheduleTimes.setting(21 * 60, for: "core", on: ["mon", "tue", "wed"], plan: week),
                       ["mon": ["run": "07:00", "core": "21:00"], "tue": ["core": "21:00"], "wed": ["core": "21:00"]])

        let mixed = plan(#"{"version":1,"week":{},"extras":{"mon":["core"],"tue":["core"]},"times":{"mon":{"core":"21:00"}}}"#)
        XCTAssertFalse(ScheduleTimes.isSameEveryDay("core", plan: mixed),
                       "Monday has a time and Tuesday has none, so the switch starts off")
        XCTAssertEqual(ScheduleTimes.setting(nil, for: "core", on: ["mon", "tue"], plan: mixed), [:],
                       "clearing every day it's on leaves no times")
    }

    func testWireAndDisplayForms() {
        XCTAssertEqual(ScheduleTimes.minutes(from: "00:00"), 0)
        XCTAssertEqual(ScheduleTimes.minutes(from: "23:59"), 23 * 60 + 59)
        XCTAssertNil(ScheduleTimes.minutes(from: "24:00"))
        XCTAssertNil(ScheduleTimes.minutes(from: "7:00"))
        XCTAssertEqual(ScheduleTimes.hhmm(7 * 60 + 5), "07:05")
        XCTAssertEqual(ScheduleTimes.display(21 * 60, locale: Locale(identifier: "en_GB")), "21:00")
        XCTAssertEqual(TodayLineup.detail("Activity", minutes: nil), "Activity")
        XCTAssertEqual(TodayLineup.detail("Activity", minutes: 21 * 60, locale: Locale(identifier: "en_GB")),
                       "Activity · 21:00")
    }

    func testTimedRemindersFireOnceAtTheirTimeAndSkipThePast() {
        let calendar = TrainingAgendaCalendar.calendar(timeZone: TimeZone(identifier: "America/Los_Angeles")!)
        let now = calendar.date(from: DateComponents(year: 2026, month: 5, day: 18, hour: 12))!
        let items = [
            TimedPlanItem(date: "2026-05-18", workoutID: "run", name: "Easy run", minutes: 420, isMain: true),
            TimedPlanItem(date: "2026-05-18", workoutID: "core", name: "Core before bed", minutes: 21 * 60, isMain: false),
            TimedPlanItem(date: "2026-05-19", workoutID: "core", name: "Core before bed", minutes: 21 * 60, isMain: false),
        ]
        let reminders = TimedReminderPlan.reminders(items: items, now: now, calendar: calendar,
                                                    locale: Locale(identifier: "en_GB"))
        XCTAssertEqual(reminders.map(\.id), ["planned-time-2026-05-18-core", "planned-time-2026-05-19-core"],
                       "This morning's run is already past")
        XCTAssertEqual(reminders.first?.title, "Time for Core before bed")
        XCTAssertEqual(reminders.first?.body, "Planned for 21:00 in Très Fort.")
        XCTAssertEqual(reminders.first?.fireComponents.hour, 21)
        XCTAssertTrue(reminders.allSatisfy { TimedReminderPlan.isReminderID($0.id) })
        XCTAssertFalse(reminders.contains { WorkoutReminderPlan.isReminderID($0.id) })
        XCTAssertEqual(TimedReminderPlan.timedWorkoutDates(items), ["2026-05-18"])
    }
}
