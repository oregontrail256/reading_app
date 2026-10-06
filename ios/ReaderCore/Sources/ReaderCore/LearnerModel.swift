import Foundation

private let day: TimeInterval = 86_400

public struct StickyWord: Identifiable, Hashable, Sendable {
    public var word: String
    public var misses: Int
    public var id: String { word }
}

/// One graded exposure to an item (a pattern or a word).
public struct Exposure: Codable, Hashable, Sendable {
    public var credit: Double
    public var weight: Double
    public var date: Date
    public var word: String
}

/// Progress on one item: a phonics pattern or an individual word.
public struct ItemProgress: Codable, Hashable, Sendable {
    public var state: ItemState = .new
    /// Most recent exposures, newest last (capped).
    public var history: [Exposure] = []
    /// Distinct words read unaided that exercise this item (patterns only).
    public var successWords: Set<String> = []
    /// Days (yyyy-MM-dd) with at least one unaided success.
    public var successDays: Set<String> = []
    public var reviewStep: Int = 0
    public var nextReview: Date?
    public var lastSeen: Date?
    public var seen: Int = 0
    public var missed: Int = 0
    /// Set when a parent overrides the state by hand.
    public var overridden: Bool = false

    public init() {}

    public func weightedAccuracy(last n: Int) -> (accuracy: Double, weight: Double) {
        let window = history.suffix(n)
        let w = window.reduce(0) { $0 + $1.weight }
        guard w > 0 else { return (0, 0) }
        return (window.reduce(0) { $0 + $1.credit * $1.weight } / w, w)
    }
}

public struct MasteryRules: Codable, Sendable {
    /// Unaided threshold: credit at or above this counts as reading it "on his own".
    public var unaidedCredit = 0.8
    public var patternWindow = 12
    public var patternMinWeight = 6.0
    public var patternMinAccuracy = 0.9
    public var patternMinDistinctWords = 8
    public var wordWindow = 6
    public var wordMinWeight = 3.0
    public var wordMinAccuracy = 0.9
    public var minDays = 2
    /// Spaced-review intervals in days. Passing the review at index >= `masteredAfterStep` makes it Mastered.
    public var intervals: [Double] = [1, 3, 7, 14, 30, 60]
    public var masteredAfterStep = 3
    /// Weight given to a mastered pattern when a word containing it is missed (the miss is probably elsewhere).
    public var masteredMissWeight = 0.3
    public var historyCap = 30

    public init() {}
}

/// The learner model. Pure value type; the app persists it as JSON.
public struct LearnerState: Codable, Sendable {
    public var patterns: [String: ItemProgress] = [:]
    public var words: [String: ItemProgress] = [:]
    /// Weighted word accuracy per finished book, oldest first.
    public var bookAccuracy: [Double] = []
    public var placedThrough: String?
    public var targetOverride: [String]?
    /// Version of the update rules this state was computed with (nil = before versioning).
    public var rulesVersion: Int?
    /// Bump when `record` changes in a way that should be re-applied to past reading.
    public static let currentRulesVersion = 2
    public var rules = MasteryRules()

    public init() {}

    // MARK: Placement

    /// Everything up to and including `through` in the sequence is mastered, plus the most common heart words.
    public mutating func place(through: String, lexicon: Lexicon, heartTopN: Int = 60, now: Date = Date()) {
        guard let cut = lexicon.patternById[through]?.order else { return }
        placedThrough = through
        for p in lexicon.patterns {
            var item = patterns[p.id] ?? ItemProgress()
            if p.order <= cut {
                item.state = .mastered
                item.reviewStep = rules.masteredAfterStep
                item.nextReview = now.addingTimeInterval(day * 14)
            } else if !item.overridden {
                item = ItemProgress()
            }
            patterns[p.id] = item
        }
        var n = 0
        for w in lexicon.byRank where n < heartTopN {
            guard let e = lexicon.words[w], e.h, !w.contains("'") else { continue }
            var item = words[w] ?? ItemProgress()
            item.state = .mastered
            item.reviewStep = rules.masteredAfterStep
            item.nextReview = now.addingTimeInterval(day * 14)
            words[w] = item
            n += 1
        }
    }

