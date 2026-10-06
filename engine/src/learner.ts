import type { Lexicon, LexEntry } from "./lexicon.ts";
import { SIGHT_WORDS } from "./sightWords.ts";
import type { ItemState, LearnerSnapshot } from "./types.ts";

const KNOWN: ItemState[] = ["mastered", "reviewing"];

export function patternKnown(snap: LearnerSnapshot, id: string): boolean {
  return KNOWN.includes(snap.patterns[id] ?? "new");
}

export function wordState(snap: LearnerSnapshot, word: string): ItemState {
  return snap.words[word] ?? "new";
}

/** Can he read this word without new teaching? */
export function wordKnown(snap: LearnerSnapshot, word: string, entry: LexEntry | undefined): boolean {
  const state = wordState(snap, word);
  if (KNOWN.includes(state)) return true;
  if (SIGHT_WORDS.has(word) && state !== "learning") return true;
  if (!entry || entry.h) return false;
  return entry.p.every((p) => patternKnown(snap, p));
}

/** Patterns in this word he hasn't mastered yet. */
export function unknownPatterns(snap: LearnerSnapshot, entry: LexEntry): string[] {
  return entry.p.filter((p) => !patternKnown(snap, p));
}

/**
 * Starting snapshot from a placement result: every pattern up to and including `throughPattern`
 * in the scope and sequence is mastered, plus the `heartTopN` most frequent heart words.
 */
export function snapshotFromPlacement(lex: Lexicon, throughPattern: string, heartTopN = 60): LearnerSnapshot {
  const through = lex.patternById.get(throughPattern);
  if (!through) throw new Error(`unknown pattern ${throughPattern}`);
  const patterns: Record<string, ItemState> = {};
  for (const p of lex.patterns) patterns[p.id] = p.order <= through.order ? "mastered" : "new";
  const words: Record<string, ItemState> = {};
  let n = 0;
  for (const w of lex.byRank) {
    if (n >= heartTopN) break;
    const e = lex.get(w)!;
    if (e.h && !w.includes("'")) {
      words[w] = "mastered";
      n++;
    }
  }
  return { patterns, words };
}
