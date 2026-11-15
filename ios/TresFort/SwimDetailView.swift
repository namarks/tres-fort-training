import SwiftUI

/// A swim's detail as `GET /api/activities/:id/swim` serves it
/// (src/swimDetail.ts, docs/plans/sport-activities P4): pool or open water,
/// the pool's length, each length and set with its stroke, and a summary.
struct ActivitySwimResponse: Decodable, Equatable {
    struct Length: Decodable, Equatable {
        let start_s: Double
        let duration_s: Double
        let distance_m: Double?
        let strokes: Int?
        let stroke: String
    }

    struct SwimSet: Decodable, Equatable {
        let start_s: Double
        let duration_s: Double
        let distance_m: Double?
        let lengths: Int
        let stroke: String
    }

    struct Detail: Decodable, Equatable {
        let location: String?
        let pool_length_m: Double?
        let pool_unit: String?
        let strokes: Int?
        let lengths: [Length]
        let sets: [SwimSet]
    }

    struct StrokeShare: Decodable, Equatable {
        let stroke: String
        let lengths: Int
        let distance_m: Double?
    }

    struct Summary: Decodable, Equatable {
        let length_count: Int
        let strokes: Int?
        let strokes_per_length: Double?
        let swolf: Double?
        let stroke_breakdown: [StrokeShare]
    }

    let activity_id: String
    let swim: Detail
    let summary: Summary
}

extension APIClient {
    /// `GET /api/activities/:id/swim`; nil when Tres Fort keeps no detail (404).
    func activitySwim(activityID: String, jwt: String) async throws -> ActivitySwimResponse? {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
        let id = activityID.addingPercentEncoding(withAllowedCharacters: allowed) ?? activityID
        do {
            let response: ActivitySwimResponse = try await get("api/activities/\(id)/swim", jwt: jwt)
            return response
        } catch let error as APIError where error.httpStatus == 404 {
            return nil
        }
    }
}

/// In-memory swim detail for this process, per account, like
/// `ActivityStreamsStore`: a finished swim doesn't change, so each is read
/// once, and "none kept" is remembered for a few minutes.
@MainActor
final class ActivitySwimStore {
    static let shared = ActivitySwimStore()

    typealias Fetch = (_ activityID: String, _ jwt: String) async throws -> ActivitySwimResponse?

    private let fetch: Fetch
    private let now: () -> Date
    private var accountID: String?
    private var loaded: [String: ActivitySwimResponse] = [:]
    private var missing: [String: Date] = [:]
    static let missingLifetime: TimeInterval = 10 * 60

    init(fetch: @escaping Fetch = { id, jwt in try await APIClient().activitySwim(activityID: id, jwt: jwt) },
         now: @escaping () -> Date = Date.init) {
        self.fetch = fetch
        self.now = now
    }

    func swim(for activityID: String, access: ActivityRouteAccess) async -> ActivitySwimResponse? {
        if accountID != access.accountID {
            accountID = access.accountID
            loaded = [:]
            missing = [:]
        }
        if let swim = loaded[activityID] { return swim }
        if let since = missing[activityID], now().timeIntervalSince(since) < Self.missingLifetime { return nil }
        let swim: ActivitySwimResponse?
        do {
            swim = try await fetch(activityID, access.jwt)
        } catch {
            return nil
        }
        guard accountID == access.accountID else { return nil }
        if let swim {
            loaded[activityID] = swim
            missing[activityID] = nil
        } else {
            missing[activityID] = now()
        }
        return swim
    }
}

extension ExternalActivity {
    /// Any swim: Apple Health sends the detail, and it is also served for
    /// another source's copy that an Apple Health swim was matched to.
    var mayHaveSwimDetail: Bool { kind == "swim" }
}

/// Reads a swim's detail when its card appears and hands it to `content`:
/// nil until it arrives, and nil for an activity with none. Hangs off the
/// whole card for the same reason as `WithActivityStreams`.
struct WithActivitySwim<Content: View>: View {
    let activity: ExternalActivity?
    let access: ActivityRouteAccess?
    var store: ActivitySwimStore? = nil
    @ViewBuilder let content: (_ swim: ActivitySwimResponse?) -> Content
    @State private var loaded: Loaded?

    /// Kept by the shown activity's id: the detail can belong to an Apple
    /// Health copy hidden behind it.
    private struct Loaded {
        let activityID: String
        let swim: ActivitySwimResponse
    }

    var body: some View {
        content(loaded?.activityID == activity?.id ? loaded?.swim : nil)
            .task(id: activity?.id) {
                guard let activity, activity.mayHaveSwimDetail, let access else { return }
                let response = await (store ?? .shared).swim(for: activity.id, access: access)
                guard !Task.isCancelled else { return }
                loaded = response.map { Loaded(activityID: activity.id, swim: $0) }
            }
    }
}

/// How a swim's detail reads: the pool, the headline figures and one line
/// per set, in the pool's own unit (yards in a yard pool), else the
/// member's. Pure, so it is unit tested.
struct SwimDetailFormat: Equatable {
    struct Figure: Equatable {
        let label: String
        let value: String
    }

    struct SetRow: Equatable, Identifiable {
        let id: Int
        let title: String
        let figures: String
    }

