import SwiftUI
import WidgetKit

/// What is next today, drawn for each complication size. The widget
/// extension shows it on a watch face and in the Smart Stack; debug builds
/// of the app show the same views in a gallery (`-watch-complication-gallery`).
/// Complications use the system font, like the iPhone's Lock Screen widgets:
/// the watch face tints them, so color is a hint and never the message.
struct WatchComplicationView: View {
    let family: WidgetFamily
    let complication: WatchComplication

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(complication.inline)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                glyph.font(.title3.weight(.semibold))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
        case .accessoryCorner:
            glyph
                .font(.title3.weight(.semibold))
                .widgetLabel(complication.title)
                .accessibilityLabel(spoken)
        default:
            VStack(alignment: .leading, spacing: 1) {
                Text(complication.kicker.uppercased())
                    .font(.caption2.weight(.heavy))
                    .tracking(0.6)
                    .foregroundStyle(complication.tone == .next ? BrandPalette.signal : BrandPalette.muted)
                    .widgetAccentable()
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(complication.title)
                    .font(.headline)
                    .foregroundStyle(BrandPalette.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let detail = complication.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(BrandPalette.muted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }

    private var glyph: some View {
        Image(systemName: complication.glyph)
            .foregroundStyle(complication.tone == .next ? BrandPalette.signal : BrandPalette.text)
            .widgetAccentable()
    }

    /// The round and corner sizes show a symbol; VoiceOver gets the words.
    private var spoken: String {
        [complication.kicker, complication.title].joined(separator: ", ")
    }
}
