import XCTest
@testable import TresFort

/// The Plan tab's one way in to a block (docs/plans/progressive-plans P4):
/// your own mix opens only without a block, and the coach prompt asks for
/// a block the member can still change week by week.
final class PlanBlockChooserTests: XCTestCase {
    func testStartFromMyWeekOpensOnlyWithoutABlock() {
        XCTAssertTrue(PlanBlockChooser.ownWeekAvailable(hasBlock: false))
        XCTAssertFalse(PlanBlockChooser.ownWeekAvailable(hasBlock: true))
    }

    func testCoachPromptAsksForAnEditableBlockThatKeepsYourWorkouts() {
        let prompt = PlanBlockChooser.coachPrompt
        XCTAssertTrue(prompt.contains("Read my current plan first"))
        XCTAssertTrue(prompt.contains("Keep the workouts I already do"))
        XCTAssertTrue(prompt.contains("review each week in the app and edit its targets on the web"))
        XCTAssertFalse(prompt.contains("\n"), "one paragraph pastes cleanly")
    }
}
