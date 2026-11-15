#if DEBUG && targetEnvironment(simulator)
import SwiftUI

/// Presentation/input qualification only. These fixtures render the production
/// partner views with isolated account state; no three-device link is started.
enum PartnerInstructionFixtureData {
    enum Mode: String {
        case setupUnknown = "setup-unknown", setupAssistance = "setup-assistance"
        case runnerUnilateral = "runner-unilateral", runnerTimed = "runner-timed"
        case runnerCardio = "runner-cardio"
        var reviewing: Bool { self == .setupUnknown || self == .setupAssistance }
    }

    static var selected: Mode? {
        guard let value = ProcessInfo.processInfo.environment["TRESFORT_UI_PARTNER_INSTRUCTIONS"] else { return nil }
        guard let mode = Mode(rawValue: value), UIFixtureScenario.selected == .ordinary else {
            preconditionFailure("Invalid synthetic partner instruction fixture")
        }
        return mode
    }
    static let planID = "61111111-1111-4111-8111-111111111111"
    static let workoutID = "62222222-2222-4222-8222-222222222222"
    static let slotID = "63333333-3333-4333-8333-333333333333"

    static func workout(_ mode: Mode) -> [String: Any] {
        var slot: [String: Any] = ["id": slotID, "exercise_id": "synthetic-partner-exercise",
            "exercise_name": "Dumbbell Row", "exercise_unit": "lb", "exercise_modality": "dumbbell",
            "exercise_laterality": "unilateral", "exercise_load_mode": "per_hand", "order_index": 0,
            "target_sets": 2, "target_reps": 8, "rest_seconds": 60,
            "target_weight": NSNull(), "target_weight_unit": "lb"]
        switch mode {
        case .setupUnknown, .runnerUnilateral: break
        case .setupAssistance:
            slot["exercise_name"] = "Pull-Up"; slot["exercise_modality"] = "bw"
            slot["exercise_laterality"] = "bilateral"; slot["exercise_load_mode"] = "total"
        case .runnerTimed, .runnerCardio:
            slot["exercise_name"] = mode == .runnerTimed ? "Plank" : "Stationary Bike"
            slot["exercise_modality"] = mode == .runnerTimed ? "timed" : "cardio"
            slot["exercise_laterality"] = "bilateral"; slot["exercise_load_mode"] = "total"
            slot["target_duration_s"] = 45; slot["target_reps"] = 1; slot["target_weight"] = 0
        }
        return ["id": workoutID, "name": "Shared instruction check", "order_index": 0, "exercises": [slot]]
    }

    static func plan(_ mode: Mode) -> [String: Any] {
        ["id": planID, "name": "Shared instruction check", "version": 1,
         "meta": "{\"schedule\":{\"version\":1,\"week\":{\"tue\":\"\(workoutID)\"}}}",
         "days": [workout(mode)]]
    }
}

@MainActor
struct PartnerInstructionFixtureView: View {
    @ObservedObject var auth: AuthModel
    let mode: PartnerInstructionFixtureData.Mode
    @StateObject private var sync: SyncModel
    @StateObject private var partner = PartnerPhoneModel()
    @State private var installed = false

    init(auth: AuthModel, mode: PartnerInstructionFixtureData.Mode) {
        self.auth = auth; self.mode = mode
        _sync = StateObject(wrappedValue: SyncModel(auth: auth, defaults: UIFixtureModel.defaults,
            now: { CalendarProjection.date(from: "2026-09-08")! },
            restActivityUpdater: { _, _ in }, restActivityEnder: {}, restNotificationCanceller: {}))
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("SYNTHETIC · shared instructions").font(.caption).dynamicTypeSize(.large)
                .accessibilityIdentifier("fixture.partnerInstructions")
                .accessibilityValue(Text(evidence))
            if installed {
                if mode.reviewing { PartnerPhoneSetup(model: partner, sync: sync) }
                else { PartnerPhoneRunner(model: partner, sync: sync) }
            } else { ProgressView("Loading synthetic workout…") }
        }
        .task {
            guard !installed else { return }
            await sync.load()
            guard let plan = sync.plan, let workout = plan.workouts.first else { return }
            if !mode.reviewing { sync.startWorkout() }
            let offer = PartnerOffer(id: UUID(), hostName: "Jordan", planID: plan.id,
                                     planVersion: plan.version, workout: workout)
            precondition(offer.isValid)
            let copy = PartnerCopyRequest(workout_id: workout.id, name: workout.name,
                expected_plan_id: plan.id, expected_version: plan.version,
                slots: workout.exercises.map { PartnerSlot($0, id: $0.id, index: $0.order_index, groupID: $0.group_id) })
            let checkpoint = PartnerCheckpoint(id: offer.id, lane: .partner, offer: offer, name: "Casey",
                phase: mode.reviewing ? .reviewing : .active,
                slotMap: Dictionary(uniqueKeysWithValues: workout.exercises.map { ($0.id, $0.id) }), copy: copy,
                receipt: .init(workout_id: workout.id, plan_id: plan.id, version: plan.version),
                sessionID: sync.todaySession?.id, attempt: sync.todaySession?.attempt)
            installed = partner.installInstructionUIFixture(auth: auth, sync: sync, checkpoint: checkpoint)
        }
    }

    private var evidence: String {
        let slot = partner.checkpoint?.copy?.slots.first
        return "installed:\(installed);load:\(slot?.target_weight.map(WeightUnit.text) ?? "nil");unit:\(slot?.target_weight_unit ?? "none");sets:\(sync.sets.count)"
    }
}
#endif
