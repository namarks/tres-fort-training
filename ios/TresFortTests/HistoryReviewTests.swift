import XCTest
@testable import TresFort

final class HistoryReviewTests: XCTestCase {
    private var exercise: ExerciseCatalog {
        ExerciseCatalog(id: "bench", name: "Bench Press", primary_muscle: "chest",
            modality: "barbell", unit: "kg", laterality: nil, load_mode: nil,
            demo_slug: nil, aliases: "[\"chest press\"]")
    }

    private func session(_ id: String, date: String = "2026-11-14", slot: Int = 0,
                         start: Int? = nil, status: String = "completed", attempt: Int = 0) -> SessionRow {
        SessionRow(slot: slot, started_at: start, id: id, date: date, status: status,
                   workout_id: nil, attempt: attempt)
    }

    private func set(_ id: String, session: String, weight: Double = 100, reps: Int = 5,
                     time: Int = 1, unit: String? = nil, warmup: Bool = false,
                     deleted: Bool = false) -> SetLog {
        SetLog(id: id, session_id: session, exercise_id: "bench", template_exercise_id: nil,
            set_index: 1, weight: weight, reps: reps, rpe: nil, is_warmup: warmup ? 1 : 0,
            logged_at: time, duration_s: nil, is_timed: 0, deleted_at: deleted ? 999 : nil,
            weight_unit: unit)
    }

    private func index(_ sessions: [SessionRow], _ sets: [SetLog]) -> TrainingHistoryIndex {
        TrainingHistoryIndex(sessions: sessions, sets: sets, catalog: [exercise])
    }

    func testSameDayOrderUsesChronologyInsteadOfInputOrderOrUUID() {
        let sessions = [session("a-later", slot: 1, start: 200), session("z-earlier", start: 100)]
        let sets = [set("later", session: "a-later", time: 20), set("earlier", session: "z-earlier", time: 30)]
        for input in [sessions, Array(sessions.reversed())] {
            let model = index(input, sets)
            XCTAssertEqual(model.history(for: "bench").map(\.id), ["z-earlier", "a-later"])
            XCTAssertEqual(model.history(for: "bench", latestOnly: true).first?.id, "a-later")
        }
    }

    func testMissingTimestampFallsBackToOriginalLogThenSlotAndUUID() {
        let sessions = [session("z", slot: 1), session("a", slot: 1), session("primary"), session("early")]
        let sets = [set("z", session: "z", time: 100), set("a", session: "a", time: 100),
                    set("primary", session: "primary", time: 100), set("early", session: "early", time: 90)]
        XCTAssertEqual(index(sessions, sets).history(for: "bench").map(\.id), ["early", "primary", "a", "z"])
    }

    func testLegacyChronologyUsesWholeWorkoutInsteadOfSelectedExercise() {
        let sessions = [session("early-workout"), session("later-workout", slot: 1)]
        let firstMovement = SetLog(id: "curl-first", session_id: "early-workout", exercise_id: "curl",
            template_exercise_id: nil, set_index: 1, weight: 20, reps: 8, rpe: nil,
            is_warmup: 0, logged_at: 100, duration_s: nil, is_timed: 0, deleted_at: nil)
        let sets = [firstMovement, set("bench-late-in-early-workout", session: "early-workout", time: 400),
                    set("bench-in-later-workout", session: "later-workout", time: 200)]
        let history = index(sessions, sets).history(for: "bench")
        XCTAssertEqual(history.map(\.id), ["early-workout", "later-workout"])
        XCTAssertEqual(history.first?.chronologicalTime, 100)
        XCTAssertEqual(ExerciseHistoryProgress.options(history).first?.points.first?.setID, "bench-in-later-workout")
    }

    func testOnlyCompletedLiveWorkingSetsContributeButRunnerIndexRetainsActiveSets() throws {
        let sessions = [session("done"), session("running", status: "in_progress")]
        let sets = [set("work", session: "done"), set("warmup", session: "done", weight: 900, warmup: true),
                    set("deleted", session: "done", weight: 900, deleted: true),
                    set("active", session: "running", weight: 900)]
        let model = index(sessions, sets)
        XCTAssertEqual(model.history(for: "bench").map(\.id), ["done"])
        XCTAssertEqual(model.history(for: "bench").first?.setCount, 1)
        XCTAssertEqual(model.history(for: "bench").first?.estimatedSetID, "work")
        XCTAssertEqual(model.setsBySession["running"]?.map(\.id), ["active"])
        XCTAssertTrue(index([sessions[1]], [sets[3]]).loggedExerciseIDs.isEmpty)
    }

