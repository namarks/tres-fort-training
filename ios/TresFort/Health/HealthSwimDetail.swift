import Foundation
import HealthKit

/// A swim's detail as Apple Watch saves it in Apple Health
/// (docs/plans/sport-activities P4): pool or open water, the pool's length
/// and unit, one lap event per length with its stroke, and segment events
/// for each set, plus a swim distance and a stroke count sample per length.
/// The app sends it as `swim` with the workout; the Worker keeps it
/// (`src/swimDetail.ts`, the format's owner) and serves it back with a
/// summary for the day view. Nothing is estimated: a length without a
/// matching sample has no distance or stroke count.
struct HealthSwimDetail: Equatable {
    struct Length: Equatable {
        let start: TimeInterval
        let duration: TimeInterval
        let meters: Double?
        let strokes: Int?
        let stroke: String
    }

    struct SwimSet: Equatable {
        let start: TimeInterval
        let duration: TimeInterval
        let meters: Double?
        let lengths: Int
        let stroke: String
    }

    let location: String?
    let poolLengthMeters: Double?
    let poolUnit: String?
    let strokes: Int?
    let lengths: [Length]
    let sets: [SwimSet]

    /// A lap or segment event, in seconds from the workout's start.
    struct Event: Equatable {
        enum Kind: Equatable { case lap, segment }
        let kind: Kind
        let start: TimeInterval
        let duration: TimeInterval
        let stroke: String
    }

    /// A distance or stroke count sample, in seconds from the workout's start.
    struct Sample: Equatable {
        let start: TimeInterval
        let end: TimeInterval
        let value: Double

        var middle: TimeInterval { (start + end) / 2 }
    }

    /// The server's limits (`SWIM_LIMITS`).
    static let maximumLengths = 2_000
    static let maximumSets = 500

    /// HKSwimmingStrokeStyle by the name the server keeps.
    static func strokeName(_ raw: Int?) -> String {
        switch raw.flatMap(HKSwimmingStrokeStyle.init(rawValue:)) {
        case .freestyle: return "freestyle"
        case .backstroke: return "backstroke"
        case .breaststroke: return "breaststroke"
        case .butterfly: return "butterfly"
        case .mixed: return "mixed"
        case .kickboard: return "kickboard"
        default: return "unknown"
        }
    }

    /// "pool", "open_water", or nil when the watch didn't say.
    static func locationName(_ raw: Int?) -> String? {
        switch raw.flatMap(HKWorkoutSwimmingLocationType.init(rawValue:)) {
        case .pool: return "pool"
        case .openWater: return "open_water"
        default: return nil
        }
    }

    /// The pool's length in meters and the unit it was set in: yards when it
    /// is a whole number of yards and not of meters (a 25 yd pool is 22.86 m).
    static func poolLength(meters: Double, yards: Double) -> (meters: Double, unit: String)? {
        guard meters.isFinite, yards.isFinite, meters >= 10, meters <= 100 else { return nil }
        let wholeYards = abs(yards - yards.rounded()) < 0.01
        let wholeMeters = abs(meters - meters.rounded()) < 0.01
        return (meters, wholeYards && !wholeMeters ? "yd" : "m")
    }

