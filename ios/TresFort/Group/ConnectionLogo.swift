import SwiftUI
import UIKit

/// A connection's official logo beside its name in Profile → Connections.
///
/// Each asset is the brand's own artwork, used under that brand's rules (see
/// "Brand logos" in docs/DESIGN-SYSTEM.md): shown unaltered (never tinted,
/// masked, cropped, dimmed or recolored), always next to the brand's name,
/// never as a button on its own, and never beside the brand's data. Every
/// logo takes the same size, so none shows smaller than another, with clear
/// space of at least a tenth of its height on every side.
struct ConnectionLogo: View {
    enum Brand: CaseIterable {
        case appleHealth
        case garminConnect

        var asset: String {
            switch self {
            case .appleHealth: "logo_apple_health"
            case .garminConnect: "logo_garmin_connect"
            }
        }

        /// A neutral capability symbol, not a recreation of a provider's logo.
        var fallbackSymbol: String {
            switch self {
            case .appleHealth: "heart.text.square"
            case .garminConnect: "figure.run"
            }
        }
    }

    /// The logo's own height and width: 90 px on a 3x screen, above
    /// Garmin's 88 px minimum for its tile.
    static let size: CGFloat = 30
    /// The column a connection's mark sits in, logo plus clear space.
    static let column: CGFloat = 36

    let brand: Brand

    var body: some View {
        Group {
            if let artwork = UIImage(named: brand.asset) {
                Image(uiImage: artwork)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: Self.size, height: Self.size)
            } else {
                Image(systemName: brand.fallbackSymbol)
                    .font(.system(size: 24))
                    .foregroundStyle(Theme.muted)
                    .frame(width: Self.size, height: Self.size)
            }
        }
        .frame(width: Self.column, height: Self.column)
        // The name beside it says what it is.
        .accessibilityHidden(true)
    }
}
