import Foundation

/// A complete reviewed workout. The client keeps every identity and field
/// unchanged when retrying an uncertain response, so creation is idempotent.
struct WorkoutPrescriptionRequest: Codable, Equatable {
    let workout_id: String
    let name: String
    let expected_plan_id: String?
    let expected_version: Int
    var slots: [PartnerSlot]
}

struct WorkoutPrescriptionReceipt: Codable, Equatable {
    let workout_id: String
    let plan_id: String
    let version: Int
}

enum WorkoutPrescriptionOutcome: Equatable {
    case saved(WorkoutPrescriptionReceipt)
    /// This attempt did not save; refresh the draft's reviewed authority.
    case reviewDraft
    /// The identity may already have saved a different or subsequently edited workout.
    case needsReview
    case retrySameRequest
}
