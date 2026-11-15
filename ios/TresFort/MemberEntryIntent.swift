import Foundation
import Combine

/// Navigation only: never stores an Apple credential or a coach connect code.
/// Unbound links belong to the next successful sign-in. Once bound, an intent
/// cannot follow the member across an account change.
struct MemberEntryIntent: Codable, Equatable, Identifiable {
    enum Destination: Codable, Equatable {
        case invite(String)
        case coach
        case coachApproval(String)
        case ipadDisplay
        case workouts
        case workout(String)
        case workoutRecord(WorkoutRecordLink)
        /// First-run setup inside the app: your usual week, then your apps.
        case setup

        var requiresPersonalAccount: Bool {
            switch self {
            case .workouts, .workout, .workoutRecord, .setup: return false
            case .invite, .coach, .coachApproval, .ipadDisplay: return true
            }
        }
    }
    let id: UUID
    let destination: Destination
    var accountID: String?
}

/// Every onboarding callback carries the feature session it started in, so a
/// tap from before a sign-out or reauthentication cannot finish a later one.
@MainActor
final class OnboardingFlow: ObservableObject {
    struct Checkpoint: Equatable {
        let accountID: String?
        let epoch: UInt64
    }
    private let accountID: String?
    private let epoch: UInt64
    private unowned let auth: AuthModel

    init(auth: AuthModel) {
        self.auth = auth
        accountID = auth.userID
        epoch = auth.featureSessionEpoch
    }

    var checkpoint: Checkpoint { Checkpoint(accountID: accountID, epoch: epoch) }

    func isCurrent(_ checkpoint: Checkpoint) -> Bool {
        checkpoint == self.checkpoint && auth.isCurrentFeatureSession(accountID: accountID, epoch: epoch)
            && !auth.onboardingComplete
    }

    /// Get started: the welcome is done and setup continues in the app, where
    /// the week and the connections write through the Plan tab's and
    /// Profile's own models. An invite or coach link saved earlier keeps its
    /// place ahead of setup. Nothing finishes until that navigation is saved.
    @discardableResult
    func start(from checkpoint: Checkpoint) -> Bool {
        guard isCurrent(checkpoint), auth.requestEntry(.setup) else { return false }
        auth.completeOnboarding()
        return auth.onboardingComplete
    }
}
