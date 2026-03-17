import Foundation

struct LanguageOption: Identifiable, Hashable {
    let code: String
    let name: String

    var id: String { code }
}

enum LanguageOptions {
    static let all: [LanguageOption] = [
        .init(code: "en", name: "English"),
        .init(code: "es", name: "Spanish"),
        .init(code: "pt", name: "Brazilian Portuguese"),
        .init(code: "fr", name: "French"),
        .init(code: "ja", name: "Japanese"),
        .init(code: "de", name: "German"),
    ]

    static let cefrLevels = ["A1", "A2", "B1", "B2", "C1", "C2"]
}
