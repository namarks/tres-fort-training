#if DEBUG && targetEnvironment(simulator)
import Foundation

enum HistoryReviewFixtureData {
    static let catalog: [[String: Any]] = [
        ["id": "history-squat", "name": "Barbell Squat", "primary_muscle": "legs", "modality": "barbell", "unit": "lb", "aliases": "[\"back squat\"]"],
        ["id": "history-press", "name": "Overhead Press", "primary_muscle": "shoulders", "modality": "barbell", "unit": "lb", "aliases": "[\"OHP\",\"military press\"]"]
    ]
    static let base = Int(CalendarProjection.date(from: "2026-09-07")!.timeIntervalSince1970 * 1_000)
    static let plan: [String: Any] = ["id": "history-plan", "name": "Strength plan", "version": 1,
        "days": [workout("history-morning", name: "Morning strength", order: 0),
                 workout("history-evening", name: "Evening strength", order: 1)]]
    private static func workout(_ id: String, name: String, order: Int) -> [String: Any] {
        ["id": id, "name": name, "order_index": order, "exercises": [[
            "id": id + "-slot", "exercise_id": "history-squat", "exercise_name": "Barbell Squat",
            "exercise_unit": "lb", "exercise_modality": "barbell", "order_index": 0,
            "target_sets": 1, "target_reps": 5, "rest_seconds": 60, "target_weight": 100]]]
    }
    static let sessions: [[String: Any]] = [
        ["id": "history-old", "date": "2026-09-01", "slot": 0, "status": "completed", "attempt": 1, "updated_at": base - 1_000],
        ["id": "history-am", "date": "2026-09-07", "slot": 0, "status": "completed", "attempt": 1,
         "workout_id": "history-morning", "started_at": base + 8 * 3_600_000, "completed_at": base + 9 * 3_600_000, "updated_at": base],
        ["id": "history-pm", "date": "2026-09-07", "slot": 1, "status": "completed", "attempt": 2,
         "workout_id": "history-evening", "started_at": base + 18 * 3_600_000, "completed_at": base + 19 * 3_600_000, "updated_at": base]
    ]
    static let sets: [[String: Any]] = [
        set("history-old-squat", session: "history-old", exercise: "history-squat", weight: 90, time: base - 1_000),
        set("history-old-press", session: "history-old", exercise: "history-press", weight: 65, time: base - 1_000),
        set("history-am-set", session: "history-am", exercise: "history-squat", weight: 95, time: base + 8 * 3_600_000),
        set("history-pm-set", session: "history-pm", exercise: "history-squat", weight: 100, time: base + 18 * 3_600_000)
    ]
    private static func set(_ id: String, session: String, exercise: String, weight: Int, time: Int) -> [String: Any] {
        ["id": id, "session_id": session, "exercise_id": exercise, "set_index": 1, "weight": weight,
         "weight_unit": "lb", "reps": 5, "is_warmup": 0, "is_timed": 0, "logged_at": time, "updated_at": time]
    }
    static var state: StateResponse {
        let data = try! JSONSerialization.data(withJSONObject: ["plan": plan, "plan_version": 1,
            "sessions": sessions, "sets": sets, "server_time": base + 86_400_000,
            "external_events": [], "external_activities": [], "activities": []])
        return try! JSONDecoder().decode(StateResponse.self, from: data)
    }
}
#endif
