import UIKit
import XCTest
@testable import TresFort

final class ConnectionLogoTests: XCTestCase {
    /// Public checkouts work without privately licensed brand artwork.
    func testEveryBrandHasAnAvailableNeutralFallback() throws {
        for brand in ConnectionLogo.Brand.allCases {
            _ = try XCTUnwrap(UIImage(systemName: brand.fallbackSymbol))
        }
    }

    /// Artwork supplied for an official release retains its original geometry.
    /// The release preflight separately requires both complete image sets.
    func testSuppliedBrandLogosAreSquareAtEveryScale() throws {
        let bundle = Bundle(for: SyncModel.self)
        for brand in ConnectionLogo.Brand.allCases {
            guard UIImage(named: brand.asset, in: bundle, compatibleWith: nil) != nil else { continue }
            for scale in [1.0, 2.0, 3.0] {
                let traits = UITraitCollection(displayScale: scale)
                let image = try XCTUnwrap(UIImage(named: brand.asset, in: bundle, compatibleWith: traits),
                                          "\(brand.asset) is missing")
                XCTAssertEqual(image.size.width, image.size.height, "\(brand.asset) isn't square")
                XCTAssertEqual(image.size.width, ConnectionLogo.size, "\(brand.asset) isn't \(ConnectionLogo.size) pt")
            }
        }
    }
}
