import SwiftUI

/// Today's day as one list (app-design-pass P30). Everything the day holds,
/// the main workout, workouts and activities beside it and workouts added
/// for later, is one row each in time order. The next thing to do is the
/// one navy row, with Up next, its time, how much it is and its orange
/// Start. Finished rows shrink to a check and what was done; Add to today
/// is the list's last row. Every row's other choices (Details, Change for
/// today, Not today, Log it) open from the row itself or its •••.
enum TodayDayList {
    /// The agenda items the list shows. A day with nothing planned at slot 0
    /// keeps its own placeholder out, and so does a skipped main workout
    /// that no longer names one.
    static func rows(_ items: [DailyWorkoutAgenda.Item]) -> [DailyWorkoutAgenda.Item] {
        items.filter { item in
            if item.status == "rest" { return false }
            if item.source == .primary, item.workout == nil, item.session?.isFreestyle != true { return false }
            return true
        }
    }

    /// The row that leads: one already under way, else the first that's
    /// still to do. Nil once everything is done or set aside.
    static func nextID(_ rows: [DailyWorkoutAgenda.Item]) -> String? {
        (rows.first { $0.status == "in_progress" } ?? rows.first { $0.status == "planned" })?.id
    }

    /// Whether the day still holds something to do.
    static func hasOpenRow(_ rows: [DailyWorkoutAgenda.Item]) -> Bool { nextID(rows) != nil }

    /// "Not today" for a skipped row: it was set aside, not missed.
    static let skippedLabel = "Not today"

    /// One line on how much a row is, so the day reads at a glance: a run's
    /// time, kind and target ("40 min · Tempo · HR 155–161"), a lift's
    /// exercises ("Swing, goblet squat, press +3"), what a finished row was
    /// ("Done · 6 exercises"). The next row's time sits in its Up next line,
    /// so `showsTime` is false there.
    static func detail(_ item: DailyWorkoutAgenda.Item, unit: RunDistanceUnit, showsTime: Bool = true,
                       locale: Locale = .current) -> String {
        let base = summary(item, unit: unit)
        let line: String
        switch item.status {
        case "completed":
            line = "Done" + (item.workout.flatMap(exerciseCount).map { " · \($0)" } ?? "")
        case "logged": line = "Logged"
        case "skipped": line = skippedLabel
        case "in_progress": line = "In progress · \(base)"
        default: line = base
        }
        guard showsTime, let minutes = item.minutes, !item.isDone, item.status != "skipped" else { return line }
        return "\(line) · \(ScheduleTimes.display(minutes, locale: locale))"
    }

    /// "Up next", or "Up next · 6:00 PM" when the member set a time.
    static func nextKicker(_ item: DailyWorkoutAgenda.Item, locale: Locale = .current) -> String {
        let head = item.status == "in_progress" ? "In progress" : "Up next"
        guard let minutes = item.minutes else { return head }
        return "\(head) · \(ScheduleTimes.display(minutes, locale: locale))"
    }

    /// What a row holds, without its status.
    static func summary(_ item: DailyWorkoutAgenda.Item, unit: RunDistanceUnit) -> String {
        if item.session?.isFreestyle == true { return "Pick exercises as you go" }
        guard let workout = item.workout else { return "Workout" }
        if PlannedActivity.isActivity(workout) {
            return homeStart(for: workout) != nil ? "No exercises yet" : "Activity"
        }
        if PlannedRunCreation.isRun(workout) {
            let figures = DayChange.glance(workout, unit: unit)
            if !figures.isEmpty { return figures.map(\.value).joined(separator: " · ") }
            return PlannedRunCreation.runSlot(in: workout)?.runPrescriptionLabel(in: unit) ?? "Run"
        }
        return PlanItemSummary.contents(workout.exercises.map(\.exercise_name))
    }

