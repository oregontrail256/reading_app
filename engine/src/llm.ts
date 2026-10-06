import { DRAFT_SCHEMA, JUDGE_PROMPT, JUDGE_SCHEMA, judgeInput, PLAN_PROMPT, PLAN_SCHEMA, planInput } from "./prompt.ts";
import type { BookRequest, DraftBook, LessonSpec, StoryPlan } from "./types.ts";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Review {
  ok: boolean;
  issues: string[];
}

export interface Writer {
  readonly name: string;
  write(messages: Message[]): Promise<DraftBook>;
  /** Optional editorial review (grammar, coherence). Absent = always ok. */
  review?(draft: DraftBook, idea: string): Promise<Review>;
  /** Optional story outline, written before the vocabulary-constrained draft. Absent = no plan. */
  plan?(spec: LessonSpec, req: BookRequest): Promise<StoryPlan>;
}

export class OpenAIWriter implements Writer {
  readonly name: string;
  constructor(
    private apiKey = process.env.OPENAI_API_KEY ?? "",
    model = process.env.OPENAI_MODEL ?? "gpt-5",
    private baseURL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    private reasoningEffort = process.env.OPENAI_REASONING_EFFORT ?? "low",
    /** Planning and editorial review are where story quality is decided, so they think harder. */
    private storyEffort = process.env.OPENAI_STORY_EFFORT ?? "medium",
  ) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    this.name = model;
  }

  async write(messages: Message[]): Promise<DraftBook> {
    return this.chat<DraftBook>(messages, DRAFT_SCHEMA);
  }

  async plan(spec: LessonSpec, req: BookRequest): Promise<StoryPlan> {
    return this.chat<StoryPlan>(
      [
        { role: "system", content: PLAN_PROMPT },
        { role: "user", content: planInput(spec, req) },
      ],
      PLAN_SCHEMA,
      this.storyEffort,
    );
  }

  async review(draft: DraftBook, idea: string): Promise<Review> {
    return this.chat<Review>(
      [
        { role: "system", content: JUDGE_PROMPT },
        { role: "user", content: judgeInput(draft, idea) },
      ],
      JUDGE_SCHEMA,
      this.storyEffort,
    );
  }

  private async chat<T>(messages: Message[], schema: object, effort = this.reasoningEffort): Promise<T> {
    const body: Record<string, unknown> = {
      model: this.name,
      messages,
      response_format: { type: "json_schema", json_schema: schema },
    };
    if (effort && effort !== "none") body.reasoning_effort = effort;
    const res = await fetchWithRetry(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as any;
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error(`OpenAI returned no content: ${JSON.stringify(json).slice(0, 500)}`);
    return JSON.parse(content) as T;
  }
}

export async function fetchWithRetry(url: string, init: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(240_000) });
      if (res.ok) return res;
      const text = await res.text();
      // Out of credits / quota is not transient: fail at once with a clear message.
      if (res.status === 429 && /insufficient_quota|credit_balance_exhausted/.test(text))
        throw new Error(`OpenAI account has no API credits. Add credits at https://platform.openai.com/settings/organization/billing/ and retry.`);
      if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && (/HTTP 4\d\d/.test(e.message) && !e.message.includes("429") || e.message.includes("no API credits"))) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  throw lastErr;
}

/**
 * Deterministic stand-in for tests and offline runs. Its prose is nonsense, but it exercises the pipeline:
 * the first draft deliberately includes words he can't read, and the repair pass swaps them out.
 */
export class MockWriter implements Writer {
  readonly name = "mock";
  calls = 0;
  constructor(private spec: LessonSpec) {}

  async write(messages: Message[]): Promise<DraftBook> {
    this.calls++;
    const spec = this.spec;
    const known = spec.allowedWords.filter((w) => w.length > 2).slice(0, 120);
    const practice = spec.targetWords.slice(0, 6);
    const heart = spec.newHeartWords;
    const pages: { text: string; scene: string }[] = [];
    let k = 0;
    const pick = () => known[(k++ * 7) % known.length];
    for (let i = 0; i < spec.pages; i++) {
      const sentence1 = ["Max", pick(), practice[i % Math.max(1, practice.length)] ?? pick(), pick()].join(" ");
      const extra = i < 3 && heart.length ? heart[0] : pick();
      const sentence2 = [extra, pick(), pick(), pick(), pick()].join(" ");
      const sentence3 = [pick(), pick(), pick(), pick(), pick()].join(" ");
      pages.push({ text: `${cap(sentence1)}. ${cap(sentence2)}. ${cap(sentence3)}.`, scene: `Max the shark, page ${i + 1}.` });
    }
    if (this.calls === 1) pages[0].text += " The enormous dinosaurs giggled.";
    if (this.calls > 1) {
      const last = messages[messages.length - 1].content;
      const bad = [...last.matchAll(/- "([^"]+)" \(x\d+\)/g)].map((m) => m[1]);
      for (const p of pages) for (const b of bad) p.text = p.text.replace(new RegExp(`\\b${b}\\b`, "gi"), "");
    }
    return {
      title: "Max",
      characters: [{ name: "Max", description: "a small blue shark in a white baker's hat" }],
      previewWords: ["Max"],
      pages,
      coverScene: "Max the shark in his bakery.",
      summary: "Max the shark opened a bakery.",
      chatQuestions: ["Why did Max open a bakery?", "What would you bake?"],
      nextOptions: ["Max bakes a giant cake", "A crab steals the cookies", "Max goes to the beach"],
    };
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
