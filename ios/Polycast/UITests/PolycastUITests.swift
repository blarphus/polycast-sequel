import XCTest

final class PolycastUITests: XCTestCase {
    func testLaunches() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
    }

    func testLandscapePlayerAdvancesWithRealAutomaticCaptions() throws {
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

        let clock = app.staticTexts["landscape-player-time"]
        XCTAssertTrue(clock.waitForExistence(timeout: 15))
        let first = Double(clock.value as? String ?? "") ?? 0
        sleep(3)
        let second = Double(clock.value as? String ?? "") ?? 0
        XCTAssertGreaterThan(second, first + 1, "The real YouTube player did not advance")

        XCTAssertTrue(app.buttons.count > 1, "No clickable caption words were exposed")
    }

    func testLandscapeSharedPlayerLoadsPreviouslyBlackVideo() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestLandscapePlayer", "-uiTestLandscapeTerVideo"]
        app.launch()

        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
        let clock = app.staticTexts["landscape-player-time"]
        XCTAssertTrue(clock.waitForExistence(timeout: 15))
        let first = Double(clock.value as? String ?? "") ?? 0
        sleep(3)
        let second = Double(clock.value as? String ?? "") ?? 0
        XCTAssertGreaterThan(second, first + 1, "The shared YouTube player remained blank or failed to play")
    }

    func testLandscapeAutomaticSubtitleWordIsClickable() throws {
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

        let clock = app.staticTexts["landscape-player-time"]
        XCTAssertTrue(clock.waitForExistence(timeout: 15))
        let first = Double(clock.value as? String ?? "") ?? 0
        sleep(3)
        let second = Double(clock.value as? String ?? "") ?? 0
        XCTAssertGreaterThan(second, first + 1, "The retained YouTube player stopped advancing")
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
