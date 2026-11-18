import SwiftUI

/// Which days Today's card can swipe to (docs/plans/app-design-pass P20):
/// a week back and two weeks ahead, the same window Coming up looks at.
enum TodayDays {
    static let range = -7...13

    /// Whole days from `today` to `ymd`, or nil for a date that doesn't parse.
    static func offset(of ymd: String, from today: String) -> Int? {
        guard let start = CalendarProjection.date(from: today),
              let date = CalendarProjection.date(from: ymd) else { return nil }
        return CalendarProjection.calendar.dateComponents([.day], from: start, to: date).day
    }

    /// The date `offset` days from `today`.
    static func date(_ offset: Int, from today: String) -> String {
        guard let start = CalendarProjection.date(from: today),
              let date = CalendarProjection.calendar.date(byAdding: .day, value: offset, to: start)
        else { return today }
        return CalendarProjection.dateString(date)
    }

    /// "Tomorrow", "Yesterday", "In 3 days", "3 days ago".
    static func relative(_ ymd: String, from today: String) -> String {
        switch offset(of: ymd, from: today) ?? 0 {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case -1: return "Yesterday"
        case let days where days > 1: return "In \(days) days"
        case let days: return "\(-days) days ago"
        }
    }

    /// The card's status words for a day other than today.
    static func status(_ day: TrainingAgendaDay, workout: Workout?, isPast: Bool) -> String {
        switch day.status {
        case .workout:
            if isPast { return "Not logged" }
            guard let workout else { return "Planned workout" }
            switch PlanItemSummary.kind(of: workout) {
            case .run: return "Planned run"
            case .activity: return "Planned activity"
            case .lift: return "Planned workout"
            }
        case .inProgress: return "In progress"
        case .completed: return "Completed"
        case .skipped: return "Skipped"
        case .rest: return "Rest day"
        case .unavailable: return "Away"
        case .light: return "Travel day"
        }
    }
}

/// Today's card swiped to another day: what that date holds, with ways to
/// look closer or change it, and one tap back to today. Starting and logging
/// stay on today's own card.
struct TodayOtherDayCard: View {
    @ObservedObject var sync: SyncModel
    let dateString: String
    let onBackToToday: () -> Void
    let onViewDay: () -> Void
    let onChangeDay: () -> Void

    var body: some View {
        let today = sync.todayString
        let day = sync.trainingAgendaDay(for: dateString, today: today)
        let workout = day.status == .skipped ? nil : sync.previewWorkout(forDateString: dateString, today: today)
        let isPast = dateString < today
        let extras = isPast ? [] : sync.plannedExtras(on: dateString, today: today)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                // The date is the heading over the card (`TodayDayHeading`).
                TodaySectionLabel(text: TodayDays.status(day, workout: workout, isPast: isPast).uppercased())
                    .accessibilityIdentifier("today.otherDay.kicker")
                Spacer(minLength: 8)
                Button(action: onBackToToday) {
                    HStack(spacing: 4) {
                        Image(systemName: isPast ? "chevron.right" : "chevron.left")
                            .font(.caption.weight(.bold))
                        Text("Today")
                    }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.text)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 32)
                    .background(RaisedFill().clipShape(Capsule()))
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back to today")
                .accessibilityIdentifier("today.backToToday")
            }
            Text(TodayDays.relative(dateString, from: today))
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted)
                .accessibilityIdentifier("today.otherDay.relative")
            Text(title(day))
                .font(Theme.display(30)).foregroundStyle(Theme.text)
                .lineLimit(2).minimumScaleFactor(0.7)
                .padding(.top, 4)
                .accessibilityIdentifier("today.otherDay.title")
            if let detail = detail(day, workout: workout) {
                Text(detail)
                    .font(.footnote).foregroundStyle(Theme.muted)
                    .lineLimit(2)
                    .padding(.top, 4)
            }
            HStack {
                Button(action: onViewDay) {
                    HStack(spacing: 4) {
                        Text(isPast || day.status == .completed ? "View day" : "View details")
                        Image(systemName: "chevron.right").font(.caption.weight(.bold))
                    }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("today.otherDay.view")
                Spacer()
                if !isPast, day.status != .completed, day.status != .inProgress {
                    Button("Change this day", action: onChangeDay)
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("today.otherDay.change")
                }
            }
            .padding(.top, 8)
            TodayLaterList(extras: extras, onLog: nil, title: "ALSO THIS DAY") { workout in
                ScheduleTimes.minutes(workout.id, onDate: dateString, plan: sync.plan)
            }
        }
        // Nothing starts or logs from another day, so its card stays plain:
        // navy on Today always means "do this" (app-design-pass P29).
        .padding(.bottom, extras.isEmpty ? -8 : 0)
        .todayPlainCard()
    }

    private func title(_ day: TrainingAgendaDay) -> String {
        if let name = day.workoutName, day.status != .skipped { return name }
        switch day.status {
        case .skipped: return day.workoutName.map { "\($0) skipped" } ?? "Skipped"
        case .unavailable: return "Away"
        case .light: return "Light day"
        default: return "Nothing planned"
        }
    }

    /// What's in it, and the time the member set for it, if any.
    private func detail(_ day: TrainingAgendaDay, workout: Workout?) -> String? {
        var parts: [String] = []
        if let workout, let minutes = ScheduleTimes.minutes(workout.id, onDate: dateString, plan: sync.plan),
           day.status == .workout {
            parts.append(ScheduleTimes.display(minutes))
        }
        if !day.exerciseNames.isEmpty {
            parts.append(day.exerciseNames.joined(separator: " · "))
        } else if day.status == .rest {
            parts.append("Train anyway, or take the day off.")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
