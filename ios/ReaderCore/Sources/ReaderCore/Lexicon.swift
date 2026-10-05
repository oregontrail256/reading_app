import Foundation

public struct LexEntry: Codable, Sendable {
    /// Grapheme segments: [letters, phones, patternTag].
    public var seg: [[String]]
    public var p: [String]
    public var h: Bool
    public var hp: [Int]?
    public var syl: Int
    public var base: String?
    public var r: Int
    public var z: Double

    public var patterns: [String] { p }
    public var isHeartWord: Bool { h }
    public var rank: Int { r }
    /// Letter chunks for sounding out ("sh", "i", "p").
    public var chunks: [String] { seg.map { $0.first ?? "" } }
    /// Range of the irregular ("heart") part within the word's letters.
    public var heartRange: Range<Int>? {
        guard let hp, hp.count == 2 else { return nil }
        return hp[0]..<hp[1]
    }
}

public struct PhonicsPattern: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var order: Int
    public var name: String
    public var kid: String
    public var examples: [String]
}

public final class Lexicon: @unchecked Sendable {
    public let words: [String: LexEntry]
    public let patterns: [PhonicsPattern]
    public let patternById: [String: PhonicsPattern]
    /// Words sorted by frequency rank.
    public let byRank: [String]

    public init(words: [String: LexEntry], patterns: [PhonicsPattern]) {
        self.words = words
        self.patterns = patterns.sorted { $0.order < $1.order }
        self.patternById = Dictionary(uniqueKeysWithValues: patterns.map { ($0.id, $0) })
        self.byRank = words.keys.sorted { (words[$0]?.r ?? .max) < (words[$1]?.r ?? .max) }
    }

    public convenience init(lexiconURL: URL, patternsURL: URL) throws {
        let dec = JSONDecoder()
        let words = try dec.decode([String: LexEntry].self, from: Data(contentsOf: lexiconURL))
        let patterns = try dec.decode([PhonicsPattern].self, from: Data(contentsOf: patternsURL))
        self.init(words: words, patterns: patterns)
    }

    public func entry(_ word: String) -> LexEntry? {
        words[Lexicon.normalize(word)]
    }

    public static func normalize(_ word: String) -> String {
        word.lowercased().replacingOccurrences(of: "’", with: "'")
    }

    /// Split a surface word ("Ship") into display chunks matching the lexicon's graphemes ("Sh", "i", "p").
    public func displayChunks(_ surface: String) -> [String] {
        guard let e = entry(surface) else { return [surface] }
        let letters = Array(surface)
        var out: [String] = []
        var i = 0
        for c in e.chunks {
            let n = c.count
            guard i + n <= letters.count else { return [surface] }
            out.append(String(letters[i..<(i + n)]))
            i += n
        }
        return i == letters.count ? out : [surface]
    }
}
