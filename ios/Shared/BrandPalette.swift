import SwiftUI
import UIKit

// Navy and orange: the app icon's colors carried through the app. One hue
// (OKLCH 255, the icon's navy) set as a tonal scale, with neutrals tinted
// toward it, plus the icon's orange as the one signal color. Light mode is a
// cool paper white with navy text and controls; dark mode is navy, not black.
// Orange marks primary actions, progress, today and the selected tab. Each
// color resolves for the current light or dark appearance. Text colors meet
// WCAG AA (4.5:1) on every surface in both modes; ThemeAccessibilityTests
// checks that. The web app uses the same values (web/src/styles.css).
enum BrandPalette {
    static let bgTop = dynamic(light: 0xFDFDFE, dark: 0x111F30)
    static let bg = dynamic(light: 0xF2F6FB, dark: 0x0D1826)
    static let surface = dynamic(light: 0xFDFDFE, dark: 0x142234)
    static let surface2 = dynamic(light: 0xE2E9F1, dark: 0x1F3045)
    static let text = dynamic(light: 0x0F1D2F, dark: 0xF2F5F9)
    static let muted = dynamic(light: 0x525F6F, dark: 0xA8B6C8)
    static let dim = dynamic(light: 0x989FA8, dark: 0x505C6C)
    /// Brand navy for links, tints and selection; a light ink blue in dark mode.
    static let accent = dynamic(light: 0x23436C, dark: 0x97BAE7)
    /// Text and icons on an accent fill.
    static let onAccent = dynamic(light: 0xFFFFFF, dark: 0x091628)
    /// The brand's orange as text, icons and thin marks (progress, the
    /// selected tab, a route): darker in light mode so it keeps 4.5:1 on
    /// every light surface.
    static let signal = dynamic(light: 0xC22D0C, dark: 0xEC7859)
    /// The orange fill of primary actions, the same in both modes, under
    /// `onSignal` navy labels (5.8:1).
    static let signalFill = fixed(0xEE694F)
    /// Text and icons on a signal fill.
    static let onSignal = fixed(0x091628)
    static let done = dynamic(light: 0x31693F, dark: 0x82C38F)
    static let danger = dynamic(light: 0xAF3C3A, dark: 0xEB827B)

    /// A screen's key card (`Theme.heroCard`): solid navy in both modes,
    /// a step lighter than the navy page in dark mode, with an edge there.
    /// Its content takes the dark-mode colors.
    static let hero = dynamic(light: 0x15273E, dark: 0x1A314E)
    static let heroEdge = dynamic(light: 0x15273E, dark: 0x314968)
    /// Tiles and dividers inside a hero card, a step lighter than either
    /// navy so they still read as buttons and rules on it.
    static let heroRaised = fixed(0x2A4466)

    /// Live Activities and the Dynamic Island always sit on a dark
    /// background, so they use the dark-mode values directly.
    static let liveBackground = Color(red: 0x0D / 255, green: 0x18 / 255, blue: 0x26 / 255)
    static let liveAccent = Color(red: 0x97 / 255, green: 0xBA / 255, blue: 0xE7 / 255)

    /// The fort: the app icon's navy and orange, the same in light and dark
    /// mode. Activity's week card is navy; Today's week chart sits on the
    /// page and draws each trained day as an orange tower.
    static let fortNavy = fixed(0x15273E)
    /// Towers and marks on fortNavy (graphics only, 4:1 on navy) and on the
    /// page in Today's week chart (3.4:1 or better).
    static let fortOrange = fixed(0xED4929)
    /// A planned day's tower in Today's week chart, on the page: a quiet
    /// blue that still keeps the 3:1 graphics minimum in both modes.
    static let weekPlanned = dynamic(light: 0x798EA8, dark: 0x556E8E)
    /// Text on fortNavy: orange (4.9:1) and a quiet ink blue (5.9:1).
    static let fortOrangeText = fixed(0xEE694F)
    static let fortLabel = fixed(0x83A4CE)
    /// Dates under the towers: a pale ink white on fortNavy.
    static let fortText = fixed(0xDCE6F2)
    /// A planned day's tower, and the card's edge on a dark page.
    static let fortIdle = fixed(0x2C4362)

    /// Six categorical colors for telling things apart (group members,
    /// activity kinds), never for emphasis. Same OKLCH lightness and chroma at
    /// evenly spread hues, so none shouts louder than another; each passes
    /// 4.5:1 as text on every surface.
    static let categorical: [Color] = [
        dynamic(light: 0x984742, dark: 0xF69B94),  // clay, hue 25
        dynamic(light: 0x676803, dark: 0xBBBE67),  // olive, hue 110
        dynamic(light: 0x2B7440, dark: 0x82CB92),  // green, hue 150
        dynamic(light: 0x057176, dark: 0x4ECCD3),  // teal, hue 200
        dynamic(light: 0x6D5398, dark: 0xC2A7F4),  // violet, hue 300
        dynamic(light: 0x8E4771, dark: 0xEA9BC7),  // plum, hue 345
    ]

    /// One color for both appearances.
    static func fixed(_ rgb: UInt32) -> Color {
        Color(UIColor(rgb: rgb))
    }

    static func dynamic(light: UInt32, dark: UInt32) -> Color {
        #if os(watchOS)
        // watchOS has one appearance, dark, and no dynamic colors.
        return Color(UIColor(rgb: dark))
        #else
        return Color(UIColor { traits in
            UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
        })
        #endif
    }
}

private extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255,
                  green: CGFloat((rgb >> 8) & 0xFF) / 255,
                  blue: CGFloat(rgb & 0xFF) / 255,
                  alpha: 1)
    }
}
