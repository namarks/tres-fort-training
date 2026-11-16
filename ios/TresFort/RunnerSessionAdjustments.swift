import Foundation

struct SessionRoundActionTarget: Equatable {
    let session: WorkoutTerminalActionTarget
    let prescription: RunnerGroupPrescription
    let members: [TemplateExercise]
    let nextSetNumbers: [Int]
    let skippedSlotIDs: [String]
}

/// The entire saved group owns a session choice. A reorder, regroup, swap or
/// prescription change invalidates the choice instead of moving it to new work.
struct RunnerGroupPrescription: Codable, Equatable {
    let groupID: String
    let members: [TemplateExercise]

    init?(groupID: String, workout: Workout) {
        let members = workout.exercises.filter { $0.group_id == groupID }
        guard members.count >= 2, let first = members.first,
              members.allSatisfy({ $0.target_sets == first.target_sets }),
              (1...100).contains(first.target_sets) else { return nil }
        self.groupID = groupID
        self.members = members
    }

    var rounds: Int { members.first?.target_sets ?? 0 }

    func matches(_ workout: Workout) -> Bool {
        self == RunnerGroupPrescription(groupID: groupID, workout: workout)
    }
}

/// Local choices for one running session. They never become library targets
/// or change the server's immutable starting-target comparison.
struct RunnerSessionAdjustments: Codable, Equatable {
    struct ExtraSets: Codable, Equatable {
        let prescription: RunnerPrescription
        let prescribedSets: Int
        var count: Int

        func matches(_ exercise: TemplateExercise) -> Bool {
            exercise.group_id == nil && exercise.target_sets == prescribedSets
                && prescription.matches(current: RunnerPrescription(exercise))
                && count > 0 && count <= 100 - prescribedSets
        }
    }

    struct GroupAdjustment: Codable, Equatable {
        let prescription: RunnerGroupPrescription
        var extraRounds: Int = 0
        var roundRest: Int?
        var transitionRest: Int?

        func matches(_ workout: Workout) -> Bool {
            prescription.matches(workout) && extraRounds >= 0
                && extraRounds <= 100 - prescription.rounds
                && (roundRest.map { (0...3600).contains($0) } ?? true)
                && (transitionRest.map { (0...3600).contains($0) } ?? true)
        }
    }

    var addedExercises: [TemplateExercise] = []
    var extraSets: [String: ExtraSets] = [:]
    var restOverrides: [String: RunnerRestOverride] = [:]
    var groups: [String: GroupAdjustment] = [:]

    init() {}

    private enum CodingKeys: String, CodingKey { case addedExercises, extraSets, restOverrides, groups }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        addedExercises = try values.decodeIfPresent([TemplateExercise].self, forKey: .addedExercises) ?? []
        extraSets = try values.decodeIfPresent([String: ExtraSets].self, forKey: .extraSets) ?? [:]
        restOverrides = try values.decodeIfPresent([String: RunnerRestOverride].self, forKey: .restOverrides) ?? [:]
        groups = try values.decodeIfPresent([String: GroupAdjustment].self, forKey: .groups) ?? [:]
    }

    var isEmpty: Bool { addedExercises.isEmpty && extraSets.isEmpty && restOverrides.isEmpty && groups.isEmpty }

    /// A live edit may replace a movement or change its prescription while a
    /// runner is open. Never transfer the old extra work to that replacement.
    func normalized(for workout: Workout) -> Self {
        var normalized = self
        var movements = Set(workout.exercises.map(\.exercise_id))
        normalized.addedExercises = addedExercises.prefix(50).filter { exercise in
            guard exercise.id == exercise.exercise_id, !exercise.id.isEmpty,
                  exercise.exercise_id != RunPlan.exerciseID,
                  exercise.group_id == nil, !exercise.isWarmup,
                  exercise.target_sets == 1,
                  movements.insert(exercise.exercise_id).inserted else { return false }
            return true
        }
        let slots = workout.exercises + normalized.addedExercises
        normalized.extraSets = extraSets.filter { id, value in
            slots.first(where: { $0.id == id }).map(value.matches) ?? false
        }
        normalized.restOverrides = restOverrides.filter { id, value in
            guard let slot = slots.first(where: { $0.id == id }), slot.group_id == nil,
                  (0...3600).contains(value.seconds) else { return false }
            return value.prescription.matches(current: RunnerPrescription(slot))
        }
        normalized.groups = groups.filter { id, value in
            id == value.prescription.groupID && value.matches(workout)
                && (value.extraRounds > 0 || value.roundRest != nil || value.transitionRest != nil)
        }
        return normalized
    }

    func applying(to workout: Workout) -> Workout {
        let normalized = normalized(for: workout)
        let exercises = (workout.exercises + normalized.addedExercises).map { exercise in
            if let groupID = exercise.group_id, let group = normalized.groups[groupID] {
                return exercise.applying(SlotTargets(sets: exercise.target_sets + group.extraRounds))
            }
            guard let extra = normalized.extraSets[exercise.id] else { return exercise }
            return exercise.applying(SlotTargets(sets: exercise.target_sets + extra.count))
        }
        return Workout(tags: workout.tags, archived_at: workout.archived_at,
            one_time_date: workout.one_time_date, id: workout.id, name: workout.name,
            day_label: workout.day_label, order_index: workout.order_index, exercises: exercises)
    }

    static func addedExercise(_ exercise: ExerciseCatalog, order: Int) -> TemplateExercise {
        // An unprescribed loaded movement requires an explicit load. Zero is
        // still a legitimate input for bodyweight and timed exercises.
        FreestyleRunner.exercise(exercise, order: order)
            .applying(SlotTargets(weight: .some(nil)))
    }

    static func warmup(_ exercise: TemplateExercise) -> TemplateExercise {
        TemplateExercise(progression: exercise.progression,
            id: exercise.id, exercise_id: exercise.exercise_id, exercise_name: exercise.exercise_name,
            exercise_unit: exercise.exercise_unit, order_index: exercise.order_index,
            target_sets: 1, target_reps: exercise.target_reps, target_reps_max: exercise.target_reps_max,
            target_rpe: nil, rest_seconds: exercise.rest_seconds, target_weight: nil, cues: exercise.cues,
            exercise_modality: exercise.exercise_modality, exercise_laterality: exercise.exercise_laterality,
            exercise_load_mode: exercise.exercise_load_mode, exercise_demo_slug: exercise.exercise_demo_slug,
            target_duration_s: nil, is_warmup: 1, target_weight_unit: exercise.target_weight_unit)
    }
}

struct SessionWarmupValues: Equatable {
    let weight: Double
    let reps: Int
    var rpe: Double? = nil

    func isValid(for exercise: TemplateExercise) -> Bool {
        weight.isFinite && (exercise.isBodyweight || weight >= 0) && (1...1000).contains(reps)
            && (rpe.map { $0.isFinite && (1...10).contains($0) } ?? true)
    }
}
