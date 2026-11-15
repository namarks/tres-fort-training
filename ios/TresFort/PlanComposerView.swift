import SwiftUI

/// The rules behind "Add to your week" (docs/plans/app-design-pass P13): one
/// sheet that puts a run, a lift, an activity or a saved workout on one or more
/// weekdays. A plain run is a distance or a time, not a trip through the step
/// planner, so "a 3-mile run every Wednesday" is four taps.
enum PlanComposer {
    enum Kind: String, CaseIterable, Identifiable {
        case run, ride, swim, lift, home, sport, saved
        var id: String { rawValue }

        var title: String {
            switch self {
            case .run: return "Run"
            case .ride: return "Ride"
            case .swim: return "Swim"
            case .lift: return "Lift"
            case .home: return "At home"
            case .sport: return "Other"
            case .saved: return "Saved"
            }
        }

        var glyph: String {
            switch self {
            case .run: return "figure.run"
            case .ride: return "bicycle"
            case .swim: return "figure.pool.swim"
            case .lift: return "dumbbell"
            case .home: return "figure.core.training"
            case .sport: return "sportscourt"
            case .saved: return "square.stack"
            }
        }

        /// A ride or a swim: planned by distance or time, and kept as an
        /// activity that a synced or logged ride or swim on the day counts.
        var isEndurance: Bool { self == .ride || self == .swim }

        /// The kinds that make something new, in the order their tiles show.
        static let new: [Kind] = [.run, .ride, .swim, .lift, .home, .sport]

        /// The composer's tiles before any ranking: four, then three.
        static let rows: [[Kind]] = layout(new)

        /// The composer's tiles for kinds in a given order: the first four,
        /// then the other two and Saved, which always comes last.
        static func layout(_ order: [Kind]) -> [[Kind]] {
            [Array(order.prefix(4)), Array(order.dropFirst(4)) + [.saved]]
        }
    }

    /// The kinds to make something new, the member's most frequent first
    /// (app-design-pass P24). Ties, and a member with nothing yet, keep
    /// the default order: run, ride, swim, lift, at home, other.
    static func ranked(_ counts: [Kind: Int]) -> [Kind] {
        Kind.new.enumerated().sorted { a, b in
            let first = counts[a.element] ?? 0, second = counts[b.element] ?? 0
            return first != second ? first > second : a.offset < b.offset
        }.map(\.element)
    }

    /// The tile a sport belongs under: a run, ride or swim its own, a
    /// strength workout a lift, core and stretching at home, any other
    /// sport Other.
    static func kind(sport id: String?) -> Kind {
        switch id {
        case "run": return .run
        case "ride": return .ride
        case "swim": return .swim
        case "strength", "lift": return .lift
        case "core", "flexibility": return .home
        default: return .sport
        }
    }

    /// The tile a saved workout belongs under: an activity by the sport its
    /// name stands for, a planned run a run, all bodyweight and holds at
    /// home, anything else a lift.
    static func kind(of workout: Workout) -> Kind {
        if PlannedActivity.isActivity(workout) {
            return kind(sport: PlannedActivity.sport(named: workout.name)?.id)
        }
        if PlannedRunCreation.isRun(workout) { return .run }
        if workout.exercises.allSatisfy({ $0.exercise_modality == "bw" || $0.exercise_modality == "timed" }) {
            return .home
        }
        return .lift
    }

