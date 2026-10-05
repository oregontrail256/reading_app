import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** One grapheme segment: [letters, phones, patternTag] */
export type Segment = [string, string, string];

export interface LexEntry {
  seg: Segment[];
  /** Phonics patterns this word exercises (ids from patterns.json). */
  p: string[];
  /** Heart word: taught as a whole word, with an irregular part. */
  h: boolean;
  /** [start, end) letter span of the irregular ("heart") part, if any. */
  hp: [number, number] | null;
  syl: number;
  base: string | null;
  /** Frequency rank (1 = most common). */
  r: number;
  /** Zipf frequency. */
  z: number;
}

export interface Pattern {
  id: string;
  order: number;
  name: string;
  kid: string;
  examples: string[];
}

export class Lexicon {
  readonly words: Map<string, LexEntry>;
  readonly patterns: Pattern[];
  readonly patternById: Map<string, Pattern>;
  /** Words sorted by frequency rank. */
  readonly byRank: string[];

  constructor(words: Record<string, LexEntry>, patterns: Pattern[]) {
    this.words = new Map(Object.entries(words));
    this.patterns = [...patterns].sort((a, b) => a.order - b.order);
    this.patternById = new Map(this.patterns.map((p) => [p.id, p]));
    this.byRank = [...this.words.keys()].sort((a, b) => this.words.get(a)!.r - this.words.get(b)!.r);
  }

  get(word: string): LexEntry | undefined {
    return this.words.get(word.toLowerCase());
  }

  static load(sharedDir = defaultSharedDir()): Lexicon {
    const words = JSON.parse(readFileSync(join(sharedDir, "lexicon.json"), "utf8"));
    const patterns = JSON.parse(readFileSync(join(sharedDir, "patterns.json"), "utf8"));
    return new Lexicon(words, patterns);
  }
}

export function defaultSharedDir(): string {
  if (process.env.SHARED_DIR) return process.env.SHARED_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "shared");
}

let cached: Lexicon | null = null;
export function lexicon(): Lexicon {
  if (!cached) cached = Lexicon.load();
  return cached;
}
