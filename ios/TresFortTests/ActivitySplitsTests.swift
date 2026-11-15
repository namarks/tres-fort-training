import XCTest
@testable import TresFort

/// A run's split per mile or kilometer from its chart series (Activity tab
/// fixes, app-design-pass P23). The series come bucketed the way
/// src/activityStreams.ts serves them: `t` is each bucket's middle in moving
/// seconds and `distance_m` the distance at its end, from the start.
final class ActivitySplitsTests: XCTestCase {
    /// `buckets` buckets of `width` seconds at `metersPerSecond`.
    private func steady(buckets: Int, width: Double, metersPerSecond: Double,
                        hr: [Double?]? = nil) -> ActivityStreams {
        let t = (0..<buckets).map { (Double($0) + 0.5) * width }
        let d = (0..<buckets).map { Double($0 + 1) * width * metersPerSecond }
        return streams(t: t, d: d, moving: Double(buckets) * width, hr: hr)
    }

    private func streams(t: [Double], d: [Double?], moving: Double, hr: [Double?]? = nil) -> ActivityStreams {
        ActivityStreams(v: 1, t: t, distance_m: d, speed_mps: nil, heart_rate: hr, elevation_m: nil,
                        moving_s: moving, total_distance_m: d.compactMap { $0 }.last,
                        elevation_gain_m: nil)
    }

    func testSplitsCountFromTheStartOfTheActivity() {
        // 4:10 a kilometer in 10-second buckets: the first bucket already
        // ends 40 m in, and the first kilometer still counts from 0 m.
        let five = ActivitySplit.splits(steady(buckets: 125, width: 10, metersPerSecond: 4), unit: .kilometers)
        XCTAssertEqual(five.count, 5)
        for split in five {
            XCTAssertFalse(split.isPartial)
            XCTAssertEqual(split.meters, 1_000, accuracy: 1e-6)
            XCTAssertEqual(split.seconds, 250, accuracy: 1e-6)
        }
        let one = ActivitySplit.splits(steady(buckets: 25, width: 10, metersPerSecond: 4), unit: .kilometers)
        XCTAssertEqual(one.count, 1)
        XCTAssertEqual(one.first?.seconds ?? 0, 250, accuracy: 1e-6)
    }

    func testEachKilometerAndTheLastStretch() {
        // 250 m a minute for 2.5 km: 4:00 a kilometer, then 500 m in 2:00.
        let splits = ActivitySplit.splits(steady(buckets: 10, width: 60, metersPerSecond: 250.0 / 60,
                                                 hr: Array(repeating: 150, count: 10)), unit: .kilometers)
        XCTAssertEqual(splits.count, 3)
        XCTAssertEqual(splits[0].seconds, 240, accuracy: 1e-6)
        XCTAssertEqual(splits[1].seconds, 240, accuracy: 1e-6)
        XCTAssertEqual(splits[0].pace(.kilometers) ?? 0, 240, accuracy: 1e-6)
        XCTAssertEqual(splits[0].averageHeartRate, 150)
        XCTAssertTrue(splits[2].isPartial)
        XCTAssertEqual(splits[2].meters, 500, accuracy: 1e-6)
        XCTAssertEqual(splits[2].seconds, 120, accuracy: 1e-6)
    }

    func testABoundaryBetweenTwoBucketEndsIsInterpolated() {
        // 750 m by 300 s and 1,500 m by 600 s: the kilometer falls at 400 s.
        let splits = ActivitySplit.splits(streams(t: [150, 450], d: [750, 1_500], moving: 600), unit: .kilometers)
        XCTAssertEqual(splits.first?.seconds ?? 0, 400, accuracy: 1e-6)
        XCTAssertEqual(splits.last?.meters ?? 0, 500, accuracy: 1e-6)
        XCTAssertEqual(splits.last?.seconds ?? 0, 200, accuracy: 1e-6)
    }

    func testMilesAndHeartRatePerSplit() {
        let mile = RunDistanceUnit.miles.meters
        let splits = ActivitySplit.splits(streams(t: [240, 720, 1_200], d: [mile, mile + mile, mile + mile + mile],
                                                  moving: 1_440, hr: [140, 160, 170]), unit: .miles)
        XCTAssertEqual(splits.count, 3)
        for split in splits { XCTAssertEqual(split.seconds, 480, accuracy: 1e-6) }
        XCTAssertEqual(splits.map(\.averageHeartRate), [140, 160, 170])
        XCTAssertEqual(splits.map(\.isPartial), [false, false, false])
    }

    func testATinyLastStretchAndRunsShorterThanAUnitHaveNoSplit() {
        let tiny = ActivitySplit.splits(streams(t: [120, 360], d: [1_000, 1_050], moving: 480), unit: .kilometers)
        XCTAssertEqual(tiny.count, 1, "50 m after the last kilometer is mostly the stop")
        XCTAssertEqual(tiny.first?.seconds ?? 0, 240, accuracy: 1e-6)
        XCTAssertTrue(ActivitySplit.splits(streams(t: [100], d: [900], moving: 200), unit: .kilometers).isEmpty)
        XCTAssertTrue(ActivitySplit.splits(streams(t: [100, 300], d: [nil, nil], moving: 400),
                                           unit: .kilometers).isEmpty)
    }

    func testGapsAndBackwardDistancesAreSkipped() {
        let splits = ActivitySplit.splits(streams(t: [50, 150, 250, 350], d: [500, nil, 400, 1_000], moving: 400),
                                          unit: .kilometers)
        XCTAssertEqual(splits.count, 1)
        XCTAssertEqual(splits[0].seconds, 400, accuracy: 1e-6)
    }

    func testBucketEndsAreHalfwayToTheNextMiddle() {
        XCTAssertEqual(ActivitySplit.bucketEnds([5, 15, 25], count: 3, movingSeconds: 30), [10, 20, 30])
        XCTAssertEqual(ActivitySplit.bucketEnds([5], count: 1, movingSeconds: 3), [5])
    }

    func testTheFastestSplitHasTheLongestBar() {
        XCTAssertEqual(ActivitySplitsView.barShare(400, fastest: 400, slowest: 500), 1)
        XCTAssertEqual(ActivitySplitsView.barShare(500, fastest: 400, slowest: 500), 0.35, accuracy: 1e-9)
        XCTAssertEqual(ActivitySplitsView.barShare(450, fastest: 450, slowest: 450), 1)
        XCTAssertEqual(ActivitySplitsView.barShare(nil, fastest: 400, slowest: 500), 0)
    }
}