    /// How often the member does each kind: once for each time their week
    /// holds it, and once for each one they did on or after `since`
    /// (YYYY-MM-DD). Finished workouts count as a lift or at home; runs,
    /// rides, swims and other sports count from the activities logged or
    /// synced, so a recorded run isn't counted twice.
    static func usage(plan: PlanTree?, sessions: [SessionRow], synced: [ExternalActivity],
                      manual: [ActivityRow], since: String) -> [Kind: Int] {
        var counts: [Kind: Int] = [:]
        let byID = Dictionary((plan?.workouts ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        if let schedule = plan?.schedule {
            for key in PlanSchedule.weekdayKeys {
                let ids = [schedule.templateID(forWeekdayKey: key)].compactMap { $0 } + schedule.extraIDs(forWeekdayKey: key)
                for id in ids { if let workout = byID[id] { counts[Self.kind(of: workout), default: 0] += 1 } }
            }
        }
        for session in sessions where session.status == "completed" && session.date >= since {
            let done = session.workout_id.flatMap { byID[$0] }.map { Self.kind(of: $0) } ?? .lift
            if done == .lift || done == .home { counts[done, default: 0] += 1 }
        }
        for activity in synced where activity.deleted_at == nil && activity.date >= since {
            counts[Self.kind(sport: activity.sport ?? activity.kind), default: 0] += 1
        }
        for activity in manual where activity.deleted_at == nil && activity.date >= since {
            counts[Self.kind(sport: activity.type), default: 0] += 1
        }
        return counts
    }

    /// The member's kinds, most frequent first, from their week and the
    /// last eight weeks.
    @MainActor static func ranked(for sync: SyncModel, now: Date = Date()) -> [Kind] {
        let start = CalendarProjection.calendar.date(byAdding: .day, value: -56, to: now) ?? now
        return ranked(usage(plan: sync.plan, sessions: sync.sessions, synced: sync.activities,
                            manual: sync.manualActivities, since: CalendarProjection.dateString(start)))
    }

    /// How a new run is planned: a distance, a time, or step by step.
    enum RunMeasure: String, CaseIterable, Identifiable {
        case distance, time, steps
        var id: String { rawValue }
        var title: String {
            switch self {
            case .distance: return "Distance"
            case .time: return "Time"
            case .steps: return "Steps"
            }
        }
    }

    /// Distance shortcuts in the member's unit.
    static func distanceChoices(_ unit: RunDistanceUnit) -> [Double] {
        unit == .miles ? [2, 3, 4, 5, 6, 10] : [3, 5, 8, 10, 15, 21.1]
    }

    static let defaultDistance = 3.0
    static let distanceStep = 0.5
    static let distanceRange = 0.5...60.0
    static let minuteChoices = [20, 30, 45, 60, 75, 90]
    static let defaultMinutes = 30
    static let minuteStep = 5
    static let minuteRange = 5...360

    /// How far and how long each kind is planned: a run in miles or km, a
    /// ride in longer miles or km, a swim in yards or meters to match.
    struct Amounts: Equatable {
        let distanceChoices: [Double]
        let defaultDistance: Double
        let distanceStep: Double
        let distanceRange: ClosedRange<Double>
        let distanceLabel: String
        let minuteChoices: [Int]
        let defaultMinutes: Int
        let defaultMeasure: RunMeasure
    }

    static func amounts(_ kind: Kind, unit: RunDistanceUnit) -> Amounts {
        switch kind {
        case .ride:
            return Amounts(distanceChoices: unit == .miles ? [10, 15, 20, 30, 40, 50] : [15, 25, 40, 50, 80, 100],
                           defaultDistance: unit == .miles ? 20 : 30, distanceStep: 1, distanceRange: 1...300,
                           distanceLabel: unit.abbreviation,
                           minuteChoices: [30, 45, 60, 90, 120, 180], defaultMinutes: 60, defaultMeasure: .time)
        case .swim:
            return Amounts(distanceChoices: [500, 1000, 1500, 2000, 2500, 3000],
                           defaultDistance: 1000, distanceStep: 100, distanceRange: 50...10_000,
                           distanceLabel: swimUnit(unit),
                           minuteChoices: [20, 30, 45, 60, 75, 90], defaultMinutes: 30, defaultMeasure: .distance)
        default:
            return Amounts(distanceChoices: distanceChoices(unit), defaultDistance: defaultDistance,
                           distanceStep: distanceStep, distanceRange: distanceRange,
                           distanceLabel: unit.abbreviation,
                           minuteChoices: minuteChoices, defaultMinutes: defaultMinutes, defaultMeasure: .distance)
        }
    }

    /// Swims count yards for a member on miles, meters on kilometers.
    static func swimUnit(_ unit: RunDistanceUnit) -> String { unit == .miles ? "yd" : "m" }

    /// The name a new ride or swim gets when the member doesn't type one:
    /// "60 min ride", "20 mi ride", "1000 yd swim". It ends in the sport, so
    /// Today knows a synced ride or swim on the day is the one planned.
    static func enduranceName(_ kind: Kind, measure: RunMeasure, distance: Double, minutes: Int,
                              unit: RunDistanceUnit) -> String {
        let sport = kind == .swim ? "swim" : "ride"
        switch measure {
        case .distance:
            return "\(number(distance)) \(amounts(kind, unit: unit).distanceLabel) \(sport)"
        case .time, .steps:
            return "\(RunPlanFormat.duration(minutes * 60)) \(sport)"
        }
    }

    /// The name a ride or swim is saved under: the typed one, ending in
    /// its sport so it still reads as that sport ("Recovery" becomes
    /// "Recovery ride"), or the amount's name when nothing is typed. Only
    /// the name says what an activity is, so the sport can't be dropped.
    static func enduranceName(_ kind: Kind, typed: String, auto: String) -> String {
        let clean = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return auto }
        let sport = kind == .swim ? "swim" : "ride"
        return PlannedActivity.sport(named: clean)?.id == sport ? clean : "\(clean) \(sport)"
    }

    /// A plain run's plan: one step of that distance or time, no target.
    /// Nil for a run planned step by step, which the step editor fills in.
    static func runPlan(measure: RunMeasure, distance: Double, minutes: Int,
                        unit: RunDistanceUnit) -> RunPlan? {
        switch measure {
        case .distance:
            let meters = min(RunPlanLimits.distanceMeters, (distance * unit.meters * 10).rounded() / 10)
            guard meters > 0 else { return nil }
            return RunPlan(items: [.step(RunPlan.Step(kind: .work, durationSeconds: nil,
                                                      distanceMeters: meters, target: nil))])
        case .time:
            let seconds = min(RunPlanLimits.durationSeconds.upperBound, max(60, minutes * 60))
            return RunPlan(items: [.step(RunPlan.Step(kind: .work, durationSeconds: seconds,
                                                      distanceMeters: nil, target: nil))])
        case .steps:
            return nil
        }
    }

    /// The name a new run gets when the member doesn't type one:
    /// "3 mi run", "30 min run", or "Run" for one planned by steps.
    static func runName(measure: RunMeasure, distance: Double, minutes: Int,
                        unit: RunDistanceUnit) -> String {
        switch measure {
        case .distance: return "\(number(distance)) \(unit.abbreviation) run"
        case .time: return "\(RunPlanFormat.duration(minutes * 60)) run"
        case .steps: return PlannedRunCreation.defaultName
        }
    }

    /// The saved week with every chosen weekday set to one workout. Weekdays
    /// pointing at a missing or archived workout already read as rest, so
    /// they are sent as rest instead of being rejected.
    static func week(_ plan: PlanTree, setting weekdayKeys: Set<String>, to workoutID: String) -> [String: String] {
        let live = Set(plan.libraryWorkouts.map(\.id))
        return Dictionary(uniqueKeysWithValues: PlanSchedule.weekdayKeys.map { key in
            if weekdayKeys.contains(key) { return (key, workoutID) }
            let id = plan.schedule?.templateID(forWeekdayKey: key) ?? ""
            return (key, live.contains(id) ? id : "")
        })
    }

    /// The primary button: "Add to Wednesdays", "Add to Mon, Wed, Fri".
    static func addTitle(_ weekdayKeys: Set<String>) -> String {
        let ordered = PlanSchedule.weekdayKeys.filter(weekdayKeys.contains)
        switch ordered.count {
        case 0: return "Pick a day"
        case 1: return "Add to \(WorkoutLibraryPolicy.weekdayNames[ordered[0]] ?? ordered[0])s"
        case 7: return "Add to every day"
        default: return "Add to " + ordered.map(\.capitalized).joined(separator: ", ")
        }
    }

    /// What the chosen days hold now and would lose: "Replaces Kettlebell A
    /// on Monday." Rest days and days already holding this workout say nothing.
    static func replacing(_ weekdayKeys: Set<String>, with workoutID: String?, plan: PlanTree?) -> String? {
        let replaced = WorkoutLibraryPolicy.weekRows(plan: plan).filter {
            weekdayKeys.contains($0.weekdayKey) && $0.workoutID != nil && $0.workoutID != workoutID
        }
        guard !replaced.isEmpty else { return nil }
        let parts = replaced.map { "\($0.workoutName ?? "a workout") on \(WorkoutLibraryPolicy.weekdayNames[$0.weekdayKey] ?? $0.weekdayKey)" }
        return "Replaces " + parts.joined(separator: ", ") + "."
    }

    /// Every weekday's times after one write puts a workout on the chosen
    /// days at a time of day (app-design-pass P24): saved times stay where
    /// their item is still on the day, and the new item gets its time on
    /// each chosen day. Nil without a time, so the write leaves times as
    /// they are.
    static func times(_ minutes: Int?, for workoutID: String, on weekdayKeys: Set<String>,
                      week: [String: String], extras: [String: [String]]?,
                      plan: PlanTree) -> [String: [String: String]]? {
        guard let minutes else { return nil }
        let savedExtras = extras ?? ScheduleExtras.current(plan)
        var out: [String: [String: String]] = [:]
        for (key, day) in ScheduleTimes.current(plan) {
            let held = Set([week[key] ?? ""].filter { !$0.isEmpty } + (savedExtras[key] ?? []))
            let kept = day.filter { held.contains($0.key) }
            if !kept.isEmpty { out[key] = kept }
        }
        for key in PlanSchedule.weekdayKeys where weekdayKeys.contains(key) {
            out[key, default: [:]][workoutID] = ScheduleTimes.hhmm(minutes)
        }
        return out
    }

    /// Where a new time starts: evening for a routine at home, morning
    /// for the rest.
    static func defaultTimeOfDay(for kind: Kind) -> Int {
        kind == .home || kind == .sport ? 20 * 60 : 7 * 60
    }

    /// A routine done at home with no equipment: core, stretching or a
    /// bodyweight circuit, set by set like a lift, with holds timed.
    enum HomeStart: String, CaseIterable, Identifiable {
        case core, stretching, bodyweight, own
        var id: String { rawValue }

        var title: String {
            switch self {
            case .core: return "Core"
            case .stretching: return "Stretching"
            case .bodyweight: return "Bodyweight"
            case .own: return "My own"
            }
        }

        /// The name it gets unless the member types one.
        var defaultName: String {
            switch self {
            case .core: return "Core routine"
            case .stretching: return "Stretch routine"
            case .bodyweight: return "Bodyweight circuit"
            case .own: return "Home workout"
            }
        }

        /// Catalog exercises it starts with; the member can change them
        /// before it's saved and set reps or hold times after.
        var exerciseIDs: [String] {
            switch self {
            case .core: return ["ex_plank", "ex_dead_bug", "ex_side_plank", "ex_bird_dog", "ex_hollow"]
            case .stretching: return ["ex_cat_cow", "ex_thoracic_rotation", "ex_90_90_hip", "ex_pigeon_pose", "ex_couch_stretch"]
            case .bodyweight: return ["ex_pushup", "ex_bw_squat", "ex_bw_reverse_lunge", "ex_glute_bridge_march", "ex_plank"]
            case .own: return []
            }
        }

        /// Its exercises that the catalog on this phone has, in order.
        func exercises(in catalog: [ExerciseCatalog]) -> [ExerciseCatalog] {
            exerciseIDs.compactMap { id in catalog.first { $0.id == id } }
        }
    }

    /// Up to one decimal without a trailing zero: "3", "3.5", "21.1".
    static func number(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        return rounded == rounded.rounded() ? String(Int(rounded)) : String(format: "%.1f", rounded)
    }
}

/// "Add to your week": pick what (a run, a ride, a swim, a lift, a routine at
/// home, an activity or a saved workout), say how far or how long for a run,
/// ride or swim, pick the weekdays and, if wanted, a time to be reminded,
/// then add. Opened from the Plan tab with no day chosen, or from a weekday
/// with that day chosen.
struct PlanComposerView: View {
    @ObservedObject var sync: SyncModel
    /// Closes the whole flow once the week holds the new item.
    var onFinished: () -> Void
    /// Shows Cancel; false when pushed from a weekday sheet, which has Back.
    var isRoot = false

