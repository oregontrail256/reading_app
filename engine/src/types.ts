/** Shared contract between the iPad app and the engine/proxy. Mirrored in ios/ReaderCore/Models.swift. */

export type ItemState = "new" | "learning" | "reviewing" | "mastered";

/** What the app sends about the learner. The app owns the learner model; this is a read-only snapshot. */
export interface LearnerSnapshot {
  /** Pattern id -> state. Missing = "new". */
  patterns: Record<string, ItemState>;
  /** Word -> state, for words tracked individually (heart words and any word with evidence). */
  words: Record<string, ItemState>;
  /** Items due for spaced review: pattern ids and/or words. */
  reviewDue?: string[];
  /** Word accuracy of the last few books (0..1), newest last. Used to tune difficulty. */
  recentAccuracy?: number[];
  /** Force specific target patterns (parent override). */
  targetOverride?: string[];
}

export interface Character {
  name: string;
  description: string;
}

export interface BookRequest {
  /** One-line idea from the child or parent: "a shark who runs a bakery". */
  prompt: string;
  characters?: Character[];
  series?: {
    id: string;
    title: string;
    /** One- or two-sentence summaries of earlier books, oldest first. */
    summaries: string[];
    /** The "what happens next" option the child picked. */
    choice?: string;
  };
  /** Topics to avoid (parent setting). */
  avoid?: string[];
  pages?: number;
}

export interface Thresholds {
  /** Share of tokens that must be known words or pre-taught story words. */
  minSupportedPct: number;
  /** Max share of tokens that are target-pattern words. */
  maxTargetPct: number;
  /** Min occurrences (tokens) of each target pattern. */
  minTargetTokens: number;
  /** Max distinct pre-taught story words (names, theme words). */
  maxStoryWords: number;
  maxSentenceWords: number;
  minSentencesPerPage: number;
  maxSentencesPerPage: number;
}

export interface LessonSpec {
  targets: string[];
  targetWords: string[];
  reviewWords: string[];
  newHeartWords: string[];
  /** Known words offered to the writer, by frequency. */
  allowedWords: string[];
  storyWords: string[];
  pages: number;
  wordBudget: [number, number];
  thresholds: Thresholds;
}

export type TokenClass = "known" | "target" | "heart" | "story" | "unknown";

export interface Token {
  /** Surface text as written. */
  t: string;
  /** Normalized lexical key (lowercase), or null for punctuation/whitespace runs. */
  w: string | null;
  k?: TokenClass;
}

export interface Page {
  text: string;
  scene: string;
  tokens: Token[];
  /** Base64 JPEG, when images were generated. */
  image?: string;
}

export interface Violation {
  word: string;
  count: number;
  reason: string;
}

export interface ValidationReport {
  pass: boolean;
  totalTokens: number;
  counts: Record<TokenClass, number>;
  supportedPct: number;
  targetPct: number;
  targetCounts: Record<string, number>;
  /** Practice words used on each page (title excluded), in order. */
  targetByPage: string[][];
  heartCounts: Record<string, number>;
  storyWordsUsed: string[];
  violations: Violation[];
  problems: string[];
  /** Rules the shipped book still misses (set when the best draft is accepted after all repair rounds). */
  warnings?: string[];
}

export interface Book {
  id: string;
  createdAt: string;
  title: string;
  titleTokens: Token[];
  request: BookRequest;
  spec: Omit<LessonSpec, "allowedWords">;
  characters: Character[];
  previewWords: string[];
  pages: Page[];
  coverScene: string;
  cover?: string;
  summary: string;
  chatQuestions: string[];
  nextOptions: string[];
  validation: ValidationReport;
  rounds: number;
  model: string;
}

/** What the writer model returns. */
export interface DraftBook {
  title: string;
  characters: Character[];
  previewWords: string[];
  pages: { text: string; scene: string }[];
  coverScene: string;
  summary: string;
  chatQuestions: string[];
  nextOptions: string[];
}
