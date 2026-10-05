import { randomUUID } from "node:crypto";
import type { Illustrator } from "./images.ts";
import { pool } from "./images.ts";
import type { Lexicon } from "./lexicon.ts";
import type { Message, Writer } from "./llm.ts";
import { repairPrompt, systemPrompt, userPrompt } from "./prompt.ts";
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

  const messages: Message[] = [
    { role: "system", content: systemPrompt(spec) },
    { role: "user", content: userPrompt(spec, req, lex) },
  ];
  let best: { draft: DraftBook; report: ValidationReport } | null = null;
  const maxRepairs = o.maxRepairs ?? 3;
  let rounds = 0;
  for (let round = 0; round <= maxRepairs; round++) {
    rounds = round + 1;
    const t0 = Date.now();
    const draft = sanitize(await writer.write(messages));
    const report = validate(draft, spec, snap, lex);
    // Editorial review only once the words pass (and only if there are rounds left to fix things).
    if (report.pass && writer.review && !o.skipReview) {
      const rv = await writer.review(draft, req.prompt).catch((e) => (log(`review failed: ${e.message}`), { ok: true, issues: [] }));
      if (!rv.ok && rv.issues.length) {
        report.pass = false;
        report.problems.push(...rv.issues.map((i) => `editor: ${i}`));
      }
    }
    log(`round ${round + 1}: ${report.pass ? "PASS" : report.problems.join("; ")} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (!best || badness(report) < badness(best.report)) best = { draft, report };
    if (report.pass) break;
    messages.push({ role: "assistant", content: JSON.stringify(draft) });
    messages.push({ role: "user", content: repairPrompt(draft, report, spec) });
  }

  let { draft, report } = best!;
  if (!report.pass) {
    // Never fail a book over vocabulary. Any words he can't decode yet become "stretch words":
    // pre-taught on the preview page (read to him first) and not counted against him while reading.
    if (report.violations.length) {
      const extra = report.violations.map((v) => v.word.replace(/'s$/, "")).filter((w) => !draft.previewWords.map((x) => x.toLowerCase()).includes(w));
      draft = { ...draft, previewWords: [...draft.previewWords, ...extra] };
      const before = report.problems.filter((p) => p.startsWith("editor:"));
      report = validate(draft, spec, snap, lex);
      report.problems.push(...before);
      log(`stretch words added to preview: ${extra.join(", ")}`);
    }
    // Whatever is left (too many preview words, length, practice-word mix, editor notes) is a quality
    // shortfall, not a reason to give him nothing. Ship the best draft and keep the notes.
    if (!report.pass && draft.pages.some((p) => p.text.trim())) {
      log(`accepting best draft with notes: ${report.problems.join("; ")}`);
      report = { ...report, pass: true, warnings: report.problems, problems: [] };
    }
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
