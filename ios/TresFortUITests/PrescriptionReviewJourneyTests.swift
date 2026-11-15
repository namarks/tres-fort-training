import XCTest

final class PrescriptionReviewJourneyTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func editor(_ mode: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["TRESFORT_UI_FIXTURE"] = "app-store"
        app.launchEnvironment["TRESFORT_UI_PRESCRIPTION_REVIEW"] = mode
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        tap(app.buttons["today.viewWorkout"], in: app)
        tap(app.buttons["workoutDetails.edit"], in: app)
        tap(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Edit your saved'")).firstMatch, in: app)
        XCTAssertTrue(app.buttons["editor.slot.a-squat"].waitForExistence(timeout: UITestWait.screen))
        return app
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        _ = element.waitForExistence(timeout: 2)
        for _ in 0..<8 {
            if element.exists && element.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(element.exists)
        XCTAssertTrue(element.isHittable)
        element.tap()
    }

    private func enter(_ value: String, field: XCUIElement, app: XCUIApplication) {
        tap(field, in: app)
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: UITestWait.screen))
        let shown = field.value as? String ?? ""
        let old = shown == field.placeholderValue ? "" : shown
        if !old.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
            let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let text = field.value as? String ?? ""
                return text.isEmpty || text == field.placeholderValue
            }, object: field)
            XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: UITestWait.screen), .completed)
        }
        field.typeText(value)
        let entered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: UITestWait.screen), .completed)
    }

    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
    }

    func testReplacementReviewsNewLoadBeforeSaving() {
        let app = editor("replacement")
        tap(app.buttons["Options for Barbell Squat"], in: app)
        tap(app.buttons["Replace with…"], in: app)
        tap(app.buttons["replacement.exercise.review-dumbbell"], in: app)
        let field = app.textFields["slot.targetWeight"]
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Week-specific exercise targets'")).firstMatch.exists)
        for _ in 0..<8 where !field.exists { app.swipeUp() }
        XCTAssertTrue(field.waitForExistence(timeout: UITestWait.screen))
        XCTAssertNotEqual(field.value as? String, "135", "Total weight must not become weight per hand")
        enter("45", field: field, app: app)
        capture("replacement-reviewed-per-hand")
        tap(app.buttons["Save replacement"], in: app)
        let row = app.buttons["editor.slot.a-squat"]
        XCTAssertTrue(row.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(row.label.contains("Dumbbell Bench Press"))
        tap(row, in: app)
        XCTAssertEqual(app.textFields["slot.targetWeight"].value as? String, "45")
    }

    func testDraftSurvivesCancelAndConflictUntilExplicitReview() {
        let app = editor("conflict")
        tap(app.buttons["editor.slot.a-squat"], in: app)
        let field = app.textFields["slot.targetWeight"]
        enter("145", field: field, app: app)
        XCTAssertEqual(field.value as? String, "145")
        tap(app.buttons["Cancel"], in: app)
        tap(app.buttons["Keep editing"], in: app)
        XCTAssertEqual(field.value as? String, "145")
        tap(app.buttons["Save targets"], in: app)
        let review = app.buttons["Use my draft with these targets"]
        XCTAssertEqual(field.value as? String, "145")
        XCTAssertFalse(app.buttons["Save targets"].isEnabled)
        for _ in 0..<8 {
            if review.exists && review.isHittable { break }
            app.swipeDown()
        }
        XCTAssertTrue(review.waitForExistence(timeout: UITestWait.screen))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Currently saved:' AND label CONTAINS '140'")).firstMatch.exists)
        capture("native-target-conflict-keeps-draft")
        tap(review, in: app)
        tap(app.buttons["Save targets"], in: app)
        let row = app.buttons["editor.slot.a-squat"]
        XCTAssertTrue(row.waitForExistence(timeout: UITestWait.screen))
        tap(row, in: app)
        XCTAssertEqual(app.textFields["slot.targetWeight"].value as? String, "145")
    }
}
