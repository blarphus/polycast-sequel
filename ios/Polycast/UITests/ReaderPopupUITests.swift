import XCTest

/// Drives the reader to a word popup so the simulator framebuffer can be
/// inspected from the host (simctl io screenshot) without touching the Mac UI.
final class ReaderPopupUITests: XCTestCase {
    func testDictionaryRowShowsImage() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))

        let dictTab = app.tabBars.buttons["Dictionary"]
        XCTAssertTrue(dictTab.waitForExistence(timeout: 10))
        dictTab.tap()
        sleep(4)

        // Expand a word row and give the image time to load.
        let row = app.staticTexts["suponer"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        sleep(6)

        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "dictionary-row"
        shot.lifetime = .keepAlways
        add(shot)
    }

    func testOpenWordPopupInReader() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))

        // Books tab (assumes a logged-in session in the simulator).
        let booksTab = app.tabBars.buttons["Books"]
        XCTAssertTrue(booksTab.waitForExistence(timeout: 10))
        booksTab.tap()

        // Open the Spanish book in the grid.
        let bookCard = app.staticTexts["Al final mueren los dos"].firstMatch
        XCTAssertTrue(bookCard.waitForExistence(timeout: 10))
        bookCard.tap()

        // Wait for parse + pagination, page past the title page.
        sleep(20)
        app.swipeLeft()
        sleep(2)
        app.swipeLeft()
        sleep(2)

        // Page with saved-word highlights.
        let pageShot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        pageShot.name = "page"
        pageShot.lifetime = .keepAlways
        add(pageShot)

        // Open the Aa display settings sheet.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.83, dy: 0.09)).tap()
        sleep(3)
        let sheetShot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        sheetShot.name = "aa-sheet"
        sheetShot.lifetime = .keepAlways
        add(sheetShot)
    }
}
