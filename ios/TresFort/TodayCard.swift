import SwiftUI

/// The Today screen reads top to bottom as three sections, each under a
/// small heading with a link beside it: the day and its card, the week, then
/// what's coming up. These pieces keep them alike.
enum TodayCard {
    /// A date and a status in small capitals: "FRI, NOV 6 · REST DAY". With
    /// no status it is the day's heading over the card, "FRI, NOV 6".
    static func kicker(_ ymd: String, _ status: String) -> String {
        [DateLabel.short(ymd), status]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
            .uppercased()
    }
}

/// A section's small uppercase heading.
struct TodaySectionLabel: View {
    let text: String
    var color: Color = Theme.muted

    var body: some View {
        Text(text)
            .font(Theme.mono(11, .bold)).tracking(1.6)
            .foregroundStyle(color)
    }
}

/// The date over the day's card, with the goal event's countdown beside it:
/// the first of Today's section headings. The card under it opens straight
/// on what the day holds.
struct TodayDayHeading: View {
    @ObservedObject var sync: SyncModel
    let dateString: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
            : AnyLayout(HStackLayout(spacing: 8))
        layout {
            TodaySectionLabel(text: TodayCard.kicker(dateString, ""))
                .fixedSize()
                .accessibilityIdentifier("today.date")
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
            EventTodayLine(sync: sync)
        }
        .frame(minHeight: 28)
        .padding(.horizontal, 4)
    }
}

/// Today's card in two tones (app-design-pass P29). Navy is kept for the one
/// thing to do now and the orange action that starts or logs it; everything
/// else about the day sits on the plain card around it. A day with nothing to
/// start or log has no navy at all, so navy on Today always means "do this".
private struct TodayActionBand: ViewModifier {
    func body(content: Content) -> some View {
        // The same recipe as `heroCard`: the content takes the dark-mode
        // colors, the fill keeps this appearance's navy.
        content
            .environment(\.colorScheme, .dark)
            .environment(\.inHeroCard, true)
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BrandPalette.hero)
            // Above the plain rows, so the rule over the first of them
            // tucks under the navy (`todayFootRows`).
            .zIndex(1)
    }
}

extension View {
    /// What to do now, with its one action, on navy.
    func todayActionBand() -> some View {
        modifier(TodayActionBand())
    }

    /// What leads the card: on navy when it has an action to take, on the
    /// plain card when it is only something to read (already logged).
    @ViewBuilder func todayLeadBand(hasAction: Bool) -> some View {
        if hasAction {
            todayActionBand()
        } else {
            padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Finished items over what leads the card, on the plain card.
    func todayDoneBand() -> some View {
        padding(.horizontal, 20).padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The plain rows under what leads the card. Each row draws a thin rule
    /// over itself (`todayFootRow`); the stack sits one point up so the first
    /// row's rule hides under a navy band and shows under a plain one.
    func todayFootRows() -> some View {
        padding(.horizontal, 20).padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, -1)
    }

    /// One of the plain rows of today's card, under a thin rule. The first
    /// row of a card with nothing over it goes without the rule.
    func todayFootRow(ruled: Bool = true) -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { if ruled { RaisedFill().frame(height: 1) } }
    }

    /// Rounds a card's bands into one card on the plain surface.
    func todayCardShell() -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    /// A day's card with nothing to start or log: one plain card.
    func todayPlainCard() -> some View {
        padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
    }
}

/// Today's plan in order: the day's workout first, then the activities it
/// holds beside it (schedule extras). Finished items shrink to a check line
/// at the top of the card, the first unfinished one leads it, and the rest
/// wait under Later today.
enum TodayLineup {
    struct Arrangement: Equatable {
        /// Finished items, in plan order, shown as check lines.
        var done: [String] = []
        /// The item the card leads with, or nil once everything is done.
        var lead: String?
        /// Unfinished items after the lead.
        var later: [String] = []
    }

    /// `main` is the day's workout and whether it is done; `extras` are the
    /// activities beside it, in plan order, each with whether it is logged.
    /// When nothing is left to do, the workout keeps its own finished card
    /// (it leads as done) and the logged activities sit under it as check
    /// lines.
    /// "Activity", or "Activity · 9:00 PM" when the member set a time.
    static func detail(_ kind: String, minutes: Int?, locale: Locale = .current) -> String {
        guard let minutes else { return kind }
        return "\(kind) · \(ScheduleTimes.display(minutes, locale: locale))"
    }

