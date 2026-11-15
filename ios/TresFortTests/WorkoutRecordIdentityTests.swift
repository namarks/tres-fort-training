import XCTest
@testable import TresFort

final class WorkoutRecordIdentityTests: XCTestCase {
    private func set(weight: Double, unit: String? = nil, reps: Int = 5, duration: Int? = nil) -> SetLog {
        SetLog(id: "source", session_id: "workout", exercise_id: "exercise", template_exercise_id: nil,
            set_index: 2, weight: weight, reps: reps, rpe: nil, is_warmup: 0, logged_at: 1,
            duration_s: duration, is_timed: duration == nil ? 0 : 1, deleted_at: nil, weight_unit: unit)
    }

    func testOriginalLoadUnitStaysExplicitWhenChartConvertsItsEstimate() {
        XCTAssertEqual(WorkoutRecordIdentity.sourceSetLabel(set(weight: 300), timed: false,
            bodyweight: false, unilateral: false, perHand: false), "Set 2 · 300 lb × 5")
        XCTAssertEqual(WorkoutRecordIdentity.sourceSetLabel(set(weight: 100, unit: "kg"), timed: false,
            bodyweight: false, unilateral: false, perHand: false), "Set 2 · 100 kg × 5")
    }

    func testPerHandAndPerSideDescribeOriginalSetWithoutDoublingLoadOrReps() {
        XCTAssertEqual(WorkoutRecordIdentity.sourceSetLabel(set(weight: 25, unit: "kg", reps: 8), timed: false,
            bodyweight: false, unilateral: true, perHand: true), "Set 2 · 25 kg × 8 per side · load each hand")
    }

    func testBodyweightAssistanceAndTimedSourcesKeepTheirMeaning() {
        XCTAssertEqual(WorkoutRecordIdentity.sourceSetLabel(set(weight: 0, reps: 8), timed: false,
            bodyweight: true, unilateral: false, perHand: false), "Set 2 · BW × 8")
        XCTAssertEqual(WorkoutRecordIdentity.sourceSetLabel(set(weight: -30, reps: 8), timed: false,
            bodyweight: true, unilateral: false, perHand: false), "Set 2 · BW−30 lb × 8")
        XCTAssertEqual(WorkoutRecordIdentity.sourceSetLabel(set(weight: 10, unit: "kg", duration: 45), timed: true,
            bodyweight: false, unilateral: true, perHand: false), "Set 2 · 45s · +10 kg")
    }
}
