import Foundation

/// Disposable read model. No persistence, account authority, or write state:
/// SyncModel invalidates it whenever its published source arrays change.
struct TrainingHistoryIndex {
    struct SessionStat: Identifiable {
        let id: String
        let date: String
        let session: SessionRow
        let chronologicalTime: Int
        let estimatedSetID: String?
        let est1RM: Double?
        let topWeight: Double
        let topReps: Int
        /// Unit of `est1RM` and `topWeight`: the top set's own logged unit.
        let loadUnit: WeightUnit
        let bestReps: Int?
        let totalReps: Int
        /// External-load volume per logged unit; lb and kg are never summed.
        let volumeByUnit: [WeightUnit: Double]
        let setCount: Int
        let bestHoldSeconds: Int?
        let hasTimedSets: Bool
        let avgDuration: Int
        let cohorts: [ExerciseMetricCohort]

        /// The single-unit volume; nil when absent or when units are mixed.
        var volume: Double? { volumeByUnit.count == 1 ? volumeByUnit.values.first : nil }
        var chronologicalKey: (String, Int, Int, String) { (date, chronologicalTime, session.slot ?? 0, id) }
    }

    let sessionsByDate: [String: SessionRow]
    private let sessionsByID: [String: SessionRow]
    private let firstWorkingLogBySession: [String: Int]
    let setsBySession: [String: [SetLog]]
    let workingSetsByExercise: [String: [SetLog]]
    let catalogByID: [String: ExerciseCatalog]
    let loggedExerciseIDs: [String]

    init(sessions: [SessionRow], sets: [SetLog], catalog: [ExerciseCatalog]) {
        func rank(_ status: String) -> Int {
            switch status {
            case "completed": return 4
            case "in_progress": return 3
            case "planned": return 2
            case "skipped": return 1
            default: return 0
            }
        }
        var byDate: [String: SessionRow] = [:]
        for session in sessions {
            guard (session.slot ?? 0) == 0 else { continue }
            if let current = byDate[session.date], rank(current.status) >= rank(session.status) { continue }
            byDate[session.date] = session
        }
        sessionsByDate = byDate
        sessionsByID = Dictionary(sessions.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let live = sets.filter { $0.deleted_at == nil }
        setsBySession = Dictionary(grouping: live, by: \.session_id)
        let working = live.filter { $0.is_warmup == 0 }
        firstWorkingLogBySession = working.reduce(into: [:]) { result, set in
            result[set.session_id] = min(result[set.session_id] ?? Int.max, set.logged_at)
        }
        workingSetsByExercise = Dictionary(grouping: working, by: \.exercise_id)
        var recent: [String: Int] = [:]
        for set in working where sessionsByID[set.session_id]?.status == "completed" {
            recent[set.exercise_id] = max(recent[set.exercise_id] ?? Int.min, set.logged_at)
        }
        loggedExerciseIDs = recent.keys.sorted {
            recent[$0] == recent[$1] ? $0 < $1 : recent[$0]! > recent[$1]!
        }
        catalogByID = Dictionary(catalog.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }

    func history(for exerciseID: String, latestOnly: Bool = false) -> [SessionStat] {
        let grouped = Dictionary(grouping: workingSetsByExercise[exerciseID] ?? [], by: \.session_id)
        func time(_ id: String) -> Int {
            let session = sessionsByID[id]!
            return session.started_at ?? session.completed_at ?? firstWorkingLogBySession[id] ?? 0
        }
        let sessionIDs = grouped.keys.filter { sessionsByID[$0]?.status == "completed" }
            .sorted {
                let lhs = sessionsByID[$0]!, rhs = sessionsByID[$1]!
                return (lhs.date, time($0), lhs.slot ?? 0, lhs.id) < (rhs.date, time($1), rhs.slot ?? 0, rhs.id)
            }
        let selected = latestOnly ? Array(sessionIDs.suffix(1)) : sessionIDs
        let exercise = catalogByID[exerciseID]
        let sides = exercise?.laterality == "unilateral" ? 2 : 1
        let implements = exercise?.load_mode == "per_hand" ? 2 : 1
        func timed(_ set: SetLog) -> Bool {
            set.is_timed.map { $0 == 1 } ?? (exercise?.modality == "timed")
        }
        // Estimates compare physically across units; the best keeps its own
        // number and unit (`loadUnit`).
        func estimateInPounds(_ cohort: ExerciseMetricCohort) -> Double {
            cohort.estimatedOneRepMax.map { cohort.weightUnit.convert($0, to: .lb) } ?? 0
        }
        return selected.compactMap { sid in
            guard let groupedRows = grouped[sid], let session = sessionsByID[sid], !groupedRows.isEmpty else { return nil }
            let rows = groupedRows.sorted { ($0.logged_at, $0.set_index, $0.id) < ($1.logged_at, $1.set_index, $1.id) }
            let timedRows = rows.filter(timed)
            let repRows = rows.filter { !timed($0) }
            let cohorts = ExerciseMetrics.cohorts(rows, catalog: exercise.map { [$0] } ?? [])
            let repCohorts = cohorts.filter { !$0.key.timed }
            let holdCohorts = cohorts.filter { $0.key.timed }
            let best = cohorts.max {
                (estimateInPounds($0), $0.top.logged_at, $0.top.id) < (estimateInPounds($1), $1.top.logged_at, $1.top.id)
            }
            let top = best?.top ?? rows[0]
            let durations = timedRows.map { $0.duration_s ?? $0.reps }
            var volumeByUnit: [WeightUnit: Double] = [:]
            for row in repRows where row.weight > 0 {
                volumeByUnit[row.weightUnit, default: 0] +=
                    row.weight * Double(row.reps * sides) * Double(implements)
            }
            return SessionStat(id: sid, date: session.date, session: session, chronologicalTime: time(sid),
                estimatedSetID: best?.estimatedOneRepMax == nil ? nil : best?.top.id,
                est1RM: best?.estimatedOneRepMax,
                topWeight: top.weight, topReps: top.reps, loadUnit: top.weightUnit,
                bestReps: exercise?.modality == "bw" && repCohorts.count == 1 ? repCohorts[0].bestReps : nil,
                totalReps: repRows.reduce(0) { $0 + $1.reps * sides },
                volumeByUnit: volumeByUnit, setCount: rows.count,
                bestHoldSeconds: holdCohorts.count == 1 ? holdCohorts[0].bestHoldSeconds : nil,
                hasTimedSets: !timedRows.isEmpty,
                avgDuration: holdCohorts.count == 1 && !durations.isEmpty ? durations.reduce(0, +) / durations.count : 0,
                cohorts: cohorts)
        }
    }
}
