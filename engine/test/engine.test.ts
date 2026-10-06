import assert from "node:assert/strict";
import { test } from "node:test";
import { GenerationFailed, generateBook } from "../src/generate.ts";
import { snapshotFromPlacement, wordKnown } from "../src/learner.ts";
import { lexicon } from "../src/lexicon.ts";
import { MockWriter, type Writer } from "../src/llm.ts";
import { buildSpec, chooseTargets } from "../src/spec.ts";
import { sentences, tokenize } from "../src/tokenize.ts";
import type { DraftBook } from "../src/types.ts";
import { storyInput } from "../src/prompt.ts";
import { classifyWord, isFancy, validate } from "../src/validate.ts";

const lex = lexicon();
const snap = snapshotFromPlacement(lex, "suffix_ed"); // mastered through -ed; next up is silent-e

test("lexicon tags core patterns", () => {
  const has = (w: string, p: string) => assert.ok(lex.get(w)!.p.includes(p), `${w} should have ${p}: ${lex.get(w)!.p}`);
  has("cat", "short_a");
  has("ship", "digraph_sh");
  has("cake", "vce_a");
  has("bike", "vce_i");
  has("rain", "vt_ai_ay");
  has("stop", "blend_initial");
  has("jumped", "suffix_ed");
  has("car", "r_ar");
  assert.equal(lex.get("said")!.h, true);
  assert.equal(lex.get("cat")!.h, false);
  assert.deepEqual(lex.get("said")!.hp, [1, 3]); // "ai" is the heart part
});

test("tokenize keeps exact text and normalizes words", () => {
  const toks = tokenize("Max’s cat ran! Then—he hid.");
  assert.equal(toks.map((t) => t.t).join(""), "Max’s cat ran! Then—he hid.");
  assert.deepEqual(toks.filter((t) => t.w).map((t) => t.w), ["max's", "cat", "ran", "then", "he", "hid"]);
  assert.deepEqual(sentences("A cat sat. It ran! Did it?").map((s) => s.words), [3, 2, 2]);
});

test("placement snapshot: decodable words known, later patterns not", () => {
  assert.ok(wordKnown(snap, "jumped", lex.get("jumped")));
  assert.ok(wordKnown(snap, "fish", lex.get("fish")));
  assert.ok(!wordKnown(snap, "cake", lex.get("cake")));
  assert.ok(!wordKnown(snap, "rain", lex.get("rain")));
  assert.ok(wordKnown(snap, "the", lex.get("the")), "top heart words are pre-mastered");
});

test("targets: next pattern in sequence, two when accuracy is high", () => {
  assert.deepEqual(chooseTargets(lex, snap), ["vce_a"]);
  assert.deepEqual(chooseTargets(lex, { ...snap, recentAccuracy: [0.97, 0.98, 0.99] }), ["vce_a", "vce_i"]);
  assert.deepEqual(chooseTargets(lex, { ...snap, patterns: { ...snap.patterns, r_ar: "learning" } }), ["r_ar"]);
  assert.deepEqual(chooseTargets(lex, { ...snap, targetOverride: ["oo"] }), ["oo"]);
});

test("classify: known, target, story, unknown", () => {
  const spec = buildSpec(lex, snap, { prompt: "x" });
  const story = new Set(["max", "bakery", "game", "zork"]);
  assert.equal(classifyWord("fish", spec, snap, lex, story).cls, "known");
  assert.equal(classifyWord("cake", spec, snap, lex, story).cls, "target");
  assert.equal(classifyWord("max", spec, snap, lex, story).cls, "known", "a decodable name is just a known word");
  assert.equal(classifyWord("game", spec, snap, lex, story).cls, "target", "listing a practice word as preview doesn't make it pre-taught");
  assert.equal(classifyWord("bakery", spec, snap, lex, story).cls, "story");
  assert.equal(classifyWord("zork's", spec, snap, lex, story).cls, "story");
  assert.equal(classifyWord("rain", spec, snap, lex, story).cls, "unknown");
  assert.equal(classifyWord("zxqv", spec, snap, lex, story).cls, "unknown");
});

