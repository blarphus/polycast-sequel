import Foundation

extension String {
    /// Case- and diacritic-insensitive form for search matching, so a query
    /// typed without accents still matches ("dano" finds "daño").
    func searchFolded() -> String {
        folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
    }
}

/// Canonical key used when comparing visible reader/transcript tokens with saved
/// dictionary words and their stored inflections.
func savedWordMatchKey(_ value: String) -> String {
    value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .precomposedStringWithCanonicalMapping
        .searchFolded()
        .lowercased()
}
