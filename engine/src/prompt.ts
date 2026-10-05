import type { Lexicon } from "./lexicon.ts";
import type { BookRequest, DraftBook, LessonSpec, ValidationReport } from "./types.ts";

export const SYSTEM_PROMPT = `You write short, funny, warm picture-book stories for a 7-year-old who is learning to read.
He reads every word aloud himself, so the words you may use are strictly limited to what he has learned.

Word rules (a computer checks every word, and a story that breaks them is rejected):
- Use ONLY words from the KNOWN list, the PRACTICE list, and the NEW HEART WORDS list.
- Character names and up to {maxStory} other theme words (like "dinosaur") may be used even if not listed, but you MUST list every one of them in "previewWords" (character names too). An adult reads these to him before the story.
- Word forms count as separate words: if "jumped" is not listed, do not use it, even if "jump" is.
- Use the PRACTICE words often: each practice pattern must appear at least {minTarget} times across the book. Using the same practice word several times is good.
- Use each NEW HEART WORD at least 3 times.
- Use each REVIEW word at least once.
- No digits (write "two", not "2"). No contractions unless the contraction itself is in a list. Avoid hyphenated words.

Shape rules:
- Exactly {pages} pages. Each page has 1 to {maxSent} short sentences of at most {maxWords} words each.
- {minWords} to {maxWords2} words in total, counting the title.
- The title follows the same word rules.

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
  return SYSTEM_PROMPT.replace("{maxStory}", String(t.maxStoryWords))
    .replace("{minTarget}", String(t.minTargetTokens))
    .replace("{pages}", String(spec.pages))
    .replace("{maxSent}", String(t.maxSentencesPerPage))
    .replace("{maxWords}", String(t.maxSentenceWords))
    .replace("{minWords}", String(spec.wordBudget[0]))
    .replace("{maxWords2}", String(spec.wordBudget[1]));
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
    lines.push(`PRACTICE pattern "${p?.name ?? t}" (${p?.kid ?? ""}). Use these words: ${ws.join(", ")}`);
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
  if (spec.targets.length)
    lines.push("", `Reminder: PRACTICE words are ${spec.targetWords.slice(0, 30).join(", ")}.`);
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