    /// "6 exercises", "1 exercise", or nil for an activity.
    static func exerciseCount(_ workout: Workout) -> String? {
        let count = workout.exercises.count
        guard count > 0, !PlannedRunCreation.isRun(workout) else { return nil }
        return "\(count) \(count == 1 ? "exercise" : "exercises")"
    }

    /// An activity that is a routine you do yourself (core, stretching, a
    /// bodyweight circuit) can be started: it is given exercises, or done as
    /// a routine for today. Any other activity, such as soccer, is logged.
    static func homeStart(for workout: Workout) -> PlanComposer.HomeStart? {
        guard PlannedActivity.isActivity(workout) else { return nil }
        let name = workout.name.lowercased()
        if name.contains("core") || name.contains("abs") { return .core }
        if name.contains("stretch") || name.contains("mobility") { return .stretching }
        if name.contains("bodyweight") || name.contains("body weight") { return .bodyweight }
        return nil
    }

    /// The row's one word: Start, Continue or Log; nil for a finished or
    /// set-aside row.
    static func actionTitle(_ item: DailyWorkoutAgenda.Item) -> String? {
        if item.isDone || item.status == "skipped" { return nil }
        if item.status == "in_progress" { return "Continue" }
        if item.isActivity, let workout = item.workout, homeStart(for: workout) == nil { return "Log" }
        return "Start"
    }
}

/// What today already holds that no planned row stands for (app-design-pass
/// P33): a run recorded off the plan, a ride or match a provider synced, an
/// activity logged by hand. Each shows on Today as done, after the day's own
/// rows, so a day's training is all in one place. A synced workout that a
/// planned activity's row shows as logged ("Soccer"), and the run
/// that carried out a finished run workout, stay with their rows.
enum TodayDoneActivities {
    static func entries(rows: [DailyWorkoutAgenda.Item], activities: [ExternalActivity],
                        logged: [ActivityRow], today: String,
                        unit: RunDistanceUnit) -> [ActivityHistory.Entry] {
        let synced = activities.filter { !$0.isDeleted && $0.date == today }
        let byHand = logged.filter { $0.deleted_at == nil && $0.date == today }
        var claimed: Set<String> = []
        for row in rows {
            guard let workout = row.workout else { continue }
            if row.isActivity {
                // Only a row that reads Logged stands for what logged it; one
                // set aside as Not today leaves a match done anyway on show.
                guard row.isDone else { continue }
                for activity in synced where PlannedActivity.matches(workout.name, synced: activity) {
                    claimed.insert("activity:" + activity.id)
                }
                for entry in byHand where PlannedActivity.matches(workout.name, manual: entry) {
                    claimed.insert("logged:" + entry.id)
                }
            } else if row.status == "completed", PlannedRunCreation.isRun(workout),
                      let run = PlannedRunRecord.matchingRun(
                        workoutName: workout.name,
                        among: synced.filter { !claimed.contains("activity:" + $0.id) }) {
                claimed.insert("activity:" + run.id)
            }
        }
        let history = ActivityHistory(sessions: [], activities: synced, logged: byHand, today: today,
                                      unit: unit, setCount: { _ in 0 }, workout: { _ in nil })
        // In the order they happened, as the day's own rows read; the
        // history lists newest first, with unknown starts last.
        let known = history.entries.filter { $0.startMs != nil }.reversed()
        let unknown = history.entries.filter { $0.startMs == nil }
        return (Array(known) + unknown).filter { !claimed.contains($0.id) }
    }

    /// "Done · 3.5 mi · 35m · 10:00 /mi", or "Done" when nothing is known.
    static func detail(_ entry: ActivityHistory.Entry) -> String {
        (["Done"] + entry.details).joined(separator: " · ")
    }

    /// "Run, done. 3.5 mi. 35m. 10:00 /mi", with its attribution last.
    static func spoken(_ entry: ActivityHistory.Entry) -> String {
        var parts: [String] = ["\(entry.title), done"]
        parts.append(contentsOf: entry.details)
        if let attribution = entry.attribution, !attribution.isEmpty { parts.append(attribution) }
        return parts.joined(separator: ". ")
    }
}

