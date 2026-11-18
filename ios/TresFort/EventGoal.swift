import Foundation

/// The member's goal event (`plans.meta.race`) as the app edits it
/// (docs/plans/coach-free-planning P1). The rules mirror the web's Event page
/// (`web/src/event.ts`): the same event types, distance presets and goal-time
/// format, so an event set on one reads the same on the other.
enum EventGoal {
    /// What a single-sport event trains: a run, a ride or a swim.
    enum Kind: String, Equatable {
        case run, ride, swim
    }

    /// Event types the editor offers; any other text the coach set is kept.
    struct Discipline: Equatable, Identifiable {
        let id: String
        let label: String
    }

    static let disciplines: [Discipline] = [
        Discipline(id: "running", label: "Running"),
        Discipline(id: "cycling", label: "Cycling"),
        Discipline(id: "swimming", label: "Swimming"),
        Discipline(id: "triathlon", label: "Triathlon"),
        Discipline(id: "duathlon", label: "Duathlon"),
    ]

    static let mile = 1_609.344

    struct Preset: Equatable, Identifiable {
        let label: String
        let meters: Double
        var id: String { label }
    }

    /// Common distances per kind, the same list as the web.
    static func presets(_ kind: Kind) -> [Preset] {
        switch kind {
        case .run:
            return [
                Preset(label: "1 mile", meters: mile),
                Preset(label: "5k", meters: 5_000),
                Preset(label: "8k", meters: 8_000),
                Preset(label: "10k", meters: 10_000),
                Preset(label: "15k", meters: 15_000),
                Preset(label: "10 miles", meters: 10 * mile),
                Preset(label: "Half marathon", meters: 21_097.5),
                Preset(label: "Marathon", meters: 42_195),
                Preset(label: "50k", meters: 50_000),
            ]
        case .ride:
            return [
                Preset(label: "40 km", meters: 40_000),
                Preset(label: "100 km", meters: 100_000),
                Preset(label: "100 miles", meters: 100 * mile),
                Preset(label: "200 km", meters: 200_000),
            ]
        case .swim:
            return [
                Preset(label: "500 yd", meters: 457.2),
                Preset(label: "750 m", meters: 750),
                Preset(label: "1500 m", meters: 1_500),
                Preset(label: "1 mile", meters: mile),
                Preset(label: "2.4 miles", meters: 2.4 * mile),
                Preset(label: "5 km", meters: 5_000),
            ]
        }
    }

