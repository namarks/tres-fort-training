import Charts
import SwiftUI

/// "Train for an event" (docs/plans/progressive-plans P3): name the event and
/// where you start, see the weeks the rules lay out, change a rule and they
/// redraw, then save them as the block. No AI: the server applies fixed rules.
struct EventBuildSheet: View {
    @ObservedObject var sync: SyncModel
    @Environment(\.dismiss) private var dismiss
    @State private var request: EventBuildRequest
    @State private var eventDate: Date
    @State private var preview: EventBuildPreview?
    /// The request the shown preview answers. Saving sends exactly it, and
    /// only while the inputs still match, so the weeks saved are the weeks shown.
    @State private var previewed: EventBuildRequest?
    @State private var failure: String?
    @State private var loading = false
    @State private var showsWeeks = false
    @State private var saving = false

    /// "Keep building, no date": no event, a length and a ceiling.
    private let keepBuilding: Bool

    init(sync: SyncModel, keepBuilding: Bool = false) {
        _sync = ObservedObject(wrappedValue: sync)
        self.keepBuilding = keepBuilding
        let today = sync.todayString
        let date = ProgramEditing.addingDays(16 * 7 - 1, to: ProgramEditing.monday(onOrBefore: today) ?? today) ?? today
        var request = EventBuildRequest(
            name: "", date: date, distance: .marathon,
            longRunWeekday: EventBuilding.longRunWeekday(in: sync.plan) ?? "sun",
            today: today, unit: RunDistanceUnit.preferred())
        if keepBuilding { request.openWeeks = 12 }
        _request = State(initialValue: request)
        _eventDate = State(initialValue: CalendarProjection.date(from: date) ?? Date())
    }

    private var unit: RunDistanceUnit { request.unit }
    private var dateRange: ClosedRange<Date> {
        let today = CalendarProjection.date(from: sync.todayString) ?? Date()
        let last = CalendarProjection.date(from: ProgramEditing.addingDays(51 * 7, to: sync.todayString) ?? "")
            ?? today.addingTimeInterval(51 * 7 * 86_400)
        return today...last
    }

