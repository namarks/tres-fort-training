import SwiftUI

/// The Today screen reads top to bottom as three sections: one card for
/// today, the week, then what's coming up. These pieces keep them alike.
enum TodayCard {
    /// The card's small first line: "FRI, NOV 6 · REST DAY".
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

extension View {
    /// Today's card: solid navy, the app icon in miniature (`heroCard`).
    func todayCardSurface(padding: CGFloat = 16) -> some View {
        heroCard(padding: padding)
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
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(title), done. \(detail)")
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
/// its name and the one orange action that logs it.
struct TodayNextActivity: View {
    let workout: Workout
    let dateString: String
    let onLog: ((String) -> Void)?
    /// The member's time for it today, minutes after midnight, if set.
    var minutes: Int? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TodaySectionLabel(text: TodayCard.kicker(dateString, "Next up"))
            Text(workout.name).font(Theme.display(30)).foregroundStyle(Theme.text)
                .lineLimit(2).minimumScaleFactor(0.7)
                .padding(.top, 8)
            Text(TodayLineup.detail("Activity", minutes: minutes))
                .font(.subheadline).foregroundStyle(Theme.muted).padding(.top, 4)
            if let onLog {
                Button("Log \(workout.name)") { onLog(workout.name) }
                    .buttonStyle(WorkoutPrimaryButtonStyle())
                    .padding(.top, 14)
                    .accessibilityIdentifier("today.extra.log.\(workout.id)")
            }
        }
    }
}

/// Today's activities still to come, under the item leading the card, each
/// with its own Log.
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
            .padding(.top, 12)
            .overlay(alignment: .top) { RaisedFill().frame(height: 1) }
            .padding(.top, 8)
        }
    }
}