    /// "25 yd pool", "50 m pool", "Pool", "Open water" or nil.
    let place: String?
    let figures: [Figure]
    /// "Freestyle 30 · Breaststroke 4".
    let strokes: String?
    let sets: [SetRow]

    /// Yards or meters: the pool's unit, else the member's.
    static func yards(_ swim: ActivitySwimResponse.Detail, unit: RunDistanceUnit) -> Bool {
        switch swim.pool_unit {
        case "yd": return true
        case "m": return false
        default: return unit == .miles
        }
    }

    static func strokeName(_ stroke: String) -> String {
        switch stroke {
        case "freestyle": return "Freestyle"
        case "backstroke": return "Backstroke"
        case "breaststroke": return "Breaststroke"
        case "butterfly": return "Butterfly"
        case "mixed": return "Mixed"
        case "kickboard": return "Kick"
        default: return "Unknown stroke"
        }
    }

    static func distance(_ meters: Double, yards: Bool) -> String {
        "\(Int((yards ? meters / 0.9144 : meters).rounded()).formatted()) \(yards ? "yd" : "m")"
    }

    /// "1:52 /100yd", or nil without both a time and a distance.
    static func pacePer100(seconds: Double, meters: Double?, yards: Bool) -> String? {
        guard let meters, meters > 0, seconds > 0 else { return nil }
        return EnduranceEntry.paceLabel(seconds: Int(seconds.rounded()), meters: meters,
                                        unit: yards ? .yd : .m, kind: "swim")
    }

    init(_ response: ActivitySwimResponse, unit: RunDistanceUnit) {
        let swim = response.swim
        let summary = response.summary
        let yards = Self.yards(swim, unit: unit)
        switch swim.location {
        case "open_water":
            place = "Open water"
        case "pool":
            place = swim.pool_length_m.map { "\(Self.distance($0, yards: yards)) pool" } ?? "Pool"
        default:
            place = swim.pool_length_m.map { "\(Self.distance($0, yards: yards)) pool" }
        }
        var figures: [Figure] = []
        if summary.length_count > 0 { figures.append(Figure(label: "Lengths", value: "\(summary.length_count)")) }
        if let strokes = summary.strokes { figures.append(Figure(label: "Strokes", value: strokes.formatted())) }
        if let perLength = summary.strokes_per_length {
            figures.append(Figure(label: "Strokes / length", value: String(format: "%.1f", perLength)))
        }
        if let swolf = summary.swolf { figures.append(Figure(label: "SWOLF", value: String(format: "%.0f", swolf))) }
        self.figures = figures
        let shares = summary.stroke_breakdown.filter { $0.stroke != "unknown" }
        strokes = shares.count > 1
            ? shares.map { "\(Self.strokeName($0.stroke)) \($0.lengths)" }.joined(separator: " · ")
            : nil
        sets = swim.sets.enumerated().map { index, set in
            var parts: [String] = []
            if let meters = set.distance_m, meters > 0 { parts.append(Self.distance(meters, yards: yards)) }
            parts.append(RunFormat.duration(set.duration_s))
            if let pace = Self.pacePer100(seconds: set.duration_s, meters: set.distance_m, yards: yards) {
                parts.append(pace)
            }
            var title = "Set \(index + 1)"
            if set.stroke != "unknown" { title += " · " + Self.strokeName(set.stroke) }
            return SetRow(id: index, title: title, figures: parts.joined(separator: " · "))
        }
    }

    var isEmpty: Bool { place == nil && figures.isEmpty && strokes == nil && sets.isEmpty }
}

/// A swim's pool, lengths, strokes, SWOLF and sets on its day-view card.
struct SwimDetailSection: View {
    let swim: ActivitySwimResponse
    let unit: RunDistanceUnit

    var body: some View {
        let format = SwimDetailFormat(swim, unit: unit)
        if !format.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text("SWIM")
                        .font(Theme.mono(11, .bold)).tracking(2)
                        .foregroundStyle(Theme.muted)
                    if let place = format.place {
                        Text(place)
                            .font(.caption)
                            .foregroundStyle(Theme.muted)
                    }
                }
                if !format.figures.isEmpty {
                    LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading),
                                        GridItem(.flexible(), alignment: .leading)],
                              alignment: .leading, spacing: 12) {
                        ForEach(format.figures, id: \.label) { figure in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(figure.label.uppercased())
                                    .font(Theme.mono(9, .bold)).tracking(1)
                                    .foregroundStyle(Theme.dim)
                                Text(figure.value)
                                    .font(Theme.mono(15, .bold))
                                    .foregroundStyle(Theme.text)
                                    .monospacedDigit()
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                if let strokes = format.strokes {
                    Text(strokes)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(format.sets) { row in
                    HStack(alignment: .top, spacing: 10) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Theme.done)
                            .frame(width: 4)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title.uppercased())
                                .font(Theme.mono(11, .bold)).tracking(1)
                                .foregroundStyle(Theme.muted)
                            Text(row.figures)
                                .font(Theme.mono(13, .bold))
                                .foregroundStyle(Theme.text)
                                .monospacedDigit()
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("activity.swim.set.\(row.id)")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("activity.swim")
        }
    }
}
