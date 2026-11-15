import Foundation

/// The rules behind changing a planned day (docs/plans/app-design-pass P25).
/// Change today opens on what the day holds and asks what the member wants:
/// a different version of the same thing, something else, or a rest day.
/// Each answer changes that date only; the saved workout and the week stay
/// as they are. A run is changed by its kind and one amount, not by picking
/// another saved workout.
enum DayChange {
    /// What a planned day holds, in the words its first screen uses.
    enum Holding: Equatable {
        case run, ride, swim, lift, home, activity

        /// "Change the run", "Change the lift".
        var noun: String {
            switch self {
            case .run: return "run"
            case .ride: return "ride"
            case .swim: return "swim"
            case .lift: return "lift"
            case .home: return "routine"
            case .activity: return "activity"
            }
        }

        /// What "Change the …" says it can change.
        var changeDetail: String {
            switch self {
            case .run: return "Kind of run, distance or time"
            case .ride, .swim: return "Distance or time"
            case .lift, .home: return "Exercises, sets or weights"
            case .activity: return ""
            }
        }

        /// An activity such as soccer has nothing to change but itself.
        var canChange: Bool { self != .activity }
    }

    static func holding(_ workout: Workout) -> Holding {
        switch PlanComposer.kind(of: workout) {
        case .run: return PlannedActivity.isActivity(workout) ? .activity : .run
        case .ride: return .ride
        case .swim: return .swim
        case .lift: return .lift
        case .home: return PlannedActivity.isActivity(workout) ? .activity : .home
        case .sport, .saved: return .activity
        }
    }

    /// "Monday", for "Change Monday" and "Skip Monday".
    static func weekday(_ date: String) -> String {
        guard let day = CalendarProjection.date(from: date) else { return "this day" }
        let index = CalendarProjection.calendar.component(.weekday, from: day) - 1
        let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        return names.indices.contains(index) ? names[index] : "this day"
    }

    // MARK: - A run

    /// The kind of run. One choice sets both the shape of the run and its
    /// effort, so the screen has a single choice and a single amount.
    enum RunKind: String, CaseIterable, Identifiable {
        case easy, tempo, intervals, long
        var id: String { rawValue }

        var title: String {
            switch self {
            case .easy: return "Easy"
            case .tempo: return "Tempo"
            case .intervals: return "Intervals"
            case .long: return "Long"
            }
        }

        /// The name the date's run gets, matching the planner's ideas.
        var runName: String {
            switch self {
            case .easy: return "Easy run"
            case .tempo: return "Tempo run"
            case .intervals: return "Intervals"
            case .long: return "Long run"
            }
        }

        /// Where the amount starts when the member picks this kind.
        func defaultAmount(_ unit: RunDistanceUnit) -> (minutes: Int, distance: Double) {
            switch self {
            case .easy: return (30, unit == .miles ? 3 : 5)
            case .tempo: return (40, unit == .miles ? 4 : 6)
            case .intervals: return (40, unit == .miles ? 4 : 6)
            case .long: return (75, unit == .miles ? 8 : 12)
            }
        }

        /// The least a run of this kind can be: a tempo or intervals needs
        /// room for its warm-up and cool-down around the work.
        var minimumMinutes: Int { self == .tempo || self == .intervals ? 30 : 10 }
        func minimumDistance(_ unit: RunDistanceUnit) -> Double {
            self == .tempo || self == .intervals ? (unit == .miles ? 3 : 5) : 1
        }
    }

    /// Distance or time, with the unit shown beside the number.
    enum Measure: String, Equatable {
        case time, distance
    }

    /// What the run screen shows: one kind and one amount.
    struct RunDraft: Equatable {
        var kind: RunKind
        var measure: Measure
        var minutes: Int
        var distance: Double

        static let minuteStep = 5
        static let maxMinutes = 360
        static let distanceStep = 0.5
        static let maxDistance = 60.0

        static func fresh(_ kind: RunKind = .easy, unit: RunDistanceUnit) -> RunDraft {
            let amount = kind.defaultAmount(unit)
            return RunDraft(kind: kind, measure: .time, minutes: amount.minutes, distance: amount.distance)
        }

        /// A new kind keeps the amount when it still fits, else starts at
        /// the kind's own.
        mutating func choose(_ next: RunKind, unit: RunDistanceUnit) {
            kind = next
            let amount = next.defaultAmount(unit)
            if minutes < next.minimumMinutes { minutes = amount.minutes }
            if distance < next.minimumDistance(unit) { distance = amount.distance }
        }