    /// The same learner recomputed under the current rules: placement, then every logged read in order.
    /// Parent overrides, book accuracies, and the target override carry over.
    public func rebuilt(events: [ReadEvent], lexicon: Lexicon) -> LearnerState {
        var s = LearnerState()
        s.rules = rules
        s.bookAccuracy = bookAccuracy
        s.targetOverride = targetOverride
        let ordered = events.sorted { $0.date < $1.date }
        if let p = placedThrough { s.place(through: p, lexicon: lexicon, now: ordered.first?.date ?? Date()) }
        s.record(ordered, lexicon: lexicon)
        for (id, item) in patterns where item.overridden { s.patterns[id] = item }
        for (w, item) in words where item.overridden { s.words[w] = item }
        s.rulesVersion = LearnerState.currentRulesVersion
        return s
    }

    // MARK: Queries

    public func patternState(_ id: String) -> ItemState { patterns[id]?.state ?? .new }
    public func wordState(_ w: String) -> ItemState { words[w]?.state ?? .new }

    public func knows(_ word: String, lexicon: Lexicon) -> Bool {
        let w = Lexicon.normalize(word)
        if wordState(w).isKnown { return true }
        guard let e = lexicon.words[w], !e.h else { return false }
        return e.p.allSatisfy { patternState($0).isKnown }
    }

    public func dueItems(now: Date = Date()) -> [String] {
        let all = patterns.map { ($0.key, $0.value) } + words.map { ($0.key, $0.value) }
        return all
            .filter { $0.1.state.isKnown && ($0.1.nextReview ?? .distantFuture) <= now }
            .sorted { ($0.1.nextReview ?? now) < ($1.1.nextReview ?? now) }
            .map { $0.0 }
    }

    public func snapshot(now: Date = Date()) -> LearnerSnapshot {
        LearnerSnapshot(
            patterns: patterns.mapValues(\.state),
            words: words.filter { $0.value.state != .new }.mapValues(\.state),
            reviewDue: Array(dueItems(now: now).prefix(8)),
            recentAccuracy: Array(bookAccuracy.suffix(5)),
            targetOverride: targetOverride
        )
    }

    /// Words he has missed recently, most-missed first.
    public func stickyWords(days: Double = 14, now: Date = Date()) -> [StickyWord] {
        let since = now.addingTimeInterval(-day * days)
        let threshold = rules.unaidedCredit
        return words.compactMap { entry -> StickyWord? in
            let misses = entry.value.history.filter { $0.date >= since && $0.credit < threshold && $0.weight >= 0.5 }.count
            return misses > 0 ? StickyWord(word: entry.key, misses: misses) : nil
        }
        .sorted { $0.misses > $1.misses || ($0.misses == $1.misses && $0.word < $1.word) }
    }

    // MARK: Updates

    /// Apply one read event to the word and to the patterns it exercises.
    public mutating func record(_ ev: ReadEvent, lexicon: Lexicon) {
        let w = Lexicon.normalize(ev.word)
        guard ev.weight > 0 else { return }
        let exposure = Exposure(credit: ev.credit, weight: ev.weight, date: ev.date, word: w)
        var wi = words[w] ?? ItemProgress()
        apply(exposure, to: &wi, isPattern: false)
        words[w] = wi

        guard let e = lexicon.words[w], !e.h else { return }  // heart words: whole-word item only
        let failed = exposure.credit < rules.unaidedCredit
        // A word that uses a pattern he hasn't learned (toilet, rocket) is expected to need help: a miss on
        // it says nothing about the patterns he already knows, so only the unlearned ones take the miss.
        let unlearned = Set(e.p.filter { !patternState($0).isKnown })
        for pid in Set(e.p) {
            if failed && !unlearned.isEmpty && !unlearned.contains(pid) { continue }
            var pi = patterns[pid] ?? ItemProgress()
            var x = exposure
            if failed && pi.state == .mastered { x.weight *= rules.masteredMissWeight }
            apply(x, to: &pi, isPattern: true)
            patterns[pid] = pi
        }
    }

