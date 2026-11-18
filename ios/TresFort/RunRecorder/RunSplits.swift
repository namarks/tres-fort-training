import AVFoundation
import Foundation

/// A finished mile or kilometer, announced while the run records.
struct RunSplit: Equatable {
    var number: Int
    var unit: RunDistanceUnit
    /// Moving seconds for this split alone.
    var seconds: Double
    /// Moving seconds per unit over the whole run so far.
    var averagePace: Double

    /// "Mile 3. Split 8 32. Average pace 8 41 a mile."
    var spokenText: String {
        "\(unit.spokenName.capitalized) \(number). Split \(Self.spokenPace(seconds)). "
            + "Average pace \(Self.spokenPace(averagePace)) a \(unit.spokenName)."
    }

    /// A pace or split time the way a runner says it: "6 30", "6 oh 5", or
    /// "7 minutes" on the minute. Never "6:30", which the speech voice reads
    /// as a time of day ("six thirty" is fine, "seven o'clock" is not). An
    /// hour or more falls back to words.
    static func spokenPace(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        guard total >= 60, total < 3600 else { return spoken(seconds) }
        let minutes = total / 60, rest = total % 60
        switch rest {
        case 0: return "\(minutes) minute\(minutes == 1 ? "" : "s")"
        case 1..<10: return "\(minutes) oh \(rest)"
        default: return "\(minutes) \(rest)"
        }
    }

    static func spoken(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        let parts = [(total / 3600, "hour"), ((total % 3600) / 60, "minute"), (total % 60, "second")]
            .filter { $0.0 > 0 }
            .map { "\($0.0) \($0.1)\($0.0 == 1 ? "" : "s")" }
        return parts.isEmpty ? "0 seconds" : parts.joined(separator: " ")
    }
}

/// Watches distance and moving time for the next whole mile or kilometer.
struct RunSplitTracker {
    let unit: RunDistanceUnit
    private(set) var completed: Int
    private var lastSplitSeconds: Double

    /// Starts past the splits already run, so a recovered run or a changed
    /// unit doesn't announce them again. Their time is estimated from the
    /// average so far.
    init(unit: RunDistanceUnit, meters: Double = 0, movingSeconds: Double = 0) {
        self.unit = unit
        completed = Int(max(0, meters) / unit.meters)
        lastSplitSeconds = meters > 0 ? movingSeconds * Double(completed) * unit.meters / meters : 0
    }

    /// The split just finished, if the distance reached a new whole unit. A
    /// jump across several reports only the latest, with the time shared out.
    mutating func update(meters: Double, movingSeconds: Double) -> RunSplit? {
        let reached = Int(max(0, meters) / unit.meters)
        guard reached > completed else { return nil }
        let seconds = (movingSeconds - lastSplitSeconds) / Double(reached - completed)
        completed = reached
        lastSplitSeconds = movingSeconds
        return RunSplit(number: reached, unit: unit, seconds: max(0, seconds),
                        averagePace: movingSeconds / (meters / unit.meters))
    }
}

@MainActor
protocol RunSplitSpeaking: AnyObject {
    /// Says `text` after anything already being said, or, when `urgent`,
    /// cuts that off first so the cue is on time: a step starting is said
    /// as it starts, not after the end of a split announcement.
    func speak(_ text: String, urgent: Bool)
    /// One short countdown beep, as a timed step's last seconds tick down.
    func beep()
}

extension RunSplitSpeaking {
    func speak(_ text: String) { speak(text, urgent: false) }
}

/// Speaks over music or a podcast, ducking music and pausing a podcast, then
/// hands the audio back so it resumes (`RunAnnouncementAudio`). The run's
/// workout session keeps the app running while the phone is locked, and the
/// beta's audio background mode lets it speak then.
@MainActor
final class SystemRunSplitSpeaker: NSObject, RunSplitSpeaking, AVSpeechSynthesizerDelegate {
    private let synthesizer: AVSpeechSynthesizer
    private let audio: RunAnnouncementAudio

    override init() {
        let synthesizer = AVSpeechSynthesizer()
        self.synthesizer = synthesizer
        audio = RunAnnouncementAudio(session: SystemRunAnnouncementAudioSession(),
                                     isSpeaking: { synthesizer.isSpeaking })
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String, urgent: Bool) {
        // The cancelled utterance reports its end, which only schedules a
        // release that the new utterance keeps waiting.
        if urgent, synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        audio.willSpeak()
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = TimerCueVoice.preferred()
        synthesizer.speak(utterance)
    }

    /// The lift runner's timed-set tick, so a countdown sounds the same
    /// everywhere in the app.
    private lazy var beepPlayer: AVAudioPlayer? = {
        guard let url = Bundle.main.url(forResource: "timed-set-tick", withExtension: "wav") else { return nil }
        let player = try? AVAudioPlayer(contentsOf: url)
        player?.prepareToPlay()
        return player
    }()

    /// Beeps a second apart keep music ducked from the first to the step's
    /// announcement after the last.
    static let beepHold: Duration = .milliseconds(1_200)

    func beep() {
        guard let player = beepPlayer else { return }
        audio.willSpeak()
        player.currentTime = 0
        let played = player.play()
        audio.didStopSpeaking(holding: played ? Self.beepHold : .zero)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.audio.didStopSpeaking() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.audio.didStopSpeaking() }
    }
}