        mutating func step(by direction: Int, unit: RunDistanceUnit) {
            switch measure {
            case .time:
                minutes = min(Self.maxMinutes, max(kind.minimumMinutes, minutes + direction * Self.minuteStep))
            case .distance:
                let next = ((distance + Double(direction) * Self.distanceStep) * 2).rounded() / 2
                distance = min(Self.maxDistance, max(kind.minimumDistance(unit), next))
            }
        }

        mutating func toggleMeasure() { measure = measure == .time ? .distance : .time }
    }

    /// Effort targets for a run, from what the member has told the app.
    struct Targets {
        /// Threshold heart rate, bpm.
        var heartRate: Int?
        /// Threshold pace, seconds per kilometer.
        var pace: Int?
        /// The run being changed, when it already had its own target for
        /// the same kind of run: the member's own range wins.
        var own: (kind: RunKind, target: RunPlan.Target)?

        static let none = Targets(heartRate: nil, pace: nil, own: nil)

        /// The member's thresholds in effect on the date, heart rate first.
        static func from(_ thresholds: [AthleteThreshold], on date: String,
                         own: (kind: RunKind, target: RunPlan.Target)? = nil) -> Targets {
            let hr = AthleteThresholdHistory.inEffect(thresholds, sport: .run, metric: .heartRate, on: date)
            let pace = AthleteThresholdHistory.inEffect(thresholds, sport: .run, metric: .pace, on: date)
            return Targets(heartRate: hr.map { Int($0.value.rounded()) },
                           pace: pace.map { Int($0.value.rounded()) }, own: own)
        }

        /// The target for the main part of a kind of run. Heart rate is
        /// preferred over pace; nil when the member has set neither, so the
        /// run is planned by feel.
        func work(_ kind: RunKind) -> RunPlan.Target? {
            if let own, own.kind == kind { return own.target }
            let band: (low: Double, high: Double)
            let paceBand: (fast: Double, slow: Double)
            switch kind {
            case .easy, .long: band = (0.80, 0.89); paceBand = (1.15, 1.30)
            case .tempo: band = (0.95, 0.99); paceBand = (1.00, 1.05)
            case .intervals: band = (1.00, 1.05); paceBand = (0.92, 0.97)
            }
            if let heartRate {
                let low = Int((Double(heartRate) * band.low).rounded())
                let high = Int((Double(heartRate) * band.high).rounded())
                let limits = RunPlanLimits.heartRate
                return .heartRate(minBPM: min(max(low, limits.lowerBound), limits.upperBound),
                                  maxBPM: min(max(high, limits.lowerBound), limits.upperBound))
            }
            if let pace {
                let limits = RunPlanLimits.paceSecondsPerKm
                let fast = Int((Double(pace) * paceBand.fast).rounded())
                let slow = Int((Double(pace) * paceBand.slow).rounded())
                return .pace(fastestSecondsPerKm: min(max(fast, limits.lowerBound), limits.upperBound),
                             slowestSecondsPerKm: min(max(slow, limits.lowerBound), limits.upperBound))
            }
            return nil
        }
    }

    static let warmupSeconds = 10 * 60
    static let intervalWorkSeconds = 3 * 60
    static let intervalRecoverySeconds = 2 * 60
    static let intervalWorkMeters = 800.0
    static let intervalRecoveryMeters = 400.0

