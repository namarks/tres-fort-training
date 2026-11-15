import HealthKit
import XCTest
@testable import TresFort

/// A swim's detail (docs/plans/sport-activities P4): what the app reads from
/// Apple Health, what it sends, and how the day view words what comes back.
final class SwimDetailTests: XCTestCase {
    private typealias Event = HealthSwimDetail.Event
    private typealias Sample = HealthSwimDetail.Sample

    func testAPoolSwimSendsItsLengthsSetsAndStrokes() throws {
        // Two 25 yd lengths of freestyle, a rest, then one of breaststroke.
        let yard = 22.86
        let events = [
            Event(kind: .segment, start: 0, duration: 41, stroke: "freestyle"),
            Event(kind: .lap, start: 20, duration: 21, stroke: "freestyle"),
            Event(kind: .lap, start: 0, duration: 20, stroke: "freestyle"),
            Event(kind: .segment, start: 70, duration: 30, stroke: "breaststroke"),
            Event(kind: .lap, start: 70, duration: 30, stroke: "breaststroke"),
        ]
        let distances = [Sample(start: 0, end: 20, value: yard), Sample(start: 20, end: 41, value: yard),
                         Sample(start: 70, end: 100, value: yard)]
        let strokes = [Sample(start: 0, end: 20, value: 15), Sample(start: 20, end: 41, value: 16)]
        let detail = try XCTUnwrap(HealthSwimDetail.build(
            location: "pool", poolLength: (yard, "yd"), events: events, distances: distances, strokeCounts: strokes))

        XCTAssertEqual(detail.lengths.map(\.start), [0, 20, 70])
        XCTAssertEqual(detail.lengths[0], .init(start: 0, duration: 20, meters: yard, strokes: 15, stroke: "freestyle"))
        // No stroke count was saved for the last length: none is made up.
        XCTAssertNil(detail.lengths[2].strokes)
        XCTAssertEqual(detail.sets.map(\.lengths), [2, 1])
        XCTAssertEqual(detail.sets[0].meters ?? 0, yard * 2, accuracy: 0.001)
        XCTAssertEqual(detail.strokes, 31)

        let body = detail.jsonBody
        XCTAssertEqual(body["location"] as? String, "pool")
        XCTAssertEqual(body["pool_unit"] as? String, "yd")
        XCTAssertEqual(body["pool_length_m"] as? Double, 22.86)
        let lengths = try XCTUnwrap(body["lengths"] as? [[String: Any]])
        XCTAssertEqual(lengths.count, 3)
        XCTAssertNil(lengths[2]["strokes"])
        XCTAssertEqual(lengths[0]["stroke"] as? String, "freestyle")
    }

    func testAnOpenWaterSwimHasSetsButNoLengths() throws {
        let detail = try XCTUnwrap(HealthSwimDetail.build(
            location: "open_water", poolLength: nil,
            events: [Event(kind: .lap, start: 0, duration: 600, stroke: "freestyle"),
                     Event(kind: .segment, start: 0, duration: 1200, stroke: "freestyle")],
            distances: [Sample(start: 0, end: 600, value: 500), Sample(start: 600, end: 1200, value: 480)],
            strokeCounts: []))
        XCTAssertTrue(detail.lengths.isEmpty)
        XCTAssertEqual(detail.sets.first?.meters, 980)
        XCTAssertNil(detail.strokes)
        XCTAssertNil(HealthSwimDetail.build(location: nil, poolLength: nil, events: [], distances: [], strokeCounts: []))
    }

    func testThePoolUnitAndHealthKitNames() throws {
        XCTAssertEqual(HealthSwimDetail.poolLength(meters: 22.86, yards: 25)?.unit, "yd")
        XCTAssertEqual(HealthSwimDetail.poolLength(meters: 25, yards: 27.34)?.unit, "m")
        XCTAssertEqual(HealthSwimDetail.poolLength(meters: 50, yards: 54.68)?.unit, "m")
        XCTAssertNil(HealthSwimDetail.poolLength(meters: 5, yards: 5.47))
        XCTAssertEqual(HealthSwimDetail.strokeName(HKSwimmingStrokeStyle.butterfly.rawValue), "butterfly")
        XCTAssertEqual(HealthSwimDetail.strokeName(HKSwimmingStrokeStyle.kickboard.rawValue), "kickboard")
        XCTAssertEqual(HealthSwimDetail.strokeName(nil), "unknown")
        XCTAssertEqual(HealthSwimDetail.locationName(HKWorkoutSwimmingLocationType.openWater.rawValue), "open_water")
        XCTAssertNil(HealthSwimDetail.locationName(HKWorkoutSwimmingLocationType.unknown.rawValue))
    }

