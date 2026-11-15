import XCTest
@testable import TresFort

final class RoutineTimerPreviewTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Exercise: Decodable { let id: String; let name: String; let modality: String; let laterality: String? }
        struct Draft: Decodable {
            let sets: String; let reps: String; let seconds: String; let rest: String
            let circuit: Bool; let timeEveryExercise: Bool; let transitionRest: String; let roundRest: String
            var value: HomeRoutineDraft {
                HomeRoutineDraft(sets: sets, reps: reps, seconds: seconds, rest: rest, circuit: circuit,
                    timeEveryExercise: timeEveryExercise, transitionRest: transitionRest, roundRest: roundRest)
            }
        }
        struct Expected: Decodable {
            let workOrder: [String]; let rests: [Int]; let timedWorkSeconds: Int; let restSeconds: Int
            let untimedSets: Int; let summary: String; let firstTarget: String
        }
        let name: String; let exercises: [Exercise]; let draft: Draft; let expected: Expected?
    }

    func testSharedWebAndNativeTimerSequenceFixtures() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "RoutineTimerPreview", withExtension: "json"))
        let cases = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
        XCTAssertEqual(cases.count, 7)
        for fixture in cases {
            let exercises = fixture.exercises.map {
                ExerciseCatalog(id: $0.id, name: $0.name, primary_muscle: "core", modality: $0.modality, unit: "lb",
                    laterality: $0.laterality, load_mode: nil, demo_slug: nil, aliases: nil)
            }
            let preview = fixture.draft.value.timerPreview(for: exercises)
            guard let expected = fixture.expected else { XCTAssertNil(preview, fixture.name); continue }
            let actual = try XCTUnwrap(preview, fixture.name)
            XCTAssertEqual(actual.steps.filter { $0.kind == .work }.map(\.exerciseID), expected.workOrder, fixture.name)
            XCTAssertEqual(actual.steps.filter { $0.kind == .rest }.compactMap(\.seconds), expected.rests, fixture.name)
            XCTAssertEqual(actual.timedWorkSeconds, expected.timedWorkSeconds, fixture.name)
            XCTAssertEqual(actual.restSeconds, expected.restSeconds, fixture.name)
            XCTAssertEqual(actual.untimedSets, expected.untimedSets, fixture.name)
            XCTAssertEqual(actual.timeSummary, expected.summary, fixture.name)
            XCTAssertEqual(actual.steps.first?.target, expected.firstTarget, fixture.name)
            XCTAssertEqual(actual.steps.last?.kind, .work, fixture.name)
            XCTAssertTrue(actual.timeExplanation.contains("at your own pace") == (expected.untimedSets > 0), fixture.name)
        }
    }

    func testCircuitPreviewShowsActualRoundsAndManualStarts() throws {
        let exercises = ["Plank", "Hollow Hold"].map {
            ExerciseCatalog(id: $0, name: $0, primary_muscle: "core", modality: "timed", unit: "sec",
                laterality: nil, load_mode: nil, demo_slug: nil, aliases: nil)
        }
        let preview = try XCTUnwrap(HomeRoutineDraft(sets: "2", circuit: true).timerPreview(for: exercises))
        XCTAssertEqual(preview.steps.map(\.context), ["Round 1 of 2", "Round 1 of 2", "Round 1 of 2",
            "Round 1 of 2", "Round 2 of 2", "Round 2 of 2", "Round 2 of 2"])
        XCTAssertEqual(preview.steps[3].title, "Between rounds")
        XCTAssertTrue(preview.steps[0].instruction.contains("Tap Start"))
        XCTAssertTrue(preview.steps[1].instruction.contains("next set waits for you"))
    }
}
