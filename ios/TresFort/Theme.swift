import SwiftUI

// Visual language: navy and orange (`BrandPalette`), the app icon's colors,
// following the system light or dark appearance. Navy is the accent (links,
// tints, selection) and, as `heroCard`, the key card on a screen; a muted
// green means "done". The brand orange (`signal`) marks primary actions,
// progress, today and the selected tab; it is not a general accent. One type system: SF Pro (system text styles, so Dynamic Type
// applies) for every label and heading; Bebas Neue display type only for
// workout and exercise names and big numbers; JetBrains Mono only for big
// numbers. Primary actions use `WorkoutPrimaryButtonStyle`.
enum Theme {
    static let bgTop = BrandPalette.bgTop
    static let bg = BrandPalette.bg
    static let surface = BrandPalette.surface
    static let surface2 = BrandPalette.surface2
    static let text = BrandPalette.text
    static let muted = BrandPalette.muted
    static let dim = BrandPalette.dim
    static let accent = BrandPalette.accent
    /// Text and icons on an accent fill.
    static let onAccent = BrandPalette.onAccent
    /// Brand orange as text, icons, progress and other thin marks.
    static let signal = BrandPalette.signal
    /// Brand orange as a primary action's fill; `onSignal` labels it.
    static let signalFill = BrandPalette.signalFill
    static let onSignal = BrandPalette.onSignal
    static let done = BrandPalette.done
    static let danger = BrandPalette.danger
    /// The widest a one-column screen grows (`readableColumn`), about the
    /// readable width iPad uses for text.
    static let readableWidth: CGFloat = 700

    static var background: some View {
        RadialGradient(colors: [bgTop, bg],
                       center: .top, startRadius: 0, endRadius: 600)
            .ignoresSafeArea()
    }

    /// Bebas Neue: condensed all-caps display, only for workout and
    /// exercise names and big numbers (timers, weights, stats).
    static func display(_ size: CGFloat) -> Font {
        .custom("BebasNeue-Regular", size: size)
    }
    /// Small labels and captions: SF Pro at the nearest text style (so they
    /// follow Dynamic Type) with tabular digits, so numbers in a label still
    /// line up. Formerly JetBrains Mono; mono type is now only for `number`.
    static func mono(_ size: CGFloat, _ w: Font.Weight = .medium) -> Font {
        Font.system(textStyle(for: size), weight: w).monospacedDigit()
    }
    /// The text style closest to a point size, never much larger.
    static func textStyle(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case ..<12: .caption2
        case ..<13: .caption
        case ..<15: .footnote
        case ..<16: .subheadline
        case ..<17: .callout
        case ..<20: .body
        case ..<22: .title3
        case ..<28: .title2
        case ..<34: .title
        default: .largeTitle
        }
    }
    /// Big tabular number (stepper values, countdowns).
    static func number(_ size: CGFloat) -> Font {
        .custom("JetBrainsMono-Bold", size: size)
    }
}

/// A screen's key card in solid navy, the app icon in miniature. Its content
/// resolves the dark-mode colors (light text, orange signal) in both modes;
/// the card itself stays navy, a step lighter than the page in dark mode.
struct HeroCard: ViewModifier {
    var padding: CGFloat = 20
    var cornerRadius: CGFloat = 16

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius)
        content
            .environment(\.colorScheme, .dark)
            .environment(\.inHeroCard, true)
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BrandPalette.hero, in: shape)
            .overlay(shape.strokeBorder(BrandPalette.heroEdge, lineWidth: 1))
    }
}

private struct InHeroCardKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// True inside `heroCard`, where `surface2` would vanish into the navy.
    var inHeroCard: Bool {
        get { self[InHeroCardKey.self] }
        set { self[InHeroCardKey.self] = newValue }
    }
}

/// A fill one step up from where it sits, for tiles and thin rules:
/// `surface2` on a page or card, `heroRaised` inside a hero card.
struct RaisedFill: View {
    @Environment(\.inHeroCard) private var inHeroCard

    var body: some View {
        Rectangle().fill(inHeroCard ? BrandPalette.heroRaised : Theme.surface2)
    }
}

extension View {
    func heroCard(padding: CGFloat = 20, cornerRadius: CGFloat = 16) -> some View {
        modifier(HeroCard(padding: padding, cornerRadius: cornerRadius))
    }

    /// Keeps a one-column screen at a comfortable width and centers it, so
    /// its cards don't stretch across an iPad. Every iPhone is narrower than
    /// this, so it changes nothing there.
    func readableColumn(maxWidth: CGFloat = Theme.readableWidth) -> some View {
        frame(maxWidth: maxWidth).frame(maxWidth: .infinity)
    }
}

/// Something to check before going on, such as a count that may be
/// incomplete: a warning icon beside ordinary text. Not an error (that's
/// `danger`) and never orange, which means what to do next.
struct CautionText: View {
    let text: String
    var font: Font = .subheadline

    init(_ text: String, font: Font = .subheadline) {
        self.text = text
        self.font = font
    }

    var body: some View {
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.muted)
        }
        .font(font)
        .foregroundStyle(Theme.text)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1)
    }
}