    /// The kinds of session an event type trains; unknown types have none.
    static func kinds(_ discipline: String) -> [Kind] {
        let d = discipline.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        func matches(_ pattern: String) -> Bool { d.range(of: pattern, options: .regularExpression) != nil }
        if matches(#"\btri(athlon)?\b"#) { return [.swim, .ride, .run] }
        if matches("duathlon") { return [.run, .ride] }
        if matches(#"^(ride|riding|cycl|bike|biking|gravel|road cycling|mtb|gran fondo|century)"#) { return [.ride] }
        if matches(#"^(swim|open water)"#) { return [.swim] }
        if matches(#"^(run|running|road race|trail|track|cross country|xc)\b|marathon|\b\d+\s?k\b"#) { return [.run] }
        return []
    }

    /// The one kind a single-sport event is, else nil.
    static func singleKind(_ discipline: String) -> Kind? {
        let all = kinds(discipline)
        return all.count == 1 ? all[0] : nil
    }

    static func disciplineLabel(_ discipline: String) -> String {
        let text = discipline.trimmingCharacters(in: .whitespacesAndNewlines)
        if let known = disciplines.first(where: { $0.id == text.lowercased() }) { return known.label }
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    /// "18:00" or "1:45:30" to seconds; a bare number is minutes. Nil when it
    /// isn't a time. The same rule as the web's `parseGoalTime`.
    static func parseGoalTime(_ text: String) -> Int? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = CharacterSet(charactersIn: "0123456789")
        if !t.isEmpty, t.unicodeScalars.allSatisfy(digits.contains) {
            guard let minutes = Int(t), minutes > 0, minutes <= 7 * 24 * 60 else { return nil }
            return minutes * 60
        }
        guard let match = goalTimePattern.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) else { return nil }
        func group(_ index: Int) -> Int? {
            guard let range = Range(match.range(at: index), in: t) else { return nil }
            return Int(t[range])
        }
        let hasHours = match.range(at: 1).location != NSNotFound
        let hours = group(1)
        if hasHours && hours == nil { return nil }
        // Over a week is never a goal time; checking first keeps the sum from overflowing.
        if let hours, hours > 7 * 24 { return nil }
        guard let minutes = group(2), let seconds = group(3) else { return nil }
        if seconds >= 60 || (hours != nil && minutes >= 60) { return nil }
        let total = (hours ?? 0) * 3_600 + minutes * 60 + seconds
        return total > 0 ? total : nil
    }

    private static let goalTimePattern = try! NSRegularExpression(pattern: #"^(?:(\d+):)?(\d{1,2}):(\d{2})$"#)

    /// "18:00", "1:45:30": the web's clock format.
    static func goalTimeText(_ seconds: Int) -> String {
        let h = seconds / 3_600, m = seconds % 3_600 / 60, s = seconds % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    /// "6:26/mi" for a run or swim pace, "28.4 mph" for a ride; nil without
    /// a single kind, a distance and a goal time.
    static func goalPaceText(_ event: PlanEvent, unit: RunDistanceUnit) -> String? {
        guard let kind = singleKind(event.discipline ?? ""), let meters = event.distance_m, meters > 0,
              let seconds = event.goal_time_s, seconds > 0 else { return nil }
        switch kind {
        case .ride:
            let perHour = meters / unit.meters / (Double(seconds) / 3_600)
            return String(format: "%.1f %@", perHour, unit == .miles ? "mph" : "km/h")
        case .swim:
            // Swims read per 100 of the pool's unit: yards with miles, meters otherwise.
            let hundred = unit == .miles ? 91.44 : 100
            let total = Int((Double(seconds) / meters * hundred).rounded())
            return String(format: "%d:%02d/100 %@", total / 60, total % 60, unit == .miles ? "yd" : "m")
        case .run:
            let total = Int((Double(seconds) / meters * unit.meters).rounded())
            guard total < 3_600 else { return nil }
            return String(format: "%d:%02d/%@", total / 60, total % 60, unit.abbreviation)
        }
    }

    /// "19 days to go", "Tomorrow", "Today", or "2 days ago".
    static func countdown(_ event: PlanEvent, today: String) -> String? {
        guard let day = CalendarProjection.dayNumber(event.date),
              let now = CalendarProjection.dayNumber(today) else { return nil }
        let left = day - now
        switch left {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case 2...: return "\(left) days to go"
        case -1: return "Yesterday"
        default: return "\(-left) days ago"
        }
    }

    /// The card's top line: "THU, NOV 26 · 19 DAYS TO GO".
    static func dateLine(_ event: PlanEvent, today: String) -> String {
        let date = ProgramEditing.spokenDate(event.date)
        guard let countdown = countdown(event, today: today) else { return date.uppercased() }
        return "\(date) · \(countdown)".uppercased()
    }

    /// "5k · goal 20:00 · 6:26/mi", or nil when the event has none of them.
    static func detailLine(_ event: PlanEvent, unit: RunDistanceUnit) -> String? {
        var parts: [String] = []
        if let distance = event.distance?.trimmingCharacters(in: .whitespacesAndNewlines), !distance.isEmpty {
            parts.append(distance)
        } else if let meters = event.distance_m {
            parts.append(EventBuilding.distanceText(meters, unit))
        } else if let discipline = event.discipline, !discipline.isEmpty {
            parts.append(disciplineLabel(discipline))
        }
        if let goal = event.goal_time_s { parts.append("goal \(goalTimeText(goal))") }
        if let pace = goalPaceText(event, unit: unit) { parts.append(pace) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// A distance unit the editor's "Another distance" can be typed in.
enum EventDistanceUnit: String, CaseIterable, Identifiable {
    case km, mi, m, yd

    var id: String { rawValue }
    var meters: Double {
        switch self {
        case .km: return 1_000
        case .mi: return EventGoal.mile
        case .m: return 1
        case .yd: return 0.9144
        }
    }

    static func choices(for kind: EventGoal.Kind?) -> [EventDistanceUnit] {
        kind == .swim ? [.m, .yd, .km, .mi] : [.km, .mi]
    }
}

/// The event while the member edits it. Mirrors the web's `EventDraft`; a
/// save sends the whole event, keeping a priority and place the coach set.
struct EventGoalDraft: Equatable {
    /// How the distance is given for a single-sport event.
    enum DistanceChoice: Hashable {
        case noDistance
        case preset(String)
        case custom
        /// A distance saved as text only (such as one the coach set), kept as it is.
        case text
    }

    static let otherDiscipline = "other"

    var name: String
    private(set) var date: Date
    /// A known discipline id, or `otherDiscipline` with `otherText` typed in.
    private(set) var discipline: String
    private(set) var otherText: String
    var distanceChoice: DistanceChoice
    var customAmount: String
    var customUnit: EventDistanceUnit
    /// A free distance, such as "Sprint" or "70.3" (multisport and other types).
    var distanceLabel: String
    var goal: String
    private let original: PlanEvent?

    var isNew: Bool { original == nil }
    var dateString: String { CalendarProjection.dateString(date) }

    /// A new event starts as a run eight weeks out, the web's default type.
    init(today: String, unit: RunDistanceUnit) {
        let start = ProgramEditing.addingDays(56, to: today) ?? today
        name = ""
        date = CalendarProjection.date(from: start) ?? Date()
        discipline = "running"
        otherText = ""
        distanceChoice = .noDistance
        customAmount = ""
        customUnit = unit == .miles ? .mi : .km
        distanceLabel = ""
        goal = ""
        original = nil
    }

    init(event: PlanEvent, unit: RunDistanceUnit) {
        let saved = (event.discipline ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let known = EventGoal.disciplines.contains { $0.id == saved }
        name = event.name
        date = CalendarProjection.date(from: event.date) ?? Date()
        if saved.isEmpty {
            discipline = "running"
            otherText = ""
        } else if known {
            discipline = saved
            otherText = ""
        } else {
            discipline = Self.otherDiscipline
            otherText = saved
        }
        distanceChoice = .noDistance
        customAmount = ""
        customUnit = unit == .miles ? .mi : .km
        distanceLabel = event.distance ?? ""
        goal = event.goal_time_s.map(EventGoal.goalTimeText) ?? ""
        original = event
        guard let kind = self.kind else { return }
        if let meters = event.distance_m {
            if let preset = EventGoal.presets(kind).first(where: { abs($0.meters - meters) < 1 }) {
                distanceChoice = .preset(preset.label)
            } else {
                let unitChoice: EventDistanceUnit = kind == .swim ? (unit == .miles ? .yd : .m)
                    : (unit == .miles ? .mi : .km)
                distanceChoice = .custom
                customUnit = unitChoice
                customAmount = Self.amountText(meters / unitChoice.meters)
            }
        } else if let text = event.distance?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            // A distance saved as text only: a matching preset, else kept as it is.
            let preset = EventGoal.presets(kind).first { $0.label.lowercased() == text.lowercased() }
            distanceChoice = preset.map { .preset($0.label) } ?? .text
        }
    }

    /// The discipline as saved: the picked type, or the text typed for another.
    var savedDiscipline: String {
        discipline == Self.otherDiscipline ? otherText.trimmingCharacters(in: .whitespacesAndNewlines) : discipline
    }

    /// The single sport the draft's type is, which picks its distances.
    var kind: EventGoal.Kind? { EventGoal.singleKind(savedDiscipline) }

    var disciplineChoice: String { discipline }

    mutating func setDate(_ value: Date) { date = value }

    /// A new type keeps a preset only when it is still one of that type's.
    mutating func setDiscipline(_ value: String) {
        discipline = value
        reconcileDistance()
    }

    mutating func setOtherText(_ value: String) {
        otherText = value
        reconcileDistance()
    }

    private mutating func reconcileDistance() {
        guard let kind = self.kind else {
            if distanceChoice != .text { distanceChoice = .noDistance }
            return
        }
        switch distanceChoice {
        case .preset(let label) where !EventGoal.presets(kind).contains(where: { $0.label == label }):
            distanceChoice = .noDistance
        default: break
        }
        if !EventDistanceUnit.choices(for: kind).contains(customUnit) {
            customUnit = EventDistanceUnit.choices(for: kind)[0]
        }
    }

    /// The goal time typed, in seconds, when it reads as one.
    var goalSeconds: Int? { EventGoal.parseGoalTime(goal) }

    /// The event this draft saves, or what to fix first.
    func event() -> Result<PlanEvent, EventGoalDraftProblem> {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return .failure(.init("Name the event.")) }
        if name.count > 100 { return .failure(.init("Keep the name to 100 characters.")) }
        let discipline = savedDiscipline
        if discipline.isEmpty { return .failure(.init("Say what kind of event it is.")) }
        if discipline.count > 40 { return .failure(.init("Keep the event type to 40 characters.")) }
        var distance: String?
        var meters: Double?
        if let kind {
            switch distanceChoice {
            case .custom:
                let typed = customAmount.trimmingCharacters(in: .whitespacesAndNewlines)
                    .replacingOccurrences(of: ",", with: ".")
                guard let amount = Double(typed), amount.isFinite, amount > 0 else {
                    return .failure(.init("Enter the distance as a number."))
                }
                if let original, let saved = original.distance_m,
                   typed == Self.amountText(saved / customUnit.meters) {
                    // Untouched since it opened: keep the saved distance exactly,
                    // not the two-decimal figure the field shows.
                    meters = saved
                    distance = original.distance ?? "\(typed) \(customUnit.rawValue)"
                } else {
                    let value = (amount * customUnit.meters * 10).rounded() / 10
                    if value > 1_000_000 { return .failure(.init("That distance is too long.")) }
                    if value <= 0 { return .failure(.init("Enter the distance as a number.")) }
                    meters = value
                    distance = "\(Self.amountText(amount)) \(customUnit.rawValue)"
                }
            case .text:
                let text = distanceLabel.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { distance = text }
            case .preset(let label):
                if let preset = EventGoal.presets(kind).first(where: { $0.label == label }) {
                    distance = preset.label
                    meters = preset.meters
                }
            case .noDistance:
                break
            }
        } else {
            let text = distanceLabel.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.count > 40 { return .failure(.init("Keep the distance to 40 characters.")) }
            if !text.isEmpty { distance = text }
        }
        var goalSeconds: Int?
        if !goal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let seconds = EventGoal.parseGoalTime(goal), seconds <= 7 * 24 * 3_600 else {
                return .failure(.init("Enter the goal time like 18:00 or 1:45:30."))
            }
            goalSeconds = seconds
        }
        return .success(PlanEvent(
            name: name, date: dateString, discipline: discipline, distance: distance,
            distance_m: meters, goal_time_s: goalSeconds,
            priority: original?.priority, location: original?.location))
    }

    var problem: String? {
        if case .failure(let problem) = event() { return problem.message }
        return nil
    }

    /// Saving a new event needs a valid one; an edit also needs a change.
    var canSave: Bool {
        guard case .success(let event) = event() else { return false }
        return original.map { $0 != event } ?? true
    }

    /// "5", "3.1", "26.22": up to two decimals, no trailing zeros.
    static func amountText(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        if rounded == rounded.rounded() { return String(Int(rounded)) }
        var text = String(format: "%.2f", rounded)
        while text.hasSuffix("0") { text.removeLast() }
        return text
    }
}

struct EventGoalDraftProblem: Error, Equatable {
    let message: String
    init(_ message: String) { self.message = message }
}

extension PlanEvent {
    /// The `race` object for `PUT /api/plan/race`: every field the event has.
    var wire: [String: Any] {
        var race: [String: Any] = ["name": name, "date": date, "discipline": discipline ?? "running"]
        if let distance { race["distance"] = distance }
        if let distance_m { race["distance_m"] = distance_m }
        if let goal_time_s { race["goal_time_s"] = goal_time_s }
        if let priority { race["priority"] = priority }
        if let location { race["location"] = location }
        return race
    }
}
