/**
 * Thin proxy: holds the OpenAI key, runs generation, returns validated books to the iPad app.
 *
 *   APP_TOKEN=some-long-secret OPENAI_API_KEY=sk-... npm run serve
 *
 * Endpoints (all but /health need `Authorization: Bearer $APP_TOKEN`):
 *   GET  /health
 *   POST /v1/books   { snapshot, request, images?: boolean, quality?: "low"|"medium"|"high" }  -> Book
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadEnv } from "./env.ts";
import { GenerationFailed, generateBook } from "./generate.ts";
import { OpenAIIllustrator } from "./images.ts";
import { lexicon } from "./lexicon.ts";
import { MockWriter, OpenAIWriter } from "./llm.ts";
import { moderate } from "./moderation.ts";
import type { BookRequest, LearnerSnapshot } from "./types.ts";

loadEnv();
const lex = lexicon();
const mock = process.env.MOCK === "1" || !process.env.OPENAI_API_KEY;
const token = process.env.APP_TOKEN;

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, mock, words: lex.words.size, model: mock ? "mock" : process.env.OPENAI_MODEL ?? "gpt-5" }));

app.use("/v1/*", async (c, next) => {
  if (token && c.req.header("authorization") !== `Bearer ${token}`) return c.json({ error: "unauthorized" }, 401);
  await next();
});

app.post("/v1/books", async (c) => {
  const body = (await c.req.json()) as { snapshot: LearnerSnapshot; request: BookRequest; images?: boolean; quality?: string };
  if (!body?.request?.prompt || !body.snapshot?.patterns) return c.json({ error: "need snapshot and request.prompt" }, 400);
  const started = Date.now();
  const log = (m: string) => console.log(`[book ${body.request.prompt.slice(0, 30)}] ${m}`);

  const input = await moderate([body.request.prompt, ...(body.request.characters ?? []).map((ch) => `${ch.name}: ${ch.description}`)].join("\n"));
  if (input.flagged) return c.json({ error: "prompt_flagged", categories: input.categories }, 422);

  try {
    const book = await generateBook({
      lex,
      snapshot: body.snapshot,
      request: body.request,
      writer: mock ? (spec) => new MockWriter(spec) : new OpenAIWriter(),
      illustrator: body.images && !mock ? new OpenAIIllustrator(undefined, { quality: (body.quality as any) ?? undefined }) : undefined,
      log,
    });
    const out = await moderate([book.title, ...book.pages.map((p) => p.text), ...book.nextOptions, ...book.chatQuestions].join("\n"));
    if (out.flagged) return c.json({ error: "output_flagged", categories: out.categories }, 422);
    log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return c.json(book);
  } catch (e) {
    if (e instanceof GenerationFailed) return c.json({ error: "validation_failed", problems: e.report.problems, violations: e.report.violations }, 422);
    console.error(e);
    return c.json({ error: "generation_error", message: e instanceof Error ? e.message : String(e) }, 502);
  }
});

if (process.argv[1]?.endsWith("server.ts")) {
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  console.log(`reader proxy on :${port} (${mock ? "MOCK writer" : `OpenAI ${process.env.OPENAI_MODEL ?? "gpt-5"}`})${token ? "" : " — WARNING: APP_TOKEN not set, no auth"}`);
}