test("validator flags hard words, long sentences, and missing practice", () => {
  const spec = buildSpec(lex, snap, { prompt: "x", pages: 4 });
  const draft: DraftBook = {
    title: "Max and the Rain",
    characters: [{ name: "Max", description: "a shark" }],
    previewWords: ["Max"],
    pages: [
      { text: "Max can swim fast. He has a big fin.", scene: "" },
      { text: "Max went to the shop and he got a lot of fish and a big red hat for his mom.", scene: "" },
      { text: "It is wet. Max sat.", scene: "" },
      { text: "The end.", scene: "" },
    ],
    coverScene: "",
    summary: "",
    chatQuestions: [],
    nextOptions: [],
  };
  const r = validate(draft, spec, snap, lex);
  assert.equal(r.pass, false);
  assert.ok(r.violations.some((v) => v.word === "rain"));
  assert.ok(r.problems.some((p) => p.includes("has 20 words; max 12")));
  assert.ok(r.problems.some((p) => p.includes("Silent e: a_e") && p.includes("appears 0 times")));
});

test("generate: hard words the writer didn't list stay in as tap-to-hear stretch words, not rewritten", async () => {
  const logs: string[] = [];
  const book = await generateBook({
    lex,
    snapshot: snap,
    request: { prompt: "a shark who runs a bakery" },
    writer: (spec) => new MockWriter(spec),
    log: (m) => logs.push(m),
  });
  assert.equal(book.rounds, 1);
  assert.ok(!book.previewWords.includes("enormous"), `preview: ${book.previewWords}`);
  assert.ok(book.pages.some((p) => p.tokens.some((t) => t.w === "enormous" && t.k === "unknown")));
  assert.ok(book.validation.pass);
  assert.equal(book.pages.length, 10);
  assert.ok(book.pages[0].tokens.some((t) => t.k === "target"));
  assert.ok(!("allowedWords" in book.spec));
  assert.ok(logs.some((l) => l.startsWith("round 1: PASS")), logs.join("\n"));
});

test("generate: never fails over vocabulary", async () => {
  const stubborn: Writer = {
    name: "stubborn",
    async write() {
      return {
        title: "Rain",
        characters: [],
        previewWords: [],
        pages: [{ text: "The rain fell on the train in Spain.", scene: "" }],
        coverScene: "",
        summary: "",
        chatQuestions: [],
        nextOptions: [],
      };
    },
  };
  const book = await generateBook({ lex, snapshot: snap, request: { prompt: "x" }, writer: stubborn, maxRepairs: 1 });
  assert.ok(book.validation.pass);
  assert.ok(book.pages[0].tokens.find((t) => t.w === "rain")?.k === "unknown");
  assert.ok((book.validation.warnings ?? []).length > 0, "shape shortfalls are kept as warnings");
});

test("generate: an empty draft still fails", async () => {
  const empty: Writer = { name: "empty", async write() { return { title: "", characters: [], previewWords: [], pages: [], coverScene: "", summary: "", chatQuestions: [], nextOptions: [] }; } };
  await assert.rejects(generateBook({ lex, snapshot: snap, request: { prompt: "x" }, writer: empty, maxRepairs: 0 }), (e: unknown) => e instanceof GenerationFailed);
});

test("validator: grammar-ish checks; no preview-word cap", () => {
  const spec = buildSpec(lex, snap, { prompt: "x", pages: 2 }, { thresholds: { maxStoryWords: 3 } });
  const draft: DraftBook = {
    title: "Zork",
    characters: [{ name: "Zork", description: "a robot" }],
    previewWords: ["Zork", "bakery", "dinosaur", "octopus", "jungle", "spider", "rocket"],
    pages: [
      { text: "zork had a bakery. the dinosaur sat.", scene: "" },
      { text: "An octopus came to the jungle. A spider had a rocket.", scene: "" },
    ],
    coverScene: "", summary: "", chatQuestions: [], nextOptions: [],
  };
  const r = validate(draft, spec, snap, lex);
  assert.ok(r.problems.some((p) => p.includes('write the name "Zork" with a capital')));
  assert.ok(r.problems.some((p) => p.includes("must start with a capital")));
  assert.ok(!r.problems.some((p) => p.includes("preview words")));
});

test("generate: the preview page holds names, then hard key words, maxStoryWords in all with the heart word", async () => {
  const writer: Writer = {
    name: "listy",
    async write() {
      return {
        title: "Zork",
        characters: [{ name: "Zork", description: "a robot" }],
        previewWords: ["Zork", "bakery", "the", "dinosaur", "octopus", "jungle", "spider"],
        pages: [{ text: "Zork had a bakery. The dinosaur sat. An octopus came to the jungle. A spider sat.", scene: "" }],
        coverScene: "", summary: "", chatQuestions: [], nextOptions: [],
      };
    },
  };
  const book = await generateBook({ lex, snapshot: snap, request: { prompt: "x", pages: 1 }, writer, maxRepairs: 0, thresholds: { maxStoryWords: 4 } });
  const expected = ["Zork", "bakery", "dinosaur", "octopus"].slice(0, 4 - book.spec.newHeartWords.length);
  assert.deepEqual(book.previewWords, expected);
  assert.ok(book.previewWords.length + book.spec.newHeartWords.length <= 4);
  assert.equal(book.pages[0].tokens.find((t) => t.w === "jungle")?.k, "unknown");
});

