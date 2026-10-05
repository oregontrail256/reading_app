import type { Lexicon } from "./lexicon.ts";
import { patternKnown, unknownPatterns, wordKnown } from "./learner.ts";
import type { BookRequest, LearnerSnapshot, LessonSpec, Thresholds } from "./types.ts";

export const DEFAULT_THRESHOLDS: Thresholds = {
  minSupportedPct: 0.85,
  maxTargetPct: 0.15,
  minTargetTokens: 6,
  maxStoryWords: 8,
  maxSentenceWords: 10,
  minSentencesPerPage: 3,
  maxSentencesPerPage: 4,
};

/** Patterns never chosen as a book's teaching target. */
const NOT_TARGETABLE = new Set(["consonants", "advanced", "contraction", "multisyllable"]);
const MAX_RANK_FOR_WRITING = 8000;
const MIN_TARGET_WORDS = 8;

export interface SpecOptions {
  thresholds?: Partial<Thresholds>;
  maxAllowedWords?: number;
}

/** Words that exercise `pattern` and need nothing else he hasn't learned. */
export function wordsForTarget(lex: Lexicon, snap: LearnerSnapshot, pattern: string, limit = 40): string[] {
  const out: string[] = [];
  for (const w of lex.byRank) {
    const e = lex.get(w)!;
    if (e.r > MAX_RANK_FOR_WRITING && !e.k) continue;
    if (e.h || w.includes("'") || !e.p.includes(pattern)) continue;
    const unk = unknownPatterns(snap, e);
    if (unk.length === 1 && unk[0] === pattern) out.push(w);
  }
  // Children's-book words first, then by frequency.
  out.sort((a, b) => (lex.get(b)!.k ?? 0) - (lex.get(a)!.k ?? 0) || lex.get(a)!.r - lex.get(b)!.r);
  return out.slice(0, limit);
}

export function chooseTargets(lex: Lexicon, snap: LearnerSnapshot): string[] {
  if (snap.targetOverride?.length) return snap.targetOverride;
  const acc = snap.recentAccuracy ?? [];
  const recent = acc.slice(-3);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0.93;
  const want = recent.length >= 2 && avg >= 0.95 ? 2 : 1;

  const ordered = [
    ...lex.patterns.filter((p) => snap.patterns[p.id] === "learning"),
    ...lex.patterns.filter((p) => (snap.patterns[p.id] ?? "new") === "new"),
  ];
  const chosen: string[] = [];
  for (const p of ordered) {
    if (chosen.length >= want) break;
    if (NOT_TARGETABLE.has(p.id) || patternKnown(snap, p.id)) continue;
    if (wordsForTarget(lex, snap, p.id, MIN_TARGET_WORDS).length >= MIN_TARGET_WORDS) chosen.push(p.id);
  }
  return chosen;
}

export function buildSpec(
  lex: Lexicon,
  snap: LearnerSnapshot,
  req: BookRequest,
  opts: SpecOptions = {},
): LessonSpec {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
  const targets = chooseTargets(lex, snap);
  const targetWords = targets.flatMap((t) => wordsForTarget(lex, snap, t, 120));

  // review: due words directly, due patterns via a couple of known example words
  const reviewWords: string[] = [];
  for (const item of snap.reviewDue ?? []) {
    if (lex.patternById.has(item)) {
      let n = 0;
      for (const w of lex.byRank) {
        const e = lex.get(w)!;
        if (e.r > 3000 || n >= 2) break;
        if (e.p.includes(item) && wordKnown(snap, w, e) && !reviewWords.includes(w)) {
          reviewWords.push(w);
          n++;
        }
      }
    } else if (lex.get(item)) {
      reviewWords.push(item);
    }
  }

  const acc = snap.recentAccuracy ?? [];
  const struggling = acc.length > 0 && acc[acc.length - 1] < 0.9;
  const newHeartWords: string[] = [];
  if (!struggling) {
    for (const w of lex.byRank) {
      const e = lex.get(w)!;
      if (e.r > 400) break;
      if (e.h && !w.includes("'") && !wordKnown(snap, w, e) && w.length > 1) {
        newHeartWords.push(w);
        break;
      }
    }
  }

  const allowedWords: string[] = [];
  const maxAllowed = opts.maxAllowedWords ?? 1800;
  for (const w of lex.byRank) {
    const e = lex.get(w)!;
    if (allowedWords.length >= maxAllowed) break;
    if (e.r > MAX_RANK_FOR_WRITING) break;
    if (wordKnown(snap, w, e)) allowedWords.push(w);
  }

  const pages = Math.max(4, Math.min(16, req.pages ?? 10));
  const storyWords = (req.characters ?? []).map((c) => c.name.toLowerCase());
  return {
    targets,
    targetWords,
    reviewWords: reviewWords.slice(0, 6),
    newHeartWords,
    allowedWords,
    storyWords,
    pages,
    wordBudget: [pages * 14, pages * 26],
    thresholds,
  };
}