    /// The detail from what Apple Health saved. A pool swim's lap events are
    /// its lengths; an open-water swim has no lengths, only sets. Nil when
    /// there is nothing to send.
    static func build(location: String?, poolLength: (meters: Double, unit: String)?,
                      events: [Event], distances: [Sample], strokeCounts: [Sample]) -> HealthSwimDetail? {
        func within(_ samples: [Sample], _ start: TimeInterval, _ duration: TimeInterval) -> [Sample] {
            let end = start + duration
            return samples.filter { $0.middle >= start && $0.middle <= end }
        }
        let laps: [Event] = location == "open_water" ? [] : Array(events
            .filter { $0.kind == .lap && $0.start.isFinite && $0.duration.isFinite && $0.start >= 0 && $0.duration >= 0 }
            .sorted { $0.start < $1.start }
            .prefix(maximumLengths))
        let lengths: [Length] = laps.map { lap in
            let meters = within(distances, lap.start, lap.duration)
            let strokes = within(strokeCounts, lap.start, lap.duration)
            return Length(
                start: lap.start, duration: lap.duration,
                meters: meters.isEmpty ? nil : meters.reduce(0) { $0 + $1.value },
                strokes: strokes.isEmpty ? nil : Int(strokes.reduce(0) { $0 + $1.value }.rounded()),
                stroke: lap.stroke)
        }
        let sets: [SwimSet] = events
            .filter { $0.kind == .segment && $0.start.isFinite && $0.duration.isFinite && $0.start >= 0 && $0.duration >= 0 }
            .sorted { $0.start < $1.start }
            .prefix(maximumSets)
            .map { segment in
                let end = segment.start + segment.duration
                let inside = lengths.filter { $0.start + $0.duration / 2 >= segment.start && $0.start + $0.duration / 2 <= end }
                let meters: Double?
                if !inside.isEmpty {
                    meters = inside.allSatisfy { $0.meters != nil } ? inside.reduce(0) { $0 + ($1.meters ?? 0) } : nil
                } else {
                    let samples = within(distances, segment.start, segment.duration)
                    meters = samples.isEmpty ? nil : samples.reduce(0) { $0 + $1.value }
                }
                return SwimSet(start: segment.start, duration: segment.duration, meters: meters,
                               lengths: inside.count, stroke: segment.stroke)
            }
        let total = strokeCounts.isEmpty ? nil : Int(strokeCounts.reduce(0) { $0 + $1.value }.rounded())
        guard location != nil || poolLength != nil || total != nil || !lengths.isEmpty || !sets.isEmpty else {
            return nil
        }
        return HealthSwimDetail(location: location, poolLengthMeters: poolLength?.meters,
                                poolUnit: poolLength?.unit, strokes: total, lengths: lengths, sets: sets)
    }

    /// The push body's `swim` value, in `src/swimDetail.ts`'s shape.
    var jsonBody: [String: Any] {
        func tenth(_ value: Double) -> Double { (value * 10).rounded() / 10 }
        var body: [String: Any] = [
            "lengths": lengths.map { length -> [String: Any] in
                var item: [String: Any] = [
                    "start_s": tenth(length.start), "duration_s": tenth(length.duration), "stroke": length.stroke,
                ]
                if let meters = length.meters { item["distance_m"] = tenth(meters) }
                if let strokes = length.strokes { item["strokes"] = strokes }
                return item
            },
            "sets": sets.map { set -> [String: Any] in
                var item: [String: Any] = [
                    "start_s": tenth(set.start), "duration_s": tenth(set.duration),
                    "lengths": set.lengths, "stroke": set.stroke,
                ]
                if let meters = set.meters { item["distance_m"] = tenth(meters) }
                return item
            },
        ]
        if let location { body["location"] = location }
        if let poolLengthMeters, let poolUnit {
            body["pool_length_m"] = (poolLengthMeters * 100).rounded() / 100
            body["pool_unit"] = poolUnit
        }
        if let strokes { body["strokes"] = strokes }
        return body
    }
}

extension HealthSwimDetail {
    /// Pool or open water, from the workout's metadata.
    static func location(of workout: HKWorkout) -> String? {
        locationName((workout.metadata?[HKMetadataKeySwimmingLocationType] as? NSNumber)?.intValue)
    }

