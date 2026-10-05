import Foundation

/// A word as shown on the page, with punctuation glued on ("“Look!" -> prefix "“", word "Look", suffix "!").
public struct ReadingUnit: Identifiable, Hashable, Sendable {
    /// Index of the word token in the page's token list (used as the mark key).
    public var id: Int
    public var prefix: String
    public var word: String
    public var suffix: String
    public var key: String
    public var cls: TokenClass?
}

public enum ReadingUnits {
    public static func build(_ tokens: [Token]) -> [ReadingUnit] {
        var units: [ReadingUnit] = []
        var pendingPrefix = ""
        for (i, tok) in tokens.enumerated() {
            if let w = tok.w {
                units.append(ReadingUnit(id: i, prefix: pendingPrefix, word: tok.t, suffix: "", key: w, cls: tok.k))
                pendingPrefix = ""
                continue
            }
            // Punctuation run: text before the first whitespace sticks to the previous word,
            // text after the last whitespace sticks to the next word.
            let s = tok.t
            let parts = s.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
            let hasSpace = parts.count > 1
            let leading = parts.first ?? ""
            let trailing = hasSpace ? (parts.last ?? "") : ""
            if !units.isEmpty {
                units[units.count - 1].suffix += hasSpace ? leading : s
            } else if !hasSpace {
                pendingPrefix += s
            } else {
                pendingPrefix += leading
            }
            if hasSpace { pendingPrefix += trailing }
        }
        return units
    }
}
