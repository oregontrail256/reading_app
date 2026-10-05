import { fetchWithRetry } from "./llm.ts";
import type { Character } from "./types.ts";

export const STYLE =
  "Warm, bright children's picture-book illustration in soft watercolor and colored pencil. " +
  "Simple, uncluttered composition with one clear focal action, expressive friendly characters, gentle lighting. " +
  "Every person in the picture has black hair. " +
  "Absolutely no text, letters, numbers, signs, or written words anywhere in the image.";

export interface ImageOptions {
  model?: string;
  quality?: "low" | "medium" | "high";
  size?: string;
}

export interface Illustrator {
  draw(scene: string, characters: Character[]): Promise<string>;
}

export class OpenAIIllustrator implements Illustrator {
  constructor(
    private apiKey = process.env.OPENAI_API_KEY ?? "",
    private opts: ImageOptions = {},
    private baseURL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  ) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  }

  /** Returns a base64-encoded JPEG. */
  async draw(scene: string, characters: Character[]): Promise<string> {
    const cast = characters.length
      ? ` Characters (draw them exactly like this every time): ${characters.map((c) => `${c.name}: ${c.description}`).join("; ")}.`
      : "";
    const prompt = `${STYLE}${cast}\n\nScene: ${scene}`;
    const res = await fetchWithRetry(`${this.baseURL}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.opts.model ?? process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
        prompt,
        size: this.opts.size ?? "1536x1024",
        quality: this.opts.quality ?? (process.env.OPENAI_IMAGE_QUALITY as ImageOptions["quality"]) ?? "low",
        output_format: "jpeg",
        output_compression: 80,
        n: 1,
      }),
    });
    const json = (await res.json()) as any;
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error(`image API returned no image: ${JSON.stringify(json).slice(0, 300)}`);
    return b64;
  }
}

/** Run async jobs with bounded concurrency. */
export async function pool<T>(jobs: (() => Promise<T>)[], limit = 4): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}
