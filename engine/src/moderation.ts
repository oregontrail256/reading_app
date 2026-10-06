import { fetchWithRetry } from "./llm.ts";

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
}

/** Categories we allow: cartoon fights, battles, and peril are fine in his books (graphic violence is not). */
const ALLOWED = new Set(["violence"]);

/** OpenAI moderation on arbitrary text. Flags only categories outside ALLOWED. Returns not-flagged when no key is configured (mock mode). */
export async function moderate(text: string, apiKey = process.env.OPENAI_API_KEY): Promise<ModerationResult> {
  if (!apiKey || !text.trim()) return { flagged: false, categories: [] };
  const res = await fetchWithRetry(`${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/moderations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
  });
  const json = (await res.json()) as any;
  const r = json.results?.[0];
  if (!r) return { flagged: false, categories: [] };
  const categories = Object.entries(r.categories ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k);
  const blocking = categories.filter((c) => !ALLOWED.has(c));
  return { flagged: blocking.length > 0, categories: blocking };
}
