import XCTest

@MainActor
final class ReaderPopupUITests: XCTestCase {
    private func launchFixture() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestContentFixture"]
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        return app
    }

    func testDictionaryRowShowsImage() {
        let app = launchFixture()
        let row = app.buttons["suponer"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(app.images["dictionary-word-image"].waitForExistence(timeout: 5))
    }

    func testOpenWordPopupInReader() {
        let app = launchFixture()
        app.buttons["Open reader fixture"].tap()
        XCTAssertTrue(app.staticTexts["reader-fixture-page"].waitForExistence(timeout: 5))
        app.buttons["reader-display-settings"].tap()
        XCTAssertTrue(app.staticTexts["reader-settings-sheet"].waitForExistence(timeout: 5))
    }
}