    static func arrange(main: (id: String, done: Bool)?, extras: [(id: String, done: Bool)]) -> Arrangement {
        let items = (main.map { [$0] } ?? []) + extras
        let open = items.filter { !$0.done }
        guard let first = open.first else {
            return Arrangement(done: extras.map { $0.id }, lead: main?.id, later: [])
        }
        return Arrangement(done: items.filter { $0.done }.map { $0.id }, lead: first.id,
                           later: open.dropFirst().map { $0.id })
    }
}

/// A finished item of today's plan, shrunk to one line with a check.
struct TodayDoneLine: View {
    let title: String
    let detail: String
    /// A third line, such as a provider's attribution ("Garmin Forerunner 945").
    var note: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var detailIdentifier: String? = nil
    var actionIdentifier: String? = nil
    /// A rule under the line, separating it from what leads the card.
    var dividerBelow = true

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.title3).foregroundStyle(Theme.done)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.headline).foregroundStyle(Theme.text).lineLimit(1)
                Text(detail).font(.footnote.monospacedDigit()).foregroundStyle(Theme.muted).lineLimit(1)
                    .accessibilityIdentifier(detailIdentifier ?? "")
                if let note, !note.isEmpty {
                    Text(note).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(title), done. \(detail)" + (note.map { ". \($0)" } ?? ""))
            Spacer(minLength: 8)
            if let actionTitle, let action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(actionIdentifier ?? "")
            }
        }
        .frame(minHeight: 44)
        .padding(.bottom, dividerBelow ? 10 : 0)
        .overlay(alignment: .bottom) { if dividerBelow { RaisedFill().frame(height: 1) } }
        .padding(.bottom, dividerBelow ? 12 : 0)
    }
}

/// An activity leading today's card once what came before it is done:
/// its name and the one orange action that logs it. The caller puts it on
/// navy (`todayLeadBand`).
struct TodayNextActivity: View {
    let workout: Workout
    let onLog: ((String) -> Void)?
    /// The member's time for it today, minutes after midnight, if set.
    var minutes: Int? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TodaySectionLabel(text: "NEXT UP")
            Text(workout.name).font(Theme.display(30)).foregroundStyle(Theme.text)
                .lineLimit(2).minimumScaleFactor(0.7)
                .padding(.top, 8)
            Text(TodayLineup.detail("Activity", minutes: minutes))
                .font(.headline).foregroundStyle(Theme.text).padding(.top, 6)
            if let onLog {
                Button("Log \(workout.name)") { onLog(workout.name) }
                    .buttonStyle(WorkoutPrimaryButtonStyle())
                    .padding(.top, 16)
                    .accessibilityIdentifier("today.extra.log.\(workout.id)")
            }
        }
    }
}

/// Today's activities still to come, one of the plain rows under the item
/// leading the card, each with its own Log.
struct TodayLaterList: View {
    let extras: [Workout]
    let onLog: ((String) -> Void)?
    /// The list's heading; another day's card calls it ALSO THIS DAY.
    var title = "LATER TODAY"
    /// Each activity's time today, minutes after midnight, if set.
    var minutes: (Workout) -> Int? = { _ in nil }

    var body: some View {
        if !extras.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                TodaySectionLabel(text: title)
                ForEach(extras) { workout in
                    HStack(spacing: 12) {
                        PlanItemBadge(glyph: PlanItemSummary.glyph(for: workout))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(workout.name).font(.headline).foregroundStyle(Theme.text).lineLimit(2)
                            Text(TodayLineup.detail("Activity", minutes: minutes(workout)))
                                .font(.footnote).foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 8)
                        if let onLog {
                            Button("Log") { onLog(workout.name) }
                                .font(.subheadline.weight(.semibold))
                                .frame(minWidth: 44, minHeight: 44)
                                .accessibilityLabel("Log \(workout.name)")
                                .accessibilityIdentifier("today.extra.log.\(workout.id)")
                        }
                    }
                    .frame(minHeight: 48)
                    .accessibilityIdentifier("today.later.\(workout.id)")
                }
            }
            .padding(.top, 12).padding(.bottom, 4)
            .todayFootRow()
        }
    }
}