    @State private var kind: PlanComposer.Kind
    @State private var days: Set<String>
    @State private var measure = PlanComposer.RunMeasure.distance
    @State private var distance = PlanComposer.defaultDistance
    @State private var minutes = PlanComposer.defaultMinutes
    @State private var typedName = ""
    @State private var savedID: String?
    /// An activity goes alongside what the chosen days already hold, unless
    /// the member turns this off to swap it in.
    @State private var alongside = true
    @State private var saving = false
    /// The workout an earlier attempt made, so a retry doesn't make another.
    @State private var createdID: String?
    @State private var stepsSaved = false
    @State private var authority: Authority?
    @State private var hadUncertainAttempt = false
    @State private var needsLibraryReview = false
    @State private var stepsVersion: Int?
    @State private var needsRunReview = false
    @State private var creatingLift = false
    @State private var liftID: String?
    @State private var planning: Planning?
    /// What a routine at home starts from.
    @State private var homeStart = PlanComposer.HomeStart.core
    @State private var logOnlyConfirmed = false
    /// An optional time of day, set on every chosen day, with a reminder.
    @State private var timed = false
    @State private var timeOfDay = Date()
    /// The tiles' order, the member's most frequent first, fixed while the
    /// sheet is open so a sync doesn't move a tile under a finger.
    @State private var order: [PlanComposer.Kind]
    @FocusState private var nameFocused: Bool