test("generate: only structural problems get a rewrite", async () => {
  let calls = 0;
  const pages = (n: number) => Array.from({ length: n }, () => ({ text: "Max ran. Max sat.", scene: "" }));
  const writer: Writer = {
    name: "short",
    async write() {
      calls++;
      // First draft is missing pages (rewrite); the second has shape misses only (ship with warnings).
      return { title: "Max", characters: [], previewWords: [], pages: pages(calls === 1 ? 3 : 10), coverScene: "", summary: "", chatQuestions: [], nextOptions: [] };
    },
  };
  const book = await generateBook({ lex, snapshot: snap, request: { prompt: "x" }, writer, maxRepairs: 3 });
  assert.equal(calls, 2);
  assert.equal(book.pages.length, 10);
  assert.ok((book.validation.warnings ?? []).length > 0, "practice-word shortfall is kept as a warning");
});

test("server: auth and mock generation", async () => {
  process.env.MOCK = "1";
  process.env.APP_TOKEN = "t0ken";
  const { app } = await import("../src/server.ts");
  const denied = await app.request("/v1/books", { method: "POST", body: "{}" });
  assert.equal(denied.status, 401);
  const res = await app.request("/v1/books", {
    method: "POST",
    headers: { authorization: "Bearer t0ken", "content-type": "application/json" },
    body: JSON.stringify({ snapshot: snap, request: { prompt: "a shark bakery" } }),
  });
  assert.equal(res.status, 200);
  const book = (await res.json()) as any;
  assert.equal(book.pages.length, 10);
});

test("server: async job submit and poll", async () => {
  process.env.MOCK = "1";
  process.env.APP_TOKEN = "t0ken";
  const { app } = await import("../src/server.ts");
  const h = { authorization: "Bearer t0ken", "content-type": "application/json" };
  const sub = await app.request("/v1/jobs", { method: "POST", headers: h, body: JSON.stringify({ snapshot: snap, request: { prompt: "ninjas in the bathroom" } }) });
  assert.equal(sub.status, 202);
  const { id } = (await sub.json()) as any;
  let job: any;
  for (let i = 0; i < 50; i++) {
    job = await (await app.request(`/v1/jobs/${id}`, { headers: h })).json();
    if (job.status !== "running") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(job.status, "done");
  assert.equal(job.book.pages.length, 10);
  assert.equal((await app.request(`/v1/jobs/nope`, { headers: h })).status, 404);
  assert.equal((await app.request(`/v1/jobs/${id}`)).status, 401);
});

test("generate: the story is written freely first, then handed to the adapt step", async () => {
  let seen = "";
  const book = await generateBook({
    lex,
    snapshot: snap,
    request: { prompt: "a shark who runs a bakery" },
    writer: (spec) => {
      const m = new MockWriter(spec) as MockWriter & { story: Writer["story"] };
      const write = m.write.bind(m);
      m.write = async (msgs) => ((seen = msgs[1].content), write(msgs));
      m.story = async () => "Max Bakes\n1. Max the shark had a bakery.";
      return m;
    },
  });
  assert.ok(seen.includes("THE STORY:\nMax Bakes\n1. Max the shark had a bakery."), seen.slice(-300));
  assert.ok(!seen.includes("PRACTICE words"), "practice words go to the author, not the adapt step");
  assert.equal(book.story, "Max Bakes\n1. Max the shark had a bakery.");
});

test("fancy words: inflected everyday words are plain, rare ones are fancy", () => {
  for (const w of ["smiled", "laughed", "taller", "tapped", "rolled", "tied", "park", "slow"]) assert.ok(!isFancy(w, lex), w);
  for (const w of ["slumped", "scooted", "tumbled"]) assert.ok(isFancy(w, lex), w);
});

test("prompt: the author gets the practice words and heart word with the idea", () => {
  const spec = buildSpec(lex, snap, { prompt: "a shark who runs a bakery" });
  const input = storyInput(spec, { prompt: "a shark who runs a bakery" }, lex);
  assert.ok(input.startsWith("STORY IDEA: a shark who runs a bakery"));
  assert.ok(input.includes("PRACTICE words") && input.includes(spec.targetWords[0]), input);
  if (spec.newHeartWords.length) assert.ok(input.includes(`NEW HEART WORD: ${spec.newHeartWords[0]}`));
});
