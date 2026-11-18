import SwiftUI
import UIKit
import XCTest
@testable import TresFort

@MainActor
final class ThemeAccessibilityTests: XCTestCase {
    private let styles: [UIUserInterfaceStyle] = [.light, .dark]

    // The gradient interpolates between bg and bgTop. All component channels
    // lie within these surfaces, so testing each bounds the text contrast.
    // The native iOS 26.2 contrast audit reports false positives over this
    // gradient. This policy checks the resolved colors themselves, in both
    // light and dark mode; decorative dim and intentionally disabled text
    // have a different purpose.
    func testEnabledTextContrastAcrossSurfaces() {
        let foregrounds = [Theme.text, Theme.muted, Theme.accent, Theme.signal, Theme.done, Theme.danger]
            + BrandPalette.categorical
        for style in styles {
            for foreground in foregrounds {
                for background in [Theme.bg, Theme.bgTop, Theme.surface, Theme.surface2] {
                    XCTAssertGreaterThanOrEqual(contrast(foreground, background, style), 4.5,
                                                "Enabled text must retain WCAG AA contrast (\(style == .dark ? "dark" : "light"))")
                }
            }
        }
    }

    func testPrimaryActionTextContrast() {
        for style in styles {
            XCTAssertGreaterThanOrEqual(contrast(Theme.onAccent, Theme.accent, style), 4.5)
            // Older call sites label accent fills with the page background.
            XCTAssertGreaterThanOrEqual(contrast(Theme.bg, Theme.accent, style), 4.5)
        }
    }

    func testSignalActionTextContrast() {
        for style in styles {
            XCTAssertGreaterThanOrEqual(contrast(Theme.onSignal, Theme.signalFill, style), 4.5)
        }
    }

    /// A hero card is navy in both modes and its content takes the dark-mode
    /// colors, so dark text, accent and signal keep 4.5:1 on either navy, and
    /// a primary button's orange fill keeps the 3:1 graphics minimum on it.
    func testHeroCardContrast() {
        for style in styles {
            for foreground in [Theme.text, Theme.muted, Theme.accent, Theme.signal, Theme.done, Theme.danger] {
                XCTAssertGreaterThanOrEqual(contrast(foreground, .dark, BrandPalette.hero, style), 4.5,
                                            "Hero text must retain WCAG AA contrast (\(style == .dark ? "dark" : "light"))")
            }
            XCTAssertGreaterThanOrEqual(contrast(Theme.signalFill, .dark, BrandPalette.hero, style), 3)
            // Tiles inside the card: their labels and icons stay readable.
            for foreground in [Theme.text, Theme.muted, Theme.accent] {
                XCTAssertGreaterThanOrEqual(contrast(foreground, .dark, BrandPalette.heroRaised, style), 4.5)
            }
        }
    }

    /// The run's Lock Screen sits on the live navy and takes the dark-mode
    /// colors: the step's title and bar (signal), the on-target note (done),
    /// labels (muted), figures (text) and the countdown (live accent) keep
    /// 4.5:1 there.
    func testRunLiveActivityContrast() {
        for style in styles {
            for foreground in [BrandPalette.signal, BrandPalette.done, BrandPalette.muted, BrandPalette.text] {
                XCTAssertGreaterThanOrEqual(contrast(foreground, .dark, BrandPalette.liveBackground, style), 4.5)
            }
            XCTAssertGreaterThanOrEqual(contrast(BrandPalette.liveAccent, BrandPalette.liveBackground, style), 4.5)
        }
    }

    /// Today's week chart sits on the page: its trained and planned towers
    /// keep the 3:1 graphics minimum on both ends of the page's gradient,
    /// and today's ring and date (signal) keep 4.5:1.
    func testWeekChartContrastOnThePage() {
        for style in styles {
            for page in [Theme.bgTop, Theme.bg] {
                XCTAssertGreaterThanOrEqual(contrast(BrandPalette.fortOrange, page, style), 3)
                XCTAssertGreaterThanOrEqual(contrast(BrandPalette.weekPlanned, page, style), 3)
                XCTAssertGreaterThanOrEqual(contrast(Theme.signal, page, style), 4.5)
            }
        }
    }

    /// Activity's week card is navy in both modes: its text keeps 4.5:1 and
    /// its towers keep the 3:1 graphics minimum.
    func testWeekFortContrastOnNavy() {
        for style in styles {
            for text in [BrandPalette.fortOrangeText, BrandPalette.fortLabel, BrandPalette.fortText] {
                XCTAssertGreaterThanOrEqual(contrast(text, BrandPalette.fortNavy, style), 4.5)
            }
            XCTAssertGreaterThanOrEqual(contrast(BrandPalette.fortOrange, BrandPalette.fortNavy, style), 3)
        }
    }

    func testLightAndDarkResolveDifferently() {
        XCTAssertNotEqual(luminance(Theme.bg, .light), luminance(Theme.bg, .dark))
        XCTAssertNotEqual(luminance(Theme.accent, .light), luminance(Theme.accent, .dark))
    }

    private func contrast(_ a: Color, _ b: Color, _ style: UIUserInterfaceStyle) -> Double {
        contrast(a, style, b, style)
    }

    private func contrast(_ a: Color, _ aStyle: UIUserInterfaceStyle,
                          _ b: Color, _ bStyle: UIUserInterfaceStyle) -> Double {
        let x = luminance(a, aStyle), y = luminance(b, bStyle)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    private func luminance(_ color: Color, _ style: UIUserInterfaceStyle) -> Double {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        let resolved = UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
        XCTAssertTrue(resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
        XCTAssertEqual(alpha, 1)
        let linear = [red, green, blue].map { component -> Double in
            let value = Double(component)
            return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return zip(linear, [0.2126, 0.7152, 0.0722]).reduce(0) { $0 + $1.0 * $1.1 }
    }
}
