import Foundation
import XCTest
@testable import TresFort

/// Spoken step and on/off-target cues for planned runs (planned-runs P3).
final class RunTargetCoachTests: XCTestCase {
    private let pace = RunPlan.Target.pace(fastestSecondsPerKm: 300, slowestSecondsPerKm: 330)
    private let heartRate = RunPlan.Target.heartRate(minBPM: 130, maxBPM: 145)

    func testReadingsLeaveTheTargetOnlyPastTheMargin() {
        XCTAssertEqual(RunTargetCoach.reading(315, target: pace), .onTarget)
        XCTAssertEqual(RunTargetCoach.reading(300, target: pace), .onTarget)
        XCTAssertNil(RunTargetCoach.reading(333, target: pace), "Inside the margin the last reading stands")
        XCTAssertEqual(RunTargetCoach.reading(336, target: pace), .above)
        XCTAssertEqual(RunTargetCoach.reading(294, target: pace), .below)
        XCTAssertEqual(RunTargetCoach.reading(148, target: heartRate), .above)
        XCTAssertNil(RunTargetCoach.reading(146, target: heartRate))
        XCTAssertEqual(RunTargetCoach.reading(127, target: heartRate), .below)
    }

    /// Feeds one reading a second from `from` to `to` moving seconds and
    /// returns what was said, with the second it was said.
    private func run(_ coach: inout RunTargetCoach, target: RunPlan.Target, value: Double,
                     from: Int, to: Int, stepStart: Double = 0) -> [(Int, String)] {
        var said: [(Int, String)] = []
        for second in from...to {
            if let cue = coach.update(target: target, value: value, stepSeconds: Double(second) - stepStart,
                                      movingSeconds: Double(second)) {
                said.append((second, cue))
            }
        }
        return said
    }

    func testACueWaitsForTheStepToSettleAndTheChangeToHold() {
        var coach = RunTargetCoach()
        coach.startStep(at: 0)
        // Too slow from the start: readings count from 30 s into the step,
        // and the change must hold 10 s.
        let said = run(&coach, target: pace, value: 360, from: 1, to: 60)
        XCTAssertEqual(said.map(\.0), [40])
        XCTAssertEqual(said.map(\.1), ["Speed up."])
    }

    func testBackOnTargetIsSpokenAndCuesDontChatter() {
        var coach = RunTargetCoach()
        coach.startStep(at: 0)
        XCTAssertEqual(run(&coach, target: pace, value: 360, from: 1, to: 40).map(\.1), ["Speed up."])
        // Back on pace at 41 s: held 10 s by 51 s, but the last cue was at 40 s.
        let back = run(&coach, target: pace, value: 315, from: 41, to: 70)
        XCTAssertEqual(back.map(\.0), [70])
        XCTAssertEqual(back.map(\.1), ["On pace."])
        // A brief excursion shorter than the hold says nothing.
        XCTAssertTrue(run(&coach, target: pace, value: 280, from: 71, to: 78).isEmpty)
        XCTAssertTrue(run(&coach, target: pace, value: 315, from: 79, to: 120).isEmpty)
    }

    func testStayingOnTargetSaysNothing() {
        var coach = RunTargetCoach()
        coach.startStep(at: 0)
        XCTAssertTrue(run(&coach, target: heartRate, value: 138, from: 1, to: 300).isEmpty)
    }

    func testHeartRateCuesAndNoReading() {
        var coach = RunTargetCoach()
        coach.startStep(at: 100)
        XCTAssertNil(coach.update(target: heartRate, value: nil, stepSeconds: 40, movingSeconds: 140))
        let said = run(&coach, target: heartRate, value: 120, from: 101, to: 160, stepStart: 100)
        XCTAssertEqual(said.map(\.0), [140])
        XCTAssertEqual(said.map(\.1), ["Heart rate low. Pick it up."])
        let high = run(&coach, target: heartRate, value: 160, from: 161, to: 220, stepStart: 100)
        XCTAssertEqual(high.map(\.1), ["Heart rate high. Ease off."])
    }

    func testANewStepStartsFresh() {
        var coach = RunTargetCoach()
        coach.startStep(at: 0)
        XCTAssertEqual(run(&coach, target: pace, value: 360, from: 1, to: 40).map(\.1), ["Speed up."])
        coach.startStep(at: 41)
        XCTAssertNil(coach.announced)
        // Still slow in the new step: said again once it has settled.
        let said = run(&coach, target: pace, value: 360, from: 42, to: 90, stepStart: 41)
        XCTAssertEqual(said.map(\.0), [81])
    }

