import type { Lexicon } from "./lexicon.ts";
import type { BookRequest, DraftBook, LessonSpec, ValidationReport } from "./types.ts";

/**
 * Step 1: write the story the way a good author would, with no checklists. Everything about his reading
 * level that matters is said here in plain terms; the exact word rules come later, in the adapt step.
 */
export const STORY_PROMPT = `You are a children's author who writes early readers that kids beg to reread, in the spirit of Mo Willems's Elephant and Piggie, Arnold Lobel's Frog and Toad, and Dav Pilkey's Dragon books.

Write a story for a 7-year-old boy in the middle of first grade. He will read it aloud himself.

- Make it a real little story: someone wants something, it goes wrong in a funny or exciting way (more than once), and they figure it out. End with a payoff or a joke. The requested idea is the heart of it from page one.
- Make it fun to read out loud: dialogue, sound effects, repetition with a twist, a joke a 7-year-old boy will love.
- Sound effects he can sound out himself: short, spelled-the-way-they-sound words like Bam! Zap! Pop! Thud! Bonk! Crash! Smash! Splash! Zip! Plop! Thump! Fizz! Crunch! Skid! Not ones with long vowels or odd spellings (WHOOSH, BOING, ZOOM, BOOM, KAPOW), and no stretched letters (Zzzip, Mooo).
- Action, slapstick, battles, peril, monsters, and cartoon fighting are all fine.
- Use the words of a first-grade early reader: mostly short, common words he can sound out or knows by sight. When the story needs a bigger word (ninja, toilet paper, rocket), use it. Don't use a fancy word where a plain one works.
- Short sentences (at most {maxWords} words), {minSent} to {maxSent} sentences per page, about {minWords} to {maxWords2} words in all.
- Third person ("Lincoln ran", not "I ran" or "we ran") and one tense throughout.
- He is practicing a spelling pattern this week. Use a FEW of the PRACTICE words: about {targetMin} times in the whole book (repeats count), at most one per page, only where it is the word you'd pick anyway. Do not build the story around them or pick the plot to fit them. The NEW HEART WORD can appear a couple of times if it fits.
- Use given characters' names and genders. Every human in the story has black hair, but don't mention hair in the text.
- Characters and worlds he asks for from shows, games, and toys (Ninjago, Minecraft, Pokemon) are welcome; use them the way he'd expect. No romance or real public figures.

Write exactly {pages} pages. Answer with the title on the first line, then one line per page: "1. ...", "2. ...". Nothing else.`;

/**
 * Step 2: fit the finished story to this reader with as few edits as possible, and add everything the
 * app needs around it (preview words, scenes, questions).
 */
export const ADAPT_PROMPT = `You are the editor of an early-reader series. You get a finished story written for a 7-year-old in the middle of first grade. It is good: keep its words, voice, and jokes exactly. Do not swap in other words, add lines, or "improve" it.

Allowed text changes, and only these:
1. Split any sentence over {maxWords} words into two. Make sure the book has exactly {pages} pages.
2. Write numbers as words, capitalize sentence starts and names, and fix a real grammar mistake or a switch between "he" and "we" or between past and present.

Then fill in the rest:
- "title": the story's title (shorten it if it is long).
- "pages[].text": the story text for each page.
- "previewWords": at most {maxStory} words in all: the main character names, then the key words of this story that a mid-first grader probably can't sound out yet (ninja, toilet, rocket, balloon). An adult reads these to him before the story. Most important first.
- "pages[].scene": one or two sentences describing the illustration for that page: setting, characters (with their consistent look), action, mood. The picture must not contain any written words.
- "coverScene": the illustration for the cover.
- "characters": the main characters with a one-line visual description each (species, colors, clothing) so pictures stay consistent. For MAIN CHARACTERS that were given, copy their given description exactly and only add clothing. Every human has black hair: say so in their description and in every scene that shows them.
- "summary": one or two sentences an author would need to continue the series.
- "chatQuestions": exactly two questions an adult asks out loud afterwards: one about what happened or why, one open-ended "what would you do / what do you think" question.
- "nextOptions": exactly three short, exciting ideas for what could happen in the next book.`;

