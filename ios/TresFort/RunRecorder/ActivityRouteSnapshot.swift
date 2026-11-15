import MapKit
import SwiftUI
import UIKit

/// Small still maps of routes for the Activity tab's cards: a muted Apple
/// Maps image with the route drawn on it, made once per route, size and
/// appearance and kept for this process. A list of cards shows images
/// rather than live maps, which would be heavy while scrolling.
@MainActor
final class ActivityRouteSnapshotStore {
    static let shared = ActivityRouteSnapshotStore()

    private let cache = NSCache<NSString, UIImage>()
    private var inFlight: [String: Task<UIImage?, Never>] = [:]

    init() {
        cache.countLimit = 120
    }

    struct Request {
        let key: String
        let segments: [[CLLocationCoordinate2D]]
        let size: CGSize
        let scale: CGFloat
        let dark: Bool
        let stroke: UIColor

        var cacheKey: String {
            "\(key)|\(Int(size.width))x\(Int(size.height))@\(scale)|\(dark ? "dark" : "light")"
        }
    }

    func cached(_ request: Request) -> UIImage? {
        cache.object(forKey: request.cacheKey as NSString)
    }

    /// The map image for `request`, or nil when the map can't be drawn now
    /// (offline, say); the next look tries again.
    func image(for request: Request) async -> UIImage? {
        let key = request.cacheKey
        if let image = cache.object(forKey: key as NSString) { return image }
        if let running = inFlight[key] { return await running.value }
        let task = Task { await Self.render(request) }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        if let image { cache.setObject(image, forKey: key as NSString) }
        return image
    }

    private static func render(_ request: Request) async -> UIImage? {
        guard let region = ActivityRouteMap.region(for: request.segments,
                                                   margin: ActivityRouteSnapshot.margin),
              request.size.width > 0, request.size.height > 0 else { return nil }
        let options = MKMapSnapshotter.Options()
        options.region = region
        options.size = request.size
        let style = UITraitCollection(userInterfaceStyle: request.dark ? .dark : .light)
        options.traitCollection = UITraitCollection { traits in
            traits.userInterfaceStyle = request.dark ? .dark : .light
            traits.displayScale = request.scale
        }
        let configuration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
        configuration.pointOfInterestFilter = .excludingAll
        options.preferredConfiguration = configuration
        let segments = request.segments
        let stroke = request.stroke.resolvedColor(with: style)
        // A soft edge in the page's own background keeps the line clear of
        // the roads under it.
        let halo = UIColor(Theme.bg).resolvedColor(with: style).withAlphaComponent(0.55)
        return await withCheckedContinuation { continuation in
            let snapshotter = MKMapSnapshotter(options: options)
            snapshotter.start(with: .global(qos: .userInitiated)) { snapshot, _ in
                // Holds the snapshotter until it answers.
                _ = snapshotter
                guard let snapshot else {
                    continuation.resume(returning: nil)
                    return
                }
                let format = UIGraphicsImageRendererFormat()
                format.scale = snapshot.image.scale
                let image = UIGraphicsImageRenderer(size: snapshot.image.size, format: format).image { _ in
                    snapshot.image.draw(at: .zero)
                    let path = UIBezierPath()
                    for segment in segments where segment.count > 1 {
                        path.move(to: snapshot.point(for: segment[0]))
                        for coordinate in segment.dropFirst() { path.addLine(to: snapshot.point(for: coordinate)) }
                    }
                    path.lineCapStyle = .round
                    path.lineJoinStyle = .round
                    path.lineWidth = 4.5
                    halo.setStroke()
                    path.stroke()
                    path.lineWidth = 2.5
                    stroke.setStroke()
                    path.stroke()
                }
                continuation.resume(returning: image)
            }
        }
    }
}

/// A route's thumbnail on a card: the route on a muted map. Until the map
/// arrives, or when it can't be drawn, the route's outline shows on the
/// card's own surface instead.
struct ActivityRouteSnapshot: View {
    /// Names the route, such as its activity id.
    let key: String
    let segments: [[CLLocationCoordinate2D]]
    let tint: Color
    var size = CGSize(width: 84, height: 64)
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale
    @State private var loaded: (key: String, image: UIImage)?

    /// Extra room around the route, as a share of its span.
    static let margin = 1.35

    private var request: ActivityRouteSnapshotStore.Request {
        .init(key: key, segments: segments, size: size, scale: displayScale,
              dark: colorScheme == .dark, stroke: UIColor(tint))
    }

    var body: some View {
        let current = self.request
        let cacheKey = current.cacheKey
        let shown = loaded?.key == cacheKey ? loaded?.image : ActivityRouteSnapshotStore.shared.cached(current)
        ZStack {
            if let shown {
                Image(uiImage: shown)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else {
                Theme.surface2
                ActivityRouteShape(segments: segments)
                    .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                    .padding(8)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.surface2, lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel("Route map")
        .task(id: cacheKey) {
            guard let made = await ActivityRouteSnapshotStore.shared.image(for: current),
                  !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) { loaded = (cacheKey, made) }
        }
    }
}
