import XCTest
@testable import TresFort

/// Today with several things planned: the workout first, then the
/// activities beside it (docs/plans/app-design-pass P16).
final class TodayLineupTests: XCTestCase {
    private func arrange(_ main: (String, Bool)?, _ extras: [(String, Bool)]) -> TodayLineup.Arrangement {
        TodayLineup.arrange(main: main.map { (id: $0.0, done: $0.1) },
                            extras: extras.map { (id: $0.0, done: $0.1) })
    }

    func testWorkoutLeadsAndActivitiesWaitUnderLaterToday() {
        XCTAssertEqual(arrange(("run", false), [("core", false), ("stretch", false)]),
                       .init(done: [], lead: "run", later: ["core", "stretch"]))
    }

    func testFinishedWorkoutShrinksAndTheNextActivityLeads() {
        XCTAssertEqual(arrange(("run", true), [("core", false), ("stretch", false)]),
                       .init(done: ["run"], lead: "core", later: ["stretch"]))
    }

    func testLoggedActivitiesBecomeCheckLinesInPlanOrder() {
        XCTAssertEqual(arrange(("run", false), [("core", true), ("stretch", false)]),
                       .init(done: ["core"], lead: "run", later: ["stretch"]))
        XCTAssertEqual(arrange(("run", true), [("core", true), ("stretch", false)]),
                       .init(done: ["run", "core"], lead: "stretch", later: []))
    }

    func testWhenEverythingIsDoneTheWorkoutKeepsItsOwnCard() {
        XCTAssertEqual(arrange(("run", true), [("core", true)]),
                       .init(done: ["core"], lead: "run", later: []))
        XCTAssertEqual(arrange(("run", true), []),
                       .init(done: [], lead: "run", later: []))
    }

    func testADayWithOnlyActivitiesLeadsWithTheFirst() {
        XCTAssertEqual(arrange(nil, [("core", false), ("stretch", false)]),
                       .init(done: [], lead: "core", later: ["stretch"]))
        XCTAssertEqual(arrange(nil, [("core", true)]),
                       .init(done: ["core"], lead: nil, later: []))
        XCTAssertEqual(arrange(nil, []), .init(done: [], lead: nil, later: []))
    }
}
