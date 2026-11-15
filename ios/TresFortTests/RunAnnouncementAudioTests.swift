import Foundation
import XCTest
@testable import TresFort

@MainActor
private final class FakeAnnouncementSession: RunAnnouncementAudioSession {
    private(set) var activations = 0
    private(set) var deactivationTries = 0
    private(set) var deactivations = 0
    /// Tries that answer busy before one succeeds, like a speech output
    /// still running.
    var busyTries = 0

    struct Busy: Error {}

    func activate() throws { activations += 1 }

    func deactivateNotifyingOthers() throws {
        deactivationTries += 1
        if busyTries > 0 {
            busyTries -= 1
            throw Busy()
        }
        deactivations += 1
    }
}

@MainActor
private final class AnnouncementClock {
    private(set) var waits: [Duration] = []
    var onWait: ((Int) -> Void)?

    func wait(_ duration: Duration) {
        waits.append(duration)
        onWait?(waits.count)
    }
}

@MainActor
final class RunAnnouncementAudioTests: XCTestCase {
    private var session: FakeAnnouncementSession!
    private var clock: AnnouncementClock!
    private var speaking: [Bool] = []

    override func setUp() async throws {
        session = FakeAnnouncementSession()
        clock = AnnouncementClock()
        speaking = []
    }

    private func makeAudio() -> RunAnnouncementAudio {
        RunAnnouncementAudio(
            session: session,
            isSpeaking: { [unowned self] in self.speaking.isEmpty ? false : self.speaking.removeFirst() },
            sleep: { [clock] duration in await clock?.wait(duration) })
    }

    func testHandsTheAudioBackAfterTheAnnouncement() async {
        let audio = makeAudio()
        audio.willSpeak()
        XCTAssertEqual(session.activations, 1)
        XCTAssertTrue(audio.isHolding)

        audio.didStopSpeaking()
        await audio.settled()

        XCTAssertEqual(session.deactivations, 1)
        XCTAssertFalse(audio.isHolding)
        XCTAssertEqual(clock.waits, [RunAnnouncementAudio.settleDelay])
    }

    /// The bug from the owner's run on 2026-11-12: the release came while the
    /// speech output was still running, answered busy, and music stayed paused.
    func testRetriesWhileTheSessionIsBusy() async {
        session.busyTries = 2
        let audio = makeAudio()
        audio.willSpeak()
        audio.didStopSpeaking()
        await audio.settled()

        XCTAssertEqual(session.deactivationTries, 3)
        XCTAssertEqual(session.deactivations, 1)
        XCTAssertFalse(audio.isHolding)
        XCTAssertEqual(clock.waits, [RunAnnouncementAudio.settleDelay] + RunAnnouncementAudio.retryDelays.prefix(2))
    }

    func testWaitsWhileTheSynthesizerStillSaysItIsSpeaking() async {
        speaking = [true, true]
        let audio = makeAudio()
        audio.willSpeak()
        audio.didStopSpeaking()
        await audio.settled()

        XCTAssertEqual(session.deactivationTries, 1)
        XCTAssertFalse(audio.isHolding)
        XCTAssertEqual(clock.waits.count, 3)
    }

    func testANewAnnouncementKeepsTheAudio() async {
        let audio = makeAudio()
        audio.willSpeak()
        // The next announcement starts while the first one's release waits.
        clock.onWait = { count in if count == 1 { audio.willSpeak() } }
        audio.didStopSpeaking()
        await audio.settled()
        XCTAssertEqual(session.activations, 2)
        XCTAssertEqual(session.deactivationTries, 0)
        XCTAssertTrue(audio.isHolding)

        clock.onWait = nil
        audio.didStopSpeaking()
        await audio.settled()
        XCTAssertEqual(session.deactivationTries, 1)
        XCTAssertEqual(session.deactivations, 1)
        XCTAssertFalse(audio.isHolding)
    }

    func testGivesUpAfterTheLastTryAndReleasesAfterTheNextAnnouncement() async {
        session.busyTries = RunAnnouncementAudio.retryDelays.count + 1
        let audio = makeAudio()
        audio.willSpeak()
        audio.didStopSpeaking()
        await audio.settled()
        XCTAssertEqual(session.deactivationTries, RunAnnouncementAudio.retryDelays.count + 1)
        XCTAssertTrue(audio.isHolding)

        audio.willSpeak()
        audio.didStopSpeaking()
        await audio.settled()
        XCTAssertEqual(session.deactivations, 1)
        XCTAssertFalse(audio.isHolding)
    }

    func testAnEndWithoutAnAnnouncementTouchesNothing() async {
        let audio = makeAudio()
        audio.didStopSpeaking()
        await audio.settled()
        XCTAssertEqual(session.deactivationTries, 0)
        XCTAssertTrue(clock.waits.isEmpty)
    }
}
