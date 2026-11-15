import XCTest
@testable import TresFort

/// The recorder's pauses and GPS speed readings sent with a run
/// (docs/plans/run-recorder P5(e)). The exact JSON below is also parsed by
/// test/diagnostics.test.ts, which keeps the two sides in step.
final class RecordingDiagnosticsTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_793_000_000)

    private func makeRun() -> RecordedRun {
        var run = RecordedRun(startedAt: start, timeZone: TimeZone(identifier: "America/Los_Angeles")!, name: "Run")
        run.autoPauseOn = true
        run.pauses = [
            .init(start: start.addingTimeInterval(60), end: start.addingTimeInterval(90), automatic: nil),
            .init(start: start.addingTimeInterval(120), end: nil, automatic: true),
        ]
        run.speeds = [
            .init(timestamp: start, metersPerSecond: 3.456, horizontalAccuracy: 5),
            .init(timestamp: start.addingTimeInterval(1), metersPerSecond: nil, horizontalAccuracy: 4.84),
            .init(timestamp: start.addingTimeInterval(2.0004), metersPerSecond: 0.1, horizontalAccuracy: 12),
        ]
        return run
    }

    func testUploadJSONIsTheServerShape() {
        XCTAssertEqual(RecordingDiagnostics.uploadJSON(makeRun()), """
            {"auto_pause":true,"pauses":[{"automatic":false,"end_ms":1793000090000,"start_ms":1793000060000},\
            {"automatic":true,"end_ms":null,"start_ms":1793000120000}],"speeds":{"accuracy_dm":[50,48,120],\
            "dt_ms":[0,1000,1000],"speed_cms":[346,null,10],"start_ms":1793000000000},"v":1}
            """)
    }

    func testMotionLevelsAreSentWhenThePhoneHadThem() throws {
        var run = makeRun()
        run.speeds?[0].motion = 0.4123
        run.speeds?[2].motion = 0.018
        let json = try XCTUnwrap(RecordingDiagnostics.uploadJSON(run))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        let speeds = try XCTUnwrap(object["speeds"] as? [String: Any])
        let motion = try XCTUnwrap(speeds["motion_mg"] as? [Any])
        XCTAssertEqual(motion.count, 3)
        XCTAssertEqual(motion[0] as? Int, 412)
        XCTAssertTrue(motion[1] is NSNull)
        XCTAssertEqual(motion[2] as? Int, 18)
    }

    func testARunWithNothingToSendHasNoField() throws {
        let plain = RecordedRun(startedAt: start, timeZone: TimeZone(identifier: "UTC")!)
        XCTAssertNil(RecordingDiagnostics.uploadJSON(plain))
        let body = try XCTUnwrap(String(
            data: APIClient.recordingMultipartBody(plain, tcx: Data(), boundary: "B"), encoding: .utf8))
        XCTAssertFalse(body.contains("diagnostics"))
    }

    func testMultipartBodyCarriesTheField() throws {
        let body = try XCTUnwrap(String(
            data: APIClient.recordingMultipartBody(makeRun(), tcx: Data(), boundary: "B"), encoding: .utf8))
        XCTAssertTrue(body.contains("name=\"diagnostics\"\r\n\r\n{\"auto_pause\":true,"))
    }

    func testOverlappingPausesAndBackwardFixesAreSentInOrder() throws {
        var odd = makeRun()
        odd.pauses = [
            .init(start: start.addingTimeInterval(60), end: start.addingTimeInterval(90), automatic: true),
            .init(start: start.addingTimeInterval(80), end: start.addingTimeInterval(70), automatic: false),
        ]
        odd.speeds = [
            .init(timestamp: start.addingTimeInterval(5), metersPerSecond: 99, horizontalAccuracy: .infinity),
            .init(timestamp: start, metersPerSecond: -1, horizontalAccuracy: 3),
        ]
        let json = try XCTUnwrap(RecordingDiagnostics.uploadJSON(odd))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        let pauses = try XCTUnwrap(object["pauses"] as? [[String: Any]])
        XCTAssertEqual(pauses[1]["start_ms"] as? Int64, 1_793_000_090_000)
        XCTAssertEqual(pauses[1]["end_ms"] as? Int64, 1_793_000_090_000)
        let speeds = try XCTUnwrap(object["speeds"] as? [String: Any])
        XCTAssertEqual(speeds["dt_ms"] as? [Int], [0, 0])
        // Readings past the server's limit are capped; a missing one is null.
        let readings = try XCTUnwrap(speeds["speed_cms"] as? [Any])
        XCTAssertEqual(readings.first as? Int, 5_000)
        XCTAssertTrue(readings.last is NSNull)
        XCTAssertEqual(speeds["accuracy_dm"] as? [Int], [100_000, 30])
    }

    func testFixesPastADayAreLeftOut() throws {
        var long = makeRun()
        long.speeds = [
            .init(timestamp: start, metersPerSecond: 3, horizontalAccuracy: 5),
            .init(timestamp: start.addingTimeInterval(86_400), metersPerSecond: 0, horizontalAccuracy: 5),
            .init(timestamp: start.addingTimeInterval(86_401), metersPerSecond: 3, horizontalAccuracy: 5),
        ]
        let json = try XCTUnwrap(RecordingDiagnostics.uploadJSON(long))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        let speeds = try XCTUnwrap(object["speeds"] as? [String: Any])
        XCTAssertEqual(speeds["dt_ms"] as? [Int], [0, 86_400_000])
    }

    func testARunSavedBeforeDiagnosticsStillLoads() throws {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(makeRun())) as? [String: Any])
        json["speeds"] = nil
        json["autoPauseOn"] = nil
        let old = try JSONDecoder().decode(RecordedRun.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(old.speeds)
        XCTAssertNil(old.autoPauseOn)
    }
}