    /// The steps a kind and an amount make. An easy or long run is one
    /// step. A tempo is a warm-up, the tempo and a cool-down. Intervals are
    /// a warm-up, repeats of hard and easy, and a cool-down. The amount is
    /// the whole run.
    static func runPlan(_ draft: RunDraft, targets: Targets, unit: RunDistanceUnit) -> RunPlan {
        let work = targets.work(draft.kind)
        switch draft.measure {
        case .time:
            let total = min(RunPlanLimits.durationSeconds.upperBound, max(60, draft.minutes * 60))
            switch draft.kind {
            case .easy, .long:
                return RunPlan(items: [.step(.init(kind: .work, durationSeconds: total, distanceMeters: nil, target: work))])
            case .tempo:
                let middle = max(5 * 60, total - 2 * warmupSeconds)
                return RunPlan(items: [
                    .step(.init(kind: .warmup, durationSeconds: warmupSeconds, distanceMeters: nil, target: nil)),
                    .step(.init(kind: .work, durationSeconds: middle, distanceMeters: nil, target: work)),
                    .step(.init(kind: .cooldown, durationSeconds: warmupSeconds, distanceMeters: nil, target: nil)),
                ])
            case .intervals:
                let round = intervalWorkSeconds + intervalRecoverySeconds
                let times = min(RunPlanLimits.repeats.upperBound, max(2, (total - 2 * warmupSeconds) / round))
                return RunPlan(items: [
                    .step(.init(kind: .warmup, durationSeconds: warmupSeconds, distanceMeters: nil, target: nil)),
                    .repeated(times: times, steps: [
                        .init(kind: .work, durationSeconds: intervalWorkSeconds, distanceMeters: nil, target: work),
                        .init(kind: .recovery, durationSeconds: intervalRecoverySeconds, distanceMeters: nil, target: nil),
                    ]),
                    .step(.init(kind: .cooldown, durationSeconds: warmupSeconds, distanceMeters: nil, target: nil)),
                ])
            }
        case .distance:
            let total = min(RunPlanLimits.distanceMeters, max(100, (draft.distance * unit.meters).rounded()))
            // A warm-up and a cool-down of a mile, or a kilometer and a half.
            let easy = (unit == .miles ? 1 : 1.5) * unit.meters
            switch draft.kind {
            case .easy, .long:
                return RunPlan(items: [.step(.init(kind: .work, durationSeconds: nil, distanceMeters: total, target: work))])
            case .tempo:
                let middle = max(unit.meters, total - 2 * easy)
                return RunPlan(items: [
                    .step(.init(kind: .warmup, durationSeconds: nil, distanceMeters: easy.rounded(), target: nil)),
                    .step(.init(kind: .work, durationSeconds: nil, distanceMeters: middle.rounded(), target: work)),
                    .step(.init(kind: .cooldown, durationSeconds: nil, distanceMeters: easy.rounded(), target: nil)),
                ])
            case .intervals:
                let round = intervalWorkMeters + intervalRecoveryMeters
                let times = min(RunPlanLimits.repeats.upperBound, max(2, Int((total - 2 * easy) / round)))
                return RunPlan(items: [
                    .step(.init(kind: .warmup, durationSeconds: nil, distanceMeters: easy.rounded(), target: nil)),
                    .repeated(times: times, steps: [
                        .init(kind: .work, durationSeconds: nil, distanceMeters: intervalWorkMeters, target: work),
                        .init(kind: .recovery, durationSeconds: nil, distanceMeters: intervalRecoveryMeters, target: nil),
                    ]),
                    .step(.init(kind: .cooldown, durationSeconds: nil, distanceMeters: easy.rounded(), target: nil)),
                ])
            }
        }
    }

    /// The one line under the amount: what the run will be, step by step.
    static func summary(_ draft: RunDraft, targets: Targets, unit: RunDistanceUnit) -> String {
        let plan = runPlan(draft, targets: targets, unit: unit)
        let line = RunPlanFormat.summary(plan, unit: unit)
        return targets.work(draft.kind) == nil ? line + ". By feel: add your threshold heart rate or pace in Profile for a target." : line + "."
    }

    /// The run screen's starting point for a run the day already holds:
    /// its kind from its name or shape, and its amount from its steps.
    static func draft(from workout: Workout?, unit: RunDistanceUnit) -> RunDraft {
        guard let workout, let slot = PlannedRunCreation.runSlot(in: workout) else { return .fresh(unit: unit) }
        let plan = slot.runPlan
        let kind = runKind(named: workout.name, plan: plan)
        guard let plan else { return .fresh(kind, unit: unit) }
        var seconds = 0, meters = 0.0
        for expanded in plan.expandedSteps {
            if let distance = expanded.step.distanceMeters { meters += distance }
            else { seconds += expanded.step.durationSeconds ?? 0 }
        }
        var draft = RunDraft.fresh(kind, unit: unit)
        if meters > 0 && seconds == 0 {
            draft.measure = .distance
            draft.distance = min(RunDraft.maxDistance, max(kind.minimumDistance(unit), ((meters / unit.meters) * 2).rounded() / 2))
        } else if seconds > 0 {
            draft.measure = .time
            let rounded = Int((Double(seconds) / 60 / Double(RunDraft.minuteStep)).rounded()) * RunDraft.minuteStep
            draft.minutes = min(RunDraft.maxMinutes, max(kind.minimumMinutes, rounded))
        }
        return draft
    }

