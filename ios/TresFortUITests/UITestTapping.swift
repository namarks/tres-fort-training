import XCTest

/// How long a UI test gives a screen to appear or go away. Simulators on a
/// loaded CI runner can take several seconds to present a sheet or cover, so
/// a fixed few seconds fails healthy runs. A wait ends as soon as its element
/// appears, so a longer limit only slows a run that is already failing. Use it
/// for every wait a test asserts. Keep a short literal only where the element
/// is optional (`if alert.waitForExistence(timeout: 3) { ... }`), since that
/// wait runs to its end whenever the element never comes.
enum UITestWait {
    static let screen: TimeInterval = 15
}

extension XCUIElement {
    /// Waits until the control exists, is enabled and can be tapped. A tap on
    /// a control that only exists can be dropped: during launch a button can
    /// be on screen but still disabled, and during an animation it can be
    /// covered.
    @discardableResult
    func waitUntilTappable(timeout: TimeInterval = UITestWait.screen) -> Bool {
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in self.exists && self.isEnabled && self.isHittable },
            object: nil)
        return XCTWaiter.wait(for: [ready], timeout: timeout) == .completed
    }

    /// Taps once the control can be tapped. Use it for taps that change state,
    /// such as logging a set, where a second tap would do something else.
    func tapWhenReady(timeout: TimeInterval = UITestWait.screen,
                      file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(waitUntilTappable(timeout: timeout),
                      "\(self) never became tappable", file: file, line: line)
        tap()
    }

    /// Taps the control once it can be tapped, then waits for `result` to
    /// appear. If the result hasn't appeared halfway through the wait and the
    /// control can still be tapped, the first tap was probably dropped, so it
    /// taps once more. Use it only where a second tap is harmless, such as a
    /// button that opens or closes a screen.
    func tap(until result: XCUIElement, timeout: TimeInterval = UITestWait.screen,
             file: StaticString = #filePath, line: UInt = #line) {
        tapWhenReady(timeout: timeout, file: file, line: line)
        if result.waitForExistence(timeout: timeout / 2) { return }
        if exists && isEnabled && isHittable { tap() }
        XCTAssertTrue(result.waitForExistence(timeout: timeout / 2),
                      "\(result) didn't appear after tapping \(self)", file: file, line: line)
    }
}

extension XCUIApplication {
    /// Opens Time and days on a composer opened on a weekday's sheet, where
    /// the days, time and "Keep what's on those days" wait closed by the add
    /// button (app-design-pass P28). Add to your week from the Plan tab
    /// shows them already, so this does nothing there.
    func openComposerWhen() {
        let days = buttons["composer.day.mon"]
        guard !days.exists else { return }
        let when = buttons["composer.when"]
        guard when.waitForExistence(timeout: UITestWait.screen), when.label == "Time and days" else { return }
        when.tap(until: days)
    }

    /// Brings a kind tile on Add to your week into view. The tiles are one
    /// row that scrolls sideways (app-design-pass P27), so a vertical swipe
    /// never reveals one past the screen's edge: drag the row instead, in
    /// short slow drags that stop where the finger stops.
    @discardableResult
    func revealComposerKind(_ kind: String, maxDrags: Int = 6) -> XCUIElement {
        let tile = buttons["composer.kind.\(kind)"]
        let strip = scrollViews["composer.kinds"]
        _ = tile.waitForExistence(timeout: UITestWait.screen)
        for _ in 0..<maxDrags where !(tile.isHittable && frame.contains(tile.frame)) {
            guard strip.exists else { break }
            let start = strip.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
            let end = strip.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.5))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        return tile
    }

    /// Scrolls the current screen in short, slow drags until `element` can be
    /// tapped, and reports whether it can. Use it instead of a `swipeUp()`
    /// loop: a swipe is a fling, and on a loaded simulator one fling can carry
    /// a row from under the tab bar to above the navigation bar, so the loop
    /// never sees it on screen. Each drag here moves the content less than the
    /// visible area and holds before lifting, so the content stops where the
    /// finger stops and the element passes through the visible area.
    ///
    /// When the element is already in the accessibility tree above the
    /// visible area it scrolls back down; otherwise it scrolls down the page,
    /// since rows far below the viewport are not materialized yet. A lazy
    /// list also drops rows that scrolled far above the viewport, so pass
    /// `searchingUp` when the element sits above the current position, such
    /// as a picker at the top of a long form the test has scrolled through.
    @discardableResult
    func scroll(toReveal element: XCUIElement, searchingUp: Bool = false,
                maxDrags: Int = 16) -> Bool {
        for _ in 0..<maxDrags {
            let band = visibleContentBand()
            guard band.height > 80 else { break }
            if isVisibleForTap(element, in: band) { return true }
            let elementIsAbove = element.exists ? element.frame.midY < band.minY + 8 : searchingUp
            // Drag near the leading edge, on row labels rather than trailing
            // switches or steppers a drag could catch. Offsets are measured
            // from the app's own origin.
            let x: CGFloat = 24
            let high = band.minY - frame.minY + band.height * 0.3
            let low = band.minY - frame.minY + band.height * 0.75
            let origin = coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: x, dy: elementIsAbove ? high : low))
            let end = origin.withOffset(CGVector(dx: x, dy: elementIsAbove ? low : high))
            start.press(forDuration: 0.1, thenDragTo: end,
                        withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        return isVisibleForTap(element, in: visibleContentBand())
    }

    private func isVisibleForTap(_ element: XCUIElement, in band: CGRect) -> Bool {
        guard element.exists else { return false }
        // A lazy Form can report a picker as hittable while its row is
        // behind the sheet's navigation bar. Keep scrolling until the tap
        // point is inside the unobscured content, not merely in the tree.
        let center = CGPoint(x: element.frame.midX, y: element.frame.midY)
        return band.insetBy(dx: 0, dy: 8).contains(center) && element.isHittable
    }

    /// The part of the screen where scrolled content can be tapped: below any
    /// navigation bar and top tab bar, above any bottom tab bar and keyboard.
    private func visibleContentBand() -> CGRect {
        var top = frame.minY + 60
        var bottom = frame.maxY - 40
        for bar in navigationBars.allElementsBoundByIndex where bar.exists && bar.isHittable {
            top = max(top, bar.frame.maxY)
        }
        let tabBar = tabBars.firstMatch
        if tabBar.exists && tabBar.isHittable {
            if tabBar.frame.midY > frame.midY {
                bottom = min(bottom, tabBar.frame.minY)
            } else {
                top = max(top, tabBar.frame.maxY)
            }
        }
        let keyboard = keyboards.firstMatch
        if keyboard.exists { bottom = min(bottom, keyboard.frame.minY) }
        return CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
    }
}

extension XCUIApplication {
    /// Opens the saved workouts from Today's + menu. The library's home is
    /// the Plan tab; on Today it waits in the menu so the screen stays calm.
    func openSavedWorkoutsFromToday(file: StaticString = #filePath, line: UInt = #line) {
        let saved = buttons["today.chooseWorkout"]
        buttons["today.moreWaysToTrain"].tapWhenReady(file: file, line: line)
        saved.tap(until: navigationBars["Workouts"], file: file, line: line)
    }
}
