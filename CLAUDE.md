# Reader — project notes for Claude

A personal Ello-style iPad reading app for one early reader (mid-1st grade). The app writes AI picture books from his idea, sized to the phonics patterns he knows, and tracks mastery pattern by pattern and word by word. It's for one family, distributed through TestFlight.

PRD (design rationale and research basis): https://claude.ai/code/artifact/de66edc2-e1e5-4f03-8bb3-a204298b03fd

## Layout

```
lexicon/   Python: builds shared/lexicon.json (CMU dict + wordfreq + kid_words.txt − blocklist.txt)
shared/    lexicon.json (~13.8k words: graphemes, phonics patterns, heart words, kid flag), patterns.json (scope & sequence)
engine/    TypeScript (Node 22, tsx): lesson spec → free-written story → adapt to JSON → validator → images
           src/server.ts = book server (Hono), src/cli.ts = printable books for testing
ios/       SwiftUI iPad app (XcodeGen project.yml) + ReaderCore Swift package (learner model, store, client)
render.yaml  Render blueprint for the book server
```

## Commands

- Engine tests: `cd engine && npm test` (offline, mock writer). Typecheck: `npx tsc --noEmit`
- Try a book: `cd engine && npm run book -- --prompt "..." [--images]` → `engine/out/*.html` (needs OPENAI_API_KEY in repo-root `.env`)
- Local server: `cd engine && npm run serve` (port 8787)
- iOS: `cd ios && xcodegen`, then build in Xcode. ReaderCore tests: `cd ios/ReaderCore && swift test`
- Rebuild lexicon: `python3 lexicon/build_lexicon.py 10000`

## Deploy

- **Book server**: Render, service from `render.yaml`, free plan (sleeps after ~15 min idle). Auto-deploys on push to `main`. Env: OPENAI_API_KEY (dashboard only), APP_TOKEN (generated), OPENAI_MODEL=gpt-5.
- **iPad app**: TestFlight, app "Kim Eng Family Reader", bundle `com.jonathaneng.reader`, team `JTA48F9F92`, internal group "Family". To ship: bump `CURRENT_PROJECT_VERSION` in `ios/project.yml`, run `xcodegen`, then Product → Archive → Distribute → TestFlight Internal Only. Builds expire after 90 days.
- `ios/Reader/Resources/server.json` (git-ignored) bakes the Render URL and APP_TOKEN into the build. The app fills these settings only if they're empty or point at localhost.

## Design decisions (keep unless asked)

- **Write freely, then adapt (two calls, ~2 min).** (1) `writer.story`: a short author-style prompt (`STORY_PROMPT`, medium reasoning effort, plain text) writes the whole story the way ChatGPT would, with the idea, characters, and his level in plain terms, plus the practice words offered as ingredients ("about 6 uses, at most one per page, only where it's the word you'd pick anyway"). (2) `writer.write` with `ADAPT_PROMPT` (low effort, JSON): keeps the story's words exactly, only splits long sentences / fixes page count and mechanics, and adds preview words, scenes, characters, questions. The original is saved as `book.story`. A rewrite happens only for structural problems (wrong page count, empty page), at most once.
- **Why it's built this way (learned the hard way, Oct 2026):** a separate formula planner, word lists in the prompt, a low-effort writer, and 3–4 rounds of editor-note rewrites all flattened the prose into "go not fast"–style text. Forcing practice/heart words in *after* writing damaged good lines ("Back to work" → "Back to the same work"); giving them to the author with no cap turned it into a phonics drill (22–29 uses). Don't reintroduce an editor rewrite loop or post-hoc word insertion without comparing against `book.story`.
- **Vocabulary is not restricted.** Words he can't decode are *stretch words*: the writer's most important ones (at most 6 in all, counting names and the heart word, `maxStoryWords`; the app also shows at most 6 so "Let's read!" stays on screen) go on the "Words to know" page (`cls: story`), and the rest stay as `cls: unknown`, tap to hear. Reported in `validation.violations`, never problems. `isFancy` (validate.ts) adds a soft warning for >6 rare words; it never triggers a rewrite. Sample books run about 65–78% readable (known + pre-taught); sound effects (WHOOSH, SPLAT) are much of the rest.
- **Sight words count as known.** The Dolch pre-primer + primer words plus "says" (`engine/src/sightWords.ts`) are known unless his record says "learning", and are never picked as practice words.
- **Book generation never fails over vocabulary or shape.** Leftover rule misses ship in `validation.warnings`. Only an empty draft fails.
- **Shape:** 10 pages, 2–4 sentences per page, ≤12 words per sentence, about 150–260 words, practice words about 6 uses.
- **Family cast** (main characters, chosen in "Who is it about?"): Jamie and Lincoln (boys), Lily and Reese (girls), Mommy and Daddy, all with black hair. Loki is a small black-and-white dog like a mini border collie/sheltie. Defined in `AppSettings.defaultFamily` (Store.swift). The image style also says every person has black hair.
- **Content:** action, battles, peril, and cartoon fighting are allowed (parent's call). Characters and worlds from shows, games, and toys (Ninjago, Minecraft) are welcome; the image model drew Ninjago/Minecraft pages fine in testing. Still excluded: romance, real public figures.
- **Sound effects he can decode:** the story prompt asks for short-vowel ones (Bam! Zap! Thud! Plop!) instead of WHOOSH/BOING. They're in `lexicon/kid_words.txt` so they're scored as readable; rebuild with `python3 lexicon/build_lexicon.py 10000` (needs `pip install cmudict wordfreq`; a rebuild with no changes reproduces the file exactly). Moderation runs on input and output but ignores the plain `violence` category (`ALLOWED` in moderation.ts); graphic violence, sexual, self-harm, hate, etc. still block. The app's own "Topics to avoid" setting (Grown-ups; default "scary monsters, getting lost") is still sent to the writer.
- **iPad UI:** forced light appearance. Tapping an unmarked word says it at once and marks it "needed help" (highlighted). Tapping a marked word clears the mark silently. Names and theme words are never marked. (Press-and-hold missed/helped marking was removed in 003c65d; that commit is newer than TestFlight build 1.) Font: Andika (PostScript names `Andika`, `Andika-Bold`).
- **Async jobs:** the app POSTs `/v1/jobs` and polls `/v1/jobs/:id`. Pending books persist across app restarts and are resubmitted once if the server lost the job (Render sleep/redeploy).
- **Data:** JSON files in the app's Application Support on the iPad (learner.json, events.jsonl, books/, series.json). No database. The server is stateless.

## Learner model (ReaderCore/LearnerModel.swift)

States: New → Learning → Reviewing → Mastered.
- **Patterns:** move to Reviewing at ≥90% weighted accuracy over the last 12 attempts, weight ≥6, ≥8 distinct words read unaided, successes on ≥2 days.
- **Spaced reviews:** at 1, 3 and 7 days; passing the third makes it Mastered.
- **Down-weighting:** a miss on a word only lightly penalizes patterns already mastered (×0.3). Tap-only evidence when reading alone has weight 0.3.

## Not built yet / ideas

- M2: read-aloud speech recognition and a graduated hint ladder with recorded phoneme audio.
- Keep 1–2 books pre-generated so one is always ready.
- A "Say it" microphone button on New book (today: keyboard dictation).
- iCloud Drive backup of books/progress.
- Grown-ups editor for family descriptions.

## Working agreements

- Commit with clear messages. Never commit `.env` or `server.json`.
- After changing `engine/`, push to `main` (Render redeploys). After changing `ios/`, bump the build number and upload to TestFlight.
- Run `npm test` before pushing engine changes. Keep the iOS build warning-free.
