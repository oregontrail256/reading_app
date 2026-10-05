import type { Lexicon } from "./lexicon.ts";
import { unknownPatterns, wordKnown } from "./learner.ts";
import { hasDigits, sentences, tokenize } from "./tokenize.ts";
import type {
  DraftBook,
  LearnerSnapshot,
  LessonSpec,
  Token,
  TokenClass,
  ValidationReport,
  Violation,
} from "./types.ts";

export interface Classified {
  cls: TokenClass;
  reason?: string;
  patterns?: string[];
}

export function classifyWord(
  word: string,
  spec: LessonSpec,
  snap: LearnerSnapshot,
  lex: Lexicon,
  story: Set<string>,
): Classified {
  if (story.has(word)) return { cls: "story" };
  // possessive: Max's -> Max
  if (word.endsWith("'s")) {
    const base = word.slice(0, -2);
    const c = classifyWord(base, spec, snap, lex, story);
    if (c.cls !== "unknown") return c;
  }
  const e = lex.get(word);
  if (!e) return { cls: "unknown", reason: "not in the dictionary (if it is a name, list it in previewWords)" };
  if (wordKnown(snap, word, e)) return { cls: "known" };
  if (spec.newHeartWords.includes(word)) return { cls: "heart" };
  if (e.h) return { cls: "unknown", reason: "irregular word he hasn't learned yet" };
  const unk = unknownPatterns(snap, e);
  if (unk.length && unk.every((p) => spec.targets.includes(p))) return { cls: "target", patterns: e.p.filter((p) => spec.targets.includes(p)) };
  const names = unk.map((p) => lex.patternById.get(p)?.name ?? p);
  return { cls: "unknown", reason: `uses spelling patterns he hasn't learned (${names.join(", ")})` };
}

/** Annotate tokens in place with their class. */
export function annotate(tokens: Token[], spec: LessonSpec, snap: LearnerSnapshot, lex: Lexicon, story: Set<string>): Token[] {
  for (const t of tokens) if (t.w) t.k = classifyWord(t.w, spec, snap, lex, story).cls;
  return tokens;
}

export function storySet(spec: LessonSpec, draft: DraftBook): Set<string> {
  const s = new Set(spec.storyWords.map((w) => w.toLowerCase()));
  for (const c of draft.characters ?? []) for (const part of c.name.split(/\s+/)) s.add(part.toLowerCase());
  for (const w of draft.previewWords ?? []) s.add(w.toLowerCase().trim());
  return s;
}

export function validate(draft: DraftBook, spec: LessonSpec, snap: LearnerSnapshot, lex: Lexicon): ValidationReport {
  const story = storySet(spec, draft);
  const counts: Record<TokenClass, number> = { known: 0, target: 0, heart: 0, story: 0, unknown: 0 };
  const targetCounts: Record<string, number> = Object.fromEntries(spec.targets.map((t) => [t, 0]));
  const heartCounts: Record<string, number> = Object.fromEntries(spec.newHeartWords.map((w) => [w, 0]));
  const bad = new Map<string, Violation>();
  const storyUsed = new Set<string>();
  const problems: string[] = [];

  const texts = [draft.title, ...draft.pages.map((p) => p.text)];
  for (const text of texts) {
    for (const tok of tokenize(text)) {
      if (!tok.w) continue;
      const c = classifyWord(tok.w, spec, snap, lex, story);
      counts[c.cls]++;
      if (c.cls === "target") for (const p of c.patterns ?? []) targetCounts[p] = (targetCounts[p] ?? 0) + 1;
      if (c.cls === "heart") heartCounts[tok.w] = (heartCounts[tok.w] ?? 0) + 1;
      if (c.cls === "story") storyUsed.add(tok.w.replace(/'s$/, ""));
      if (c.cls === "unknown") {
        const v = bad.get(tok.w) ?? { word: tok.w, count: 0, reason: c.reason ?? "" };
        v.count++;
        bad.set(tok.w, v);
      }
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const supportedPct = (counts.known + counts.story) / total;
  const targetPct = counts.target / total;
  const violations = [...bad.values()].sort((a, b) => b.count - a.count);
  const th = spec.thresholds;

  if (violations.length) problems.push(`${violations.length} word(s) he can't read yet`);
  if (supportedPct < th.minSupportedPct)
    problems.push(`only ${(supportedPct * 100).toFixed(0)}% of words are known words; need at least ${(th.minSupportedPct * 100).toFixed(0)}%`);
  if (targetPct > th.maxTargetPct)
    problems.push(`${(targetPct * 100).toFixed(0)}% of words are practice words; keep it under ${(th.maxTargetPct * 100).toFixed(0)}%`);
  for (const t of spec.targets) {
    if ((targetCounts[t] ?? 0) < th.minTargetTokens)
      problems.push(`practice pattern "${lex.patternById.get(t)?.name ?? t}" appears ${targetCounts[t] ?? 0} times; use it at least ${th.minTargetTokens} times`);
  }
  if (storyUsed.size > th.maxStoryWords)
    problems.push(`${storyUsed.size} preview/story words (${[...storyUsed].join(", ")}); allow at most ${th.maxStoryWords}`);
  if (draft.pages.length !== spec.pages) problems.push(`has ${draft.pages.length} pages; need exactly ${spec.pages}`);
  if (total < spec.wordBudget[0] || total > spec.wordBudget[1])
    problems.push(`has ${total} words; aim for ${spec.wordBudget[0]}-${spec.wordBudget[1]}`);
  draft.pages.forEach((p, i) => {
    const ss = sentences(p.text);
    if (ss.length > th.maxSentencesPerPage) problems.push(`page ${i + 1} has ${ss.length} sentences; max ${th.maxSentencesPerPage}`);
    for (const s of ss)
      if (s.words > th.maxSentenceWords) problems.push(`page ${i + 1}: "${s.text}" has ${s.words} words; max ${th.maxSentenceWords}`);
    if (hasDigits(p.text)) problems.push(`page ${i + 1} uses digits; write numbers as words`);
  });

  return {
    pass: problems.length === 0,
    totalTokens: total,
    counts,
    supportedPct,
    targetPct,
    targetCounts,
    heartCounts,
    storyWordsUsed: [...storyUsed],
    violations,
    problems,
  };
}

/** A single score for picking the best of several failed attempts (lower is better). */
export function badness(r: ValidationReport): number {
  return r.violations.reduce((a, v) => a + v.count, 0) * 10 + r.problems.length;
}
