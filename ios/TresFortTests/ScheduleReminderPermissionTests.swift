import XCTest
import UserNotifications
@testable import TresFort

@MainActor
final class ScheduleReminderPermissionTests: XCTestCase {
    func testReadingPermissionDoesNotPromptAndGrantUpdatesFeedback() async {
        var status = UNAuthorizationStatus.notDetermined
        var requests = 0, changes = 0
        let model = ScheduleReminderPermissionModel(readStatus: { status }, requestPermission: {
            requests += 1; status = .authorized; return true
        }, didChange: { changes += 1 })
        await model.refresh()
        XCTAssertEqual(model.state, .notRequested)
        XCTAssertEqual(requests, 0)
        await model.enable()
        XCTAssertEqual(model.state, .allowed)
        XCTAssertFalse(model.requesting)
        XCTAssertEqual(requests, 1)
        XCTAssertEqual(changes, 1)
    }

    func testDenialAndRetryableRequestFailureStayDistinct() async {
        var status = UNAuthorizationStatus.notDetermined
        let model = ScheduleReminderPermissionModel(readStatus: { status }, requestPermission: { false }, didChange: {})
        await model.enable()
        XCTAssertEqual(model.state, .failed, "An unconfirmed request offers retry, not an invented denial")
        status = .denied
        await model.refresh()
        XCTAssertEqual(model.state, .denied)
        status = .authorized // Return from Settings without reopening the form.
        await model.refresh()
        XCTAssertEqual(model.state, .allowed)
        status = .provisional
        await model.refresh()
        XCTAssertEqual(model.state, .quiet)
    }

    func testDelayedEarlierReadCannotReplaceGrantedPermission() async {
        var pending: CheckedContinuation<UNAuthorizationStatus, Never>?
        let entered = expectation(description: "earlier status read held")
        var first = true
        let model = ScheduleReminderPermissionModel(readStatus: {
            if first {
                first = false
                return await withCheckedContinuation { pending = $0; entered.fulfill() }
            }
            return .authorized
        }, requestPermission: { true }, didChange: {})
        let earlier = Task { await model.refresh() }
        await fulfillment(of: [entered], timeout: 2)
        await model.enable()
        XCTAssertEqual(model.state, .allowed)
        pending?.resume(returning: .notDetermined)
        await earlier.value
        XCTAssertEqual(model.state, .allowed)
    }

    func testOverlappingEnableRequestsPromptOnlyOnce() async {
        var pending: CheckedContinuation<Bool, Never>?
        var requests = 0
        let entered = expectation(description: "permission request held")
        let model = ScheduleReminderPermissionModel(readStatus: { .authorized }, requestPermission: {
            requests += 1
            return await withCheckedContinuation { pending = $0; entered.fulfill() }
        }, didChange: {})
        let first = Task { await model.enable() }
        await fulfillment(of: [entered], timeout: 2)
        await model.enable()
        await model.refresh()
        XCTAssertEqual(requests, 1)
        pending?.resume(returning: true)
        await first.value
        XCTAssertEqual(model.state, .allowed)
    }
}
