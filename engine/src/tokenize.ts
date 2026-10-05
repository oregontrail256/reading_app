import type { Token } from "./types.ts";

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/** Split text into word tokens and the non-word runs between them, so it can be re-rendered exactly. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    const i = m.index!;
    if (i > last) out.push({ t: text.slice(last, i), w: null });
    out.push({ t: m[0], w: normalize(m[0]) });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), w: null });
  return out;
}

export function normalize(word: string): string {
  return word.toLowerCase().replace(/’/g, "'");
}

export function words(text: string): string[] {
  return tokenize(text).flatMap((t) => (t.w ? [t.w] : []));
}

/** Sentences with their word counts. */
export function sentences(text: string): { text: string; words: number }[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ text: s, words: words(s).length }));
}

export function hasDigits(text: string): boolean {
  return /\d/.test(text);
}
