import XCTest
@testable import ReaderCore

final class LearnerModelTests: XCTestCase {
    var lex: Lexicon!
    let day: TimeInterval = 86_400
    let t0 = Date(timeIntervalSince1970: 1_790_000_000)

    override func setUpWithError() throws {
        let lexURL = try XCTUnwrap(Bundle.module.url(forResource: "lexicon", withExtension: "json", subdirectory: "Fixtures"))
        let patURL = try XCTUnwrap(Bundle.module.url(forResource: "patterns", withExtension: "json", subdirectory: "Fixtures"))
        lex = try Lexicon(lexiconURL: lexURL, patternsURL: patURL)
    }

    func placed() -> LearnerState {
        var s = LearnerState()
        s.place(through: "suffix_ed", lexicon: lex, heartTopN: 4, now: t0)
        return s
    }

    func testPlacement() {
        let s = placed()
        XCTAssertTrue(s.knows("cat", lexicon: lex))
        XCTAssertTrue(s.knows("jumped", lexicon: lex))
        XCTAssertFalse(s.knows("cake", lexicon: lex))
        XCTAssertTrue(s.knows("said", lexicon: lex), "top heart words are placed as mastered")
        XCTAssertEqual(s.patternState("vce_a"), .new)
    }

    func testPatternMasteryNeedsBreadthAccuracyAndTwoDays() {
        var s = placed()
        let vce = ["cake", "make", "bake", "lake", "made", "game", "name", "take", "same", "came", "gave"]
        // Day 1: eight different words, all correct -> still learning (only one day).
        for w in vce.prefix(8) { s.record(ReadEvent(word: w, outcome: .correct, source: .parent, date: t0), lexicon: lex) }
        XCTAssertEqual(s.patternState("vce_a"), .learning)
        // Day 2: more correct reads -> reviewing.
        for w in vce.suffix(3) { s.record(ReadEvent(word: w, outcome: .correct, source: .parent, date: t0 + day), lexicon: lex) }
        XCTAssertEqual(s.patternState("vce_a"), .reviewing)
        XCTAssertTrue(s.knows("cake", lexicon: lex))

        // Spaced reviews at 1, 3, 7 days -> mastered.
        var t = t0 + day
        for gap in [1.0, 3, 7] {
            t += gap * day + 60
            s.record(ReadEvent(word: "cake", outcome: .correct, source: .parent, date: t), lexicon: lex)
        }
        XCTAssertEqual(s.patternState("vce_a"), .mastered)
    }

    func testMissesKeepPatternLearning() {
        var s = placed()
        let vce = ["cake", "make", "bake", "lake", "made", "game", "name", "take"]
        for (i, w) in vce.enumerated() {
            let outcome: Outcome = i % 3 == 0 ? .incorrect : .correct
            s.record(ReadEvent(word: w, outcome: outcome, source: .parent, date: t0 + Double(i) * day), lexicon: lex)
        }
        XCTAssertEqual(s.patternState("vce_a"), .learning)
    }

    func testMissOnDecodableWordIsDownweightedForMasteredPatterns() {
        var s = placed()
        s.record(ReadEvent(word: "cat", outcome: .incorrect, source: .parent, date: t0), lexicon: lex)
        XCTAssertEqual(s.patterns["short_a"]!.history.last!.weight, 0.3, accuracy: 1e-9)
    }

    func testMissOnWordWithUnlearnedPatternOnlyHitsThatPattern() {
        var s = placed()
        let before = s.patterns["short_a"]!.history.count
        // "cake": he hasn't learned silent e, so tapping it must not count against short a or consonants.
        for i in 0..<10 {
            s.record(ReadEvent(word: "cake", outcome: .tapped, hintLevel: 4, source: .parent, date: t0 + Double(i) * 60), lexicon: lex)
        }
        XCTAssertEqual(s.patterns["short_a"]!.history.count, before)
        XCTAssertEqual(s.patternState("short_a"), .mastered)
        XCTAssertEqual(s.patternState("consonants"), .mastered)
        XCTAssertEqual(s.patterns["vce_a"]!.history.last!.weight, 1.0, accuracy: 1e-9)
    }

    func testRebuildReplaysTheLogUnderCurrentRules() {
        var s = placed()
        s.override(pattern: "vce_i", to: .reviewing, now: t0)
        s.bookAccuracy = [0.97]
        let log = (0..<10).map { ReadEvent(word: "cake", outcome: .tapped, hintLevel: 4, source: .parent, date: t0 + Double($0) * 60) }
        let r = s.rebuilt(events: log, lexicon: lex)
        XCTAssertEqual(r.rulesVersion, LearnerState.currentRulesVersion)
        XCTAssertEqual(r.placedThrough, "suffix_ed")
        XCTAssertEqual(r.patternState("short_a"), .mastered)
        XCTAssertEqual(r.patternState("vce_a"), .learning)
        XCTAssertEqual(r.patternState("vce_i"), .reviewing, "parent overrides carry over")
        XCTAssertEqual(r.bookAccuracy, [0.97])
    }

