/**
 * Thin proxy: holds the OpenAI key, runs generation, returns validated books to the iPad app.
 *
 *   APP_TOKEN=some-long-secret OPENAI_API_KEY=sk-... npm run serve
 *
 * Endpoints (all but /health need `Authorization: Bearer $APP_TOKEN`):
 *   GET  /health
 *   POST /v1/jobs    { snapshot, request, images?, quality? }  -> 202 { id }   (app uses this)
 *   GET  /v1/jobs/:id                                           -> { status: running | done (+book) | failed (+error) }
 *   POST /v1/books   same body, waits and returns the Book directly
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadEnv } from "./env.ts";
import { GenerationFailed, generateBook } from "./generate.ts";
import { OpenAIIllustrator } from "./images.ts";
import { lexicon } from "./lexicon.ts";
import { MockWriter, OpenAIWriter } from "./llm.ts";
import { moderate } from "./moderation.ts";
import { randomUUID } from "node:crypto";
import type { Book, BookRequest, LearnerSnapshot } from "./types.ts";

loadEnv();
const lex = lexicon();
const mock = process.env.MOCK === "1";
const token = process.env.APP_TOKEN;

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, mock, words: lex.words.size, model: mock ? "mock" : process.env.OPENAI_MODEL ?? "gpt-5" }));

app.use("/v1/*", async (c, next) => {
  if (token && c.req.header("authorization") !== `Bearer ${token}`) return c.json({ error: "unauthorized" }, 401);
  await next();
});

type JobBody = { snapshot: LearnerSnapshot; request: BookRequest; images?: boolean; quality?: string };
type JobResult = { status: 200; book: Book } | { status: 400 | 422 | 502; error: Record<string, unknown> };

/** Moderate the idea, write + check the book, moderate the result. Never throws. */
export async function runJob(body: JobBody): Promise<JobResult> {
  if (!body?.request?.prompt || !body.snapshot?.patterns) return { status: 400, error: { error: "need snapshot and request.prompt" } };
  const started = Date.now();
  const log = (m: string) => console.log(`[book ${body.request.prompt.slice(0, 30)}] ${m}`);
  try {
    const input = await moderate([body.request.prompt, ...(body.request.characters ?? []).map((ch) => `${ch.name}: ${ch.description}`)].join("\n"));
    if (input.flagged) return { status: 422, error: { error: "prompt_flagged", categories: input.categories } };
    const book = await generateBook({
      lex,
      snapshot: body.snapshot,
      request: body.request,
      writer: mock ? (spec) => new MockWriter(spec) : new OpenAIWriter(),
      illustrator: body.images && !mock ? new OpenAIIllustrator(undefined, { quality: (body.quality as any) ?? undefined }) : undefined,
      log,
    });
    const out = await moderate([book.title, ...book.pages.map((p) => p.text), ...book.nextOptions, ...book.chatQuestions].join("\n"));
    if (out.flagged) return { status: 422, error: { error: "output_flagged", categories: out.categories } };
    log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { status: 200, book };
  } catch (e) {
    if (e instanceof GenerationFailed)
      return { status: 422, error: { error: "validation_failed", problems: e.report.problems, violations: e.report.violations } };
    console.error(e);
    return { status: 502, error: { error: "generation_error", message: e instanceof Error ? e.message : String(e) } };
  }
}

/** Synchronous: waits for the whole book (used by tests and simple clients). */
app.post("/v1/books", async (c) => {
  const r = await runJob(await c.req.json());
  return r.status === 200 ? c.json(r.book) : c.json(r.error, r.status);
});

// Async jobs: the app submits, then polls. Survives slow generation, proxy timeouts, and the app being closed.
// Kept in memory: a server restart loses unfinished jobs (the app then shows "try again").
interface Job {
  id: string;
  created: number;
  status: "running" | "done" | "failed";
  book?: Book;
  error?: Record<string, unknown>;
  httpStatus?: number;
}
const jobs = new Map<string, Job>();
const JOB_TTL_MS = 3 * 24 * 3600 * 1000;

app.post("/v1/jobs", async (c) => {
  const body = (await c.req.json()) as JobBody;
  if (!body?.request?.prompt || !body.snapshot?.patterns) return c.json({ error: "need snapshot and request.prompt" }, 400);
  const job: Job = { id: randomUUID(), created: Date.now(), status: "running" };
  jobs.set(job.id, job);
  for (const [id, j] of jobs) if (Date.now() - j.created > JOB_TTL_MS) jobs.delete(id);
  void runJob(body).then((r) => {
    if (r.status === 200) Object.assign(job, { status: "done", book: r.book });
    else Object.assign(job, { status: "failed", error: r.error, httpStatus: r.status });
  });
  return c.json({ id: job.id, status: job.status }, 202);
});

app.get("/v1/jobs/:id", (c) => {
  const job = jobs.get(c.req.param("id"));
  if (!job) return c.json({ error: "job_not_found" }, 404);
  if (job.status === "running") return c.json({ id: job.id, status: "running", seconds: Math.round((Date.now() - job.created) / 1000) });
  if (job.status === "done") return c.json({ id: job.id, status: "done", book: job.book });
  return c.json({ id: job.id, status: "failed", ...job.error });
});

if (process.argv[1]?.endsWith("server.ts")) {
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  console.log(`reader proxy on :${port} (${mock ? "MOCK writer" : `OpenAI ${process.env.OPENAI_MODEL ?? "gpt-5"}`})${token ? "" : " — WARNING: APP_TOKEN not set, no auth"}`);
}