    /// Reads a swim's detail. Nil when HealthKit fails (the push then leaves
    /// the stored detail alone); `.none` inside when the swim saved nothing.
    static func read(for workout: HKWorkout, store: HKHealthStore) async -> HealthSwimDetail?? {
        let start = workout.startDate
        let location = location(of: workout)
        let pool = (workout.metadata?[HKMetadataKeyLapLength] as? HKQuantity).flatMap { q in
            poolLength(meters: q.doubleValue(for: .meter()), yards: q.doubleValue(for: .yard()))
        }
        let events: [Event] = (workout.workoutEvents ?? []).compactMap { event in
            let kind: Event.Kind
            switch event.type {
            case .lap: kind = .lap
            case .segment: kind = .segment
            default: return nil
            }
            let style = (event.metadata?[HKMetadataKeySwimmingStrokeStyle] as? NSNumber)?.intValue
            return Event(kind: kind, start: event.dateInterval.start.timeIntervalSince(start),
                         duration: event.dateInterval.duration, stroke: strokeName(style))
        }
        let source = workout.sourceRevision.source
        guard let distances = await samples(.distanceSwimming, unit: .meter(), workout: workout, source: source, store: store),
              let strokes = await samples(.swimmingStrokeCount, unit: .count(), workout: workout, source: source, store: store)
        else { return nil }
        return .some(build(location: location, poolLength: pool, events: events,
                           distances: distances, strokeCounts: strokes))
    }

    /// The workout app's own samples of `identifier` inside the workout, in
    /// seconds from its start. Nil when HealthKit fails; a denied read is
    /// indistinguishable from none and returns an empty list.
    private static func samples(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, workout: HKWorkout,
                                source: HKSource, store: HKHealthStore) async -> [Sample]? {
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: []),
            HKQuery.predicateForObjects(from: source),
        ])
        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: HKQuantityType(identifier), predicate: predicate,
                limit: HKObjectQueryNoLimit, sortDescriptors: nil
            ) { _, results, error in
                if error != nil { continuation.resume(returning: nil); return }
                let samples = (results as? [HKQuantitySample] ?? []).map { sample in
                    Sample(start: sample.startDate.timeIntervalSince(workout.startDate),
                           end: sample.endDate.timeIntervalSince(workout.startDate),
                           value: sample.quantity.doubleValue(for: unit))
                }
                continuation.resume(returning: samples.filter { $0.value.isFinite && $0.value >= 0 })
            }
            store.execute(query)
        }
    }
}

/// Apple Watch's workout effort score (sport-activities P5): the member's own
/// rating in Apple's Fitness app, else the watch's estimate, 1 to 10. Read on
/// iOS 18 and later, where Apple Health has it.
enum HealthEffortScore {
    /// Whether this iOS has the score (iOS 18 and later).
    static var isAvailable: Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    /// The read types to ask for, empty before iOS 18.
    static var readTypes: [HKObjectType] {
        if #available(iOS 18.0, *) {
            return [HKQuantityType(.workoutEffortScore), HKQuantityType(.estimatedWorkoutEffortScore)]
        }
        return []
    }

    /// The member's rating wins over the estimate; a score outside 1 to 10 is
    /// not one.
    static func choose(rated: Double?, estimated: Double?) -> Double? {
        for value in [rated, estimated] {
            if let value, value.isFinite, value >= 1, value <= 10 { return (value * 10).rounded() / 10 }
        }
        return nil
    }

    /// The workout's score. `.some(nil)` when it has none; nil when HealthKit
    /// failed or before iOS 18, so the push leaves the stored score alone.
    static func read(for workout: HKWorkout, store: HKHealthStore) async -> Double?? {
        guard #available(iOS 18.0, *) else { return nil }
        guard let rated = await latest(.workoutEffortScore, workout: workout, store: store),
              let estimated = await latest(.estimatedWorkoutEffortScore, workout: workout, store: store)
        else { return nil }
        return .some(choose(rated: rated, estimated: estimated))
    }

    @available(iOS 18.0, *)
    private static func latest(_ identifier: HKQuantityTypeIdentifier, workout: HKWorkout,
                               store: HKHealthStore) async -> Double?? {
        let predicate = HKQuery.predicateForWorkoutEffortSamplesRelated(workout: workout, activity: nil)
        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: HKQuantityType(identifier), predicate: predicate, limit: 1,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
            ) { _, results, error in
                if error != nil { continuation.resume(returning: nil); return }
                let value = (results?.first as? HKQuantitySample)?.quantity.doubleValue(for: .appleEffortScore())
                continuation.resume(returning: .some(value))
            }
            store.execute(query)
        }
    }
}
