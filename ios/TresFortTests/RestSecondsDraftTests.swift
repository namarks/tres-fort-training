import XCTest
@testable import TresFort

final class RestSecondsDraftTests: XCTestCase {
    func testExactRestSecondsIncludeNonStepperValuesAndBoundaries() {
        for seconds in [0, 1, 20, 35, 601, 3_600] {
            let draft = RestSecondsDraft(seconds: seconds)
            XCTAssertEqual(draft.text, String(seconds))
            XCTAssertEqual(draft.seconds, seconds)
        }
        var edited = RestSecondsDraft(seconds: 120)
        edited.text = " 20 "
        XCTAssertEqual(edited.seconds, 20)
        XCTAssertEqual(edited.text, " 20 ", "Validation must not rewrite an in-progress field")
    }

    func testInvalidRestCannotSaveAClampedOrFallbackValue() {
        for text in ["", " ", "-1", "+20", "20.5", "2e1", "20 seconds", "٣٠", "３５",
                     "3601", "999999999999999999999999"] {
            var draft = RestSecondsDraft(seconds: 120)
            draft.text = text
            XCTAssertNil(draft.seconds, text)
            XCTAssertEqual(draft.text, text)
        }
    }

    func testExistingLongRestsRemainSavableWithoutClamping() {
        for saved in [3_601, 7_200, 9_007_199_254_740_991] {
            let draft = RestSecondsDraft(seconds: saved)
            XCTAssertEqual(draft.text, String(saved))
            XCTAssertEqual(draft.seconds, saved, "An unrelated target edit must retain the saved rest")
        }
        XCTAssertNil(RestSecondsDraft(seconds: -1).seconds, "Invalid negative data is not grandfathered")
    }

    func testChangingOneGroupRestPreservesTheOtherSavedLongRest() {
        var roundRest = RestSecondsDraft(seconds: 3_601)
        var transitionRest = RestSecondsDraft(seconds: 7_200)
        XCTAssertEqual(roundRest.seconds, 3_601)
        XCTAssertEqual(transitionRest.seconds, 7_200)
        roundRest.text = "35"
        XCTAssertEqual(roundRest.seconds, 35)
        XCTAssertEqual(transitionRest.seconds, 7_200, "Changing round rest must retain transition rest")
        transitionRest.text = "20"
        XCTAssertEqual(roundRest.seconds, 35)
        XCTAssertEqual(transitionRest.seconds, 20)
    }

    func testNewLongRestIsRejectedButRestoringTheSavedValueIsAllowed() {
        var draft = RestSecondsDraft(seconds: 3_601)
        draft.text = "7200"
        XCTAssertNil(draft.seconds, "The original value does not raise the limit for new values")
        draft.text = "0"
        XCTAssertEqual(draft.seconds, 0)
        draft.text = "3602"
        XCTAssertNil(draft.seconds)
        draft.text = "3601"
        XCTAssertEqual(draft.seconds, 3_601, "Restoring the original is still an unchanged rest")
    }
}
