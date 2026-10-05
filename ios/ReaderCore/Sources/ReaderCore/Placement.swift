import Foundation

/// A quick placement check: a few words per pattern, in sequence order, stop after two failed steps in a row.
public struct PlacementCheck: Sendable {
    public struct Step: Identifiable, Sendable {
        public var id: String { pattern.id }
        public var pattern: PhonicsPattern
        public var words: [String]
    }

    public static let skip: Set<String> = ["consonants", "advanced", "contraction", "multisyllable"]
    public let steps: [Step]

    public init(lexicon: Lexicon, wordsPerStep: Int = 4) {
        var steps: [Step] = []
        for p in lexicon.patterns where !PlacementCheck.skip.contains(p.id) {
            var ws: [String] = []
            for w in lexicon.byRank {
                guard let e = lexicon.words[w], e.r <= 6000, !e.h, !w.contains("'"), e.p.contains(p.id) else { continue }
                // only patterns at or before this one, so a miss points at this step
                let ok = e.p.allSatisfy { (lexicon.patternById[$0]?.order ?? .max) <= p.order }
                if ok && w.count >= 2 { ws.append(w) }
                if ws.count >= wordsPerStep { break }
            }
            if ws.count >= 3 { steps.append(Step(pattern: p, words: ws)) }
        }
        self.steps = steps
    }

    /// A step passes when at least 3 of 4 (75%) of its words are read correctly.
    public static func passed(correct: Int, of total: Int) -> Bool {
        total > 0 && Double(correct) / Double(total) >= 0.75
    }

    /// Given per-step results in order, the last pattern to mark mastered (the step before the first failure),
    /// or nil if he missed the very first step. (The view stops testing after two failed steps in a row.)
    public static func placement(results: [(pattern: String, passed: Bool)]) -> String? {
        var last: String?
        for r in results {
            if !r.passed { break }
            last = r.pattern
        }
        return last
    }
}
