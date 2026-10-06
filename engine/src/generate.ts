import { randomUUID } from "node:crypto";
import type { Illustrator } from "./images.ts";
import { pool } from "./images.ts";
import type { Lexicon } from "./lexicon.ts";
import type { Message, Writer } from "./llm.ts";
import { repairPrompt, systemPrompt, userPrompt } from "./prompt.ts";
import { buildSpec, type SpecOptions } from "./spec.ts";
import { tokenize } from "./tokenize.ts";
import type { Book, BookRequest, DraftBook, LearnerSnapshot, LessonSpec, StoryPlan, ValidationReport } from "./types.ts";
import { annotate, badness, nameSet, storySet, validate } from "./validate.ts";

export interface GenerateOptions extends SpecOptions {
  lex: Lexicon;
  snapshot: LearnerSnapshot;
  request: BookRequest;
  writer: Writer | ((spec: LessonSpec) => Writer);
  illustrator?: Illustrator;
  maxRepairs?: number;
  /** Skip the editorial (grammar/coherence) review pass. */
  skipReview?: boolean;
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

  // Plan the story first, free of vocabulary rules, so the plot is decided by thinking about the story alone.
  let plan: StoryPlan | undefined;
  if (writer.plan) {
    const t0 = Date.now();
    plan = await writer.plan(spec, req).catch((e) => (log(`plan failed, writing without one: ${e.message}`), undefined));
    if (plan && plan.beats.length !== spec.pages) log(`plan has ${plan.beats.length} beats for ${spec.pages} pages`);
    if (plan) log(`plan: ${plan.lesson} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  const messages: Message[] = [
    { role: "system", content: systemPrompt(spec) },
    { role: "user", content: userPrompt(spec, req, lex, plan) },
  ];
  let best: { draft: DraftBook; report: ValidationReport } | null = null;
  const maxRepairs = o.maxRepairs ?? 3;
  let rounds = 0;
  for (let round = 0; round <= maxRepairs; round++) {
    rounds = round + 1;
    const t0 = Date.now();
    const draft = sanitize(await writer.write(messages));
    const report = validate(draft, spec, snap, lex);
    // Editorial review on every draft: story problems get fixed in the same rewrite as word problems,
    // and the best-draft pick below can see them.
    if (writer.review && !o.skipReview) {
      const rv = await writer.review(draft, req.prompt).catch((e) => (log(`review failed: ${e.message}`), { ok: true, issues: [] }));
      if (!rv.ok && rv.issues.length) {
        report.pass = false;
        report.problems.push(...rv.issues.map((i) => `editor: ${i}`));
      }
    }
    log(`round ${round + 1}: ${report.pass ? "PASS" : report.problems.join("; ")} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    // Ties go to the later draft: it already has the earlier editor notes worked in.
    if (!best || score(report) <= score(best.report)) best = { draft, report };
    if (report.pass) break;
    messages.push({ role: "assistant", content: JSON.stringify(draft) });
    messages.push({ role: "user", content: repairPrompt(draft, report, spec) });
  }

  let { draft, report } = best!;
  // The "Words to know" page: the writer's key words he can't decode yet, at most maxStoryWords
  // besides names. Other hard words stay in the text as stretch words (tap to hear).
  draft = { ...draft, previewWords: pickPreview(draft, report, spec) };
  const editorNotes = report.problems.filter((p) => p.startsWith("editor:"));
  report = validate(draft, spec, snap, lex);
  report.problems.push(...editorNotes);
  report.pass = report.problems.length === 0;
  if (report.violations.length) log(`stretch words (tap to hear): ${report.violations.map((v) => v.word).join(", ")}`);
  // Whatever is left (length, practice-word mix, editor notes) is a quality shortfall, not a reason
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
    plan,
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

/** Which draft to keep: a story that makes sense matters more than shape-rule misses. */
function score(r: ValidationReport): number {
  const editor = r.problems.filter((p) => p.startsWith("editor:")).length;
  return badness(r) + editor * 15;
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