    var body: some View {
        NavigationStack {
            eventForm
                .navigationDestination(isPresented: $showsWeeks) { weeksView }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                    }
                }
        }
        // Rules redraw the weeks as they change; a quick run of taps sends one request.
        .task(id: request) {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await refresh()
        }
        .onChange(of: eventDate) { _, value in request.date = CalendarProjection.dateString(value) }
        // A goal time belongs to its distance: a new distance starts from its own.
        .onChange(of: request.distance) { _, distance in
            if request.goalTimeSeconds != nil { request.goalTimeSeconds = distance.suggestedGoalSeconds }
        }
        // A plan changed elsewhere (a sync, another device) lays the weeks out again.
        .onChange(of: sync.plan?.version) { _, _ in Task { await refresh() } }
    }

    // MARK: The event and where you start

    private var eventForm: some View {
        Form {
            if keepBuilding {
                Section {
                    Picker("Length", selection: Binding(
                        get: { request.openWeeks ?? 12 },
                        set: { request.openWeeks = $0 }
                    )) {
                        ForEach(EventBuilding.openWeekChoices, id: \.self) { Text("\($0) weeks").tag($0) }
                    }
                    .accessibilityIdentifier("plan.keep.length")
                    Stepper(value: distanceBinding(\.peakMeters, fallback: preview?.rules.peak_m), in: 1...maxUnits) {
                        LabeledContent("Long run up to",
                                       value: EventBuilding.distanceText(request.peakMeters ?? preview?.rules.peak_m ?? 16_093, unit))
                    }
                    .accessibilityIdentifier("plan.keep.ceiling")
                } header: {
                    Text("Keep building")
                } footer: {
                    Text("Three harder weeks, then an easier one. The long run steps up until it reaches this, then holds there. "
                         + "When the weeks end, Your week comes back.")
                }
            }
            if !keepBuilding {
                Section("The event") {
                    TextField("Name, such as Spring Marathon", text: $request.name)
                        .accessibilityIdentifier("plan.event.name")
                    DatePicker("Date", selection: $eventDate, in: dateRange, displayedComponents: .date)
                        .accessibilityIdentifier("plan.event.date")
                    Picker("Distance", selection: $request.distance) {
                        ForEach(EventBuilding.Distance.allCases) { Text($0.title).tag($0) }
                    }
                    .accessibilityIdentifier("plan.event.distance")
                }
                Section {
                    Picker("Aim", selection: goalBinding) {
                        Text("Just finish").tag(false)
                        Text("Goal time").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("plan.event.style")
                    if let goal = request.goalTimeSeconds {
                        LabeledContent("Goal time") {
                            HStack(spacing: 4) {
                                Picker("Hours", selection: goalPart(goal, hours: true)) {
                                    ForEach(0..<10) { Text("\($0) h").tag($0) }
                                }
                                Picker("Minutes", selection: goalPart(goal, hours: false)) {
                                    ForEach(0..<60) { Text(String(format: "%02d min", $0)).tag($0) }
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(Theme.text)
                        }
                        .accessibilityIdentifier("plan.event.goalTime")
                    }
                } header: {
                    Text("How you'll run it")
                } footer: {
                    Text(styleFooter)
                }
            }
            Section {
                Picker("Long run", selection: $request.longRunWeekday) {
                    ForEach(PlanSchedule.weekdayKeys, id: \.self) { key in
                        Text((WorkoutLibraryPolicy.weekdayNames[key] ?? key) + "s").tag(key)
                    }
                }
                .accessibilityIdentifier("plan.event.longRunDay")
                Picker("Workout day", selection: workoutDayBinding) {
                    Text("None").tag("none")
                    ForEach(PlanSchedule.weekdayKeys, id: \.self) { key in
                        Text((WorkoutLibraryPolicy.weekdayNames[key] ?? key) + "s").tag(key)
                    }
                }
                .accessibilityIdentifier("plan.event.workoutDay")
                Stepper(value: distanceBinding(\.longRunNowMeters, fallback: preview?.rules.long_run_now_m),
                        in: 1...maxUnits) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Longest run lately")
                            Text(startHint).font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 8)
                        Text(EventBuilding.distanceText(longRunNow, unit)).font(Theme.mono(15, .bold))
                    }
                }
                .accessibilityIdentifier("plan.event.longestRun")
                if let preview {
                    LabeledContent("Starts", value: ProgramEditing.spokenDate(preview.start))
                }
            } header: {
                Text("Where you start")
            } footer: {
                Text(formFooter)
            }
            if let failure {
                Section {
                    Text(failure).foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("plan.event.error")
                }
            }
            Section {
                Button { showsWeeks = true } label: {
                    Text(preview.map { "See the \($0.weeks.count == 1 ? "week" : "\($0.weeks.count) weeks")" }
                         ?? "See the weeks")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(WorkoutPrimaryButtonStyle())
                .disabled(preview == nil || failure != nil)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                .accessibilityIdentifier("plan.event.seeWeeks")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(keepBuilding ? "Keep building" : "Train for an event")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var maxUnits: Int { Int(EventBuilding.maxMeters / unit.meters) }
    private var longRunNow: Double { request.longRunNowMeters ?? preview?.rules.long_run_now_m ?? 5_000 }

    private var startHint: String {
        if request.longRunNowMeters != nil { return "Set by you" }
        if preview?.rules.longest_recent_m != nil { return "From your last 4 weeks" }
        return "No runs in your last 4 weeks"
    }

    private var styleFooter: String {
        guard let goal = request.goalTimeSeconds else {
            return "Easy long runs with strides, tempo and a top session on your workout day."
        }
        let pace = preview?.rules.goal_pace_s_per_km.map { ", goal pace \(EventBuilding.paceText($0, unit))" } ?? ""
        let how = request.distance.meters >= 20_000
            ? "Long runs finish at goal pace, and the peak weeks practice it."
            : "Peak-week intervals run near goal pace."
        return "\(EventBuilding.goalTimeText(goal))\(pace). " + how
    }

    /// "Goal time" switches a suggested time for the distance on; "Just finish" clears it.
    private var goalBinding: Binding<Bool> {
        Binding(
            get: { request.goalTimeSeconds != nil },
            set: { request.goalTimeSeconds = $0 ? (request.goalTimeSeconds ?? request.distance.suggestedGoalSeconds) : nil }
        )
    }

    private func goalPart(_ goal: Int, hours: Bool) -> Binding<Int> {
        Binding(
            get: { hours ? goal / 3_600 : goal % 3_600 / 60 },
            set: { value in
                let h = hours ? value : goal / 3_600
                let m = hours ? goal % 3_600 / 60 : value
                // A goal time of zero isn't one: keep at least a minute.
                request.goalTimeSeconds = max(60, h * 3_600 + m * 60)
            }
        )
    }

    /// The workout day as set, else the day the preview suggested.
    private var workoutDayBinding: Binding<String> {
        Binding(
            get: {
                switch request.workoutDay {
                case .off?: return "none"
                case .day(let key)?: return key
                case nil: return preview?.rules.workout_weekday ?? "none"
                }
            },
            set: { request.workoutDay = $0 == "none" ? .off : .day($0) }
        )
    }

    private var formFooter: String {
        var text = "Your workout day's run changes with the weeks. Your other runs and lifts come from Your week."
        if keepBuilding { return text }
        if let preview {
            let count = preview.weeks.count
            text += count == 1 ? " Race day is this week." : " \(count) weeks to race day."
        }
        return text
    }

    // MARK: The weeks and the rules

    private var weeksView: some View {
        Form {
            if let preview {
                Section {
                    chart(preview)
                    Text(EventBuilding.phaseSpans(preview.weeks)
                        .map { "\($0.label) \($0.range)" }.joined(separator: "   "))
                        .font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        .accessibilityLabel("Weeks " + EventBuilding.phaseSpans(preview.weeks)
                            .map { "\($0.range): \($0.label)" }.joined(separator: ", "))
                } header: {
                    Text("Long run, week by week (\(unit.abbreviation))")
                } footer: {
                    if !preview.reached_peak {
                        Text(keepBuilding
                             ? "Adding at most 15% or a mile a week, the long run doesn't get there in these weeks. "
                               + "It keeps building until the block ends."
                             : "Adding at most 15% or a mile a week, the long run doesn't reach the peak by then. "
                               + "Start sooner, pick a later date or lower the peak.")
                    }
                }
                Section("Week by week") {
                    ForEach(preview.weeks.indices, id: \.self) { index in
                        weekRow(preview.weeks[index], number: index + 1)
                    }
                }
                Section {
                    Stepper(value: distanceBinding(\.peakMeters, fallback: preview.rules.peak_m), in: 1...maxUnits) {
                        LabeledContent(keepBuilding ? "Long run up to" : "Peak long run",
                                       value: EventBuilding.distanceText(request.peakMeters ?? preview.rules.peak_m, unit))
                    }
                    .accessibilityIdentifier("plan.event.peak")
                    Picker("Easier week", selection: Binding(
                        get: { request.easyEvery ?? preview.rules.easy_every },
                        set: { request.easyEvery = $0 }
                    )) {
                        ForEach(EventBuilding.easyEveryChoices, id: \.self) { Text(EventBuilding.easyEveryTitle($0)).tag($0) }
                    }
                    .accessibilityIdentifier("plan.event.easyEvery")
                    if !keepBuilding {
                        Stepper(value: Binding(
                            get: { request.taperWeeks ?? preview.rules.taper_weeks },
                            set: { request.taperWeeks = $0 }
                        ), in: EventBuilding.taperChoices) {
                            let taper = request.taperWeeks ?? preview.rules.taper_weeks
                            LabeledContent("Taper", value: taper == 1 ? "Race week" : "\(taper) weeks")
                        }
                        .accessibilityIdentifier("plan.event.taper")
                    }
                    Toggle("Shorter other runs in easier weeks", isOn: Binding(
                        get: { request.shortenOtherRuns ?? preview.rules.shorten_other_runs },
                        set: { request.shortenOtherRuns = $0 }
                    ))
                    .accessibilityIdentifier("plan.event.shortenOthers")
                } header: {
                    Text("The rules")
                } footer: {
                    Text("Change a rule and the weeks redraw. After saving, every week can still be changed by hand."
                         + (preview.replaces_block ? " This replaces the block you have now." : ""))
                }
            }
            if let error = failure ?? sync.loadError {
                Section {
                    Text(error).foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("plan.event.saveError")
                }
            }
            Section {
                Button { Task { await save() } } label: {
                    Text(preview.map { $0.weeks.count == 1 ? "Create 1 week" : "Create \($0.weeks.count) weeks" }
                         ?? "Create the weeks")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(WorkoutPrimaryButtonStyle())
                .disabled(preview == nil || previewed != request || failure != nil || loading || saving
                          || sync.isRoutineMutationInFlight || sync.plan == nil)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                .accessibilityIdentifier("plan.event.save")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(keepBuilding ? "Keep building"
                         : request.trimmedName.isEmpty ? request.distance.title : request.trimmedName)
        .navigationBarTitleDisplayMode(.inline)
    }

    /// A week's phase and the sessions that matter: the long run and the workout.
    private func weekRow(_ week: EventBuildPreview.Week, number: Int) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("Week \(number)").font(Theme.mono(13, .bold))
                Text(week.label).font(Theme.mono(13)).foregroundStyle(Theme.muted)
                Spacer(minLength: 8)
                Text(ProgramEditing.spokenDate(week.start)).font(Theme.mono(12)).foregroundStyle(Theme.dim)
            }
            if let long = EventBuilding.longRunText(week, raceMeters: request.distance.meters, unit) {
                Text(long).font(.subheadline)
            }
            if let workout = week.workout {
                Text(EventBuilding.workoutText(workout)).font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("plan.event.week.\(number)")
    }

    private func chart(_ preview: EventBuildPreview) -> some View {
        let labeled = preview.weeks.count <= 20
        return Chart(preview.weeks.indices, id: \.self) { index in
            let week = preview.weeks[index]
            if let meters = week.long_run_m {
                BarMark(x: .value("Week", "\(index + 1)"), y: .value("Long run", meters / unit.meters))
                    .foregroundStyle(barColor(week.phase))
                    .cornerRadius(3)
                    .annotation(position: .top, spacing: 2) {
                        if labeled {
                            Text(EventBuilding.distanceText(meters, unit).split(separator: " ").first.map(String.init) ?? "")
                                .font(Theme.mono(9, .bold)).foregroundStyle(Theme.muted)
                        }
                    }
                    .accessibilityLabel("Week \(index + 1), \(week.label)")
                    .accessibilityValue(EventBuilding.distanceText(meters, unit))
            }
        }
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks { _ in AxisValueLabel().font(Theme.mono(9)) }
        }
        .frame(height: 170)
        .padding(.vertical, 6)
        .accessibilityIdentifier("plan.event.chart")
    }

    /// Hard weeks stand out, easier and taper weeks recede. Orange stays for
    /// the next action, so the chart uses the text tones.
    private func barColor(_ phase: String) -> Color {
        switch phase {
        case "peak", "race", "hold": Theme.text
        case "build": Theme.text.opacity(0.7)
        case "base": Theme.muted
        default: Theme.dim
        }
    }

    // MARK: Actions

    /// A stepper over whole miles or kilometers for an optional distance rule.
    private func distanceBinding(_ path: WritableKeyPath<EventBuildRequest, Double?>, fallback: Double?) -> Binding<Int> {
        Binding(
            get: { EventBuilding.units(request[keyPath: path] ?? fallback ?? 5_000, unit) },
            set: { request[keyPath: path] = EventBuilding.meters($0, unit) }
        )
    }

    private func refresh() async {
        let sent = request
        loading = true
        defer { loading = false }
        let result = await sync.previewEventBlock(sent)
        // An answer to inputs that have changed since is dropped; the newer
        // request's own refresh follows.
        guard sent == request else { return }
        switch result {
        case .success(let next):
            preview = next
            previewed = sent
            failure = nil
        case .failure(let error):
            failure = error.message
            previewed = nil
        }
    }

    /// Saves against the version the shown weeks came from: if the plan
    /// changed since, the save conflicts and the weeks are laid out again.
    private func save() async {
        guard let preview, let previewed, previewed == request else { return }
        saving = true
        defer { saving = false }
        if await sync.saveEventBlock(previewed.resolved(by: preview), expectedVersion: preview.plan_version) {
            dismiss()
        } else {
            await refresh()
        }
    }
}