    func testAGapInReadingsRestartsTheHold() {
        var coach = RunTargetCoach()
        coach.startStep(at: 0)
        XCTAssertTrue(run(&coach, target: heartRate, value: 160, from: 31, to: 35).isEmpty)
        for second in 36...99 {
            XCTAssertNil(coach.update(target: heartRate, value: nil, stepSeconds: Double(second),
                                      movingSeconds: Double(second)))
        }
        // The strap is back: the high reading must hold again.
        let said = run(&coach, target: heartRate, value: 160, from: 100, to: 115)
        XCTAssertEqual(said.map(\.0), [110])
    }

    func testPaceNeedsARecentRoutePoint() {
        let start = Date(timeIntervalSince1970: 1_793_000_000)
        var recorded = RecordedRun(startedAt: start)
        // About 30 m every 10 s.
        recorded.points = (0...3).map { step in
            RecordedRun.RoutePoint(timestamp: start.addingTimeInterval(Double(step) * 10),
                  latitude: 45.5190 + Double(step) * 0.00027, longitude: -122.6793,
                  altitude: nil, horizontalAccuracy: 5)
        }
        XCTAssertNotNil(RunPace.fresh(recorded, at: start.addingTimeInterval(35), unit: .kilometers))
        XCTAssertNil(RunPace.fresh(recorded, at: start.addingTimeInterval(41), unit: .kilometers),
                     "GPS stopped 11 s ago")
    }

    func testStepsAreSpokenInTheRunUnit() {
        let steps = RunPlan(items: [
            .step(.init(kind: .warmup, durationSeconds: 600, distanceMeters: nil, target: nil)),
            .repeated(times: 4, steps: [
                .init(kind: .work, durationSeconds: nil, distanceMeters: 800,
                      target: .pace(fastestSecondsPerKm: 245, slowestSecondsPerKm: 255)),
                .init(kind: .recovery, durationSeconds: 90, distanceMeters: nil, target: nil),
            ]),
            .step(.init(kind: .work, durationSeconds: nil, distanceMeters: 1_609.344,
                        target: .heartRate(minBPM: 150, maxBPM: 150))),
        ]).expandedSteps
        XCTAssertEqual(RunPlanFormat.spoken(steps[0], unit: .miles), "Warm up 10 minutes.")
        XCTAssertEqual(RunPlanFormat.spoken(steps[1], unit: .kilometers),
                       "Run 800 meters at 4 oh 5 to 4 15 a kilometer. Rep 1 of 4.")
        XCTAssertEqual(RunPlanFormat.spoken(steps[2], unit: .miles), "Recover 1 minute 30 seconds. Rep 1 of 4.")
        XCTAssertEqual(RunPlanFormat.spoken(steps[9], unit: .miles), "Run 1 mile at 150 beats per minute.")
        XCTAssertEqual(RunPlanFormat.spokenDistance(5_000, unit: .miles), "3.11 miles")
        XCTAssertEqual(RunPlanFormat.spokenDistance(5_000, unit: .kilometers), "5 kilometers")
    }

    /// The speech voice reads "7:00" as "seven o'clock", so paces are
    /// spoken the short way a runner says them.
    func testPaceTargetsAreSpokenTheShortWay() {
        // 7:00 per mile is 261 s/km.
        XCTAssertEqual(RunPlanFormat.spokenTarget(.pace(fastestSecondsPerKm: 261, slowestSecondsPerKm: 261),
                                                  unit: .miles),
                       "7 minutes a mile")
        // 6:34 to 6:50 per mile.
        XCTAssertEqual(RunPlanFormat.spokenTarget(.pace(fastestSecondsPerKm: 245, slowestSecondsPerKm: 255),
                                                  unit: .miles),
                       "6 34 to 6 50 a mile")
        XCTAssertEqual(RunPlanFormat.spokenTarget(.pace(fastestSecondsPerKm: 300, slowestSecondsPerKm: 300),
                                                  unit: .kilometers),
                       "5 minutes a kilometer")
        let step = RunPlan(items: [
            .step(.init(kind: .work, durationSeconds: 1_200, distanceMeters: nil,
                        target: .pace(fastestSecondsPerKm: 261, slowestSecondsPerKm: 261))),
        ]).expandedSteps[0]
        let spoken = RunPlanFormat.spoken(step, unit: .miles)
        XCTAssertEqual(spoken, "Run 20 minutes at 7 minutes a mile.")
        XCTAssertFalse(spoken.contains(":"))
    }

