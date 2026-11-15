import Foundation

/// Navigation to a reviewed record, never a request to start or change it.
/// The account and attempt travel with the identity so opening an old browser
/// link cannot select another member's record or a restarted workout.
struct WorkoutRecordLink: Codable, Equatable {
    let accountID: String
    let sessionID: String
    let attempt: Int
    let setID: String?

    init?(url: URL) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "tresfort", parts.host == "workout-record",
              parts.port == nil, parts.user == nil, parts.password == nil,
              parts.percentEncodedPath.isEmpty, parts.fragment == nil,
              let items = parts.queryItems, (3...4).contains(items.count),
              Set(items.map(\.name)).count == items.count,
              items.allSatisfy({ ["account", "session", "attempt", "set"].contains($0.name) }) else { return nil }
        let values = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        guard let account = values["account"], Self.validID(account),
              let session = values["session"], Self.validID(session),
              let rawAttempt = values["attempt"], !rawAttempt.isEmpty,
              rawAttempt.utf8.allSatisfy({ (48...57).contains($0) }),
              let attempt = Int(rawAttempt), attempt <= 9_007_199_254_740_991,
              values["set"].map(Self.validID) ?? true else { return nil }
        self.accountID = account
        self.sessionID = session
        self.attempt = attempt
        self.setID = values["set"]
    }

    private static func validID(_ value: String) -> Bool {
        (1...128).contains(value.utf8.count) && value.utf8.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
                || $0 == 45 || $0 == 95
        }
    }
}