    private let unit = RunDistanceUnit.preferred()

    private struct Authority { let planID: String; let version: Int; let name: String; let exerciseIDs: [String] }
    private struct Planning { let workoutID: String; let slot: TemplateExercise; let version: Int }

    init(sync: SyncModel, kind: PlanComposer.Kind = .run, days: Set<String> = [],
         isRoot: Bool = false, onFinished: @escaping () -> Void) {
        _sync = ObservedObject(wrappedValue: sync)
        _kind = State(initialValue: kind)
        _days = State(initialValue: days)
        let amounts = PlanComposer.amounts(kind, unit: RunDistanceUnit.preferred())
        _measure = State(initialValue: amounts.defaultMeasure)
        _distance = State(initialValue: amounts.defaultDistance)
        _minutes = State(initialValue: amounts.defaultMinutes)
        _timeOfDay = State(initialValue: Self.date(minutes: PlanComposer.defaultTimeOfDay(for: kind)))
        _order = State(initialValue: PlanComposer.ranked(for: sync))
        self.isRoot = isRoot
        self.onFinished = onFinished
    }

    var body: some View {
        Group {
            if let planning {
                RunPlanEditorView(sync: sync, dayID: planning.workoutID, slot: planning.slot,
                                  expectedVersion: planning.version, onFinished: onFinished)
                    .navigationBarBackButtonHidden(true)
            } else {
                form
            }
        }
    }

    // MARK: - Form

    /// Once a request is out, what it creates is fixed until it lands.
    private var locked: Bool { authority != nil || createdID != nil || liftID != nil }
    private var busy: Bool { saving || sync.isRoutineMutationInFlight || sync.plan == nil }

