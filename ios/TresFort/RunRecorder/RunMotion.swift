import CoreMotion
import Foundation

/// How much the phone is moving while a run records, from its accelerometer
/// (docs/plans/run-recorder P4). Steps shake the phone many times harder
/// than standing at a light does, wherever it's carried, which GPS speed
/// alone can't tell from a very slow walk. Auto-pause reads it.
struct RunMotionSample: Equatable {
    var timestamp: Date
    /// The RMS of the acceleration the user gave the phone (gravity removed)
    /// over the second before `timestamp`, in g.
    var level: Double
}

/// A protocol so the recorder's own logic is tested without a phone.
@MainActor
protocol RunMotionSource: AnyObject {
    var onMotion: ((RunMotionSample) -> Void)? { get set }
    func start()
    func stop()
}

/// CoreMotion's device motion, 25 readings a second, summed into one level a
/// second. Raw motion needs no permission and keeps coming with the phone
/// locked while the run's workout session keeps the app running.
@MainActor
final class AccelerometerRunMotion: RunMotionSource {
    var onMotion: ((RunMotionSample) -> Void)?

    static let readingsPerSecond = 25.0

    private let manager = CMMotionManager()
    private var running = false
    private var sumOfSquares = 0.0
    private var count = 0
    private var windowStart: TimeInterval?

    func start() {
        guard !running, manager.isDeviceMotionAvailable else { return }
        running = true
        sumOfSquares = 0
        count = 0
        windowStart = nil
        manager.deviceMotionUpdateInterval = 1 / Self.readingsPerSecond
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let motion else { return }
            let a = motion.userAcceleration
            let squared = a.x * a.x + a.y * a.y + a.z * a.z
            // CoreMotion stamps readings in seconds since the device booted.
            let stamp = motion.timestamp
            MainActor.assumeIsolated { self?.add(squared, at: stamp) }
        }
    }

    private func add(_ squared: Double, at stamp: TimeInterval) {
        guard running, squared.isFinite else { return }
        let start = windowStart ?? stamp
        windowStart = start
        sumOfSquares += squared
        count += 1
        guard stamp - start >= 1, count > 0 else { return }
        let level = (sumOfSquares / Double(count)).squareRoot()
        let age = ProcessInfo.processInfo.systemUptime - stamp
        sumOfSquares = 0
        count = 0
        windowStart = stamp
        onMotion?(RunMotionSample(timestamp: Date().addingTimeInterval(-age), level: level))
    }

    func stop() {
        guard running else { return }
        running = false
        manager.stopDeviceMotionUpdates()
    }
}
