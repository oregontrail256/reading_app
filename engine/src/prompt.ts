import type { Lexicon } from "./lexicon.ts";
import type { BookRequest, DraftBook, LessonSpec, ValidationReport } from "./types.ts";

export const SYSTEM_PROMPT = `You write short, funny, warm picture-book stories for a 7-year-old who is learning to read. He reads them aloud himself.

THE MOST IMPORTANT RULE: it must read like a real, published early-reader book: natural sentences, a real voice, rhythm, and a story a kid wants to hear again. Simple is good; stilted is not. Never bend a sentence out of shape to avoid a word.

Word guidance (a computer checks every word):
- Build the story mostly from the KNOWN words, so he can read most of it on his own. Short common words are your friends.
- When the story is better with a word that is not in the lists, use it, and add it to "previewWords". An adult reads those to him before the story. Up to {maxStory} such words (besides character names) is fine. Choose them where they matter most: the key words of the idea (ninja, bathroom, dragon, dark), not ordinary words you could easily say with a known word.
- List character names in "previewWords" too. Do not list words that are already in the lists.
- Word forms count as separate words: if "jumped" is not listed but you need it, it is a preview word.
- PRACTICE words: use them {targetMin} to {targetMax} times in total across the whole book (repeats count). Fewer is not enough practice; more makes the book too hard. Spread them out: about one per page, never more than two on a page. Most of every page should be KNOWN words. Pick the practice words that fit THIS story best (a bakery story should use "bake" and "cake", not "game").
- Use each NEW HEART WORD at least 3 times.
- Use each REVIEW word at least once.
- No digits (write "two", not "2"). No contractions unless the contraction itself is in a list. Avoid hyphenated words.

Shape rules:
- Exactly {pages} pages. Each page has {minSent} to {maxSent} short sentences (at least {minSent} on EVERY page, so he gets real reading on each page), each at most {maxWords} words.
- {minWords} to {maxWords2} words in total, counting the title.
- The title follows the same word rules.

Grammar rules (just as important as the word rules):
- Every sentence must be correct, natural English that a children's book editor would print. Never drop endings ("Max love soup"), use the wrong verb form ("the cup fall"), or leave out small words to dodge a word. If the natural sentence needs a word that isn't listed, use it as a preview word instead of writing an awkward sentence.
- Read each page out loud in your head: it should sound like something a parent enjoys reading, with natural connections ("but", "so", "then") between ideas.
- Capitalize the first word of every sentence and every name.
- Stay in one point of view (usually third person: "Max ran," not "We ran").

Story rules:
- A real story: a character he cares about, a problem, two or three tries, a fun ending. Kind humor is great. Repetition with a twist is great.
- Mildly exciting is fine. Nothing gross, cruel, violent, or truly scary. No romance, brands, or real people.
- Pick short, easy-to-read names (Max, Pip, Tess, Jet, Bud) unless names are given.
- "scene" for each page: one or two sentences describing the illustration for that page: setting, characters (with their consistent look), action, mood. The picture must not contain any written words.
- "coverScene": the illustration for the cover.
- "summary": one or two sentences an author would need to continue the series.
- "chatQuestions": exactly two questions an adult asks out loud afterwards: one about what happened or why, one open-ended "what would you do / what do you think" question. These are read to him, so any words are fine.
- "nextOptions": exactly three short, exciting ideas for what could happen in the next book (read aloud to him; any words).
- "characters": the main characters with a one-line visual description each (species, colors, clothing) so pictures stay consistent.`;

export function systemPrompt(spec: LessonSpec): string {
  const t = spec.thresholds;
  const [tMin, tMax] = targetRange(spec);
  return SYSTEM_PROMPT.replace("{maxStory}", String(t.maxStoryWords))
    .replace("{targetMin}", String(tMin))
    .replace("{targetMax}", String(tMax))
    .replace("{pages}", String(spec.pages))
    .replace(/\{minSent\}/g, String(t.minSentencesPerPage))
    .replace("{maxSent}", String(t.maxSentencesPerPage))
    .replace("{maxWords}", String(t.maxSentenceWords))
    .replace("{minWords}", String(spec.wordBudget[0]))
    .replace("{maxWords2}", String(spec.wordBudget[1]));
}

/** Total practice-word uses to ask for: enough of each pattern, never above the cap at the low end of the word budget. */
export function targetRange(spec: LessonSpec): [number, number] {
  const n = Math.max(1, spec.targets.length);
  const lo = spec.thresholds.minTargetTokens * n;
  const avgWords = (spec.wordBudget[0] + spec.wordBudget[1]) / 2;
  const hi = Math.max(lo + 2, Math.floor(avgWords * spec.thresholds.maxTargetPct * 0.9));
  return [lo, hi];
}

