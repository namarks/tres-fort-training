import XCTest
@testable import TresFort

final class DateLabelTests: XCTestCase {
    func testLongLabelReadsAsAWeekdayAndDate() {
        XCTAssertEqual(DateLabel.long("2026-11-01"), "Sunday, Nov 1")
        XCTAssertEqual(DateLabel.long("2026-09-09"), "Wednesday, Sep 9")
    }

    func testLongLabelKeepsAnUnreadableValue() {
        XCTAssertEqual(DateLabel.long("not-a-date"), "not-a-date")
    }

    func testShortLabelAbbreviatesTheWeekday() {
        XCTAssertEqual(DateLabel.short("2026-11-06"), "Fri, Nov 6")
        XCTAssertEqual(DateLabel.short("not-a-date"), "not-a-date")
    }

    func testTodayCardKickerJoinsDateAndStatus() {
        XCTAssertEqual(TodayCard.kicker("2026-11-06", "Rest day"), "FRI, NOV 6 · REST DAY")
        XCTAssertEqual(TodayCard.kicker("2026-11-07", ""), "SAT, NOV 7")
    }
}