    func testFailedReviewDemotes() {
        var s = placed()
        XCTAssertEqual(s.patternState("short_a"), .mastered)
        for i in 0..<4 {
            s.record(ReadEvent(word: "cat", outcome: .incorrect, source: .parent, date: t0 + Double(i) * day), lexicon: lex)
        }
        XCTAssertEqual(s.wordState("cat"), .learning)
        XCTAssertNotEqual(s.patternState("short_a"), .mastered)
    }

    func testTapOnlyEvidenceIsWeak() {
        var s = placed()
        for w in ["cake", "make", "bake", "lake", "made", "game", "name", "take"] {
            s.record(ReadEvent(word: w, outcome: .correct, weight: SessionGrading.aloneUntappedWeight, source: .tapOnly, date: t0), lexicon: lex)
            s.record(ReadEvent(word: w, outcome: .correct, weight: SessionGrading.aloneUntappedWeight, source: .tapOnly, date: t0 + day), lexicon: lex)
        }
        XCTAssertEqual(s.patternState("vce_a"), .learning, "weak evidence alone never reaches mastery breadth")
    }

    func testSnapshotAndDue() {
        var s = placed()
        s.override(word: "fish", to: .reviewing, now: t0)
        let snap = s.snapshot(now: t0 + 2 * day)
        XCTAssertEqual(snap.patterns["short_a"], .mastered)
        XCTAssertEqual(snap.words["fish"], .reviewing)
        XCTAssertTrue(snap.reviewDue?.contains("fish") ?? false)
    }

    func testGradingTogetherAndAlone() {
        let toks = [Token(t: "Max", w: "max", k: .story), Token(t: " ", w: nil), Token(t: "ran", w: "ran", k: .known),
                    Token(t: " ", w: nil), Token(t: "fast", w: "fast", k: .known), Token(t: " ", w: nil), Token(t: "cake", w: "cake", k: .target)]
        let together = SessionGrading.events(tokens: toks, marks: [4: .missed, 6: .helped], mode: .together, bookId: "b")
        XCTAssertEqual(together.map(\.word), ["ran", "fast", "cake"])
        XCTAssertEqual(together.map(\.outcome), [.correct, .incorrect, .hinted])
        let alone = SessionGrading.events(tokens: toks, marks: [6: .tapped], mode: .alone, bookId: "b")
        XCTAssertEqual(alone.map(\.weight), [0.3, 0.3, 1])
        XCTAssertEqual(LearnerState.accuracy(of: together)!, (1 + 0 + 0.1) / 3, accuracy: 1e-9)
    }

    func testDisplayChunks() {
        XCTAssertEqual(lex.displayChunks("Ship"), ["Sh", "i", "p"])
        XCTAssertEqual(lex.displayChunks("cake"), ["c", "a", "k", "e"])
        XCTAssertEqual(lex.displayChunks("zzz"), ["zzz"])
    }

    func testFileStoreRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try FileStore(root: dir)
        var s = placed()
        s.record(ReadEvent(word: "cake", outcome: .correct, source: .parent, date: t0), lexicon: lex)
        try store.saveLearner(s)
        XCTAssertEqual(store.loadLearner()?.patterns["vce_a"]?.seen, 1)
        try store.append(events: [ReadEvent(word: "cat", outcome: .correct, source: .parent, date: t0)])
        try store.append(events: [ReadEvent(word: "dog", outcome: .incorrect, source: .parent, date: t0)])
        XCTAssertEqual(store.loadEvents().map(\.word), ["cat", "dog"])
    }
}

final class ReadingUnitsTests: XCTestCase {
    func testPunctuationAttaches() {
        let toks = [Token(t: "“", w: nil), Token(t: "Look", w: "look"), Token(t: "!” ", w: nil), Token(t: "said", w: "said"),
                    Token(t: " ", w: nil), Token(t: "Max", w: "max"), Token(t: ".", w: nil)]
        let u = ReadingUnits.build(toks)
        XCTAssertEqual(u.map(\.word), ["Look", "said", "Max"])
        XCTAssertEqual(u.map(\.prefix), ["“", "", ""])
        XCTAssertEqual(u.map(\.suffix), ["!”", "", "."])
        XCTAssertEqual(u.map(\.id), [1, 3, 5])
    }
}
