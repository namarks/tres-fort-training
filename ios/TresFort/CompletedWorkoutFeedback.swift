import Foundation
import Combine

/// Captured when the completed record is opened; never follows the runner or
/// another session on the same date. The baseline includes legacy fatigue 0.
struct CompletedWorkoutFeedbackTarget: Identifiable, Equatable {
    let sessionID: String
    let date: String
    let slot: Int
    let attempt: Int
    let accountID: String
    let featureSessionEpoch: UInt64
    var baseline: WorkoutFeedbackBaseline
    var id: String { sessionID }

    func matches(_ session: SessionRow) -> Bool {
        session.id == sessionID && session.date == date && (session.slot ?? 0) == slot
            && (session.attempt ?? 0) == attempt && session.status == "completed"
    }

    func accepts(_ response: SessionRow, replacing current: SessionRow) -> Bool {
        guard matches(response), matches(current) else { return false }
        let incoming = response.updated_at ?? 0, existing = current.updated_at ?? 0
        if incoming != existing { return incoming > existing }
        let currentFeedback = WorkoutFeedbackBaseline(notes: current.notes, perceivedFatigue: current.perceived_fatigue)
        let returnedFeedback = WorkoutFeedbackBaseline(notes: response.notes, perceivedFatigue: response.perceived_fatigue)
        // Equal-millisecond writes must not replace a different newer ACK.
        return currentFeedback == baseline || currentFeedback == returnedFeedback
    }
}

struct CompletedWorkoutFeedbackRequest: Equatable {
    let target: CompletedWorkoutFeedbackTarget
    let notes: String?
    let perceivedFatigue: Int?

    init(target: CompletedWorkoutFeedbackTarget, feedback: WorkoutFeedback) {
        self.target = target
        notes = feedback.notes?.isEmpty == true ? nil : feedback.notes
        perceivedFatigue = feedback.perceivedFatigue
    }

    var isValid: Bool { perceivedFatigue.map { (1...10).contains($0) } ?? true }
    var body: [String: Any] {
        ["expected_attempt": target.attempt, "notes": notes as Any? ?? NSNull(),
         "perceived_fatigue": perceivedFatigue as Any? ?? NSNull(), "expected_feedback": target.baseline.wire]
    }
}

enum CompletedWorkoutFeedbackOutcome {
    case saved
    case conflict(SessionRow)
    case retry(String)
    case invalid(String)
    case unavailable(String)
}

@MainActor
protocol CompletedWorkoutFeedbackAPI {
    func updateCompletedWorkoutFeedback(_ request: CompletedWorkoutFeedbackRequest, jwt: String) async throws -> SessionRow
}

/// Only this presentation owns unapproved words and any ambiguous submission.
/// No checkpoint or durable outbox is created for a historical edit.
@MainActor
final class CompletedWorkoutFeedbackEditor: ObservableObject, Identifiable {
    let id = UUID()
    let fields: WorkoutFeedbackEditor
    @Published private(set) var target: CompletedWorkoutFeedbackTarget
    @Published private(set) var submission: CompletedWorkoutFeedbackRequest?
    @Published private(set) var conflict: SessionRow?
    @Published private(set) var isSaving = false
    @Published private(set) var unavailable = false
    @Published private(set) var message: String?
    var isLocked: Bool { isSaving || submission != nil || conflict != nil || unavailable }

    init(target: CompletedWorkoutFeedbackTarget, transcriber: any WorkoutFeedbackTranscribing) {
        self.target = target
        fields = WorkoutFeedbackEditor(initial: WorkoutFeedback(notes: target.baseline.notes,
                                                                 perceivedFatigue: target.baseline.perceivedFatigue),
                                       transcriber: transcriber)
    }

    func save(using send: (CompletedWorkoutFeedbackRequest) async -> CompletedWorkoutFeedbackOutcome) async -> Bool {
        guard !isSaving, !unavailable, conflict == nil else { return false }
        let request = submission ?? CompletedWorkoutFeedbackRequest(target: target, feedback: fields.approvedFeedback())
        guard request.isValid else { message = "Choose a fatigue rating from 1 to 10, or Not rated."; return false }
        submission = request
        isSaving = true
        defer { isSaving = false }
        switch await send(request) {
        case .saved:
            return true
        case let .conflict(current):
            fields.edit(request.notes ?? "")
            fields.fatigue = request.perceivedFatigue
            submission = nil
            conflict = current
            message = nil
        case let .retry(reason):
            message = reason
        case let .invalid(reason):
            submission = nil
            message = reason
        case let .unavailable(reason):
            unavailable = true
            message = reason
        }
        return false
    }

    /// The explicit conflict choice is the only action that adopts a newer
    /// baseline. It never changes the submitted session/attempt/account.
    func useMine(using send: (CompletedWorkoutFeedbackRequest) async -> CompletedWorkoutFeedbackOutcome) async -> Bool {
        guard let conflict, target.matches(conflict) else { return false }
        target.baseline = WorkoutFeedbackBaseline(notes: conflict.notes, perceivedFatigue: conflict.perceived_fatigue)
        self.conflict = nil
        return await save(using: send)
    }
}
