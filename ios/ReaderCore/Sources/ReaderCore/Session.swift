import Foundation

/// How a reading session collects evidence (M1: no speech recognition yet).
public enum ReadingMode: String, Codable, CaseIterable, Sendable {
    /// A parent sits alongside and taps words he misses or needs help with.
    case together
    /// He reads alone; tapping a word to hear it is the only signal.
    case alone
}

/// What happened to one word on a page.
public enum WordMark: String, Codable, Sendable {
    case none, helped, missed, tapped
}

public enum SessionGrading {
    /// Weight of an untapped word when he reads alone: weak evidence he read it.
    public static let aloneUntappedWeight = 0.3

    /// Turn a finished page into read events. `marks` is keyed by token index.
    public static func events(tokens: [Token], marks: [Int: WordMark], mode: ReadingMode, bookId: String?, date: Date = Date()) -> [ReadEvent] {
        var out: [ReadEvent] = []
        for (i, tok) in tokens.enumerated() {
            guard let w = tok.w else { continue }
            if tok.k == .story { continue }  // names and theme words are pre-taught, not assessed
            let mark: WordMark = marks[i] ?? WordMark.none
            switch (mode, mark) {
            case (.together, .none):
                out.append(ReadEvent(word: w, outcome: .correct, weight: 1, source: .parent, date: date, bookId: bookId))
            case (.together, .helped):
                out.append(ReadEvent(word: w, outcome: .hinted, hintLevel: 3, weight: 1, source: .parent, date: date, bookId: bookId))
            case (.together, .missed):
                out.append(ReadEvent(word: w, outcome: .incorrect, weight: 1, source: .parent, date: date, bookId: bookId))
            case (.together, .tapped), (.alone, .tapped), (.alone, .helped), (.alone, .missed):
                out.append(ReadEvent(word: w, outcome: .tapped, hintLevel: 4, weight: 1, source: mode == .together ? .parent : .tapOnly, date: date, bookId: bookId))
            case (.alone, .none):
                out.append(ReadEvent(word: w, outcome: .correct, weight: aloneUntappedWeight, source: .tapOnly, date: date, bookId: bookId))
            }
        }
        return out
    }
}

public enum Warmup {
    /// 6–8 quick words: mostly spaced-review items that are due, plus a couple using today's practice patterns.
    public static func pick(state: LearnerState, lexicon: Lexicon, book: Book?, seenWords: Set<String>, count: Int = 7, now: Date = Date()) -> [String] {
        var out: [String] = []
        func add(_ w: String) { if !out.contains(w) && out.count < count { out.append(w) } }

        let due = state.dueItems(now: now)
        // Due words first.
        for item in due where state.words[item] != nil { add(item) }
        // Due patterns: a word he has seen that uses it.
        for item in due where state.patterns[item] != nil {
            if let w = seenWords.sorted(by: { (lexicon.words[$0]?.r ?? .max) < (lexicon.words[$1]?.r ?? .max) })
                .first(where: { lexicon.words[$0]?.p.contains(item) == true && !out.contains($0) && state.knows($0, lexicon: lexicon) }) {
                add(w)
            }
        }
        // Today's practice: two target words from the upcoming book.
        if let book {
            var practice: [String] = []
            for tok in book.pages.flatMap(\.tokens) where tok.k == .target {
                if let w = tok.w, !practice.contains(w) { practice.append(w) }
            }
            for w in practice.prefix(2) { add(w) }
            for w in book.spec.newHeartWords { add(w) }
        }
        // Fill with recently missed words he should see again.
        for s in state.stickyWords(now: now) { add(s.word) }
        return out
    }
}