    /// The kind a run reads as: its name first ("Tempo run"), then its
    /// shape (repeats are intervals, a targeted middle step a tempo).
    static func runKind(named name: String, plan: RunPlan?) -> RunKind {
        let lower = name.lowercased()
        if lower.contains("tempo") || lower.contains("threshold") { return .tempo }
        if lower.contains("interval") || lower.contains("repeat") || lower.contains("track") { return .intervals }
        if lower.contains("long") { return .long }
        if lower.contains("easy") || lower.contains("recovery") || lower.contains("zone 2") { return .easy }
        guard let plan else { return .easy }
        if plan.items.contains(where: { if case .repeated = $0 { return true } else { return false } }) { return .intervals }
        let steps = plan.expandedSteps.map(\.step)
        if steps.contains(where: { $0.kind == .warmup }), steps.contains(where: { $0.kind == .work && $0.target != nil }) {
            return .tempo
        }
        return .easy
    }

    /// The target the day's run already uses for its main part, kept when
    /// the member doesn't change the kind of run.
    static func ownTarget(of workout: Workout?) -> (kind: RunKind, target: RunPlan.Target)? {
        guard let workout, let plan = PlannedRunCreation.runSlot(in: workout)?.runPlan else { return nil }
        let kind = runKind(named: workout.name, plan: plan)
        guard let target = plan.expandedSteps.map(\.step).first(where: { $0.kind == .work && $0.target != nil })?.target
        else { return nil }
        return (kind, target)
    }

    /// The amount as the screen shows it: "40" and "min", or "4" and "mi".
    static func amountText(_ draft: RunDraft, unit: RunDistanceUnit) -> (value: String, unit: String) {
        switch draft.measure {
        case .time: return ("\(draft.minutes)", "min")
        case .distance: return (PlanComposer.number(draft.distance), unit.abbreviation)
        }
    }

    // MARK: - A run at a glance

    /// One figure on Today's card: "TIME 40 min", "EFFORT Tempo",
    /// "TARGET HR 155–161". The steps themselves are behind Details.
    struct Glance: Equatable, Identifiable {
        let label: String
        let value: String
        var id: String { label }
    }

    /// A planned run in three figures: how long or how far in all, the kind
    /// of run, and the main part's target when it has one. Empty for a run
    /// planned without steps, which keeps its one-line label.
    static func glance(_ workout: Workout, unit: RunDistanceUnit) -> [Glance] {
        guard let plan = PlannedRunCreation.runSlot(in: workout)?.runPlan else { return [] }
        var seconds = 0, meters = 0.0
        for expanded in plan.expandedSteps {
            if let distance = expanded.step.distanceMeters { meters += distance }
            else { seconds += expanded.step.durationSeconds ?? 0 }
        }
        var out: [Glance] = []
        if let total = RunPlanFormat.total(plan, unit: unit) {
            out.append(Glance(label: meters > 0 && seconds == 0 ? "Distance" : "Time", value: total))
        }
        out.append(Glance(label: "Effort", value: runKind(named: workout.name, plan: plan).title))
        if let target = plan.expandedSteps.map(\.step).first(where: { $0.kind == .work && $0.target != nil })?.target {
            out.append(Glance(label: "Target", value: shortTarget(target, unit: unit)))
        }
        return out
    }

    /// "HR 155–161" or "8:05–8:30 /mi".
    static func shortTarget(_ target: RunPlan.Target, unit: RunDistanceUnit) -> String {
        switch target {
        case .heartRate(let low, let high): return low == high ? "HR \(low)" : "HR \(low)–\(high)"
        case .pace: return RunPlanFormat.target(target, unit: unit)
        }
    }

    // MARK: - Something else

    /// The kinds offered for something else, the member's most frequent
    /// first, as on Add to your week.
    static func swapKinds(_ ranked: [PlanComposer.Kind]) -> [PlanComposer.Kind] {
        ranked.filter { $0 != .saved }
    }

    /// The saved workouts that go with a kind: lifts under Lift, routines
    /// under At home, activities such as soccer under Other. On a trip date
    /// travel workouts come first, as in the library's own choices.
    static func saved(_ kind: PlanComposer.Kind, in plan: PlanTree?, on date: String? = nil) -> [Workout] {
        let workouts = date.map { WorkoutLibraryPolicy.choices(plan: plan, date: $0) } ?? plan?.libraryWorkouts ?? []
        return workouts.filter { PlanComposer.kind(of: $0) == kind }
    }

    /// The tile something else opens on: the member's most frequent kind
    /// that isn't what the day already holds.
    static func firstSwapKind(_ kinds: [PlanComposer.Kind], current: Workout?) -> PlanComposer.Kind {
        let held = current.map { PlanComposer.kind(of: $0) }
        return kinds.first { $0 != held } ?? kinds.first ?? .run
    }
}
