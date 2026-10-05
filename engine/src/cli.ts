#!/usr/bin/env tsx
/**
 * M0: generate a decodable book from the command line and write JSON + a printable HTML book.
 *
 *   npm run book -- --prompt "a shark who runs a bakery"
 *   npm run book -- --prompt "..." --placement vce_a --images --quality medium
 *   npm run book -- --prompt "..." --profile profiles/sample.json --mock
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadEnv } from "./env.ts";
import { GenerationFailed, generateBook } from "./generate.ts";
import { OpenAIIllustrator } from "./images.ts";
import { snapshotFromPlacement } from "./learner.ts";
import { lexicon } from "./lexicon.ts";
import { MockWriter, OpenAIWriter } from "./llm.ts";
import { renderPrintable } from "./render.ts";
import type { BookRequest, Character, LearnerSnapshot } from "./types.ts";

loadEnv();
const { values } = parseArgs({
  options: {
    prompt: { type: "string", short: "p" },
    profile: { type: "string" },
    placement: { type: "string", default: "suffix_ed" },
    character: { type: "string", multiple: true },
    pages: { type: "string", default: "10" },
    images: { type: "boolean", default: false },
    quality: { type: "string", default: "low" },
    mock: { type: "boolean", default: false },
    repairs: { type: "string", default: "3" },
    out: { type: "string", default: "out" },
  },
});

if (!values.prompt) {
  console.error('usage: npm run book -- --prompt "a shark who runs a bakery" [--images] [--placement vce_a] [--mock]');
  process.exit(1);
}

const lex = lexicon();
const snapshot: LearnerSnapshot = values.profile
  ? JSON.parse(readFileSync(values.profile, "utf8"))
  : snapshotFromPlacement(lex, values.placement!);
const characters: Character[] = (values.character ?? []).map((c) => {
  const [name, ...rest] = c.split(":");
  return { name: name.trim(), description: rest.join(":").trim() };
});
const request: BookRequest = { prompt: values.prompt, characters, pages: Number(values.pages) };

try {
  const book = await generateBook({
    lex,
    snapshot,
    request,
    writer: values.mock ? (spec) => new MockWriter(spec) : new OpenAIWriter(),
    illustrator: values.images ? new OpenAIIllustrator(undefined, { quality: values.quality as any }) : undefined,
    maxRepairs: Number(values.repairs),
    log: (m) => console.error(`  ${m}`),
  });
  mkdirSync(values.out!, { recursive: true });
  const slug = book.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";
  const base = join(values.out!, `${slug}-${book.id.slice(0, 6)}`);
  writeFileSync(`${base}.json`, JSON.stringify(book, null, 1));
  writeFileSync(`${base}.html`, renderPrintable(book, lex));
  console.log(`\n${book.title}\n`);
  book.pages.forEach((p, i) => console.log(`  ${i + 1}. ${p.text}`));
  console.log(`\n  -> ${base}.html`);
} catch (e) {
  if (e instanceof GenerationFailed) {
    console.error(`\nFAILED after repairs: ${e.report.problems.join("; ")}`);
    for (const v of e.report.violations) console.error(`  ${v.word} x${v.count}: ${v.reason}`);
    e.draft.pages.forEach((p, i) => console.error(`  ${i + 1}. ${p.text}`));
    process.exit(2);
  }
  throw e;
}
