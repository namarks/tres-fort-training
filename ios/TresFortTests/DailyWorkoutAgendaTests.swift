import XCTest
@testable import TresFort

final class DailyWorkoutAgendaTests: XCTestCase {
    private func workout(_ id: String, activity: Bool = false) -> Workout {
        Workout(id: id, name: id.capitalized, day_label: nil, order_index: 0,
                exercises: activity ? [] : [TemplateExercise(
                    id: "\(id)-slot", exercise_id: id, exercise_name: id.capitalized,
                    exercise_unit: "lb", order_index: 0, target_sets: 1, target_reps: 1,
                    target_reps_max: nil, target_rpe: nil, rest_seconds: 20, target_weight: nil,
                    cues: nil, exercise_modality: "timed", exercise_laterality: nil,
                    exercise_load_mode: nil, exercise_demo_slug: nil, target_duration_s: 30, is_warmup: 0)])
    }

    private func session(_ id: String, workout: String?, slot: Int, status: String) -> SessionRow {
        SessionRow(slot: slot, id: id, date: "2026-09-08", status: status, workout_id: workout)
    }

    func testRunAndRunnableCoreShareATimeOrderedAgenda() {
        let run = workout("run"), core = workout("core"), walk = workout("walk", activity: true)
        let rows = DailyWorkoutAgenda.items(primary: run, extras: [walk, core], sessions: [],
            workouts: [run, core, walk], times: ["run": 420, "core": 1080, "walk": 1200], loggedActivityIDs: [])
        XCTAssertEqual(rows.map(\.title), ["Run", "Core", "Walk"])
        XCTAssertEqual(rows.map(\.minutes), [420, 1080, 1200])
        XCTAssertEqual(rows.map(\.status), ["planned", "planned", "planned"])
        XCTAssertEqual(rows.map(\.isActivity), [false, false, true])
        XCTAssertTrue(DailyWorkoutAgenda.showsCombinedAgenda(rows))
    }

    func testCompletedRunDoesNotCompleteCoreOrMoveItOutOfOrder() {
        let run = workout("run"), core = workout("core")
        let rows = DailyWorkoutAgenda.items(primary: run, extras: [core],
            sessions: [session("run-session", workout: "run", slot: 0, status: "completed")],
            workouts: [run, core], times: ["run": 420, "core": 1080], loggedActivityIDs: [])
        XCTAssertEqual(rows.map(\.title), ["Run", "Core"])
        XCTAssertEqual(rows.map(\.isDone), [true, false])
        XCTAssertEqual(rows[1].source, .additional)
        XCTAssertNil(rows[1].session)
    }

    func testRealCoreSessionReplacesItsScheduledEntryAndKeepsOwnStatus() {
        let run = workout("run"), core = workout("core")
        let rows = DailyWorkoutAgenda.items(primary: run, extras: [core], sessions: [
            session("run-session", workout: "run", slot: 0, status: "completed"),
            session("core-session", workout: "core", slot: 1, status: "in_progress")],
            workouts: [run, core], times: ["run": 420, "core": 1080], loggedActivityIDs: [])
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows.map(\.status), ["completed", "in_progress"])
        XCTAssertEqual(rows[1].session?.slot, 1)
        XCTAssertEqual(rows[1].minutes, 1080)
        XCTAssertEqual(rows[1].source, .session)
    }

    func testTwoRealSessionsUsingSameWorkoutKeepDistinctIdentityAndOneScheduledTime() {
        let core = workout("core")
        let rows = DailyWorkoutAgenda.items(primary: core, extras: [core], sessions: [
            session("first", workout: "core", slot: 0, status: "completed"),
            session("second", workout: "core", slot: 3, status: "planned")],
            workouts: [core], times: ["core": 1080], loggedActivityIDs: [])
        XCTAssertEqual(rows.map(\.id), ["session:first", "session:second"])
        XCTAssertEqual(rows.map(\.minutes), [1080, nil])
        XCTAssertEqual(rows.map(\.isDone), [true, false])
    }

    func testDiscardedExtraReturnsToScheduledWithoutReusingTheDiscardedSession() {
        let run = workout("run"), core = workout("core")
        let rows = DailyWorkoutAgenda.items(primary: run, extras: [core],
            sessions: [session("discarded", workout: "core", slot: 1, status: "discarded")],
            workouts: [run, core], times: [:], loggedActivityIDs: [])
        XCTAssertEqual(rows.map(\.id), ["primary", "scheduled:core"])
        XCTAssertNil(rows[1].session)
    }

    func testLoggedActivityDoesNotCompleteRunnableWorkoutWithSimilarName() {
        let core = workout("core"), walk = workout("walk", activity: true)
        let rows = DailyWorkoutAgenda.items(primary: core, extras: [walk], sessions: [],
            workouts: [core, walk], times: [:], loggedActivityIDs: ["core", "walk"])
        XCTAssertEqual(rows.map(\.status), ["planned", "logged"])
    }

    func testActivePrimaryWithoutFirstSetHasInProgressStatus() {
        let run = workout("run"), core = workout("core")
        let rows = DailyWorkoutAgenda.items(primary: run, extras: [core], sessions: [],
            workouts: [run, core], times: [:], loggedActivityIDs: [],
            activeScope: .init(date: "2026-09-08", slot: 0))
        XCTAssertEqual(rows.map(\.status), ["in_progress", "planned"])
    }

    func testAdditionalSessionOnRestDayRetainsRouteBackToMainAndUntimedOrder() {
        let core = workout("core")
        let rows = DailyWorkoutAgenda.items(primary: nil, extras: [],
            sessions: [session("extra", workout: "core", slot: 2, status: "completed")],
            workouts: [core], times: [:], loggedActivityIDs: [])
        XCTAssertEqual(rows.map(\.id), ["primary", "session:extra"])
        XCTAssertEqual(rows.map(\.status), ["rest", "completed"])
        XCTAssertEqual(rows.first?.source, .primary)
    }

    @MainActor
    func testArchivingCompletedCoreKeepsItsAgendaIdentity() {
        let suite = "DailyWorkoutAgendaTests.\(UUID().uuidString)"
        let defaults = LocalPersistence(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let auth = AuthModel(tokenStore: AgendaTokenStore(), defaults: defaults)
        let sync = SyncModel(auth: auth, defaults: defaults,
                             now: { CalendarProjection.date(from: "2026-09-08")! })
        var core = workout("core")
        core.archived_at = 1
        sync.plan = PlanTree(id: "plan", name: "Week", version: 2, workouts: [core], meta: nil)
        sync.sessions = [session("core-session", workout: "core", slot: 1, status: "completed")]
        let row = sync.dailyWorkoutAgenda.first { $0.session?.id == "core-session" }
        XCTAssertEqual(row?.title, "Core")
        XCTAssertEqual(row?.workout?.id, "core")
        XCTAssertEqual(row?.status, "completed")
    }
}

private final class AgendaTokenStore: AppTokenStore {
    func save(_ token: String) {}
    func load() -> String? { nil }
    func clear() {}
}