    public mutating func record(_ events: [ReadEvent], lexicon: Lexicon) {
        for ev in events { record(ev, lexicon: lexicon) }
    }

    /// Weighted accuracy for a set of events (e.g. one book); nil if no evidence.
    public static func accuracy(of events: [ReadEvent]) -> Double? {
        let w = events.reduce(0) { $0 + $1.weight }
        guard w > 0 else { return nil }
        return events.reduce(0) { $0 + $1.credit * $1.weight } / w
    }

    public mutating func finishBook(events: [ReadEvent]) -> Double? {
        guard let acc = LearnerState.accuracy(of: events) else { return nil }
        bookAccuracy.append(acc)
        if bookAccuracy.count > 50 { bookAccuracy.removeFirst(bookAccuracy.count - 50) }
        return acc
    }

    public mutating func override(pattern id: String, to state: ItemState, now: Date = Date()) {
        var item = patterns[id] ?? ItemProgress()
        setState(&item, state, now: now)
        item.overridden = true
        patterns[id] = item
    }

    public mutating func override(word: String, to state: ItemState, now: Date = Date()) {
        let w = Lexicon.normalize(word)
        var item = words[w] ?? ItemProgress()
        setState(&item, state, now: now)
        item.overridden = true
        words[w] = item
    }

    // MARK: Internals

    private func setState(_ item: inout ItemProgress, _ state: ItemState, now: Date) {
        item.state = state
        switch state {
        case .mastered:
            item.reviewStep = rules.masteredAfterStep
            item.nextReview = now.addingTimeInterval(day * 14)
        case .reviewing:
            item.reviewStep = 0
            item.nextReview = now.addingTimeInterval(day)
        case .new, .learning:
            item.reviewStep = 0
            item.nextReview = nil
        }
    }

    private func apply(_ x: Exposure, to item: inout ItemProgress, isPattern: Bool) {
        let r = rules
        let success = x.credit >= r.unaidedCredit
        item.history.append(x)
        if item.history.count > r.historyCap { item.history.removeFirst(item.history.count - r.historyCap) }
        item.seen += 1
        if !success && x.weight >= 0.5 { item.missed += 1 }
        item.lastSeen = x.date
        if success && x.weight >= 0.5 {
            item.successDays.insert(LearnerState.dayKey(x.date))
            if isPattern { item.successWords.insert(x.word) }
        }

        switch item.state {
        case .new:
            item.state = .learning
            fallthrough
        case .learning:
            let (acc, w) = item.weightedAccuracy(last: isPattern ? r.patternWindow : r.wordWindow)
            let enough = w >= (isPattern ? r.patternMinWeight : r.wordMinWeight)
            let accurate = acc >= (isPattern ? r.patternMinAccuracy : r.wordMinAccuracy)
            let breadth = !isPattern || item.successWords.count >= r.patternMinDistinctWords
            if enough && accurate && breadth && item.successDays.count >= r.minDays {
                item.state = .reviewing
                item.reviewStep = 0
                item.nextReview = x.date.addingTimeInterval(day * r.intervals[0])
            }
        case .reviewing, .mastered:
            let (acc, w) = item.weightedAccuracy(last: isPattern ? r.patternWindow : r.wordWindow)
            if !success {
                // A clear miss, or a run of weaker misses, sends it back to review; persistent trouble, back to learning.
                if x.weight >= 0.5 || (w >= 1.0 && acc < 0.6) {
                    item.state = .reviewing
                    item.reviewStep = 0
                    item.nextReview = x.date.addingTimeInterval(day * r.intervals[0])
                    if w >= 2 && acc < 0.7 { item.state = .learning }
                }
                return
            }
            guard x.weight >= 0.5 else { return }
            let due = (item.nextReview ?? .distantPast) <= x.date
            if due {
                item.reviewStep += 1
                let idx = min(item.reviewStep, r.intervals.count - 1)
                item.nextReview = x.date.addingTimeInterval(day * r.intervals[idx])
                if item.reviewStep >= r.masteredAfterStep { item.state = .mastered }
            }
        }
    }

    static func dayKey(_ d: Date) -> String {
        let c = Calendar(identifier: .gregorian).dateComponents(in: .current, from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
