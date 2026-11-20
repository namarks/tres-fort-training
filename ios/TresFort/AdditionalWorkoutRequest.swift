import Foundation

/// Persist before sending: an ambiguous response must retry the same UUID.
struct AdditionalWorkoutRequest: Codable, Equatable {
    let id: String
    let date: String
    let workoutID: String?
    let firstExerciseID: String?
    /// Added to today's list for later instead of started now
    /// (app-design-pass P30). Absent in requests saved before it existed.
    var later: Bool? = nil
    var isFreestyle: Bool { workoutID == nil }
    var startsNow: Bool { later != true }
}

enum AdditionalWorkoutRequestStore {
    static func key(_ userID: String) -> String { "com.nmarkspdx.liftcoach.additional-workout.v1.\(userID)" }

    static func load(userID: String?, defaults: LocalPersistence) -> AdditionalWorkoutRequest? {
        guard let userID, let data = defaults.data(forKey: key(userID)) else { return nil }
        guard let request = try? JSONDecoder().decode(AdditionalWorkoutRequest.self, from: data) else {
            defaults.recordInvalidData(data, forKey: key(userID)); return nil
        }
        return request
    }

    static func save(_ request: AdditionalWorkoutRequest, userID: String?, defaults: LocalPersistence) -> Bool {
        guard let userID, !defaults.hasFailure(userID: userID),
              let data = try? JSONEncoder().encode(request) else { return false }
        return defaults.set(data, forKey: key(userID))
    }

    static func clear(_ request: AdditionalWorkoutRequest, userID: String?, defaults: LocalPersistence) -> Bool {
        guard let userID, !defaults.hasFailure(userID: userID) else { return false }
        let current = load(userID: userID, defaults: defaults)
        if current == nil { return !defaults.hasFailure(userID: userID) }
        guard current == request else { return false }
        return defaults.removeObject(forKey: key(userID))
    }
}

/// Not today's creation receipts (app-design-pass P30): the session id for
/// a weekday add-on set aside today, by "date|workout id", saved on the
/// iPhone before the create goes out. A retry after a lost reply, even
/// after a relaunch, reuses the id, so it never makes a second session.
enum NotTodayReceiptStore {
    static func key(_ userID: String) -> String { "com.nmarkspdx.liftcoach.not-today.v1.\(userID)" }

    static func load(userID: String?, defaults: LocalPersistence) -> [String: String] {
        guard let userID, let data = defaults.data(forKey: key(userID)) else { return [:] }
        guard let ids = try? JSONDecoder().decode([String: String].self, from: data) else {
            defaults.recordInvalidData(data, forKey: key(userID)); return [:]
        }
        return ids
    }

    static func save(_ ids: [String: String], userID: String?, defaults: LocalPersistence) -> Bool {
        guard let userID, !defaults.hasFailure(userID: userID) else { return false }
        if ids.isEmpty { return defaults.removeObject(forKey: key(userID)) }
        guard let data = try? JSONEncoder().encode(ids) else { return false }
        return defaults.set(data, forKey: key(userID))
    }
}
