# Reader — project notes for Claude

A personal Ello-style iPad reading app for one early reader (mid-1st grade). The app writes AI picture books from his idea, sized to the phonics patterns he knows, and tracks mastery pattern by pattern and word by word. It's for one family, distributed through TestFlight.

PRD (design rationale and research basis): https://claude.ai/code/artifact/de66edc2-e1e5-4f03-8bb3-a204298b03fd

## Layout

```
lexicon/   Python: builds shared/lexicon.json (CMU dict + wordfreq + kid_words.txt − blocklist.txt)
shared/    lexicon.json (~13.8k words: graphemes, phonics patterns, heart words, kid flag), patterns.json (scope & sequence)
engine/    TypeScript (Node 22, tsx): lesson spec → OpenAI writer → validator → repair loop → editor review → images
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

- **Natural story first.** The top prompt rule is "reads like a real published early reader". Words outside his known set become *preview / stretch words* (pre-taught on the "Words to know" page; up to 8 besides names) rather than being written around. Unlisted hard words are auto-promoted, so rewrite rounds go to flow.
- **Book generation never fails over vocabulary.** After the repair rounds, the best draft ships, with leftover rule misses kept in `validation.warnings`. Only an empty draft fails.
- **Plan first.** Before writing, a separate call (`writer.plan`) outlines the story (want, problem, tries, low point, turn, resolution, running gag, one beat per page) with no vocabulary rules. The writer gets the plan. If planning fails, the book is written without one.
- **Editor review** (second model call) runs on every draft, not only passing ones: grammar, stilted phrasing, coherence, fit to the idea. Its notes drive rewrites, and the best-draft pick weights each editor problem as 15 (a story that makes sense beats word-rule misses).
- **Shape:** 10 pages, 3–4 sentences per page, ≤10 words per sentence, practice words 6–17 uses, at most 2 per page.
- **Family cast** (main characters, chosen in "Who is it about?"): Jamie and Lincoln (boys), Lily and Reese (girls), Mommy and Daddy, all with black hair. Loki is a small black-and-white dog like a mini border collie/sheltie. Defined in `AppSettings.defaultFamily` (Store.swift). The image style also says every person has black hair.
- **Content:** gentle, no violence ("fight" → playful practice). Moderation on input and output.
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
