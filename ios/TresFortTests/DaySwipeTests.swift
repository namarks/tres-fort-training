import XCTest
@testable import TresFort

/// Swiping between days on Today and the Plan tab (app-design-pass P20).
@MainActor
final class DaySwipeTests: XCTestCase {
    func testADragMovesADayOnlyWhenFarOrFastAndSideways() {
        XCTAssertEqual(DaySwipeState.offset(forDrag: -120, dy: 10, predictedDX: -150), 1, "left is the next day")
        XCTAssertEqual(DaySwipeState.offset(forDrag: 120, dy: -10, predictedDX: 150), -1, "right is the day before")
        XCTAssertEqual(DaySwipeState.offset(forDrag: -40, dy: 0, predictedDX: -400), 1, "a flick counts")
        XCTAssertNil(DaySwipeState.offset(forDrag: -40, dy: 0, predictedDX: -60), "a nudge springs back")
        XCTAssertNil(DaySwipeState.offset(forDrag: -120, dy: 200, predictedDX: -150), "a scroll stays a scroll")
    }

    func testTodaysWindowAndRelativeNames() {
        let today = "2026-11-09"
        XCTAssertEqual(TodayDays.date(1, from: today), "2026-11-10")
        XCTAssertEqual(TodayDays.date(-9, from: today), "2026-10-31")
        XCTAssertEqual(TodayDays.offset(of: "2026-11-22", from: today), 13)
        XCTAssertEqual(TodayDays.offset(of: "2026-11-02", from: today), -7)
        XCTAssertTrue(TodayDays.range.contains(13))
        XCTAssertFalse(TodayDays.range.contains(14))
        XCTAssertFalse(TodayDays.range.contains(-8))
        XCTAssertEqual(TodayDays.relative("2026-11-10", from: today), "Tomorrow")
        XCTAssertEqual(TodayDays.relative("2026-11-08", from: today), "Yesterday")
        XCTAssertEqual(TodayDays.relative("2026-11-12", from: today), "In 3 days")
        XCTAssertEqual(TodayDays.relative("2026-11-06", from: today), "3 days ago")
    }

    func testAnotherDaysStatusWords() {
        let run = Workout(id: "run", name: "Tempo", day_label: nil, order_index: 0, exercises: [])
        func day(_ status: TrainingAgendaDay.Status) -> TrainingAgendaDay {
            TrainingAgendaDay(date: "2026-11-10", status: status, workoutName: "Tempo", exerciseNames: [])
        }
        XCTAssertEqual(TodayDays.status(day(.workout), workout: run, isPast: false), "Planned activity")
        XCTAssertEqual(TodayDays.status(day(.workout), workout: nil, isPast: false), "Planned workout")
        XCTAssertEqual(TodayDays.status(day(.workout), workout: run, isPast: true), "Not logged")
        XCTAssertEqual(TodayDays.status(day(.completed), workout: run, isPast: true), "Completed")
        XCTAssertEqual(TodayDays.status(day(.rest), workout: nil, isPast: false), "Rest day")
        XCTAssertEqual(TodayDays.status(day(.unavailable), workout: nil, isPast: false), "Away")
    }
}
