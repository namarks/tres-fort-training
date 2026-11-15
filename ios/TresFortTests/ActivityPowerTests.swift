import XCTest
@testable import TresFort

/// A ride's power and cadence as the app shows them
/// (docs/plans/run-detail-charts P6): the charts and the power section
/// from what `GET /api/activities/:id/streams` serves (src/ridePower.ts).
final class ActivityPowerTests: XCTestCase {
    private static let ride = """
    {"activity_id":"intervals:activity:u:i7","source":"intervals",
     "streams":{"v":1,"t":[5,15,25,35],
       "distance_m":[100,200,300,400],"speed_mps":[10,10,10,10],
       "heart_rate":null,"elevation_m":null,"lat":null,"lon":null,
       "moving_s":40,"total_distance_m":400,"elevation_gain_m":null,
       "power_w":[150,null,250,600],"cadence_rpm":[90,0,88,110],
       "power":{"avg_w":209,"max_w":600,"normalized_w":251,"work_kj":251,
         "best":[{"s":5,"w":600},{"s":30,"w":600},{"s":60,"w":425},{"s":1200,"w":209}],
         "ftp_w":250,"intensity":1.0,
         "zones":[{"zone":1,"name":"Recovery","min_pct":0,"max_pct":55,"seconds":0},
                  {"zone":2,"name":"Endurance","min_pct":55,"max_pct":76,"seconds":600},
                  {"zone":4,"name":"Threshold","min_pct":91,"max_pct":106,"seconds":570},
                  {"zone":7,"name":"Neuromuscular","min_pct":151,"max_pct":null,"seconds":30}]},
       "cadence":{"avg_rpm":90,"max_rpm":110}}}
    """

    private func decode(_ text: String = ActivityPowerTests.ride) throws -> ActivityStreams {
        try JSONDecoder().decode(ActivityStreamsResponse.self, from: Data(text.utf8)).streams
    }

    func testARideChartsPowerAndCadence() throws {
        let streams = try decode()
        let series = try XCTUnwrap(ActivityChartSeries(streams: streams, kind: "ride", unit: .miles))
        XCTAssertEqual(series.power.map(\.y), [150, 250, 600])
        // The missing reading breaks the power line.
        XCTAssertEqual(series.power.map(\.segment), [0, 1, 1])
        XCTAssertEqual(series.powerAverage, 209)
        XCTAssertEqual(series.cadence.map(\.y), [90, 0, 88, 110])
        XCTAssertEqual(series.cadenceAverage, 90)
    }

    func testPowerAloneIsEnoughToChart() throws {
        let text = Self.ride
            .replacingOccurrences(of: "\"distance_m\":[100,200,300,400],\"speed_mps\":[10,10,10,10]",
                                  with: "\"distance_m\":null,\"speed_mps\":null")
            .replacingOccurrences(of: "\"total_distance_m\":400", with: "\"total_distance_m\":null")
        let series = try XCTUnwrap(ActivityChartSeries(streams: try decode(text), kind: "ride", unit: .miles))
        XCTAssertEqual(series.axis, .minutes)
        XCTAssertTrue(series.pace.isEmpty)
        XCTAssertEqual(series.power.count, 3)
    }

    func testSeriesFromAServerBeforePowerHaveNone() throws {
        let text = """
        {"activity_id":"a","source":"intervals","streams":{"v":1,"t":[5,15],
          "distance_m":[10,20],"speed_mps":[2,2],"heart_rate":null,"elevation_m":null,
          "moving_s":20,"total_distance_m":20,"elevation_gain_m":null}}
        """
        let streams = try decode(text)
        XCTAssertNil(streams.power)
        let series = try XCTUnwrap(ActivityChartSeries(streams: streams, kind: "ride", unit: .miles))
        XCTAssertTrue(series.power.isEmpty)
        XCTAssertTrue(series.cadence.isEmpty)
    }

    func testThePowerSectionShowsAveragesBestEffortsAndZones() throws {
        let streams = try decode()
        let view = ActivityPowerPresentation(power: try XCTUnwrap(streams.power), cadence: streams.cadence)
        XCTAssertEqual(view.stats.map(\.label),
                       ["Avg", "Normalized", "Max", "Intensity", "Variability", "Work", "Cadence"])
        XCTAssertEqual(view.stats.map(\.value),
                       ["209 W", "251 W", "600 W", "1.00", "1.20", "251 kJ", "90 rpm"])
        XCTAssertEqual(view.best.map(\.label), ["5 s", "30 s", "1 min", "20 min"])
        XCTAssertEqual(view.best.last?.value, "209 W")
        XCTAssertEqual(view.zones.map(\.label), ["Z1 Recovery", "Z2 Endurance", "Z4 Threshold", "Z7 Neuromuscular"])
        XCTAssertEqual(view.zones.map(\.range), ["0–55%", "55–76%", "91–106%", "151%+"])
        XCTAssertEqual(view.zones[1].duration, "10:00")
        XCTAssertEqual(view.zones[1].share, 0.5, accuracy: 1e-9)
        XCTAssertEqual(view.zoneNote, "Zones from your FTP of 250 W.")
    }

    func testWithoutAnFTPThePowerSectionSaysHowToGetZones() throws {
        let power = ActivityPowerSummary(avg_w: 200, max_w: 320, normalized_w: nil, work_kj: 720,
                                         best: [], ftp_w: nil, intensity: nil, zones: nil)
        let view = ActivityPowerPresentation(power: power, cadence: nil)
        XCTAssertEqual(view.stats.map(\.label), ["Avg", "Max", "Work"])
        XCTAssertTrue(view.zones.isEmpty)
        XCTAssertEqual(view.zoneNote, "Add your FTP in Profile → Training thresholds to see time in power zones.")
    }
}