    private var form: some View {
        Form {
            // The tiles sit in a header, not a row: a row's rounded corners
            // clipped the outer tiles.
            Section {
            } header: {
                kindPicker
                    .textCase(nil)
                    .padding(.vertical, 4)
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            }
            switch kind {
            case .run: runSections
            case .ride, .swim: enduranceSections
            case .lift: liftSection
            case .home: homeSections
            case .sport: sportSection
            case .saved: savedSection
            }
            daysSection
            timeSection
        }
        .scrollContentBackground(.hidden)
        // The add button stays in view below the form: with seven tiles and
        // a time, it would otherwise sit below the fold on an iPhone.
        .safeAreaInset(edge: .bottom, spacing: 0) { saveBar }
        .background(Theme.background)
        .navigationTitle("Add to your week")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(saving)
        .toolbar {
            if isRoot {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onFinished() }
                        .disabled(saving)
                        .accessibilityIdentifier("composer.cancel")
                }
            }
        }
        .tint(Theme.accent)
        // The reviewed routine lands on its days after creation closes;
        // scheduling never races an exercise edit or recreates a saved ID.
        .sheet(isPresented: $creatingLift, onDismiss: scheduleCreatedLift) {
            if kind == .home {
                CreateWorkoutView(sync: sync, onCreated: { liftID = $0 },
                                  initialName: homeName,
                                  initialExercises: homeStart.exercises(in: sync.catalog),
                                  equipmentFree: true,
                                  initialCircuit: homeStart == .bodyweight,
                                  completionTitle: PlanComposer.addTitle(days),
                                  scheduleSummary: creationScheduleSummary)
            } else {
                CreateWorkoutView(sync: sync, onCreated: { liftID = $0 },
                                  completionTitle: PlanComposer.addTitle(days),
                                  scheduleSummary: creationScheduleSummary)
            }
        }
        .onChange(of: kind) { _, newKind in
            logOnlyConfirmed = false
            // Each kind starts from its own usual amount.
            let amounts = PlanComposer.amounts(newKind, unit: unit)
            measure = amounts.defaultMeasure
            distance = amounts.defaultDistance
            minutes = amounts.defaultMinutes
            if !timed { timeOfDay = Self.date(minutes: PlanComposer.defaultTimeOfDay(for: newKind)) }
        }
        .onChange(of: typedName) { _, _ in logOnlyConfirmed = false }
        .interactiveDismissDisabled(saving)
    }

    /// The add button, with the name note and any save error above it so
    /// they show where the member is looking.
    private var saveBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = sync.loadError {
                Text(error).font(.footnote).foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("composer.error")
                if needsLibraryReview {
                    Text("The first try may have saved. Check the Workouts side before making it again.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                if needsRunReview {
                    Text("The run is saved, but it changed while its distance or time was going on. Open it from Workouts to check it.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                if liftID != nil {
                    Text("Your workout is saved. Try again to put it on the selected days; this won't create another workout.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
            }
            if let note = nameNote {
                Text(note).font(.footnote).foregroundStyle(nameTaken ? Theme.danger : Theme.muted)
            }
            Button(buttonTitle) { save() }
                .buttonStyle(WorkoutPrimaryButtonStyle())
                .disabled(!canSave)
                .accessibilityIdentifier("composer.save")
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(Theme.background)
    }

    /// What to add: four tiles, then three, the member's most frequent
    /// first and Saved last. Each tile has a fixed icon height so the
    /// names line up.
    private var kindPicker: some View {
        VStack(spacing: 8) {
            ForEach(Array(PlanComposer.Kind.layout(order).enumerated()), id: \.offset) { _, row in
                HStack(spacing: 8) {
                    ForEach(row) { option in kindTile(option) }
                }
            }
        }
    }

    private func kindTile(_ option: PlanComposer.Kind) -> some View {
        let selected = option == kind
        return Button {
            kind = option
            nameFocused = false
        } label: {
            VStack(spacing: 6) {
                Image(systemName: option.glyph).font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(height: 24)
                Text(option.title).font(Theme.mono(13, .bold)).foregroundStyle(Theme.text)
                    .lineLimit(1).minimumScaleFactor(0.75)
            }
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, minHeight: 68)
            .background(selected ? Theme.accent.opacity(0.12) : Theme.surface,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(selected ? Theme.accent : Color.clear, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(locked || saving)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityIdentifier("composer.kind.\(option.rawValue)")
    }

    @ViewBuilder private var runSections: some View {
        Section {
            Picker("Plan by", selection: $measure) {
                ForEach(PlanComposer.RunMeasure.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .disabled(locked)
            .accessibilityIdentifier("composer.run.measure")
            switch measure {
            case .distance, .time:
                amountRows
            case .steps:
                Text("Next you plan its steps: a warm-up, intervals or a steady run, each with an optional pace or heart rate range.")
                    .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                ideas(PlannedRunCreation.suggestions)
            }
        } header: {
            Text(measure == .steps ? "Plan it step by step" : measure == .distance ? "How far" : "How long")
        }
        nameSection(placeholder: autoRunName)
    }

    /// A ride or a swim: how far or how long, then its name. It is kept as
    /// an activity, so Today shows it with Log, and a ride or swim synced
    /// from a watch, bike computer or Zwift that day counts it done.
    @ViewBuilder private var enduranceSections: some View {
        Section {
            Picker("Plan by", selection: $measure) {
                Text(PlanComposer.RunMeasure.distance.title).tag(PlanComposer.RunMeasure.distance)
                Text(PlanComposer.RunMeasure.time.title).tag(PlanComposer.RunMeasure.time)
            }
            .pickerStyle(.segmented)
            .disabled(locked)
            .accessibilityIdentifier("composer.endurance.measure")
            amountRows
        } header: {
            Text(measure == .distance ? "How far" : "How long")
        } footer: {
            Text("On the day, Today shows it with a button to log it. A \(kind == .swim ? "swim" : "ride") synced from your watch, bike computer or Zwift counts too.")
        }
        nameSection(placeholder: autoEnduranceName)
    }

    /// The distance or time stepper and its shortcuts, in the kind's units.
    @ViewBuilder private var amountRows: some View {
        let amounts = PlanComposer.amounts(kind, unit: unit)
        if measure == .distance {
            amountRow(value: "\(PlanComposer.number(distance))", unitLabel: amounts.distanceLabel,
                      minus: { distance = max(amounts.distanceRange.lowerBound, distance - amounts.distanceStep) },
                      plus: { distance = min(amounts.distanceRange.upperBound, distance + amounts.distanceStep) })
            chips(amounts.distanceChoices.map { ($0, PlanComposer.number($0)) },
                  selected: distance) { distance = $0 }
        } else {
            amountRow(value: "\(minutes)", unitLabel: "min",
                      minus: { minutes = max(PlanComposer.minuteRange.lowerBound, minutes - PlanComposer.minuteStep) },
                      plus: { minutes = min(PlanComposer.minuteRange.upperBound, minutes + PlanComposer.minuteStep) })
            chips(amounts.minuteChoices.map { ($0, "\($0)") }, selected: minutes) { minutes = $0 }
        }
    }

    private var liftSection: some View {
        Section {
            Text("Pick the exercises next. It goes on the days below once you save it.")
                .font(Theme.mono(13)).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        } header: {
            Text("A workout with sets")
        }
    }

    /// A routine at home: core, stretching or a bodyweight circuit to start
    /// from, or exercises of the member's own. It is saved with its
    /// exercises, so Today starts it set by set, with holds timed.
    @ViewBuilder private var homeSections: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(PlanComposer.HomeStart.allCases) { start in
                        let on = start == homeStart
                        Button(start.title) { homeStart = start }
                            .font(Theme.mono(13, .bold))
                            .foregroundStyle(on ? Theme.onAccent : Theme.text)
                            .padding(.horizontal, 12).frame(minHeight: 36)
                            .background(on ? Theme.accent : Theme.surface2, in: Capsule())
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(on ? [.isSelected] : [])
                            .accessibilityIdentifier("composer.home.\(start.rawValue)")
                    }
                }
                .padding(.vertical, 2)
            }
            .disabled(locked || saving)
            let exercises = homeStart.exercises(in: sync.catalog)
            if exercises.isEmpty {
                Text("Pick exercises next: core, stretches, push-ups and squats, all with no equipment.")
                    .font(Theme.mono(13)).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(exercises) { exercise in
                    HStack {
                        Text(exercise.name).font(Theme.mono(14, .bold)).foregroundStyle(Theme.text)
                        Spacer()
                        Text(ExerciseSearchPolicy.initialTargets(for: exercise))
                            .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        } header: {
            Text("Core, stretching, bodyweight")
        } footer: {
            Text("Review the exercises, sets or rounds, work times and rests before saving. Today guides each set with timers.")
        }
        nameSection(placeholder: homeStart.defaultName)
    }

    @ViewBuilder private var sportSection: some View {
        Section {
            TextField("Soccer, yoga, a walk", text: $typedName)
                .textInputAutocapitalization(.words)
                .submitLabel(.done)
                .focused($nameFocused)
                .disabled(locked || saving)
                .accessibilityIdentifier("composer.name")
            ideas(PlannedActivity.suggestions)
            if let routine = suggestedHomeRoutine {
                Button("Follow exercises with timers") {
                    homeStart = routine
                    typedName = ""
                    kind = .home
                }
                .frame(minHeight: 44)
                .disabled(locked || saving)
                .accessibilityIdentifier("composer.core.withTimers")
                Button {
                    logOnlyConfirmed = true
                } label: {
                    Label("Just schedule and log it", systemImage: logOnlyConfirmed ? "checkmark.circle.fill" : "circle")
                }
                .frame(minHeight: 44)
                .disabled(locked || saving)
                .accessibilityIdentifier("composer.core.logOnly")
                Text("Choose whether you want a guided routine or a reminder for an activity you do on your own.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
        } header: {
            Text("What do you play or do?")
        } footer: {
            Text("On the day, Today shows it with a button to log it once it's done. For core or stretching with exercises and times, use At home.")
        }
    }

    private var savedSection: some View {
        Section {
            let workouts = savedChoices
            if workouts.isEmpty {
                Text("Nothing saved yet. Make something new above instead.")
                    .font(Theme.mono(13)).foregroundStyle(Theme.muted)
            }
            ForEach(workouts) { workout in
                let selected = savedID == workout.id
                Button { savedID = workout.id } label: {
                    HStack(spacing: 12) {
                        PlanItemLabel(workout: workout, plan: sync.plan)
                        Spacer(minLength: 0)
                        if selected {
                            Image(systemName: "checkmark")
                                .font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.accent)
                                .accessibilityHidden(true)
                        }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(saving)
                .accessibilityAddTraits(selected ? [.isSelected] : [])
                .accessibilityIdentifier("composer.saved.\(workout.id)")
            }
        } header: {
            Text("Use one you have")
        }
    }

    /// The chosen workout when it is already known (a saved one or a
    /// matching sport), so the notes can skip days that already hold it.
    private var knownChoiceID: String? {
        switch kind {
        case .saved: return savedID
        case .sport, .ride, .swim: return createdID ?? existingSport?.id
        case .run: return createdID
        case .lift, .home: return liftID
        }
    }

    /// The days picked include one that already holds something else.
    private var daysHoldOther: Bool {
        WorkoutLibraryPolicy.weekRows(plan: sync.plan).contains {
            days.contains($0.weekdayKey) && $0.workoutID != nil && $0.workoutID != knownChoiceID
        }
    }

    private var addsAlongside: Bool { alongside }

    private var daysNote: String {
        if addsAlongside, let note = ScheduleExtras.alongsideNote(days, with: knownChoiceID, plan: sync.plan) {
            return note
        }
        return PlanComposer.replacing(days, with: knownChoiceID, plan: sync.plan)
            ?? "Repeats every week. Outlined days already have something; picking one swaps it."
    }

    private var daysSection: some View {
        Section {
            HStack(spacing: 6) {
                ForEach(PlanSchedule.weekdayKeys, id: \.self) { key in
                    let on = days.contains(key)
                    let holds = WorkoutLibraryPolicy.weekRows(plan: sync.plan)
                        .first { $0.weekdayKey == key }?.workoutID != nil
                    Button {
                        if on { days.remove(key) } else { days.insert(key) }
                    } label: {
                        Text(String(key.prefix(1)).uppercased())
                            .font(Theme.mono(13, .bold))
                            .foregroundStyle(on ? Theme.onAccent : Theme.muted)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(on ? Theme.accent : Theme.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(holds && !on ? Theme.dim : Color.clear, lineWidth: 1))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(saving)
                    .accessibilityLabel(WorkoutLibraryPolicy.weekdayNames[key] ?? key)
                    .accessibilityAddTraits(on ? [.isSelected] : [])
                    .accessibilityIdentifier("composer.day.\(key)")
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            if daysHoldOther {
                Toggle("Keep what's on those days", isOn: $alongside)
                    .font(Theme.mono(14))
                    .tint(Theme.accent)
                    .disabled(saving)
                    .accessibilityIdentifier("composer.alongside")
            }
        } header: {
            Text("Which days")
        } footer: {
            Text(daysNote)
        }
    }

    /// An optional time of day for the new item on each chosen day. With
    /// one, the app reminds the member then (P19); without, nothing changes.
    private var timeSection: some View {
        Section {
            Toggle("Set a time", isOn: $timed)
                .font(Theme.mono(14))
                .tint(Theme.accent)
                .disabled(saving)
                .accessibilityIdentifier("composer.time.toggle")
            if timed {
                DatePicker("Time", selection: $timeOfDay, displayedComponents: .hourAndMinute)
                    .font(Theme.mono(14))
                    .disabled(saving)
                    .accessibilityIdentifier("composer.time.picker")
                ScheduleReminderPermissionView()
            }
        } header: {
            Text("Time · optional")
        } footer: {
            Text(timed ? "Shows on the plan and Today. Notification permission is separate."
                       : "Give this workout its own time. You can also set one later from the day.")
        }
    }

    private func nameSection(placeholder: String) -> some View {
        Section {
            TextField(placeholder, text: $typedName)
                .textInputAutocapitalization(.sentences)
                .submitLabel(.done)
                .focused($nameFocused)
                .disabled(locked || saving)
                .accessibilityIdentifier("composer.name")
        } header: {
            Text("Name")
        }
    }

    private func amountRow(value: String, unitLabel: String,
                           minus: @escaping () -> Void, plus: @escaping () -> Void) -> some View {
        HStack {
            stepButton("minus", label: "Less", action: minus)
            Spacer()
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(value).font(Theme.display(44)).foregroundStyle(Theme.text)
                Text(unitLabel).font(Theme.mono(17, .bold)).foregroundStyle(Theme.muted)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("composer.run.amount")
            Spacer()
            stepButton("plus", label: "More", action: plus)
        }
        .disabled(locked || saving)
    }

    private func stepButton(_ glyph: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: glyph)
                .font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.accent)
                .frame(width: 44, height: 44)
                .background(Theme.surface2, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func chips<Value: Equatable>(_ options: [(Value, String)], selected: Value,
                                         choose: @escaping (Value) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                    let on = option.0 == selected
                    Button(option.1) { choose(option.0) }
                        .font(Theme.mono(14, .bold))
                        .foregroundStyle(on ? Theme.onAccent : Theme.text)
                        .frame(minWidth: 44, minHeight: 36)
                        .padding(.horizontal, 6)
                        .background(on ? Theme.accent : Theme.surface2, in: Capsule())
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? [.isSelected] : [])
                        .accessibilityIdentifier("composer.chip.\(option.1)")
                }
            }
            .padding(.vertical, 2)
        }
        .disabled(locked || saving)
    }

    private func ideas(_ names: [String]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(names, id: \.self) { idea in
                    let on = cleanTyped == idea
                    Button(idea) { typedName = idea }
                        .font(Theme.mono(13, .bold))
                        .padding(.horizontal, 12).frame(minHeight: 36)
                        .background(on ? Theme.accent.opacity(0.18) : Theme.surface2)
                        .clipShape(Capsule())
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("composer.idea.\(idea)")
                }
            }
            .padding(.vertical, 2)
        }
        .disabled(locked || saving)
    }

    // MARK: - What gets saved

    private var cleanTyped: String { typedName.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var autoRunName: String {
        PlanComposer.runName(measure: measure, distance: distance, minutes: minutes, unit: unit)
    }

    private var autoEnduranceName: String {
        PlanComposer.enduranceName(kind, measure: measure, distance: distance, minutes: minutes, unit: unit)
    }

    /// The name a routine at home is saved under.
    private var homeName: String { cleanTyped.isEmpty ? homeStart.defaultName : cleanTyped }

    /// The name a new run, ride, swim or activity is saved under.
    private var newName: String {
        switch kind {
        case .run: return cleanTyped.isEmpty ? autoRunName : cleanTyped
        case .ride, .swim: return PlanComposer.enduranceName(kind, typed: cleanTyped, auto: autoEnduranceName)
        case .sport: return cleanTyped
        case .home: return homeName
        case .lift, .saved: return ""
        }
    }

    /// A routine at home under a name another workout already has; it
    /// would read as that one on the plan and Today.
    private var homeNameTaken: Workout? {
        guard kind == .home, liftID == nil else { return nil }
        return PlannedActivity.existing(named: homeName, in: sync.plan)
    }

    private var savedChoices: [Workout] {
        WorkoutLibraryPolicy.choices(plan: sync.plan, date: sync.todayString)
    }

    /// A matching saved run counts only before any create request is out:
    /// once one is pending, a run seen under that name may be the request's
    /// own, so a retry goes back through the create and its review.
    private var runMatch: PlannedRunCreation.Match {
        guard kind == .run, createdID == nil, authority == nil else { return .available }
        return PlannedRunCreation.match(named: newName, in: sync.plan)
    }

    /// An activity, ride or swim already saved under this name is used
    /// instead of making another.
    private var existingSport: Workout? {
        guard kind == .sport || kind.isEndurance, createdID == nil, authority == nil else { return nil }
        return PlannedActivity.existing(named: newName, in: sync.plan)
    }

    private var nameTaken: Bool {
        if case .taken = runMatch { return true }
        return homeNameTaken != nil
    }

    private var nameNote: String? {
        switch runMatch {
        case let .run(existing):
            return measure == .steps
                ? "You already have \(existing.name), so this uses it and opens its steps."
                : "You already have \(existing.name), so this uses it as it is."
        case let .taken(existing):
            return "\(existing.name) is already a workout that isn't a run. Pick another name."
        case .available:
            if let existingSport { return "You already have \(existingSport.name), so this uses it instead of making another." }
            if kind.isEndurance, !cleanTyped.isEmpty, newName != cleanTyped {
                return "Saved as \(newName), so a \(kind == .swim ? "swim" : "ride") that day counts."
            }
            if let homeNameTaken {
                return "\(homeNameTaken.name) is already in your workouts. Pick another name, or use it from Saved."
            }
            return nil
        }
    }

    private var canSave: Bool {
        guard !busy, !needsLibraryReview, !needsRunReview, !days.isEmpty else { return false }
        switch kind {
        case .run, .home: return !nameTaken
        case .sport: return !newName.isEmpty && (suggestedHomeRoutine == nil || logOnlyConfirmed)
        case .ride, .swim: return !newName.isEmpty
        case .saved: return savedID != nil
        case .lift: return true
        }
    }

    private var suggestedHomeRoutine: PlanComposer.HomeStart? {
        guard kind == .sport else { return nil }
        switch ExerciseSearchPolicy.normalized(cleanTyped) {
        case "core": return .core
        case "stretching": return .stretching
        default: return nil
        }
    }

    private var creationScheduleSummary: String {
        let names = PlanSchedule.weekdayKeys.filter { days.contains($0) }
            .map { WorkoutLibraryPolicy.weekdayNames[$0] ?? $0 }
        let time = chosenMinutes.map { " at \(ScheduleTimes.display($0))" } ?? ""
        let existing = addsAlongside ? " Keeps the workouts already on those days." : ""
        return "Every \(ScheduleExtras.spokenList(names))\(time).\(existing)"
    }

    private var buttonTitle: String {
        if saving { return "Saving…" }
        if locked { return "Try again" }
        if days.isEmpty { return PlanComposer.addTitle(days) }
        if kind == .lift { return "Choose exercises" }
        if kind == .home { return homeStart.exercises(in: sync.catalog).isEmpty ? "Choose exercises" : "Review exercises" }
        if kind == .run && measure == .steps { return "Add and plan steps" }
        return PlanComposer.addTitle(days)
    }

    private func save() {
        guard canSave else { return }
        nameFocused = false
        switch kind {
        case .lift, .home:
            // A lift or routine already made only needs its days again.
            if let liftID { scheduleLift(liftID) } else { creatingLift = true }
        case .saved:
            guard let savedID else { return }
            saving = true
            Task {
                defer { saving = false }
                if await schedule(savedID) { onFinished() }
            }
        case .sport, .ride, .swim:
            saving = true
            Task {
                defer { saving = false }
                if createdID == nil, let existingSport {
                    if await schedule(existingSport.id) { onFinished() }
                    return
                }
                guard let id = await create(exerciseIDs: []) else { return }
                if await schedule(id) { onFinished() }
            }
        case .run:
            saving = true
            Task {
                defer { saving = false }
                if createdID == nil, case let .run(existing) = runMatch {
                    guard await schedule(existing.id) else { return }
                    if measure == .steps { openSteps(existing.id) } else { onFinished() }
                    return
                }
                guard let id = await create(exerciseIDs: [RunPlan.exerciseID]) else { return }
                if !stepsSaved, let plan = PlanComposer.runPlan(measure: measure, distance: distance,
                                                                minutes: minutes, unit: unit) {
                    // A retry keeps the version the first step write saw, so
                    // a run changed elsewhere is a conflict to review, never
                    // overwritten by this draft.
                    // The create can land while its refresh fails; fetch the
                    // plan once more before giving up, keeping the created ID.
                    if PlannedRunCreation.runSlot(in: sync.workout(id: id)) == nil { await sync.load() }
                    guard let slot = PlannedRunCreation.runSlot(in: sync.workout(id: id)) else {
                        if sync.loadError == nil { sync.loadError = "The run is saved but didn't load yet. Try again." }
                        return
                    }
                    guard let version = stepsVersion ?? sync.plan?.version else { return }
                    stepsVersion = version
                    guard await sync.updateRunSteps(dayID: id, teID: slot.id, steps: plan,
                                                    expectedVersion: version) else {
                        if let current = sync.plan?.version, current != version { needsRunReview = true }
                        return
                    }
                }
                stepsSaved = true
                guard await schedule(id) else { return }
                if measure == .steps { openSteps(id) } else { onFinished() }
            }
        }
    }

    /// Makes the run or sport once. A retry keeps the first request's plan
    /// version, so a reply lost after the save can't quietly make a second.
    private func create(exerciseIDs: [String]) async -> String? {
        if let createdID { return createdID }
        guard let plan = sync.plan else { return nil }
        let request = authority ?? Authority(planID: plan.id, version: plan.version,
                                             name: newName, exerciseIDs: exerciseIDs)
        authority = request
        switch await sync.createLibraryWorkout(name: request.name, exerciseIDs: request.exerciseIDs,
            expectedPlanID: request.planID, expectedVersion: request.version) {
        case let .created(id):
            createdID = id
            return id
        case .needsReview:
            if hadUncertainAttempt { needsLibraryReview = true } else { authority = nil }
            return nil
        case .retrySameRequest:
            hadUncertainAttempt = true
            return nil
        }
    }

    /// Puts the workout on every chosen day in one write, at the plan version
    /// on screen, so a week changed elsewhere is a conflict to review.
    private func schedule(_ workoutID: String) async -> Bool {
        let timeOfDayMinutes = chosenMinutes
        // Permission is handled explicitly in the form; saving a time never
        // waits for an unrelated permission prompt or discards its answer.
        guard let plan = sync.plan else { return false }
        if addsAlongside {
            let fullDays = ScheduleExtras.fullDays(adding: workoutID, to: days, plan: plan)
            if !fullDays.isEmpty {
                let names = fullDays.map { WorkoutLibraryPolicy.weekdayNames[$0] ?? $0 }
                sync.loadError = "\(ScheduleExtras.spokenList(names)) already \(names.count == 1 ? "has" : "have") \(ScheduleExtras.maxPerDay) extra workouts. Take one off first."
                return false
            }
            let write = ScheduleExtras.adding(workoutID, to: days, plan: plan)
            return await sync.saveRecurringSchedule(
                write.week, extras: write.extras,
                times: PlanComposer.times(timeOfDayMinutes, for: workoutID, on: days, week: write.week,
                                          extras: write.extras, plan: plan),
                expectedPlanID: plan.id, expectedVersion: plan.version)
        }
        let week = PlanComposer.week(plan, setting: days, to: workoutID)
        return await sync.saveRecurringSchedule(
            week,
            times: PlanComposer.times(timeOfDayMinutes, for: workoutID, on: days, week: week, extras: nil, plan: plan),
            expectedPlanID: plan.id, expectedVersion: plan.version)
    }

    /// The chosen time of day as minutes after midnight, or nil for none.
    private var chosenMinutes: Int? {
        guard timed else { return nil }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: timeOfDay)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }

    /// Today at `minutes` after midnight, for the time picker.
    static func date(minutes: Int) -> Date {
        let today = Calendar.current.startOfDay(for: Date())
        return Calendar.current.date(byAdding: .minute, value: minutes, to: today) ?? today
    }

    private func scheduleCreatedLift() {
        guard let id = liftID else { return }
        scheduleLift(id)
    }

    /// The lift keeps its ID until its days are saved, so Try again retries
    /// the week write instead of building the workout a second time.
    private func scheduleLift(_ id: String) {
        saving = true
        Task {
            defer { saving = false }
            // Creation can be acknowledged while its refresh fails. Recover
            // the saved identity before deriving a new schedule write.
            if sync.workout(id: id) == nil { await sync.load() }
            guard sync.workout(id: id) != nil else {
                sync.loadError = "Your workout is saved, but couldn't be loaded to schedule it. Try again."
                return
            }
            if await schedule(id) {
                liftID = nil
                onFinished()
            }
        }
    }

    /// The run is on its days; plan its steps next. If the refreshed plan
    /// doesn't hold it yet, close: the week shows it and it can be planned
    /// from the workout later.
    private func openSteps(_ workoutID: String) {
        guard let slot = PlannedRunCreation.runSlot(in: sync.workout(id: workoutID)),
              let version = sync.plan?.version else {
            onFinished()
            return
        }
        planning = Planning(workoutID: workoutID, slot: slot, version: version)
    }
}
