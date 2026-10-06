import type { Lexicon } from "./lexicon.ts";
import type { BookRequest, DraftBook, LessonSpec, StoryPlan, ValidationReport } from "./types.ts";

export const SYSTEM_PROMPT = `You write short, funny, warm picture-book stories for a 7-year-old who is learning to read. He reads them aloud himself.

THE MOST IMPORTANT RULE: it must be a good story that makes sense, told like a real, published early-reader book: natural sentences, a real voice, rhythm, and a story a kid wants to hear again. Simple is good; stilted is not. Never bend a sentence out of shape to avoid a word.

THE STORY PLAN: you are given a STORY PLAN with one beat per page. Write the book from it:
- Page N tells beat N. Keep every event, in order. Do not add new characters, objects, places, or events that the plan does not set up.
- Make the cause and effect visible in the words on the page. A child reading only the text (no plan, no pictures) must always be able to answer "why did that happen?" Link ideas with "so", "but", "then", "because" rather than listing unconnected facts.
- Show what the hero wants on page one or two, and keep him wanting it until it is solved.
- The lesson comes through what the hero DOES at the turn and the ending. At most one short line where a character says it out loud. No narrator moral at the end.
- If a word rule and the story collide, simplify the wording, never the logic. A preview word is better than a sentence that makes no sense.

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
- Follow the STORY PLAN (see above). Kind humor and repetition with a twist are great.
- Mildly exciting is fine. Nothing gross, cruel, violent, or truly scary. No romance, brands, or real people.
- Pick short, easy-to-read names (Max, Pip, Tess, Jet, Bud) unless names are given.
- "scene" for each page: one or two sentences describing the illustration for that page: setting, characters (with their consistent look), action, mood. The picture must not contain any written words.
- "coverScene": the illustration for the cover.
- "summary": one or two sentences an author would need to continue the series.
- "chatQuestions": exactly two questions an adult asks out loud afterwards: one about what happened or why, one open-ended "what would you do / what do you think" question. These are read to him, so any words are fine.
- "nextOptions": exactly three short, exciting ideas for what could happen in the next book (read aloud to him; any words).
- "characters": the main characters with a one-line visual description each (species, colors, clothing) so pictures stay consistent. For MAIN CHARACTERS that were given, copy their given description exactly and only add clothing.
- Every human character has black hair. Say so in their character description and whenever a scene describes them.
- Use each given character's gender consistently (he/she) in the text.`;

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

export function userPrompt(spec: LessonSpec, req: BookRequest, lex: Lexicon, plan?: StoryPlan): string {
  const lines: string[] = [];
  lines.push(`STORY IDEA: ${req.prompt}`);
  if (plan) lines.push("", formatPlan(plan), "");
  if (req.characters?.length)
    lines.push(`MAIN CHARACTERS (the story is about them; keep their names, genders, and looks exactly): ${req.characters.map((c) => `${c.name}: ${c.description}`).join("; ")}`);
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
    "The checker rejected this draft. Rewrite it to fix every problem below. Keep the STORY PLAN, characters, and fun. Fix story problems (editor notes about logic or flow) first: never break the story logic to hit a word rule.",
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

export const PLAN_PROMPT = `You are an award-winning author of early-reader picture books for boys around age 7 (think Mo Willems, Arnold Lobel, Dav Pilkey's early readers). Before any words are written, you plan the story. A separate writer will later turn your plan into very simple sentences, so the plan must be a story that still works when told in short, plain words.

What makes it good for this reader (a 7-year-old boy):
- A hero he roots for: a kid, an animal, or a robot about his size who WANTS something concrete and visible (win the race, build the tallest tower, get the ball back from the roof). Not a feeling; a thing he can picture.
- A real problem that gets in the way, with stakes he understands. Mild danger, a race against time, a mess that keeps growing, a rival: good. Real fear or cruelty: no.
- Three tries (the rule of three). Each try is a direct consequence of the one before ("but", "so", never "and then"). Each fails in a bigger, funnier way. Slapstick, absurd escalation, and a silly sidekick land well.
- A low point where it looks hopeless.
- A turn: the hero changes HOW he tries, and that change is the lesson in action (he asks for help, tells the truth, slows down, shares, tries the scary thing, keeps practicing, listens). Choose the lesson that grows naturally out of this idea; vary it; avoid the generic "be yourself".
- The hero solves it himself. No grown-up, magic, or luck rescues him.
- A satisfying, surprising-but-fair ending that pays off something set up earlier, plus a funny final beat or callback.
- A running gag that appears three times is a great bonus.

Hard rules for a story that survives simple words:
- Every beat is something you can see and draw: actions, objects, places. No inner monologue, wordplay, dream sequences, time jumps, or "it turned out that...".
- At most three named characters and two settings.
- Every object or character that matters later is introduced earlier. Nothing appears from nowhere.
- The requested idea is central from page one, not a side detail.
- For a series, stay consistent with the earlier books and the child's chosen next step.
- Nothing gross, cruel, violent, or truly scary. No romance, brands, or real people.

"beats": exactly one beat per page, in order. Each beat is one or two plain sentences saying what happens on that page AND why (what caused it). Spread the arc over the pages: problem clear by page 2; tries in the middle; low point and turn near the end; resolution and final funny beat last.
Before answering, test it: could a 7-year-old retell this story in order and explain why each thing happened? If not, fix the plan.`;

export const PLAN_SCHEMA = {
  name: "story_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["hero", "want", "problem", "lesson", "tries", "lowPoint", "turn", "resolution", "ending", "runningGag", "beats"],
    properties: {
      hero: { type: "string", description: "Name and who he is, one line" },
      want: { type: "string" },
      problem: { type: "string" },
      lesson: { type: "string", description: "The lesson in kid words, e.g. 'Asking for help is not giving up.'" },
      tries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["attempt", "result"],
          properties: { attempt: { type: "string" }, result: { type: "string" } },
        },
      },
      lowPoint: { type: "string" },
      turn: { type: "string", description: "What the hero does differently, showing the lesson" },
      resolution: { type: "string" },
      ending: { type: "string", description: "Final funny beat or callback" },
      runningGag: { type: "string", description: "A gag that repeats three times, or empty" },
      beats: { type: "array", items: { type: "string" } },
    },
  },
} as const;