    func testTheEffortScorePrefersTheMembersRating() {
        XCTAssertEqual(HealthEffortScore.choose(rated: 6, estimated: 8), 6)
        XCTAssertEqual(HealthEffortScore.choose(rated: nil, estimated: 7.25), 7.3)
        XCTAssertNil(HealthEffortScore.choose(rated: 0, estimated: nil))
    }

    func testAPushSendsTheDetailAndScoreOnlyWhenRead() {
        func push(swim: HealthSwimDetail?? = .none, effort: Double?? = .none) -> [String: Any] {
            HealthKitActivityPush(id: "w", date: "2026-11-08", start_date_local_ms: 1, start_date_utc_ms: 1,
                                  source_timezone: nil, kind: "swim", name: "Swim", moving_time_sec: 1800,
                                  elapsed_time_sec: 1800, distance_m: 1000, average_hr: nil, max_hr: nil,
                                  calories: nil, elevation_gain_m: nil, raw: nil,
                                  swim: swim, providerEffort: effort).jsonBody
        }
        XCTAssertNil(push()["swim"])
        XCTAssertNil(push()["provider_effort"])
        XCTAssertTrue(push(swim: .some(nil))["swim"] is NSNull)
        XCTAssertTrue(push(effort: .some(nil))["provider_effort"] is NSNull)
        XCTAssertEqual(push(effort: .some(7))["provider_effort"] as? Double, 7)
    }

    func testAFailedSwimOrEffortReadKeepsTheBackfillPending() {
        func push(swim: HealthSwimDetail?? = .some(nil), effort: Double?? = .some(nil)) -> HealthKitActivityPush {
            HealthKitActivityPush(id: "w", date: "2026-11-08", start_date_local_ms: 1, start_date_utc_ms: 1,
                                  source_timezone: nil, kind: "swim", name: "Swim", moving_time_sec: 1800,
                                  elapsed_time_sec: 1800, distance_m: 1000, average_hr: nil, max_hr: nil,
                                  calories: nil, elevation_gain_m: nil, raw: nil, streams: [:],
                                  swim: swim, providerEffort: effort)
        }
        XCTAssertFalse(push().missedDetail)
        XCTAssertTrue(push(swim: .none).missedSwim)
        XCTAssertTrue(push(swim: .none).missedDetail)
        // Before iOS 18 there is no score to miss.
        XCTAssertEqual(push(effort: .none).missedEffort, HealthEffortScore.isAvailable)
        XCTAssertFalse(push(effort: .some(6)).missedEffort)
    }

    private func response(_ json: String) throws -> ActivitySwimResponse {
        try JSONDecoder().decode(ActivitySwimResponse.self, from: Data(json.utf8))
    }

    func testTheDayViewWordsAPoolSwimInThePoolsUnit() throws {
        let swim = try response("""
        {"activity_id":"a","swim":{"location":"pool","pool_length_m":22.86,"pool_unit":"yd","strokes":64,
          "lengths":[],"sets":[{"start_s":0,"duration_s":105,"distance_m":91.4,"lengths":4,"stroke":"freestyle"}]},
         "summary":{"length_count":4,"strokes":64,"strokes_per_length":16,"swolf":39.3,
          "stroke_breakdown":[{"stroke":"freestyle","lengths":3,"distance_m":68.6},
                              {"stroke":"breaststroke","lengths":1,"distance_m":22.9}]}}
        """)
        // A member who uses kilometers still sees a yard pool in yards.
        let format = SwimDetailFormat(swim, unit: .kilometers)
        XCTAssertEqual(format.place, "25 yd pool")
        XCTAssertEqual(format.figures.map(\.label), ["Lengths", "Strokes", "Strokes / length", "SWOLF"])
        XCTAssertEqual(format.figures.last?.value, "39")
        XCTAssertEqual(format.strokes, "Freestyle 3 · Breaststroke 1")
        XCTAssertEqual(format.sets.first?.title, "Set 1 · Freestyle")
        XCTAssertEqual(format.sets.first?.figures.hasSuffix("1:45 /100yd"), true)
    }

    func testOpenWaterWithoutDetailStillReads() throws {
        let swim = try response("""
        {"activity_id":"a","swim":{"location":"open_water","pool_length_m":null,"pool_unit":null,"strokes":null,
          "lengths":[],"sets":[]},
         "summary":{"length_count":0,"strokes":null,"strokes_per_length":null,"swolf":null,"stroke_breakdown":[]}}
        """)
        let format = SwimDetailFormat(swim, unit: .miles)
        XCTAssertEqual(format.place, "Open water")
        XCTAssertTrue(format.figures.isEmpty)
        XCTAssertNil(format.strokes)
        XCTAssertFalse(format.isEmpty)
    }
}
