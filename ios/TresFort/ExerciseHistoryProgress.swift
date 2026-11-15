import Foundation

/// Options for one progress panel. Load/mode comparisons stay separate even
/// though the screen only presents the selected series.
struct ExerciseHistoryProgress: Identifiable {
    enum ID: Hashable {
        case estimatedOneRepMax
        case condition(ExerciseMetricCohort.Key)
    }

    struct Point: Identifiable {
        var id: String { date }
        let date: String
        let value: Double
        let sessionID: String
        let sessionAttempt: Int
        let setID: String
        let chronologicalTime: Int
        let sessionSlot: Int
    }

    let id: ID
    let title: String
    let unit: String
    let points: [Point]
    var hasTrend: Bool { points.count > 1 }
    var explanation: String {
        if id == .estimatedOneRepMax {
            return "An estimate, not a tested maximum: load × (1 + reps ÷ 30). Each day shows its best working-set estimate, with loads converted to \(unit). Warm-ups, bodyweight and timed sets are excluded."
        }
        return "Each day shows the best working set at this load and execution mode. Warm-ups are excluded; different loads, units and timed sets stay separate."
    }

    static func options(_ history: [TrainingHistoryIndex.SessionStat]) -> [Self] {
        // A civil day has one best value, including when multiple sessions
        // were logged that day. One day is a summary, never a trend.
        func dailyBest(_ points: [Point]) -> [Point] {
            Dictionary(grouping: points, by: \.date).compactMap { _, values in
                values.max {
                    ($0.value, $0.chronologicalTime, $0.sessionSlot, $0.sessionID, $0.setID)
                        < ($1.value, $1.chronologicalTime, $1.sessionSlot, $1.sessionID, $1.setID)
                }
            }.sorted { $0.date < $1.date }
        }

        func point(_ session: TrainingHistoryIndex.SessionStat, value: Double, setID: String) -> Point {
            Point(date: session.date, value: value, sessionID: session.id,
                  sessionAttempt: session.session.attempt ?? 0, setID: setID,
                  chronologicalTime: session.chronologicalTime, sessionSlot: session.session.slot ?? 0)
        }

        let grouped = Dictionary(grouping: history.flatMap { session in
            session.cohorts.map { (session: session, cohort: $0) }
        }, by: { $0.cohort.key })
        var options = grouped.values.compactMap { rows -> Self? in
            guard let cohort = rows.first?.cohort else { return nil }
            let metric = cohort.key.timed ? "Best hold" : "Best reps"
            let side = cohort.key.laterality == "unilateral" ? " per side" : ""
            return Self(id: .condition(cohort.key),
                title: "\(cohort.conditionLabel) · \(metric)\(side)",
                unit: cohort.key.timed ? "s" : "reps",
                points: dailyBest(rows.map {
                    point($0.session, value: Double($0.cohort.bestHoldSeconds ?? $0.cohort.bestReps ?? 0),
                          setID: $0.cohort.top.id)
                }))
        }.sorted { lhs, rhs in
            // Most recently used conditions come first; label breaks ties
            // deterministically without depending on dictionary iteration.
            let a = lhs.points.last?.date ?? "", b = rhs.points.last?.date ?? ""
            return a == b ? lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending : a > b
        }

        // An estimate is a physical quantity, so a history that switched
        // units is still one trend: every estimate is shown in the unit of
        // the latest one. Estimates already in that unit keep their value.
        let estimated = history.filter { $0.est1RM != nil }
        if let latest = estimated.max(by: { $0.chronologicalKey < $1.chronologicalKey }) {
            let unit = latest.loadUnit
            let estimates = estimated.compactMap { session -> Point? in
                guard let value = session.est1RM, let setID = session.estimatedSetID else { return nil }
                if session.loadUnit == unit { return point(session, value: value, setID: setID) }
                let converted: Double = session.loadUnit.convert(value, to: unit)
                return point(session, value: (converted * 10).rounded() / 10, setID: setID)
            }
            let perHand = latest.cohorts.contains { $0.key.loadMode == "per_hand" }
            options.insert(Self(id: .estimatedOneRepMax, title: perHand ? "Estimated 1RM · each hand" : "Estimated 1RM",
                unit: unit.rawValue + (perHand ? " each hand" : ""), points: dailyBest(estimates)), at: 0)
        }
        return options
    }

    static func selected(_ id: ID?, from options: [Self]) -> Self? {
        options.first { $0.id == id } ?? options.first
    }
}
