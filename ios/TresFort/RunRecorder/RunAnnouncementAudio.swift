import AVFoundation
import Foundation

/// The parts of the shared audio session a spoken run announcement uses.
@MainActor
protocol RunAnnouncementAudioSession: AnyObject {
    /// Ducks music and pauses a podcast for the announcement.
    func activate() throws
    /// Hands the audio back and tells the paused or ducked app it may resume.
    func deactivateNotifyingOthers() throws
}

@MainActor
final class SystemRunAnnouncementAudioSession: RunAnnouncementAudioSession {
    func activate() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .voicePrompt,
                                options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try session.setActive(true)
    }

    func deactivateNotifyingOthers() throws {
        try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// Holds the audio session while an announcement plays and gives it back
/// afterwards, so music or a podcast resumes.
///
/// Giving it back the moment the synthesizer reports the end of an utterance
/// often fails: the speech output is still running, so `setActive(false)`
/// answers busy, or the synthesizer still says it is speaking. Either way the
/// other app was never told it could resume and stayed paused or ducked. Here
/// the release waits a moment, then retries with a growing delay until the
/// session lets go. A new announcement takes the session over and cancels any
/// release still waiting.
@MainActor
final class RunAnnouncementAudio {
    /// Lets the synthesizer's output stop before the first try.
    static let settleDelay: Duration = .milliseconds(300)
    /// Waits between later tries, about 8 seconds in all.
    static let retryDelays: [Duration] = [.milliseconds(250), .milliseconds(500), .seconds(1), .seconds(2), .seconds(4)]

    private let session: RunAnnouncementAudioSession
    private let isSpeaking: () -> Bool
    private let sleep: (Duration) async -> Void
    private var generation = 0
    private var holding = false
    private var releaseTask: Task<Void, Never>?

    init(session: RunAnnouncementAudioSession,
         isSpeaking: @escaping () -> Bool,
         sleep: @escaping (Duration) async -> Void = { try? await Task.sleep(for: $0) }) {
        self.session = session
        self.isSpeaking = isSpeaking
        self.sleep = sleep
    }

    /// Whether the session is still held for an announcement.
    var isHolding: Bool { holding }

    /// Before each utterance.
    func willSpeak() {
        generation &+= 1
        releaseTask?.cancel()
        // Held even when activation fails: the synthesizer may activate the
        // session itself, and a release that finds nothing to undo is harmless.
        holding = true
        try? session.activate()
    }

    /// When an utterance finishes or is cancelled. `hold` keeps the session
    /// a while longer first: a countdown beep holds it until about when the
    /// next beep comes, so music stays ducked across the countdown instead of
    /// rising between beeps. The next cue cancels the wait; without one the
    /// session is given back as usual.
    func didStopSpeaking(holding hold: Duration = .zero) {
        guard holding else { return }
        let token = generation
        releaseTask?.cancel()
        releaseTask = Task { [weak self] in await self?.release(token, after: hold) }
    }

    /// Waits for the latest release to finish or give up, for tests.
    func settled() async {
        await releaseTask?.value
    }

    private func release(_ token: Int, after hold: Duration) async {
        if hold > .zero {
            await sleep(hold)
            guard !Task.isCancelled, token == generation else { return }
        }
        await sleep(Self.settleDelay)
        for attempt in 0...Self.retryDelays.count {
            if attempt > 0 { await sleep(Self.retryDelays[attempt - 1]) }
            guard !Task.isCancelled, token == generation, holding else { return }
            // Another utterance still playing reports its own end.
            guard !isSpeaking() else { continue }
            do {
                try session.deactivateNotifyingOthers()
                holding = false
                return
            } catch {
                continue
            }
        }
    }
}