    func testDailyBestKeepsExactSourceAndAttemptAndUpdatesAfterCorrectionOrDeletion() throws {
        let sessions = [session("morning", start: 100, attempt: 2), session("evening", slot: 1, start: 200, attempt: 4)]
        let morning = set("morning-set", session: "morning", reps: 5)
        let evening = set("evening-set", session: "evening", reps: 10)
        func point(_ sets: [SetLog]) throws -> ExerciseHistoryProgress.Point {
            try XCTUnwrap(ExerciseHistoryProgress.options(index(sessions, sets).history(for: "bench"))
                .first { $0.id == .estimatedOneRepMax }?.points.first)
        }
        let original = try point([evening, morning])
        XCTAssertEqual(original.sessionID, "evening")
        XCTAssertEqual(original.setID, "evening-set")
        XCTAssertEqual(original.sessionAttempt, 4)
        XCTAssertEqual(original.value, 133.3)
        let corrected = try point([morning, set("evening-set", session: "evening", reps: 1)])
        XCTAssertEqual(corrected.setID, "morning-set")
        XCTAssertEqual(corrected.sessionAttempt, 2)
        XCTAssertEqual(try point([morning, set("evening-set", session: "evening", deleted: true)]).setID, "morning-set")
    }

    func testEqualDailyBestsChooseStableLaterSessionRegardlessOfInputOrder() throws {
        let sessions = [session("z-morning", start: 100), session("a-evening", slot: 1, start: 200)]
        let rows = [set("first", session: "z-morning"), set("second", session: "a-evening")]
        for sets in [rows, Array(rows.reversed())] {
            let options = ExerciseHistoryProgress.options(index(sessions, sets).history(for: "bench"))
            XCTAssertTrue(options.allSatisfy { $0.points.count == 1 })
            XCTAssertTrue(options.allSatisfy { $0.points.first?.setID == "second" })
        }
    }

    func testLatestSameDaySessionOwnsEstimateUnitAndBestPointRetainsOriginalSet() throws {
        let sessions = [session("a-evening", slot: 1, start: 200), session("z-morning", start: 100)]
        let rows = [set("kg", session: "a-evening", weight: 100, unit: "kg"),
                    set("lb", session: "z-morning", weight: 300)]
        let estimate = try XCTUnwrap(ExerciseHistoryProgress.options(index(sessions, rows).history(for: "bench")).first)
        XCTAssertEqual(estimate.unit, "kg")
        XCTAssertEqual(estimate.points.first?.setID, "lb")
        XCTAssertEqual(try XCTUnwrap(estimate.points.first?.value), 158.8, accuracy: 0.1)
        // The legacy log remains pounds even though the catalog unit is kg.
        XCTAssertEqual(index(sessions, rows).history(for: "bench").first?.loadUnit, .lb)
    }

    func testSearchFindsOldAliasAndOnlyGroupsLoggedPlanExercises() {
        let older = ExerciseCatalog(id: "old", name: "Cable Row", primary_muscle: "back",
            modality: "machine", unit: "lb", laterality: nil, load_mode: nil, demo_slug: nil,
            aliases: "[\"seated pull\"]")
        let catalog = [exercise, older]
        let all = ExerciseHistoryDiscovery.sections(historyIDs: ["old", "bench"],
            plannedIDs: ["bench", "bench", "unlogged"], catalog: catalog, query: "")
        XCTAssertEqual(all.current, ["bench"])
        XCTAssertEqual(all.other, ["old"])
        let found = ExerciseHistoryDiscovery.sections(historyIDs: ["bench", "old"],
            plannedIDs: ["bench"], catalog: catalog, query: "SEATED pull")
        XCTAssertTrue(found.current.isEmpty)
        XCTAssertEqual(found.other, ["old"])
    }

    func testRecordTargetRejectsSiblingRestartDateChangeAndNoncompletedRecord() {
        let original = session("exact", slot: 1, attempt: 3)
        let target = WorkoutRecordTarget(original)
        XCTAssertTrue(target.matches(original))
        XCTAssertFalse(target.matches(session("sibling", slot: 1, attempt: 3)))
        XCTAssertFalse(target.matches(session("exact", slot: 0, attempt: 3)))
        XCTAssertFalse(target.matches(session("exact", slot: 1, attempt: 4)))
        XCTAssertFalse(target.matches(session("exact", date: "2026-11-13", slot: 1, attempt: 3)))
        XCTAssertFalse(target.matches(session("exact", slot: 1, status: "in_progress", attempt: 3)))
    }
}