/// What a row of Today's list can do, decided by `TodayView`, which owns
/// starting, logging and the sheets.
struct TodayRowActions {
    /// The row's Start, Continue or Log. Nil hides the button.
    var primary: (() -> Void)?
    var primaryIdentifier: String
    var primaryDisabled = false
    /// The row's other choices.
    var more: () -> Void
}

/// The day's list (app-design-pass P30).
struct TodayDayListView: View {
    let rows: [DailyWorkoutAgenda.Item]
    let actions: (DailyWorkoutAgenda.Item) -> TodayRowActions
    let canAdd: Bool
    let onAdd: () -> Void
    /// Today's finished activities no row stands for (P33), and what
    /// tapping one opens.
    var done: [ActivityHistory.Entry] = []
    var onOpenDone: (ActivityHistory.Entry) -> Void = { _ in }
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private static let badgeSize: CGFloat = 30
    private let unit = RunDistanceUnit.preferred()
    private var stacksRows: Bool { dynamicTypeSize >= .xxLarge }

    var body: some View {
        let nextID = TodayDayList.nextID(rows)
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                if item.id == nextID {
                    nextRow(item)
                } else {
                    // No rule right under the navy row or at the top.
                    let ruled = index > 0 && rows[index - 1].id != nextID
                    row(item, ruled: ruled)
                }
            }
            ForEach(Array(done.enumerated()), id: \.element.id) { index, entry in
                let ruled = index > 0 || (rows.last.map { $0.id != nextID } ?? false)
                doneRow(entry, ruled: ruled)
            }
            addRow(ruled: done.isEmpty ? (rows.last.map { $0.id != nextID } ?? false) : true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.dayList")
    }

    // MARK: the next row, on navy