export function planInput(spec: LessonSpec, req: BookRequest): string {
  const lines = [`STORY IDEA: ${req.prompt}`, `PAGES: ${spec.pages} (so exactly ${spec.pages} beats)`];
  if (req.characters?.length)
    lines.push(`MAIN CHARACTERS (the story is about them): ${req.characters.map((c) => `${c.name}: ${c.description}`).join("; ")}`);
  if (req.series) {
    lines.push(`SERIES "${req.series.title}". Earlier books, oldest first:`);
    req.series.summaries.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    if (req.series.choice) lines.push(`He chose what happens next: ${req.series.choice}`);
  }
  if (req.avoid?.length) lines.push(`AVOID these topics: ${req.avoid.join(", ")}`);
  return lines.join("\n");
}

export function formatPlan(p: StoryPlan): string {
  return [
    "STORY PLAN (follow it beat by beat):",
    `Hero: ${p.hero}. Wants: ${p.want}`,
    `Problem: ${p.problem}`,
    `Lesson (show it through the hero's actions): ${p.lesson}`,
    ...p.tries.map((t, i) => `Try ${i + 1}: ${t.attempt} -> ${t.result}`),
    `Low point: ${p.lowPoint}`,
    `Turn: ${p.turn}`,
    `Resolution: ${p.resolution}`,
    `Ending: ${p.ending}`,
    p.runningGag ? `Running gag: ${p.runningGag}` : "",
    "Beats:",
    ...p.beats.map((b, i) => `  Page ${i + 1}: ${b}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export const JUDGE_PROMPT = `You are a strict children's book editor. You review a short early-reader story for a 7-year-old boy. Its vocabulary is deliberately simple (that is fine and expected: simple, repetitive words are OK).
Read ONLY the text, the way the child will. The bar: would this sit next to good published early readers, and would a 7-year-old understand it, follow it, and want to read it again?

Story (most important; check each page against the one before):
- Does every page follow from the previous one? Flag any event, object, or character that appears without being set up, and any step a child could not explain ("why did he do that?").
- Is it clear by page two what the hero wants and what is in the way?
- Do the tries build on each other and escalate, or is it a list of unrelated scenes?
- Does the hero solve the problem himself, in a way that was set up earlier? Flag rescues by luck, magic, or a grown-up, and endings that just stop.
- Is there a lesson that comes through what the hero does? Flag a missing lesson, or a lesson that is preached by a narrator.
- Is it fun: a funny moment, a surprise, a satisfying last page? Flag a story that is flat or pointless.
- Does it deliver the requested idea?
Sentences:
- stilted, robotic, or awkward phrasing; sentences built from a word list; choppy runs of disconnected statements
- ungrammatical sentences (missing verb endings like "Max love soup", wrong verb forms like "the cup fall", missing articles, broken phrases)
- point-of-view switches, or anything unkind, scary, or inappropriate for a 7-year-old
Do NOT flag simple vocabulary, short sentences, or repetition.
Return ok=true only when a children's book editor would print it as is. Otherwise list each issue concretely: name the page, quote the text, and say how to fix it without introducing harder words.`;

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