export function userPrompt(spec: LessonSpec, req: BookRequest, lex: Lexicon): string {
  const lines: string[] = [];
  lines.push(`STORY IDEA: ${req.prompt}`);
  if (req.characters?.length)
    lines.push(`CHARACTERS (keep their names and looks): ${req.characters.map((c) => `${c.name}: ${c.description}`).join("; ")}`);
  if (req.series) {
    lines.push(`SERIES "${req.series.title}". Earlier books, oldest first:`);
    req.series.summaries.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    if (req.series.choice) lines.push(`He chose what happens next: ${req.series.choice}`);
  }
  if (req.avoid?.length) lines.push(`AVOID these topics: ${req.avoid.join(", ")}`);
  lines.push("");
  for (const t of spec.targets) {
    const p = lex.patternById.get(t);
    const ws = spec.targetWords.filter((w) => lex.get(w)?.p.includes(t));
    lines.push(`PRACTICE pattern "${p?.name ?? t}" (${p?.kid ?? ""}). Choose the ones that fit the story from: ${ws.join(", ")}`);
  }
  if (spec.newHeartWords.length) lines.push(`NEW HEART WORDS (use each at least 3 times): ${spec.newHeartWords.join(", ")}`);
  if (spec.reviewWords.length) lines.push(`REVIEW words (use each at least once): ${spec.reviewWords.join(", ")}`);
  lines.push("");
  lines.push(`KNOWN words (most common first): ${spec.allowedWords.join(", ")}`);
  return lines.join("\n");
}

export function repairPrompt(draft: DraftBook, report: ValidationReport, spec: LessonSpec): string {
  const lines = [
    "The checker rejected this draft. Rewrite it to fix every problem below. Keep the same plot, characters, and fun.",
    "",
    "PROBLEMS:",
    ...report.problems.map((p) => `- ${p}`),
  ];
  if (report.violations.length) {
    lines.push("", "WORDS HE CAN'T READ YET (replace each with a KNOWN or PRACTICE word, or rephrase the sentence):");
    for (const v of report.violations) lines.push(`- "${v.word}" (x${v.count}): ${v.reason}`);
  }
  if (spec.targets.length) {
    const [lo, hi] = targetRange(spec);
    lines.push("", `Reminder: use PRACTICE words ${lo}-${hi} times in total. They are: ${spec.targetWords.slice(0, 50).join(", ")}.`);
  }
  lines.push("", "Keep every sentence grammatical while you fix these. Rephrase rather than dropping word endings.");
  lines.push("", "PREVIOUS DRAFT:", JSON.stringify({ title: draft.title, previewWords: draft.previewWords, pages: draft.pages.map((p) => p.text) }));
  return lines.join("\n");
}

export const DRAFT_SCHEMA = {
  name: "draft_book",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "characters", "previewWords", "pages", "coverScene", "summary", "chatQuestions", "nextOptions"],
    properties: {
      title: { type: "string" },
      characters: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "description"],
          properties: { name: { type: "string" }, description: { type: "string" } },
        },
      },
      previewWords: { type: "array", items: { type: "string" } },
      pages: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "scene"],
          properties: { text: { type: "string" }, scene: { type: "string" } },
        },
      },
      coverScene: { type: "string" },
      summary: { type: "string" },
      chatQuestions: { type: "array", items: { type: "string" } },
      nextOptions: { type: "array", items: { type: "string" } },
    },
  },
} as const;

export const JUDGE_PROMPT = `You are a strict children's book editor. You review a short early-reader story whose vocabulary is deliberately simple (that is fine and expected: simple, repetitive words are OK).
The bar: would this read naturally next to good published early readers? Flag ONLY real problems:
- stilted, robotic, or awkward phrasing; sentences that sound like they were built from a word list; choppy runs of disconnected statements with no flow
- ungrammatical sentences (missing verb endings like "Max love soup", wrong verb forms like "the cup fall", missing articles, broken phrases)
- sentences that don't make sense, or a story that doesn't hang together (events that come from nowhere, an ending that doesn't resolve the problem)
- a story that ignores the requested idea (e.g. "afraid of the dark" never mentions darkness or fear)
- point-of-view switches, or anything unkind, scary, or inappropriate for a 7-year-old
Do NOT flag simple vocabulary, short sentences, or repetition.
Return ok=true when there is nothing that a children's book editor would refuse to print. Otherwise list each issue concretely (quote the sentence and say how to fix it, without introducing harder words).`;

export const JUDGE_SCHEMA = {
  name: "story_review",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ok", "issues"],
    properties: { ok: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } },
  },
} as const;

export function judgeInput(draft: DraftBook, idea: string): string {
  return [`Requested idea: ${idea}`, `Title: ${draft.title}`, ...draft.pages.map((p, i) => `${i + 1}. ${p.text}`)].join("\n");
}