    private func nextRow(_ item: DailyWorkoutAgenda.Item) -> some View {
        let action = actions(item)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TodaySectionLabel(text: TodayDayList.nextKicker(item).uppercased())
                Spacer(minLength: 8)
                moreButton(action.more, title: item.title, identifier: "today.upNext.more")
            }
            let layout = stacksRows
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
            layout {
                HStack(alignment: .center, spacing: 12) {
                    if !dynamicTypeSize.isAccessibilitySize { badge(item, size: 34) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title).font(.title3.weight(.bold)).foregroundStyle(Theme.text)
                            .lineLimit(stacksRows ? nil : 2)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(TodayDayList.detail(item, unit: unit, showsTime: false))
                            .font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(Theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("today.agenda.status.\(item.id)")
                    }
                }
                if !stacksRows { Spacer(minLength: 8) }
                if let primary = action.primary, let title = TodayDayList.actionTitle(item) {
                    Button(title, action: primary)
                        .font(.headline)
                        .fixedSize(horizontal: false, vertical: true)
                        .foregroundStyle(action.primaryDisabled ? Theme.muted : Theme.onSignal)
                        .padding(.horizontal, 18).padding(.vertical, 8)
                        .frame(maxWidth: stacksRows ? .infinity : nil)
                        .frame(minWidth: 72, minHeight: 44)
                        .background(action.primaryDisabled ? Theme.surface2 : Theme.signalFill,
                                    in: RoundedRectangle(cornerRadius: 12))
                        .disabled(action.primaryDisabled)
                        .accessibilityLabel("\(title) \(item.title)")
                        .accessibilityIdentifier(action.primaryIdentifier)
                }
            }
        }
        .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.colorScheme, .dark)
        .environment(\.inHeroCard, true)
        .background(BrandPalette.hero)
        .contentShape(Rectangle())
        .onTapGesture(perform: action.more)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.upNext")
    }

    // MARK: the other rows

    private func row(_ item: DailyWorkoutAgenda.Item, ruled: Bool) -> some View {
        let action = actions(item)
        let finished = item.isDone || item.status == "skipped"
        let layout = stacksRows
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            HStack(alignment: .center, spacing: 12) {
                if item.isDone && !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title3).foregroundStyle(Theme.done)
                        .frame(width: Self.badgeSize, height: Self.badgeSize)
                        .accessibilityHidden(true)
                } else if !dynamicTypeSize.isAccessibilitySize {
                    badge(item, size: Self.badgeSize)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.subheadline.weight(.semibold))
                        .foregroundStyle(finished ? Theme.muted : Theme.text)
                        .lineLimit(stacksRows ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(TodayDayList.detail(item, unit: unit))
                        .font(.footnote.monospacedDigit()).foregroundStyle(Theme.muted)
                        .lineLimit(stacksRows ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("today.agenda.status.\(item.id)")
                }
            }
            if !stacksRows { Spacer(minLength: 8) }
            HStack(spacing: 4) {
                if let primary = action.primary, let title = TodayDayList.actionTitle(item) {
                    Button(title, action: primary)
                        .font(.subheadline.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44)
                        .disabled(action.primaryDisabled)
                        .accessibilityLabel("\(title) \(item.title)")
                        .accessibilityIdentifier(action.primaryIdentifier)
                }
                moreButton(action.more, title: item.title, identifier: "today.item.more.\(item.id)")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, stacksRows ? 10 : 4)
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        .overlay(alignment: .top) {
            if ruled { Rectangle().fill(Theme.surface2).frame(height: 1).padding(.leading, dynamicTypeSize.isAccessibilitySize ? 14 : 14 + Self.badgeSize + 12) }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: action.more)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.agenda.\(item.id)")
    }

    /// A finished activity off the plan: a check, its name and what was
    /// done, and the provider's attribution (a Garmin activity always
    /// names its device). Tapping it opens its record.
    private func doneRow(_ entry: ActivityHistory.Entry, ruled: Bool) -> some View {
        Button { onOpenDone(entry) } label: {
            HStack(alignment: .center, spacing: 12) {
                if !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title3).foregroundStyle(Theme.done)
                        .frame(width: Self.badgeSize, height: Self.badgeSize)
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title).font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(stacksRows ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(TodayDoneActivities.detail(entry))
                        .font(.footnote.monospacedDigit()).foregroundStyle(Theme.muted)
                        .lineLimit(stacksRows ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("today.done.detail.\(entry.id)")
                    if let attribution = entry.attribution, !attribution.isEmpty {
                        Text(attribution).font(.caption).foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold)).foregroundStyle(Theme.muted)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14).padding(.vertical, stacksRows ? 10 : 4)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) {
            if ruled { Rectangle().fill(Theme.surface2).frame(height: 1).padding(.leading, dynamicTypeSize.isAccessibilitySize ? 14 : 14 + Self.badgeSize + 12) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TodayDoneActivities.spoken(entry))
        .accessibilityHint("Opens its record")
        .accessibilityIdentifier("today.done.\(entry.id)")
    }

    private func addRow(ruled: Bool) -> some View {
        Button(action: onAdd) {
            HStack(spacing: 12) {
                Image(systemName: "plus")
                    .font(.body.weight(.semibold))
                    .frame(width: Self.badgeSize, height: Self.badgeSize)
                    .accessibilityHidden(true)
                Text("Add to today").font(.subheadline.weight(.semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(canAdd ? Theme.accent : Theme.muted)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canAdd)
        .overlay(alignment: .top) {
            if ruled { Rectangle().fill(Theme.surface2).frame(height: 1).padding(.leading, 14 + Self.badgeSize + 12) }
        }
        .accessibilityIdentifier("today.addAnotherWorkout")
    }

    private func badge(_ item: DailyWorkoutAgenda.Item, size: CGFloat) -> some View {
        PlanItemBadge(glyph: item.workout.map(PlanItemSummary.glyph)
                        ?? (item.session?.isFreestyle == true ? "figure.strengthtraining.traditional" : "list.bullet.clipboard"),
                      size: size)
    }

    private func moreButton(_ action: @escaping () -> Void, title: String, identifier: String) -> some View {
        Button(action: action) {
            Image(systemName: "ellipsis")
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.muted)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("More for \(title)")
        .accessibilityIdentifier(identifier)
    }
}

/// What one of today's rows can do besides its own button
/// (app-design-pass P30): start or log it, see its details, change it for
/// today, or set it aside for today. A routine-type activity with no
/// exercises yet (Friday's core) can be given its exercises, or done as a
/// suggested routine for today only.
enum TodayItemChoice: Equatable {
    case start, log, details, change, notToday, addExercises, routineToday, viewRecord
}

struct TodayItemChoicesSheet: View {
    let item: DailyWorkoutAgenda.Item
    let choices: [TodayItemChoice]
    let onChoose: (TodayItemChoice) -> Void
    @Environment(\.dismiss) private var dismiss
    private let unit = RunDistanceUnit.preferred()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(choices.filter(Self.doesIt), id: \.self) { row($0) }
                } footer: {
                    if choices.contains(.addExercises), let workout = item.workout {
                        Text("Exercises you add are saved to \(workout.name), so every \(workout.name) after this starts right away.")
                    }
                }
                let changes = choices.filter { !Self.doesIt($0) }
                if !changes.isEmpty {
                    Section {
                        ForEach(changes, id: \.self) { row($0) }
                    } footer: {
                        if changes.contains(.change) || changes.contains(.notToday) {
                            Text("Changes here are for today only. Your week stays the same.")
                        }
                    }
                }
            }
            .navigationTitle(item.title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private static func doesIt(_ choice: TodayItemChoice) -> Bool {
        [.start, .log, .addExercises, .routineToday].contains(choice)
    }

    private func row(_ choice: TodayItemChoice) -> some View {
        let (title, detail, glyph, identifier) = describe(choice)
        return Button { onChoose(choice) } label: {
            HStack(spacing: 12) {
                Image(systemName: glyph)
                    .font(.body.weight(.semibold)).foregroundStyle(Theme.accent)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(Theme.text)
                    if let detail { Text(detail).font(.caption).foregroundStyle(Theme.muted) }
                }
            }
            .frame(minHeight: 44)
        }
        .accessibilityIdentifier(identifier)
    }

    private func describe(_ choice: TodayItemChoice) -> (String, String?, String, String) {
        let name = item.title
        switch choice {
        case .start:
            return (item.status == "in_progress" ? "Continue" : "Start", nil, "play.fill", "today.choice.start")
        case .log:
            return ("Log \(name)", item.isActivity ? "Already did it" : nil, "square.and.pencil", "today.choice.log")
        case .addExercises:
            return ("Add exercises to \(name)", "Pick them once, then start", "plus", "today.choice.addExercises")
        case .routineToday:
            let suggestion = item.workout.flatMap(TodayDayList.homeStart(for:))?.title.lowercased() ?? "home"
            return ("Suggested \(suggestion) routine", "Just for today, yours to change", "figure.core.training",
                    "today.choice.routineToday")
        case .details:
            let isRun = item.workout.map(PlannedRunCreation.isRun) == true
            return ("Details", isRun ? "Every step of the run" : "Every exercise, and Edit",
                    "list.bullet.clipboard", "today.viewWorkout")
        case .change:
            return ("Change for today", "Something else in its place", "arrow.triangle.2.circlepath", "today.changeWorkout")
        case .notToday:
            return ("Not today", "Set it aside for today", "moon.zzz", "today.skipWorkout")
        case .viewRecord:
            return ("View workout record", nil, "clock.arrow.circlepath", "today.choice.viewRecord")
        }
    }
}