function fill(template: string, spec: LessonSpec): string {
  const t = spec.thresholds;
  const [tMin, tMax] = targetRange(spec);
  return template
    .replace("{maxStory}", String(t.maxStoryWords))
    .replace("{targetMin}", String(tMin))
    .replace("{targetMax}", String(tMax))
    .replace(/\{pages\}/g, String(spec.pages))
    .replace(/\{minSent\}/g, String(t.minSentencesPerPage))
    .replace(/\{maxSent\}/g, String(t.maxSentencesPerPage))
    .replace(/\{maxWords\}/g, String(t.maxSentenceWords))
    .replace("{minWords}", String(spec.wordBudget[0]))
    .replace("{maxWords2}", String(spec.wordBudget[1]));
}

export const storyPrompt = (spec: LessonSpec) => fill(STORY_PROMPT, spec);
export const adaptPrompt = (spec: LessonSpec) => fill(ADAPT_PROMPT, spec);

/** Total practice-word uses to ask for: enough of each pattern, never above the cap at the low end of the word budget. */
export function targetRange(spec: LessonSpec): [number, number] {
  const n = Math.max(1, spec.targets.length);
  const lo = spec.thresholds.minTargetTokens * n;
  const avgWords = (spec.wordBudget[0] + spec.wordBudget[1]) / 2;
  const hi = Math.max(lo + 2, Math.floor(avgWords * spec.thresholds.maxTargetPct * 0.9));
  return [lo, hi];
}

function context(req: BookRequest): string[] {
  const lines = [`STORY IDEA: ${req.prompt}`];
  if (req.characters?.length)
    lines.push(`MAIN CHARACTERS (keep their names, genders, and looks exactly): ${req.characters.map((c) => `${c.name}: ${c.description}`).join("; ")}`);
  if (req.series) {
    lines.push(`SERIES "${req.series.title}". Earlier books, oldest first:`);
    req.series.summaries.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    if (req.series.choice) lines.push(`He chose what happens next: ${req.series.choice}`);
  }
  if (req.avoid?.length) lines.push(`AVOID these topics: ${req.avoid.join(", ")}`);
  return lines;
}

function practice(spec: LessonSpec, lex: Lexicon): string[] {
  const lines: string[] = [];
  for (const t of spec.targets) {
    const p = lex.patternById.get(t);
    const ws = spec.targetWords.filter((w) => lex.get(w)?.p.includes(t));
    lines.push(`PRACTICE words ("${p?.name ?? t}", ${p?.kid ?? ""}): ${ws.join(", ")}`);
  }
  if (spec.newHeartWords.length) lines.push(`NEW HEART WORD: ${spec.newHeartWords.join(", ")}`);
  return lines;
}

export function storyInput(spec: LessonSpec, req: BookRequest, lex: Lexicon): string {
  return [...context(req), "", ...practice(spec, lex)].join("\n");
}

export function adaptInput(spec: LessonSpec, req: BookRequest, lex: Lexicon, story?: string): string {
  const lines = context(req);
  if (!story) lines.push("", ...practice(spec, lex));
  lines.push("", story ? `THE STORY:\n${story}` : "THE STORY: (none yet: write one for the idea, using some of the practice words where they fit)");
  return lines.join("\n");
}

export function repairPrompt(draft: DraftBook, report: ValidationReport): string {
  return [
    "Fix these problems with as few changes as possible. Keep the story, its words, and its voice.",
    "",
    ...report.problems.map((p) => `- ${p}`),
    "",
    "PREVIOUS DRAFT:",
    JSON.stringify({ title: draft.title, pages: draft.pages.map((p) => p.text) }),
  ].join("\n");
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
