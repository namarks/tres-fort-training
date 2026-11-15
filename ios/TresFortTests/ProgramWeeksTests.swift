import XCTest
@testable import TresFort

/// Blocks of weeks (docs/plans/progressive-plans P0). The shared fixture is
/// the contract with the server's `weekPatternOn` (test/program.test.ts).
final class ProgramWeeksTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Case: Decodable {
            let name: String
            let program: String?
            let date: String
            let expected_week: Int?
            let expected_workout: String?
            let expected_extras: [String]
        }
        let cases: [Case]
    }

    private let live: Set<String> = ["kb_a", "kb_b", "intervals", "tempo", "easy_run",
                                     "long_6", "long_8", "long_10", "stretch"]

    private func plan(meta: [String: Any]) throws -> PlanTree {
        let data = try JSONSerialization.data(withJSONObject: meta)
        return PlanTree(id: "p", name: "Plan", version: 3, workouts: [],
                        meta: String(data: data, encoding: .utf8))
    }

    func testSharedTypeScriptSwiftFixtures() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ProgramWeeks", withExtension: "json"))
        let data = try Data(contentsOf: url)
        let fixture = try JSONDecoder().decode(Fixture.self, from: data)
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var schedule = try XCTUnwrap(raw["schedule"] as? [String: Any])
        schedule["version"] = 1
        let programs = try XCTUnwrap(raw["programs"] as? [String: Any])
        XCTAssertFalse(fixture.cases.isEmpty)

        for item in fixture.cases {
            var meta: [String: Any] = ["schedule": schedule]
            if let name = item.program { meta["program"] = try XCTUnwrap(programs[name], item.name) }
            let tree = try plan(meta: meta)
            if item.program != nil { XCTAssertNotNil(tree.program, item.name) }

            XCTAssertEqual(tree.program?.weekIndex(on: item.date), item.expected_week, item.name)
            let effective = tree.schedule(on: item.date)
            let key = try XCTUnwrap(CalendarProjection.weekdayKey(forDateString: item.date))
            XCTAssertEqual(effective?.templateID(forWeekdayKey: key), item.expected_workout, item.name)
            XCTAssertEqual(CalendarProjection.extras(dateString: item.date, today: "2026-01-01",
                schedule: effective, templateIDs: live), item.expected_extras, item.name)

            let projection = CalendarProjection.project(dateString: item.date, today: "2026-01-01",
                sessionByDate: [:], schedule: effective, templateIDs: live)
            XCTAssertEqual(projection, item.expected_workout.map { DayProjection.projected(templateID: $0) } ?? DayProjection.rest, item.name)
        }
    }

    func testMalformedBlockFallsBackToTheRepeatingWeek() throws {
        let schedule: [String: Any] = ["version": 1, "week": ["mon": "kb_a"]]
        let bad: [[String: Any]] = [
            ["id": "x", "start": "soon", "weeks": [["week": ["mon": "long_8"]]]],
            ["id": "x", "start": "2026-11-09", "weeks": [Any]()],
            ["start": "2026-11-09", "weeks": [["week": ["mon": "long_8"]]]],
            ["id": "x", "start": "2026-11-09", "weeks": ["not a week"]],
        ]
        for program in bad {
            let tree = try plan(meta: ["schedule": schedule, "program": program])
            XCTAssertNil(tree.program)
            XCTAssertEqual(tree.schedule(on: "2026-11-09")?.templateID(forWeekdayKey: "mon"), "kb_a")
        }
    }

    func testStoredBlockIsTidiedLikeTheServer() throws {
        let tree = try plan(meta: ["program": [
            "id": "b", "name": "  Spring  ", "start": "2026-11-09",
            "weeks": [["label": String(repeating: "x", count: 50),
                       "week": ["mon": "kb_a", "tue": ""],
                       "extras": ["mon": ["kb_a", "stretch", "stretch", "a", "b", "c", "d"]]]],
        ]])
        let program = try XCTUnwrap(tree.program)
        XCTAssertEqual(program.name, "Spring")
        XCTAssertFalse(program.repeats, "Only an explicit true repeats")
        XCTAssertEqual(program.weeks[0].label?.count, PlanProgram.maxLabel)
        XCTAssertEqual(program.weeks[0].week["tue"], .some(nil), "An empty id is a rest day")
        XCTAssertEqual(program.weeks[0].extras, ["mon": ["stretch", "a", "b", "c"]],
                       "Extras drop the day's workout and repeats, and keep four")
        XCTAssertEqual(tree.schedule(on: "2026-11-09")?.templateID(forWeekdayKey: "mon"), "kb_a",
                       "A block with no routine still plans its weeks")
    }

    func testDayNumberMatchesTheServerRule() {
        XCTAssertEqual(CalendarProjection.dayNumber("1970-01-01"), 0)
        XCTAssertEqual(CalendarProjection.dayNumber("1970-01-05"), 4)
        XCTAssertEqual(CalendarProjection.dayNumber("1969-12-31"), -1)
        XCTAssertEqual(CalendarProjection.dayNumber("2000-03-01"), 11017)
        XCTAssertNil(CalendarProjection.dayNumber("soon"))
    }
}
