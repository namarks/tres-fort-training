import SwiftUI

/// Today on the wrist: the same day list as the iPhone. Finished rows
/// shrink to a check and what was done, the next thing to do sits on navy,
/// and a rest day says so and shows what is coming.
struct WatchTodayView: View {
    @ObservedObject var model: WatchDayModel

    var body: some View {
        NavigationStack {
            ScrollView {
                if let screen = model.screen {
                    WatchDayList(screen: screen)
                } else {
                    WatchWaitingView()
                }
            }
            .navigationTitle("Today")
            .containerBackground(Color.black, for: .navigation)
        }
        .tint(WatchTheme.signal)
    }
}

struct WatchDayList: View {
    let screen: WatchDayScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WatchLabel(text: WatchDayPresentation.dateLabel(screen.date))
                .padding(.horizontal, 4)
                .accessibilityIdentifier("watch.today.date")
            ForEach(screen.rows) { row in
                if row.state == .next {
                    WatchNextCard(row: row)
                } else {
                    WatchRowLine(row: row)
                }
            }
            if let title = screen.emptyTitle {
                WatchEmptyDayCard(title: title, detail: screen.emptyDetail)
            }
            if let next = screen.comingUp {
                WatchLabel(text: "Coming up")
                    .padding(.horizontal, 4)
                    .padding(.top, 4)
                WatchComingUpCard(day: next)
            }
            if screen.source == .earlier {
                Text(WatchDayPresentation.earlierNote)
                    .font(.footnote)
                    .foregroundStyle(WatchTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The row that leads, on navy: Up next and its time, the workout's name
/// and how much it is.
struct WatchNextCard: View {
    let row: WatchDayRow

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let kicker = row.kicker {
                WatchLabel(text: kicker, color: WatchTheme.signal)
            }
            Text(row.title)
                .font(WatchTheme.display(30))
                .foregroundStyle(WatchTheme.text)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            if !row.detail.isEmpty {
                Text(row.detail)
                    .font(.footnote)
                    .foregroundStyle(WatchTheme.muted)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(WatchTheme.hero, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(WatchTheme.heroEdge, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("watch.today.next")
    }
}

/// Every other row: a check for a finished one, its name and one line.
struct WatchRowLine: View {
    let row: WatchDayRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: row.state == .done ? "checkmark.circle.fill" : row.glyph)
                .font(.footnote)
                .foregroundStyle(row.state == .done ? WatchTheme.done : WatchTheme.muted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(row.state == .open ? WatchTheme.text : WatchTheme.muted)
                    .lineLimit(1)
                if !row.detail.isEmpty {
                    Text(row.detail)
                        .font(.caption2)
                        .foregroundStyle(WatchTheme.muted)
                        .lineLimit(2)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
    }
}

/// A day with nothing to train: a plain card, and no navy.
struct WatchEmptyDayCard: View {
    let title: String
    let detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(WatchTheme.display(30))
                .foregroundStyle(WatchTheme.text)
            if let detail {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(WatchTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(WatchTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("watch.today.empty")
    }
}

struct WatchComingUpCard: View {
    let day: WatchUpcomingDay

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(WatchDayPresentation.weekdayLabel(day.date))
                .font(.caption2)
                .foregroundStyle(WatchTheme.muted)
            Text(day.title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(WatchTheme.text)
                .lineLimit(2)
            if let detail = day.detail {
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
        .background(WatchTheme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Nothing to show for today yet: the day comes from the iPhone.
struct WatchWaitingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "iphone")
                .font(.title3)
                .foregroundStyle(WatchTheme.signal)
                .accessibilityHidden(true)
            Text(WatchDayPresentation.waitingTitle)
                .font(.headline)
                .foregroundStyle(WatchTheme.text)
                .fixedSize(horizontal: false, vertical: true)
            Text(WatchDayPresentation.waitingDetail)
                .font(.footnote)
                .foregroundStyle(WatchTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("watch.today.waiting")
    }
}
