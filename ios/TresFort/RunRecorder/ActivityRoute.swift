import Foundation
import MapKit
import SwiftUI

/// A run's GPS route as `GET /api/activities/:id/route` serves it
/// (src/activityRoute.ts, docs/plans/run-recorder P5 and P6). Times are delta-coded
/// milliseconds and coordinates delta-coded micro-degrees: point i is the sum
/// of entries 0...i. `breaks` lists the first index of each segment after the
/// first; the recorder starts a new segment after a pause.
struct EncodedActivityRoute: Decodable, Equatable {
    let v: Int
    let start_ms: Int
    let dt: [Int]
    let dlat: [Int]
    let dlon: [Int]
    let alt: [Int?]
    let breaks: [Int]

    /// Coordinates per segment, in order. Empty when the arrays disagree or
    /// the format is unknown.
    var segments: [[CLLocationCoordinate2D]] {
        guard v == 1, dlat.count == dt.count, dlon.count == dt.count else { return [] }
        let starts = Set(breaks)
        var out: [[CLLocationCoordinate2D]] = []
        var current: [CLLocationCoordinate2D] = []
        var lat = 0
        var lon = 0
        for i in dt.indices {
            if starts.contains(i), !current.isEmpty {
                out.append(current)
                current = []
            }
            lat += dlat[i]
            lon += dlon[i]
            let point = CLLocationCoordinate2D(latitude: Double(lat) / 1_000_000,
                                               longitude: Double(lon) / 1_000_000)
            if CLLocationCoordinate2DIsValid(point) { current.append(point) }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    /// Segments a map can draw as a line: at least two points.
    var drawableSegments: [[CLLocationCoordinate2D]] {
        segments.filter { $0.count > 1 }
    }
}

struct ActivityRouteResponse: Decodable, Equatable {
    /// The activity the route belongs to, which can differ from the activity
    /// asked for when that is the intervals.icu copy of a run recorded in the
    /// app or of an Apple Health run.
    let activity_id: String
    /// "recording" for a run recorded in the app, "intervals" for a track
    /// intervals.icu sent, "healthkit" for the route Apple Health saved with
    /// another app's run. Nil from a server that predates P6.
    let source: String?
    /// The run recorded in the app behind the activity; nil for a track from
    /// intervals.icu, which the app didn't record.
    let recording_id: String?
    /// Nil for a run recorded without GPS fixes.
    let route: EncodedActivityRoute?
    /// The recorded run's heart rate after the stop (P7). Nil for other
    /// routes, a run recorded without it, and from an older server.
    var heart_rate_recovery: HeartRateRecovery? = nil
    /// A planned run's laps, one per step (planned-runs P9). Nil for other
    /// routes, a run recorded without a plan, and from an older server.
    var laps: [ActivityLap]? = nil
}

extension APIClient {
    /// `GET /api/activities/:id/route`. Nil when the activity has no route.
    /// A route intervals.icu can't send right now is an error, so it is
    /// asked for again later.
    func activityRoute(activityID: String, jwt: String) async throws -> ActivityRouteResponse? {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
        let id = activityID.addingPercentEncoding(withAllowedCharacters: allowed) ?? activityID
        do {
            let response: ActivityRouteResponse = try await get("api/activities/\(id)/route", jwt: jwt)
            return response
        } catch let error as APIError where error.httpStatus == 404 {
            return nil
        }
    }
}

/// The account and bearer a route read uses. Routes are private, so the
/// cache below never serves one account's routes to another.
struct ActivityRouteAccess: Equatable {
    let accountID: String
    let jwt: String
}

/// In-memory routes for this process, per account. A route doesn't change,
/// so it is fetched once. "No route" is remembered for a few minutes only,
/// since the intervals.icu copy of a run can sync before the run it
/// duplicates is matched to it.
@MainActor
final class ActivityRouteStore {
    static let shared = ActivityRouteStore()

    typealias Fetch = (_ activityID: String, _ jwt: String) async throws -> ActivityRouteResponse?

    private let fetch: Fetch
    private let now: () -> Date
    private var accountID: String?
    private var routes: [String: ActivityRouteResponse] = [:]
    private var missing: [String: Date] = [:]
    static let missingLifetime: TimeInterval = 10 * 60

    init(fetch: @escaping Fetch = { id, jwt in try await APIClient().activityRoute(activityID: id, jwt: jwt) },
         now: @escaping () -> Date = Date.init) {
        self.fetch = fetch
        self.now = now
    }

    /// The route behind `activityID`, or nil when it has none or the read
    /// failed. A failed read is tried again next time.
    func route(for activityID: String, access: ActivityRouteAccess) async -> ActivityRouteResponse? {
        if accountID != access.accountID {
            accountID = access.accountID
            routes = [:]
            missing = [:]
        }
        if let route = routes[activityID] { return route }
        if let since = missing[activityID], now().timeIntervalSince(since) < Self.missingLifetime { return nil }
        let route: ActivityRouteResponse?
        do {
            route = try await fetch(activityID, access.jwt)
        } catch {
            return nil
        }
        // The account may have changed while the read was in flight.
        guard accountID == access.accountID else { return nil }
        if let route {
            routes[activityID] = route
            missing[activityID] = nil
        } else {
            missing[activityID] = now()
        }
        return route
    }

    /// Drops the routes of a recording the member deleted, under every
    /// activity that showed it, so a card doesn't keep drawing it.
    func forget(recordingID: String) {
        let deleted = routes.filter { $0.value.recording_id?.caseInsensitiveCompare(recordingID) == .orderedSame }
        for activityID in deleted.keys {
            routes[activityID] = nil
            missing[activityID] = now()
        }
    }
}

/// A route on a map: every segment as its own line, framed to fit, and a
/// dot at `marker`, the point a chart is reading (P5).
struct ActivityRouteMap: View {
    let segments: [[CLLocationCoordinate2D]]
    var interactive = false
    var marker: CLLocationCoordinate2D? = nil
    var satellite = false

    var body: some View {
        Map(initialPosition: Self.camera(for: segments),
            interactionModes: interactive ? .all : []) {
            ForEach(segments.indices, id: \.self) { index in
                MapPolyline(coordinates: segments[index])
                    .stroke(Theme.signal, lineWidth: 4)
            }
            if let marker {
                Annotation("Chart point", coordinate: marker, anchor: .center) {
                    ActivityRouteMarker()
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(satellite ? .hybrid(pointsOfInterest: .excludingAll)
                            : .standard(pointsOfInterest: .excludingAll))
    }

    static func camera(for segments: [[CLLocationCoordinate2D]]) -> MapCameraPosition {
        region(for: segments).map { .region($0) } ?? .automatic
    }

    /// The smallest region showing every point, with a margin (1.3 is 30%
    /// more than the route's span), and never closer than about 300 m across.
    static func region(for segments: [[CLLocationCoordinate2D]], margin: Double = 1.3) -> MKCoordinateRegion? {
        let points = segments.flatMap { $0 }
        guard let first = points.first else { return nil }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for p in points {
            minLat = min(minLat, p.latitude)
            maxLat = max(maxLat, p.latitude)
            minLon = min(minLon, p.longitude)
            maxLon = max(maxLon, p.longitude)
        }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max((maxLat - minLat) * margin, 0.003),
                                    longitudeDelta: max((maxLon - minLon) * margin, 0.003))
        return MKCoordinateRegion(center: center, span: span)
    }
}

/// The dot on the route where a chart is reading.
struct ActivityRouteMarker: View {
    var body: some View {
        Circle()
            .fill(Theme.accent)
            .frame(width: 16, height: 16)
            .overlay(Circle().stroke(Color.white, lineWidth: 3))
            .shadow(color: .black.opacity(0.35), radius: 3)
            .accessibilityHidden(true)
    }
}

/// The route thumbnail on a run's card, with a dot where the card's charts
/// are reading. Tapping it, or its expand button, opens the route full
/// screen, where it can be moved and zoomed and the charts sit under it.
struct ActivityRouteThumbnail: View {
    let segments: [[CLLocationCoordinate2D]]
    var series: ActivityChartSeries? = nil
    @Binding var selectedX: Double?
    @State private var showsFullMap = false

    init(segments: [[CLLocationCoordinate2D]], series: ActivityChartSeries? = nil,
         selectedX: Binding<Double?> = .constant(nil)) {
        self.segments = segments
        self.series = series
        self._selectedX = selectedX
    }

    private var marker: CLLocationCoordinate2D? {
        guard let series, let index = series.selectedIndex(selectedX) else { return nil }
        return series.position(at: index)
    }

    var body: some View {
        Button {
            showsFullMap = true
        } label: {
            ActivityRouteMap(segments: segments, marker: marker)
                .frame(height: 180)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .allowsHitTesting(false)
                .overlay(alignment: .topTrailing) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.text)
                        .frame(width: 32, height: 32)
                        .background(.regularMaterial, in: Circle())
                        .padding(8)
                        .accessibilityHidden(true)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Route map")
        .accessibilityHint("Opens the route full screen.")
        .accessibilityIdentifier("activity.routeMap")
        .fullScreenCover(isPresented: $showsFullMap) {
            ActivityRouteDetailView(segments: segments, series: series)
        }
    }
}

/// A route full screen: the map on top, moved and zoomed by hand, with the
/// activity's charts under it. Touching a chart moves a dot along the route
/// to that point.
struct ActivityRouteDetailView: View {
    let segments: [[CLLocationCoordinate2D]]
    let series: ActivityChartSeries?
    @State private var selectedX: Double?
    @State private var satellite = false
    @Environment(\.dismiss) private var dismiss

    private var marker: CLLocationCoordinate2D? {
        guard let series, let index = series.selectedIndex(selectedX) else { return nil }
        return series.position(at: index)
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                // A wide screen (an iPad or a phone in landscape) puts the
                // charts beside the map, so neither becomes a thin strip.
                if let series, geometry.size.width > geometry.size.height {
                    HStack(spacing: 0) {
                        map
                        charts(series)
                            .frame(width: min(460, geometry.size.width * 0.42))
                    }
                } else {
                    VStack(spacing: 0) {
                        map
                            .frame(height: series == nil ? geometry.size.height : geometry.size.height * 0.55)
                        if let series { charts(series) }
                    }
                }
            }
            .ignoresSafeArea(edges: series == nil ? Edge.Set.bottom : [])
            .navigationTitle("Route")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        satellite.toggle()
                    } label: {
                        Image(systemName: satellite ? "map" : "globe.americas")
                    }
                    .accessibilityLabel(satellite ? "Show the map" : "Show satellite")
                    .accessibilityIdentifier("activity.routeMap.style")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var map: some View {
        ActivityRouteMap(segments: segments, interactive: true, marker: marker, satellite: satellite)
            .accessibilityIdentifier("activity.routeMap.full")
    }

    private func charts(_ series: ActivityChartSeries) -> some View {
        ScrollView {
            ActivityChartsView(series: series, selectedX: $selectedX,
                               mapFollows: series.hasPositions)
                .padding(16)
        }
        .background(Theme.surface)
    }
}

extension ExternalActivity {
    /// Runs recorded in the app have a route, shown either as the recording
    /// itself or as the intervals.icu copy it was matched to, and so do
    /// intervals.icu runs whose device kept a GPS track and Apple Health runs
    /// whose route the app sent (run-recorder P6).
    var mayHaveRoute: Bool {
        (kind == "run" && ["recording", "intervals", "healthkit"].contains(source))
            // An open-water swim's track (sport-activities P4): the Apple
            // Health route the app sent, also behind the intervals.icu or
            // `.fit` copy it was matched to, or intervals.icu's own track.
            || (kind == "swim" && (distance_m ?? 0) > 0)
    }
}

/// Reads a run's route when its card appears and hands the drawable
/// segments to `content`: none until the route arrives, and none for an
/// activity that can't have one. `content` also gets the recording behind
/// the route, if any, which is how the intervals.icu copy of a run recorded
/// in the app is known to be one, that recording's heart rate recovery, and
/// its laps when it followed a planned run.
struct WithActivityRoute<Content: View>: View {
    let activity: ExternalActivity?
    let access: ActivityRouteAccess?
    @ViewBuilder let content: (_ segments: [[CLLocationCoordinate2D]], _ recordingID: String?,
                               _ recovery: HeartRateRecovery?, _ laps: [ActivityLap]) -> Content
    @State private var loaded: LoadedRoute?

    private struct LoadedRoute {
        let activityID: String
        let recordingID: String?
        let segments: [[CLLocationCoordinate2D]]
        let recovery: HeartRateRecovery?
        let laps: [ActivityLap]
    }

    var body: some View {
        let current = loaded?.activityID == activity?.id ? loaded : nil
        content(current?.segments ?? [], current?.recordingID, current?.recovery, current?.laps ?? [])
            .task(id: activity?.id) {
                guard let activity, activity.mayHaveRoute, let access else { return }
                let route = await ActivityRouteStore.shared.route(for: activity.id, access: access)
                guard !Task.isCancelled else { return }
                loaded = LoadedRoute(activityID: activity.id, recordingID: route?.recording_id,
                                     segments: route?.route?.drawableSegments ?? [],
                                     recovery: route?.heart_rate_recovery,
                                     laps: route?.laps ?? [])
            }
    }
}
