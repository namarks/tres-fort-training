import Foundation
import XCTest
@testable import TresFort

final class WorkoutRecordLinkTests: XCTestCase {
    func testExactRecordAndOptionalSetRetainReviewedIdentity() throws {
        let link = try XCTUnwrap(WorkoutRecordLink(url: URL(string:
            "tresfort://workout-record?account=user-a&session=session-b&attempt=3&set=set-c")!))
        XCTAssertEqual(link.accountID, "user-a")
        XCTAssertEqual(link.sessionID, "session-b")
        XCTAssertEqual(link.attempt, 3)
        XCTAssertEqual(link.setID, "set-c")
        XCTAssertEqual(try JSONDecoder().decode(WorkoutRecordLink.self,
            from: JSONEncoder().encode(link)), link)
        let withoutSet = try XCTUnwrap(WorkoutRecordLink(url: URL(string:
            "tresfort://workout-record?attempt=0&session=session-b&account=user-a")!))
        XCTAssertNil(withoutSet.setID)
        XCTAssertEqual(withoutSet.attempt, 0)
    }

    func testAmbiguousOrIncompleteTargetsAreRejected() {
        let valid = "tresfort://workout-record?account=user-a&session=session-b&attempt=0"
        let invalid = [
            valid + "&session=session-c", valid + "&set=", valid + "&date=2026-11-14",
            valid + "#other", valid.replacingOccurrences(of: "tresfort:", with: "https:"),
            valid.replacingOccurrences(of: "workout-record?", with: "workout-record/other?"),
            valid.replacingOccurrences(of: "workout-record?", with: "user@workout-record?"),
            valid.replacingOccurrences(of: "workout-record?", with: "workout-record:42?"),
            valid.replacingOccurrences(of: "user-a", with: "user%2Fa"),
            valid.replacingOccurrences(of: "user-a", with: String(repeating: "a", count: 129)),
            valid.replacingOccurrences(of: "attempt=0", with: "attempt=-1"),
            valid.replacingOccurrences(of: "attempt=0", with: "attempt=1.5"),
            valid.replacingOccurrences(of: "attempt=0", with: "attempt=9007199254740992"),
            valid.replacingOccurrences(of: "attempt=0", with: "attempt="),
            valid.replacingOccurrences(of: "&attempt=0", with: ""),
            valid.replacingOccurrences(of: "account=user-a&", with: ""),
        ]
        for raw in invalid {
            XCTAssertNil(WorkoutRecordLink(url: URL(string: raw)!), raw)
        }
    }
}
