import Foundation

// Mirrors engine/src/types.ts. Unknown JSON keys are ignored by Codable, so the server may add fields freely.

public enum ItemState: String, Codable, CaseIterable, Sendable {
    case new, learning, reviewing, mastered

    /// Counts as "can read without new teaching" for book generation.
    public var isKnown: Bool { self == .reviewing || self == .mastered }
}

public struct StoryCharacter: Codable, Hashable, Sendable {
    public var name: String
    public var description: String
    public init(name: String, description: String) {
        self.name = name
        self.description = description
    }
}

public struct SeriesContext: Codable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var summaries: [String]
    public var choice: String?
    public init(id: String, title: String, summaries: [String], choice: String? = nil) {
        self.id = id
        self.title = title
        self.summaries = summaries
        self.choice = choice
    }
}

public struct BookRequest: Codable, Hashable, Sendable {
    public var prompt: String
    public var characters: [StoryCharacter]?
    public var series: SeriesContext?
    public var avoid: [String]?
    public var pages: Int?
    public init(prompt: String, characters: [StoryCharacter]? = nil, series: SeriesContext? = nil, avoid: [String]? = nil, pages: Int? = nil) {
        self.prompt = prompt
        self.characters = characters
        self.series = series
        self.avoid = avoid
        self.pages = pages
    }
}

public struct LearnerSnapshot: Codable, Sendable {
    public var patterns: [String: ItemState]
    public var words: [String: ItemState]
    public var reviewDue: [String]?
    public var recentAccuracy: [Double]?
    public var targetOverride: [String]?
}

public enum TokenClass: String, Codable, Sendable {
    case known, target, heart, story, unknown
}

public struct Token: Codable, Hashable, Sendable {
    /// Surface text exactly as written.
    public var t: String
    /// Lowercased lexical key, or nil for spaces/punctuation.
    public var w: String?
    public var k: TokenClass?
    public init(t: String, w: String?, k: TokenClass? = nil) {
        self.t = t
        self.w = w
        self.k = k
    }
}

public struct Page: Codable, Hashable, Sendable {
    public var text: String
    public var scene: String
    public var tokens: [Token]
    /// Base64 JPEG as delivered by the proxy. The app moves it to a file on save and clears this.
    public var image: String?
}

public struct SpecSummary: Codable, Hashable, Sendable {
    public var targets: [String]
    public var targetWords: [String]
    public var reviewWords: [String]
    public var newHeartWords: [String]
    public var storyWords: [String]
    public var pages: Int
}

public struct ValidationSummary: Codable, Hashable, Sendable {
    public var pass: Bool
    public var totalTokens: Int
    public var supportedPct: Double
    public var targetPct: Double
    public var targetCounts: [String: Int]
    public var problems: [String]
}

public struct Book: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var createdAt: String
    public var title: String
    public var titleTokens: [Token]
    public var request: BookRequest
    public var spec: SpecSummary
    public var characters: [StoryCharacter]
    public var previewWords: [String]
    public var pages: [Page]
    public var coverScene: String
    public var cover: String?
    public var summary: String
    public var chatQuestions: [String]
    public var nextOptions: [String]
    public var validation: ValidationSummary
    public var rounds: Int
    public var model: String

    // App-side bookkeeping (absent in server JSON).
    public var seriesId: String?
    public var finishedAt: Date?
    public var timesRead: Int?
    public var accuracy: Double?
}

/// How strongly an event should move the learner model.
public enum EvidenceSource: String, Codable, Sendable {
    /// A parent marked it while reading together: trusted.
    case parent
    /// Speech recognition (M2): weighted by confidence.
    case asr
    /// Read alone with tap-to-hear only: untapped words are weak evidence of success.
    case tapOnly
}

public enum Outcome: String, Codable, Sendable {
    case correct, selfCorrected, hinted, incorrect, tapped

    /// Credit toward mastery for this read (1 = unaided correct).
    public func credit(hintLevel: Int) -> Double {
        switch self {
        case .correct: return 1.0
        case .selfCorrected: return 0.8
        case .hinted: return hintLevel <= 1 ? 0.5 : hintLevel == 2 ? 0.3 : 0.1
        case .incorrect, .tapped: return 0.0
        }
    }
}

public struct ReadEvent: Codable, Hashable, Sendable {
    public var word: String
    public var outcome: Outcome
    public var hintLevel: Int
    public var latencyMs: Int?
    /// 0...1 evidence strength.
    public var weight: Double
    public var source: EvidenceSource
    public var date: Date
    public var bookId: String?

    public init(word: String, outcome: Outcome, hintLevel: Int = 0, latencyMs: Int? = nil, weight: Double = 1, source: EvidenceSource, date: Date = Date(), bookId: String? = nil) {
        self.word = word
        self.outcome = outcome
        self.hintLevel = hintLevel
        self.latencyMs = latencyMs
        self.weight = weight
        self.source = source
        self.date = date
        self.bookId = bookId
    }

    public var credit: Double { outcome.credit(hintLevel: hintLevel) }
}
