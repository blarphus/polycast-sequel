import XCTest
@testable import Polycast

final class PolycastTests: XCTestCase {
    func testLanguageOptionsContainExpectedDefaults() {
        XCTAssertTrue(LanguageOptions.all.contains { $0.code == "en" })
        XCTAssertTrue(LanguageOptions.all.contains { $0.code == "es" })
        XCTAssertEqual(LanguageOptions.cefrLevels, ["A1", "A2", "B1", "B2", "C1", "C2"])
    }

    func testNewsArticleUsesLinkAsIdentifier() {
        let article = NewsArticle(
            originalTitle: "Original",
            simplifiedTitle: "Simplified",
            difficulty: "B1",
            source: "DW",
            link: "https://example.com/article",
            image: nil,
            preview: nil
        )

        XCTAssertEqual(article.id, article.link)
    }
}
