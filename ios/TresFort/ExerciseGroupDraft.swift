import Foundation

/// A group is one atomic plan edit. Keep the original location and proposal
/// separate from a refreshed workout until the member explicitly reviews it.
struct ExerciseGroupDraft {
    let groupID: String
    let planID: String
    let isExisting: Bool
    private(set) var reviewedVersion: Int
    private(set) var reviewedSlots: [TemplateExercise]
    var memberIDs: [String]
    var rounds: Int
    private(set) var maximumRounds: Int
    var roundRest: RestSecondsDraft
    var transitionRest: RestSecondsDraft
    private let originalSlots: [TemplateExercise]
    private let initialMembers: [String]
    private let initialRounds: Int
    private let initialRoundRest: String
    private let initialTransitionRest: String

    init(groupID: String, planID: String, version: Int, slots: [TemplateExercise],
         members: [TemplateExercise], isExisting: Bool) {
        self.groupID = groupID
        self.planID = planID
        self.isExisting = isExisting
        reviewedVersion = version
        reviewedSlots = slots
        memberIDs = members.map(\.id)
        rounds = members[0].target_sets
        maximumRounds = max(20, members[0].target_sets)
        roundRest = RestSecondsDraft(seconds: members[0].group_rest_seconds ?? members[0].rest_seconds)
        transitionRest = RestSecondsDraft(seconds: members[0].group_transition_seconds ?? 0)
        originalSlots = slots
        initialMembers = memberIDs
        initialRounds = rounds
        initialRoundRest = roundRest.text
        initialTransitionRest = transitionRest.text
    }

    var isDirty: Bool {
        memberIDs != initialMembers || rounds != initialRounds
            || roundRest.text != initialRoundRest || transitionRest.text != initialTransitionRest
    }

    var availableMembers: [TemplateExercise] {
        reviewedSlots.filter { !memberIDs.contains($0.id) && ($0.group_id == nil || $0.group_id == groupID) }
    }

    func member(_ id: String) -> TemplateExercise? {
        reviewedSlots.first { $0.id == id } ?? originalSlots.first { $0.id == id }
    }

    static func sameIdentity(_ before: TemplateExercise, _ current: TemplateExercise) -> Bool {
        before.exercise_id == current.exercise_id && before.exercise_modality == current.exercise_modality
            && before.isTimed == current.isTimed && before.isUnilateral == current.isUnilateral
            && before.isPerHand == current.isPerHand && before.isWarmup == current.isWarmup
            && before.group_id == current.group_id
    }

    /// Position identifies the workout slot even when several slots use the
    /// same movement. Use that slot's unit and targets, never a runner value.
    static func slotContext(_ slot: TemplateExercise, in slots: [TemplateExercise]) -> String {
        var parts: [String] = []
        if let index = slots.firstIndex(where: { $0.id == slot.id }) {
            parts.append("Workout exercise \(index + 1)")
        }
        parts.append(slot.isWarmup ? "warm-up" : "working")
        parts.append(slot.prescriptionLabel(in: slot.targetWeightUnit))
        if slot.isPerHand && slot.target_weight == nil { parts.append("load per hand not set") }
        return parts.joined(separator: " · ")
    }

    func memberContext(_ id: String) -> String {
        guard let slot = member(id) else { return "Unavailable exercise" }
        let slots = reviewedSlots.contains(where: { $0.id == id }) ? reviewedSlots : originalSlots
        return Self.slotContext(slot, in: slots)
    }

    static func reviewLabel(_ slot: TemplateExercise, in slots: [TemplateExercise] = []) -> String {
        let mode = slot.isTimed ? "timed" : "reps"
        let side = slot.isUnilateral ? ", per side" : ""
        let load = slot.isPerHand ? ", load per hand" : ""
        return "\(slot.exercise_name) · \(slotContext(slot, in: slots)) · \(mode)\(side)\(load)"
    }

    mutating func move(_ id: String, by delta: Int) {
        guard let index = memberIDs.firstIndex(of: id), memberIDs.indices.contains(index + delta) else { return }
        memberIDs.swapAt(index, index + delta)
    }

    /// Removing a selection never removes its workout slot. The insertion
    /// index is measured after extracting the proposed members, so adding an
    /// earlier slot cannot accidentally move the group into another block.
    var orderIndex: Int? {
        let first = reviewedSlots.firstIndex {
            isExisting ? $0.group_id == groupID : initialMembers.contains($0.id)
        }
        guard let first else { return nil }
        return reviewedSlots.prefix(first).filter { !memberIDs.contains($0.id) }.count
    }

    func unavailableReason(planID: String?, slots: [TemplateExercise]?) -> String? {
        guard planID == self.planID, let slots else { return "This workout is no longer available. Your changes have not been saved." }
        if isExisting && !slots.contains(where: { $0.group_id == groupID }) {
            return "This group was removed. Your changes have not been saved."
        }
        if memberIDs.contains(where: { id in !slots.contains { $0.id == id } }) {
            return "A selected exercise is no longer in this workout. Remove it from your proposal before saving."
        }
        if memberIDs.contains(where: { id in slots.contains { $0.id == id && $0.group_id != nil && $0.group_id != groupID } }) {
            return "A selected exercise now belongs to another group. Remove it from your proposal before saving."
        }
        for id in memberIDs {
            if let before = member(id), let current = slots.first(where: { $0.id == id }),
               !Self.sameIdentity(before, current) {
                return "A selected exercise changed. Review the latest exercise names and execution details before keeping your proposal."
            }
        }
        return nil
    }

    /// Adopting authority never substitutes saved membership or prescriptions
    /// for the proposed ones, including IDs that need an explicit removal.
    @discardableResult
    mutating func review(planID: String?, version: Int, slots: [TemplateExercise]) -> Bool {
        guard planID == self.planID,
              !isExisting || slots.contains(where: { $0.group_id == groupID }) else { return false }
        reviewedVersion = version
        reviewedSlots = slots
        // A supported saved count remains reachable even after reducing the
        // draft or reviewing a later, lower prescription.
        if let first = slots.first(where: { isExisting ? $0.group_id == groupID : initialMembers.contains($0.id) }) {
            maximumRounds = max(maximumRounds, first.target_sets)
        }
        return true
    }

    var submission: ExerciseGroupSubmission? {
        guard memberIDs.count >= 2, Set(memberIDs).count == memberIDs.count,
              rounds > 0, let roundRest = roundRest.seconds, let transitionRest = transitionRest.seconds,
              let orderIndex, unavailableReason(planID: planID, slots: reviewedSlots) == nil else { return nil }
        return ExerciseGroupSubmission(memberIDs: memberIDs, expectedVersion: reviewedVersion,
            roundRest: roundRest, transitionRest: transitionRest, rounds: rounds, orderIndex: orderIndex)
    }
}

struct ExerciseGroupSubmission: Equatable {
    let memberIDs: [String]
    let expectedVersion: Int
    let roundRest: Int
    let transitionRest: Int
    let rounds: Int
    let orderIndex: Int
    var isClear: Bool { memberIDs.isEmpty }
}

enum ExerciseGroupWriteResult: Equatable {
    case saved, reviewRequired, retry, unavailable
}
