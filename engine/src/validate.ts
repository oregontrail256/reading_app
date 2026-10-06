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
  // possessive: Max's -> Max
  if (word.endsWith("'s")) {
    const base = word.slice(0, -2);
    const c = classifyWord(base, spec, snap, lex, story);
    if (c.cls !== "unknown") return c;
  }
  const lexical = classifyLexical(word, spec, snap, lex);
  // A preview word only counts as pre-taught if he couldn't read it anyway.
  if (lexical.cls === "unknown" && story.has(word)) return { cls: "story" };
  return lexical;
}

function classifyLexical(word: string, spec: LessonSpec, snap: LearnerSnapshot, lex: Lexicon): Classified {
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

/** Lowercased character-name parts (names don't count toward the theme-word budget). */
export function nameSet(spec: LessonSpec, draft: DraftBook): Set<string> {
  const s = new Set(spec.storyWords.map((w) => w.toLowerCase()));
  for (const c of draft.characters ?? []) for (const part of c.name.split(/\s+/)) s.add(part.toLowerCase());
  return s;
}

export function storySet(spec: LessonSpec, draft: DraftBook): Set<string> {
  const s = new Set(spec.storyWords.map((w) => w.toLowerCase()));
  for (const c of draft.characters ?? []) for (const part of c.name.split(/\s+/)) s.add(part.toLowerCase());
  for (const w of draft.previewWords ?? []) s.add(w.toLowerCase().trim());
  return s;
}

/**
 * Rank in the (adult-text) frequency list past which an undecodable word counts as fancy. Kept loose on
 * purpose: kid words like "balloon" rank low in adult text, so this is only a backstop for the prompt
 * and the editor, which judge plain vs. fancy better.
 */
const FANCY_RANK = 6000;
const MAX_FANCY_WORDS = 6;

/** The word and the base forms it may be inflected from (smiled -> smile, taller -> tall, tapped -> tap). */
function baseForms(w: string): string[] {
  const out = [w];
  for (const suf of ["ed", "ing", "er", "est", "es", "s"]) {
    if (!w.endsWith(suf) || w.length - suf.length < 2) continue;
    const stem = w.slice(0, -suf.length);
    out.push(stem, stem + "e");
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) out.push(stem.slice(0, -1));
    if (stem.endsWith("i")) out.push(stem.slice(0, -1) + "y");
  }
  return out;
}

export function isFancy(word: string, lex: Lexicon): boolean {
  return !baseForms(word.replace(/'s$/, "")).some((f) => {
    const e = lex.get(f);
    return e && (e.k || e.r <= FANCY_RANK);
  });
}

