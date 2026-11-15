import Foundation

/// A workout's stable position on a civil date. Session aliases may change an
/// id; neither an alias nor a new attempt may cross this boundary.
struct WorkoutSessionScope: Codable, Hashable {
    let date: String
    let slot: Int
    var key: String { slot == 0 ? date : "\(date)#\(slot)" }
}

extension SessionRow {
    var workoutScope: WorkoutSessionScope { .init(date: date, slot: slot ?? 0) }
}
extension PendingSetIntent {
    var workoutScope: WorkoutSessionScope { .init(date: date, slot: sessionSlot ?? 0) }
}
extension WorkoutTerminalIntent {
    var workoutScope: WorkoutSessionScope { .init(date: date, slot: sessionSlot ?? 0) }
}
extension WorkoutRunnerCheckpoint {
    var workoutScope: WorkoutSessionScope { .init(date: date, slot: sessionSlot ?? 0) }
}
extension PendingSetCorrection {
    var workoutScope: WorkoutSessionScope { .init(date: date, slot: sessionSlot ?? 0) }
}
