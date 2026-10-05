import type { Lexicon } from "./lexicon.ts";
import type { Book } from "./types.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A printable HTML book (one story page per sheet) plus a parent sheet for marking misses on paper. */
export function renderPrintable(book: Book, lex: Lexicon): string {
  const img = (b64?: string) => (b64 ? `<img src="data:image/jpeg;base64,${b64}" alt="">` : `<div class="noimg"></div>`);
  const pages = book.pages
    .map(
      (p, i) => `<section class="page">${img(p.image)}<p class="text">${esc(p.text)}</p><div class="num">${i + 1}</div></section>`,
    )
    .join("\n");

  const targetRows = book.spec.targets
    .map((t) => {
      const pat = lex.patternById.get(t);
      const used = new Set<string>();
      for (const p of book.pages) for (const tok of p.tokens) if (tok.k === "target" && lex.get(tok.w!)?.p.includes(t)) used.add(tok.w!);
      return `<tr><td><b>${esc(pat?.name ?? t)}</b><br><span class="muted">${esc(pat?.kid ?? "")}</span></td><td>${[...used].map(esc).join(", ")}</td><td>${book.validation.targetCounts[t] ?? 0}</td></tr>`;
    })
    .join("");

  const marking = book.pages
    .map((p, i) => {
      const ws = p.tokens.filter((t) => t.w).map((t) => `<span class="w ${t.k}">${esc(t.t)}</span>`).join(" ");
      return `<div class="mark"><span class="pg">p${i + 1}</span> ${ws}</div>`;
    })
    .join("");

  const v = book.validation;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(book.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Andika:wght@400;700&display=swap" rel="stylesheet">
<style>
@page { size: letter landscape; margin: 0.5in; }
body { font-family: Andika, "Comic Sans MS", sans-serif; margin: 0; color: #222; }
.cover, .page { page-break-after: always; height: 7.3in; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25in; position: relative; }
.cover h1 { font-size: 54pt; margin: 0; text-align: center; }
img { max-height: 4.6in; max-width: 100%; border-radius: 12px; }
.noimg { height: 3.5in; width: 6in; border: 2px dashed #ccc; border-radius: 12px; }
.text { font-size: 34pt; line-height: 1.5; text-align: center; margin: 0 0.5in; word-spacing: 0.15em; }
.num { position: absolute; bottom: 0; right: 0; color: #999; font-size: 14pt; }
.parent { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 11pt; padding: 0.2in; }
.parent h2 { margin: 0 0 6px; } .parent h3 { margin: 18px 0 6px; }
table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 4px 8px; text-align: left; vertical-align: top; }
.muted { color: #777; }
.mark { margin: 6px 0; line-height: 2; } .pg { color: #999; margin-right: 6px; }
.w { border-bottom: 1px solid #bbb; padding: 0 2px; } .w.target { background: #fff3c4; } .w.heart { background: #ffd9e0; } .w.story { background: #dbeafe; }
</style></head><body>
<section class="cover">${img(book.cover)}<h1>${esc(book.title)}</h1></section>
${pages}
<section class="parent">
<h2>Parent sheet: ${esc(book.title)}</h2>
<p class="muted">${v.totalTokens} words · ${(v.supportedPct * 100).toFixed(0)}% known or pre-taught · ${(v.targetPct * 100).toFixed(0)}% practice words · ${book.rounds} writing round(s) · ${esc(book.model)}</p>
<h3>Before reading: read these to him</h3>
<p>${book.previewWords.map(esc).join(", ") || "(none)"}${book.spec.newHeartWords.length ? ` · New heart word: <b>${book.spec.newHeartWords.map(esc).join(", ")}</b> (point out the tricky part)` : ""}</p>
<h3>Practice patterns</h3>
<table><tr><th>Pattern</th><th>Words in this book</th><th>Times</th></tr>${targetRows || `<tr><td colspan=3>(none)</td></tr>`}</table>
<h3>Marking sheet</h3>
<p class="muted">Circle any word he misses; put a dot over words he needed help with. Yellow = practice, pink = heart word, blue = preview word.</p>
${marking}
<h3>After reading: talk about it</h3>
<ol>${book.chatQuestions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
<h3>What happens next? (let him pick)</h3>
<ol>${book.nextOptions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
</section></body></html>`;
}