    /// The owner's 2026-11-17 strides: a 20-second work step without a target
    /// said only "Step 2 of 10. Rep 1 of 4. 20 seconds.", which never said
    /// what to do and took a good part of the stride. A short step now hears
    /// what to do and for how long, and nothing else.
    func testAShortStepGetsAShortCue() {
        let steps = RunPlan(items: [
            .step(.init(kind: .work, durationSeconds: 1_500, distanceMeters: nil,
                        target: .heartRate(minBPM: 135, maxBPM: 148))),
            .repeated(times: 4, steps: [
                .init(kind: .work, durationSeconds: 20, distanceMeters: nil,
                      target: .pace(fastestSecondsPerKm: 200, slowestSecondsPerKm: 210)),
                .init(kind: .recovery, durationSeconds: 60, distanceMeters: nil, target: nil),
            ]),
            .step(.init(kind: .work, durationSeconds: nil, distanceMeters: 200, target: nil)),
            .step(.init(kind: .cooldown, durationSeconds: 300, distanceMeters: nil, target: nil)),
        ]).expandedSteps
        XCTAssertEqual(RunPlanFormat.spoken(steps[0], unit: .miles),
                       "Run 25 minutes at 135 to 148 beats per minute.")
        XCTAssertEqual(RunPlanFormat.spoken(steps[1], unit: .miles), "Run 20 seconds.",
                       "No target or rep on a stride")
        XCTAssertEqual(RunPlanFormat.spoken(steps[2], unit: .miles), "Recover 1 minute. Rep 1 of 4.")
        XCTAssertEqual(RunPlanFormat.spoken(steps[9], unit: .miles), "Run 200 meters.")
        XCTAssertEqual(RunPlanFormat.spoken(steps[10], unit: .miles), "Cool down 5 minutes.")
    }

    func testTheCountdownBeepsOnATimedStepsLastThreeSeconds() {
        let stride = RunPlan.Step(kind: .work, durationSeconds: 20, distanceMeters: nil, target: nil)
        var countdown = RunStepCountdown()
        var beeps: [Int] = []
        for tenth in 0...210 {
            if let beep = countdown.beep(stepIndex: 1, step: stride, stepStartSeconds: 1_500,
                                         elapsed: Double(tenth) / 10) {
                beeps.append(beep)
            }
        }
        XCTAssertEqual(beeps, [3, 2, 1], "Once each, none at the start or after the end")

        // A late check beeps for the second it's in, never a burst of missed ones.
        var late = RunStepCountdown()
        XCTAssertNil(late.beep(stepIndex: 3, step: stride, stepStartSeconds: 1_580, elapsed: 10))
        XCTAssertEqual(late.beep(stepIndex: 3, step: stride, stepStartSeconds: 1_580, elapsed: 18.5), 2)
        XCTAssertNil(late.beep(stepIndex: 3, step: stride, stepStartSeconds: 1_580, elapsed: 18.9))
        XCTAssertEqual(late.beep(stepIndex: 3, step: stride, stepStartSeconds: 1_580, elapsed: 19.2), 1)
        // The next step counts down afresh.
        XCTAssertEqual(late.beep(stepIndex: 5, step: stride, stepStartSeconds: 1_660, elapsed: 17.5), 3)

        // Too short to beep without talking over its own announcement, and
        // a distance step, whose end GPS decides.
        let blip = RunPlan.Step(kind: .work, durationSeconds: 8, distanceMeters: nil, target: nil)
        XCTAssertNil(late.beep(stepIndex: 6, step: blip, stepStartSeconds: 1_700, elapsed: 6))
        let rep = RunPlan.Step(kind: .work, durationSeconds: nil, distanceMeters: 400, target: nil)
        XCTAssertNil(late.beep(stepIndex: 7, step: rep, stepStartSeconds: 1_710, elapsed: 80))

        // The ticker wakes just past each countdown second and the end.
        XCTAssertEqual(RunStepCountdown.wait(secondsLeft: 10), 1)
        XCTAssertEqual(RunStepCountdown.wait(secondsLeft: 3.5), 0.52, accuracy: 1e-9)
        XCTAssertEqual(RunStepCountdown.wait(secondsLeft: 2.98), 1, accuracy: 1e-9)
        XCTAssertEqual(RunStepCountdown.wait(secondsLeft: 0.4), 0.42, accuracy: 1e-9)
    }
}
