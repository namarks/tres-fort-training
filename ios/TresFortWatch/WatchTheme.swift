import SwiftUI

/// The Watch's type and color, from the same tokens as the iPhone
/// (docs/DESIGN-SYSTEM.md). watchOS has one appearance, so `BrandPalette`
/// resolves its dark values here. The page stays black as watchOS expects;
/// the hero navy marks the day's key card, and orange only what is next.
enum WatchTheme {
    static let text = BrandPalette.text
    static let muted = BrandPalette.muted
    static let signal = BrandPalette.signal
    /// The orange fill of the one action to take, and the navy on it.
    static let signalFill = BrandPalette.signalFill
    static let onSignal = BrandPalette.onSignal
    static let done = BrandPalette.done
    static let surface = BrandPalette.surface
    static let hero = BrandPalette.hero
    static let heroEdge = BrandPalette.heroEdge

    /// Bebas Neue for workout names, scaled with the wearer's text size.
    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .title3) -> Font {
        .custom("BebasNeue-Regular", size: size, relativeTo: style)
    }

    /// JetBrains Mono for big tabular numbers.
    static func number(_ size: CGFloat, relativeTo style: Font.TextStyle = .title2) -> Font {
        .custom("JetBrainsMono-Bold", size: size, relativeTo: style)
    }

    /// Small capitals over a card or a group of rows.
    static let label = Font.system(.caption2, weight: .heavy)
}

/// A small all-caps label: the date, "Coming up", a row's Up next line.
struct WatchLabel: View {
    let text: String
    var color: Color = WatchTheme.muted

    var body: some View {
        Text(text.uppercased())
            .font(WatchTheme.label)
            .tracking(0.8)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }
}
