import XCTest

@MainActor
final class PolycastUITests: XCTestCase {
    private func clockValue(_ element: XCUIElement) -> Double {
        if let number = element.value as? NSNumber { return number.doubleValue }
        if let text = element.value as? String, let number = Double(text) { return number }
        return Double(element.label) ?? 0
    }

    func testLaunches() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
    }

    func testHermeticLandscapePlayerAdvancesWithAutomaticCaptionFixture() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestLandscapePlayer"]
        app.launch()

        let player = app.webViews.firstMatch
        let subtitles = app.otherElements["landscape-subtitle-panel"]
        XCTAssertTrue(player.waitForExistence(timeout: 15))
        XCTAssertTrue(subtitles.waitForExistence(timeout: 15))
        XCTAssertGreaterThanOrEqual(subtitles.frame.minY, player.frame.maxY - 2)
        XCTAssertEqual(
            subtitles.frame.height,
            player.frame.height / 5,
            accuracy: 2,
            "The subtitle strip grew beyond its intended height"
        )

        let clock = subtitles.staticTexts.firstMatch
        XCTAssertTrue(clock.waitForExistence(timeout: 15))
        let first = clockValue(clock)
        sleep(3)
        let second = clockValue(clock)
        XCTAssertGreaterThan(second, first + 1, "The hermetic player clock did not advance")

        XCTAssertTrue(app.buttons.count > 1, "No clickable caption words were exposed")
    }

    func testHermeticSharedPlayerAdvancesWithoutNetwork() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestLandscapePlayer", "-uiTestLandscapeTerVideo"]
        app.launch()

        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
        let subtitles = app.otherElements["landscape-subtitle-panel"]
        XCTAssertTrue(subtitles.waitForExistence(timeout: 15))
        let clock = subtitles.staticTexts.firstMatch
        XCTAssertTrue(clock.waitForExistence(timeout: 15))
        let first = clockValue(clock)
        sleep(3)
        let second = clockValue(clock)
        XCTAssertGreaterThan(second, first + 1, "The shared hermetic player clock stopped")
    }

    func testHermeticAutomaticSubtitleWordIsClickable() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestLandscapePlayer", "-uiTestLandscapePaused"]
        app.launch()

        let word = app.buttons["en"]
        XCTAssertTrue(word.waitForExistence(timeout: 15))
        word.tap()

        XCTAssertTrue(
            app.staticTexts["Sign in to look up this word."].waitForExistence(timeout: 10),
            "Tapping a real caption word did not open a completed popup state"
        )
    }

    func testWatchExpansionKeepsTheSamePlayingYouTubeWebView() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestPersistentWatchPlayer"]
        app.launch()

        let player = app.webViews["youtube-player-webview"]
        XCTAssertTrue(player.waitForExistence(timeout: 15))
        XCTAssertEqual(app.webViews.count, 1)
        let originalInstance = player.value as? String
        XCTAssertFalse(originalInstance?.isEmpty ?? true)

        let open = app.buttons["Open landscape player"]
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        open.tap()

        let subtitles = app.otherElements["landscape-subtitle-panel"]
        XCTAssertTrue(subtitles.waitForExistence(timeout: 15))
        XCTAssertEqual(app.webViews.count, 1, "Expansion created a second YouTube player")
        XCTAssertEqual(
            app.webViews["youtube-player-webview"].value as? String,
            originalInstance,
            "Expansion replaced the vertical YouTube player instead of resizing it"
        )

        let clock = subtitles.staticTexts.firstMatch
        XCTAssertTrue(clock.waitForExistence(timeout: 15))
        let first = clockValue(clock)
        sleep(3)
        let second = clockValue(clock)
        XCTAssertGreaterThan(second, first + 1, "The retained hermetic player stopped advancing")
        XCTAssertTrue(app.buttons["y"].waitForExistence(timeout: 15))
    }

    func testWatchCuratedChannelLinkLoadsChannel() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestPersistentWatchPlayer"]
        app.launch()

        let channel = app.buttons["watch-channel-link"]
        XCTAssertTrue(channel.waitForExistence(timeout: 15))
        channel.tap()

        XCTAssertTrue(app.segmentedControls.buttons["Recent"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["Could not load channel."].exists)
    }
}
