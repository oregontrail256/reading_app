import { randomUUID } from "node:crypto";
import type { Illustrator } from "./images.ts";
import { pool } from "./images.ts";
import type { Lexicon } from "./lexicon.ts";
import type { Message, Writer } from "./llm.ts";
import { adaptInput, adaptPrompt, repairPrompt } from "./prompt.ts";
import { buildSpec, type SpecOptions } from "./spec.ts";
import { tokenize } from "./tokenize.ts";
import type { Book, BookRequest, DraftBook, LearnerSnapshot, LessonSpec, ValidationReport } from "./types.ts";
import { annotate, badness, nameSet, storySet, validate } from "./validate.ts";

export interface GenerateOptions extends SpecOptions {
  lex: Lexicon;
  snapshot: LearnerSnapshot;
  request: BookRequest;
  writer: Writer | ((spec: LessonSpec) => Writer);
  illustrator?: Illustrator;
  /** Rewrites allowed for structural problems (wrong page count, empty pages). */
  maxRepairs?: number;
  log?: (msg: string) => void;
}

export class GenerationFailed extends Error {
  constructor(
    message: string,
    readonly report: ValidationReport,
    readonly draft: DraftBook,
  ) {
    super(message);
  }
}

export async function generateBook(o: GenerateOptions): Promise<Book> {
  const log = o.log ?? (() => {});
  const { lex, snapshot: snap, request: req } = o;
  const spec = buildSpec(lex, snap, req, o);
  const writer = typeof o.writer === "function" ? o.writer(spec) : o.writer;
  log(`targets: ${spec.targets.join(", ") || "(none)"}; heart: ${spec.newHeartWords.join(", ") || "-"}; ${spec.allowedWords.length} known words`);

  // 1. Write the story freely, like an author, with the practice words offered as ingredients, not rules.
  let freeStory: string | undefined;
  if (writer.story) {
    const t0 = Date.now();
    freeStory = await writer.story(spec, req, lex);
    log(`story written (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  // 2. Keep the story's words; fix only shape and mechanics, and add scenes, preview words, and questions.
  const messages: Message[] = [
    { role: "system", content: adaptPrompt(spec) },
    { role: "user", content: adaptInput(spec, req, lex, freeStory) },
  ];
  let best: { draft: DraftBook; report: ValidationReport } | null = null;
  const maxRepairs = o.maxRepairs ?? 1;
  let rounds = 0;
  for (let round = 0; round <= maxRepairs; round++) {
    rounds = round + 1;
    const t0 = Date.now();
    const draft = sanitize(await writer.write(messages));
    const report = validate(draft, spec, snap, lex);
    log(`round ${round + 1}: ${report.pass ? "PASS" : report.problems.join("; ")} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    // Ties go to the later draft.
    if (!best || badness(report) <= badness(best.report)) best = { draft, report };
    // Only structural problems are worth a rewrite: every rewrite risks flattening the story's voice.
    const structural = structuralProblems(draft, spec);
    if (!structural.length) break;
    messages.push({ role: "assistant", content: JSON.stringify(draft) });
    messages.push({ role: "user", content: repairPrompt(draft, { ...report, problems: structural }) });
  }

  let { draft, report } = best!;
  // The "Words to know" page: the writer's key words he can't decode yet, at most maxStoryWords
  // besides names. Other hard words stay in the text as stretch words (tap to hear).
  draft = { ...draft, previewWords: pickPreview(draft, report, spec) };
  report = validate(draft, spec, snap, lex);
  if (report.violations.length) log(`stretch words (tap to hear): ${report.violations.map((v) => v.word).join(", ")}`);
  // Whatever is left (length, practice-word mix, sentence shape) is a quality shortfall, not a reason
  // to give him nothing. Ship the best draft and keep the notes. Only an empty draft fails.
  if (!report.pass && draft.pages.some((p) => p.text.trim())) {
    log(`accepting best draft with notes: ${report.problems.join("; ")}`);
    report = { ...report, pass: true, warnings: report.problems, problems: [] };
  }
  if (!report.pass) throw new GenerationFailed(`book failed validation: ${report.problems.join("; ")}`, report, draft);

  const story = storySet(spec, draft);
  const previewWords = draft.previewWords.filter((w) => report.storyWordsUsed.includes(w.toLowerCase()));
  const book: Book = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    title: draft.title,
    titleTokens: annotate(tokenize(draft.title), spec, snap, lex, story),
    request: req,
    spec: { ...spec, allowedWords: undefined } as Book["spec"],
    characters: mergeCharacters(req.characters ?? [], draft.characters),
    previewWords,
    pages: draft.pages.map((p) => ({ text: p.text, scene: p.scene, tokens: annotate(tokenize(p.text), spec, snap, lex, story) })),
    coverScene: draft.coverScene,
    summary: draft.summary,
    chatQuestions: draft.chatQuestions.slice(0, 2),
    nextOptions: draft.nextOptions.slice(0, 3),
    validation: report,
    rounds,
    model: writer.name,
    story: freeStory,
  };
  delete (book.spec as any).allowedWords;

  if (o.illustrator) {
    const ill = o.illustrator;
    const t0 = Date.now();
    const scenes = [book.coverScene, ...book.pages.map((p) => p.scene)];
    const images = await pool(
      scenes.map((s) => () => ill.draw(s, book.characters).catch((e) => (log(`image failed: ${e.message}`), undefined))),
      5,
    );
    book.cover = images[0];
    book.pages.forEach((p, i) => (p.image = images[i + 1]));
    log(`images: ${images.filter(Boolean).length}/${images.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  return book;
}

function structuralProblems(d: DraftBook, spec: LessonSpec): string[] {
  const out: string[] = [];
  if (d.pages.length !== spec.pages) out.push(`has ${d.pages.length} pages; need exactly ${spec.pages}`);
  d.pages.forEach((p, i) => {
    if (!p.text.trim()) out.push(`page ${i + 1} is empty`);
  });
  return out;
}

/** Names, plus up to maxStoryWords of the writer's listed key words that he can't already read. */
function pickPreview(draft: DraftBook, report: ValidationReport, spec: LessonSpec): string[] {
  const names = nameSet(spec, draft);
  const hard = new Set([...report.violations.map((v) => v.word.replace(/'s$/, "")), ...report.storyWordsUsed]);
  const listed = [...new Set(draft.previewWords.map((w) => w.toLowerCase()))];
  const keep = listed.filter((w) => names.has(w));
  const theme = listed.filter((w) => !names.has(w) && hard.has(w)).slice(0, spec.thresholds.maxStoryWords);
  return [...keep, ...theme].map((w) => draft.previewWords.find((x) => x.toLowerCase() === w) ?? w);
}

function sanitize(d: DraftBook): DraftBook {
  return {
    title: (d.title ?? "").trim(),
    characters: d.characters ?? [],
    previewWords: (d.previewWords ?? []).map((w) => w.trim()).filter(Boolean),
    pages: (d.pages ?? []).map((p) => ({ text: (p.text ?? "").replace(/\s+/g, " ").trim(), scene: p.scene ?? "" })),
    coverScene: d.coverScene ?? "",
    summary: d.summary ?? "",
    chatQuestions: d.chatQuestions ?? [],
    nextOptions: d.nextOptions ?? [],
  };
}

function mergeCharacters(given: BookRequest["characters"] & {}, drafted: DraftBook["characters"]) {
  const out = [...given];
  for (const c of drafted) if (!out.some((g) => g.name.toLowerCase() === c.name.toLowerCase())) out.push(c);
  return out;
}
