import SwiftUI
import WidgetKit

// What is next today, on a watch face and in the Smart Stack
// (docs/plans/apple-watch P4). It reads the Watch app's own copy of the day
// the iPhone sent and never computes a schedule. One entry per civil day
// the copy covers lets it turn over at midnight; a tap opens the Watch app.

struct WatchNextEntry: TimelineEntry {
    let date: Date
    let complication: WatchComplication
}

struct WatchNextProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchNextEntry { Self.sample }

    func getSnapshot(in context: Context, completion: @escaping (WatchNextEntry) -> Void) {
        if context.isPreview { return completion(Self.sample) }
        completion(entries(now: Date()).first ?? Self.sample)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchNextEntry>) -> Void) {
        // The Watch app reloads this timeline whenever the iPhone sends a
        // changed day.
        completion(Timeline(entries: entries(now: Date()), policy: .never))
    }

    private func entries(now: Date) -> [WatchNextEntry] {
        let snapshot = WatchDayStore.load(from: WatchDayStore.sharedDefaults)
        return WatchDayTimeline
            .entries(snapshot: snapshot, now: now, calendar: TrainingAgendaCalendar.calendar())
            .map { WatchNextEntry(date: $0.date, complication: WatchComplication($0.screen)) }
    }

    /// A fictional day for the complication picker.
    static let sample = WatchNextEntry(
        date: Date(),
        complication: WatchComplication(
            kicker: "Up next · 5:30 PM", title: "Lower Body", detail: "Back squat, Deadlift +3",
            glyph: "dumbbell", inline: "Lower Body", tone: .next))
}

struct WatchNextComplicationEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WatchNextEntry

    var body: some View {
        WatchComplicationView(family: family, complication: entry.complication)
            .containerBackground(for: .widget) {
                // The Smart Stack shows this behind the rectangular size; a
                // watch face removes it.
                BrandPalette.hero
            }
    }
}

struct WatchNextComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WatchDayStore.complicationKind, provider: WatchNextProvider()) { entry in
            WatchNextComplicationEntryView(entry: entry)
        }
        .configurationDisplayName("Up next")
        .description("What is next today in Très Fort.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryCorner, .accessoryInline])
    }
}

@main
struct TresFortWatchWidgets: WidgetBundle {
    var body: some Widget {
        WatchNextComplication()
    }
}