export function validate(draft: DraftBook, spec: LessonSpec, snap: LearnerSnapshot, lex: Lexicon): ValidationReport {
  const story = storySet(spec, draft);
  const names = nameSet(spec, draft);
  const counts: Record<TokenClass, number> = { known: 0, target: 0, heart: 0, story: 0, unknown: 0 };
  const targetCounts: Record<string, number> = Object.fromEntries(spec.targets.map((t) => [t, 0]));
  const heartCounts: Record<string, number> = Object.fromEntries(spec.newHeartWords.map((w) => [w, 0]));
  const bad = new Map<string, Violation>();
  const storyUsed = new Set<string>();
  const problems: string[] = [];

  const texts = [draft.title, ...draft.pages.map((p) => p.text)];
  const targetByPage: string[][] = draft.pages.map(() => []);
  texts.forEach((text, ti) => {
    for (const tok of tokenize(text)) {
      if (!tok.w) continue;
      const c = classifyWord(tok.w, spec, snap, lex, story);
      counts[c.cls]++;
      if (c.cls === "target" && ti > 0) targetByPage[ti - 1].push(tok.w);
      if (c.cls === "target") for (const p of c.patterns ?? []) targetCounts[p] = (targetCounts[p] ?? 0) + 1;
      if (c.cls === "heart") heartCounts[tok.w] = (heartCounts[tok.w] ?? 0) + 1;
      if (c.cls === "story") storyUsed.add(tok.w.replace(/'s$/, ""));
      if (c.cls === "unknown") {
        const v = bad.get(tok.w) ?? { word: tok.w, count: 0, reason: c.reason ?? "" };
        v.count++;
        bad.set(tok.w, v);
      }
    }
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  // Known, pre-taught preview words, and the new heart word (taught in the preview) are all "supported".
  const supportedPct = (counts.known + counts.story + counts.heart) / total;
  const targetPct = counts.target / total;
  const violations = [...bad.values()].sort((a, b) => b.count - a.count);
  const th = spec.thresholds;

  // Words he can't decode yet are allowed: they become stretch words (pre-taught or tap-to-hear).
  // Common words (park, tree, slow) are fine even if he can't decode them yet. Fancy ones where a plain
  // word would do (slumped, crooked, tumbled) are a soft problem: it steers rewrites and the best-draft
  // pick, and never rejects a book.
  const fancy = violations.filter((v) => !story.has(v.word) && isFancy(v.word, lex)).map((v) => v.word);
  if (fancy.length > MAX_FANCY_WORDS)
    problems.push(
      `words harder than a first grader needs: ${fancy.slice(0, 12).join(", ")}. Use a plain, common word where one works ("sat down" for "slumped"); keep hard words the story really needs`,
    );
  if (targetPct > th.maxTargetPct)
  {
    const cap = Math.floor(total * th.maxTargetPct);
    const cut = counts.target - cap;
    // Name concrete places to cut: the pages with the most practice words first.
    const where = targetByPage
      .map((ws, i) => ({ i, ws }))
      .filter((x) => x.ws.length > 1)
      .sort((a, b) => b.ws.length - a.ws.length)
      .map((x) => `page ${x.i + 1} (${x.ws.join(", ")})`)
      .slice(0, 4);
    problems.push(
      `${counts.target} practice-word uses; the most allowed for ${total} words is ${cap}. Swap ${cut} practice word(s) for known words` +
        (where.length ? `, e.g. on ${where.join("; ")}` : "") + ", or add more sentences made only of known words",
    );
  }
  for (const t of spec.targets) {
    if ((targetCounts[t] ?? 0) < th.minTargetTokens)
      problems.push(`practice pattern "${lex.patternById.get(t)?.name ?? t}" appears ${targetCounts[t] ?? 0} times; use it at least ${th.minTargetTokens} times`);
  }
  if (draft.pages.length !== spec.pages) problems.push(`has ${draft.pages.length} pages; need exactly ${spec.pages}`);
  if (total < spec.wordBudget[0] || total > spec.wordBudget[1])
    problems.push(`has ${total} words; aim for ${spec.wordBudget[0]}-${spec.wordBudget[1]}`);
  draft.pages.forEach((p, i) => {
    const ss = sentences(p.text);
    if (ss.length > th.maxSentencesPerPage) problems.push(`page ${i + 1} has ${ss.length} sentences; max ${th.maxSentencesPerPage}`);
    if (ss.length < th.minSentencesPerPage) problems.push(`page ${i + 1} has ${ss.length} sentence(s); write at least ${th.minSentencesPerPage}`);
    for (const s of ss)
      if (s.words > th.maxSentenceWords) problems.push(`page ${i + 1}: "${s.text}" has ${s.words} words; max ${th.maxSentenceWords}`);
    if (hasDigits(p.text)) problems.push(`page ${i + 1} uses digits; write numbers as words`);
    for (const s of ss) {
      const first = s.text.replace(/^[^A-Za-z]+/, "");
      if (first && first[0] !== first[0].toUpperCase()) problems.push(`page ${i + 1}: sentence "${s.text}" must start with a capital letter`);
    }
    for (const c of draft.characters ?? []) {
      const n = c.name.split(/\s+/)[0];
      if (n && new RegExp(`\\b${n.toLowerCase()}\\b`).test(p.text)) problems.push(`page ${i + 1}: write the name "${n}" with a capital letter`);
    }
  });

  return {
    pass: problems.length === 0,
    totalTokens: total,
    counts,
    supportedPct,
    targetPct,
    targetCounts,
    targetByPage,
    heartCounts,
    storyWordsUsed: [...storyUsed],
    violations,
    problems,
  };
}

/** A single score for picking the best of several failed attempts (lower is better). */
export function badness(r: ValidationReport): number {
  return r.problems.length;
}
