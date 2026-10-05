# Reader

A personal, Ello-style reading app for one early reader. It writes decodable picture books about whatever he picks, sized so about 85% or more of the words are ones he already knows. A few words practice the next phonics pattern. It tracks what he's mastered pattern by pattern, word by word.

This repo implements milestones **M0** (generator + validator, printable books) and **M1** (proxy + iPad reader with tap-to-hear, parent marking, learner model). Speech recognition (M2), consistent character art and the full series flow (M3) come next. See the PRD.

```
lexicon/   Python: builds shared/lexicon.json (13.8k words: graphemes, phonics patterns, heart words)
shared/    lexicon.json + patterns.json (the scope and sequence). Used by both the engine and the app
engine/    TypeScript: lesson spec -> LLM writer -> word-level validator -> repair loop -> images. CLI + HTTP proxy
ios/       SwiftUI iPad app (XcodeGen) + ReaderCore Swift package (learner model, persistence, client)
```

## How a book gets made

1. **Lesson spec** (`engine/src/spec.ts`). From the learner snapshot it picks 1–2 target patterns: the next unmastered step in the sequence that has at least 8 usable words, or 2 targets when recent accuracy is 95% or higher. It also picks up to one new heart word, any due review words, and the list of known words.
2. **Write** (`llm.ts`, `prompt.ts`). An OpenAI chat model with a strict JSON schema returns pages, scene descriptions, preview words, chat questions and three "what happens next" options.
3. **Validate** (`validate.ts`). Every token is classified as known / target / heart / story / unknown against the lexicon and his state. The rules: no unknown words; at least 85% known or pre-taught; at most 15% practice words; each target used 5 or more times; at most 4 preview words; sentences of 10 words or fewer; at most 3 sentences per page; exact page count.
4. **Repair.** Violations go back to the model as concrete instructions, up to 3 rounds. If at the end only a few hard words remain and the budget allows, they become pre-taught preview words. Otherwise the book is rejected.
5. **Moderate and illustrate.** OpenAI moderation runs on both input and output. One image per page is generated from the scene text, never the page text, so pictures don't give away the words.

## M0: make printable books (no app needed)

```bash
cd engine && npm install
cp ../.env.example ../.env     # add OPENAI_API_KEY
npm run book -- --prompt "a shark who runs a bakery"                       # text only
npm run book -- --prompt "a robot who loves soup" --images --quality medium
npm run book -- --prompt "..." --placement vce_a        # mastered through silent-e a_e
npm run book -- --prompt "..." --character "Pip: a tiny green dragon with a red scarf"
npm test                                                # 9 tests, offline (mock writer)
```

Each book is written to `engine/out/<title>.html`. It prints as one page per sheet, plus a **parent sheet**: preview words to read to him first, the practice patterns, a marking strip for every page (circle misses), the chat questions, and the next-book options.

`--placement <pattern id>` sets what he has mastered. It means "everything up to and including this step"; the ids are in `shared/patterns.json`. The default `suffix_ed` (step 21) matches "mid-1st grade: blends, digraphs, -ed/-ing; silent-e next."

## M1: the iPad app

**1. Run the book server** (on your Mac, or any always-on box):

```bash
cd engine
APP_TOKEN=$(openssl rand -hex 16) npm run serve      # prints the port, 8787
```

Keep that token. Without `OPENAI_API_KEY`, the server runs a mock writer so you can test the app flow.

**2. Build the app:**

```bash
brew install xcodegen
cd ios && xcodegen && open Reader.xcodeproj
```

Pick your team under Signing & Capabilities and run it on the iPad. To distribute to the iPad without a cable, use Product → Archive → TestFlight.

**3. First launch:**

1. Do the 5-minute placement check with him, or set the level yourself.
2. Open **Grown-ups** (the gear, then a multiplication question). Set the server URL to `http://<your-mac>.local:8787` and paste the token. Use Test connection to check it.

**Optional:** the app looks better with **Andika**, a font designed for beginning readers with a single-story "a". Download it from Google Fonts, then drop `Andika-Regular.ttf` and `Andika-Bold.ttf` into `ios/Reader/Resources/` and run `xcodegen` again.

### In the app

- **Make a new book.** He picks Who / Where / What happens, or types or dictates an idea. He can also bring along characters from earlier books. Books generate in the background, so he can keep reading.
- **A session:**
  1. Warm-up of about 7 words: due reviews, today's practice words, and recent misses.
  2. Preview words and the new heart word, with its tricky part in pink.
  3. The pages.
  4. Two spoken chat questions.
  5. He picks what happens next, which queues the next book in the series.
- **Reading together** (default): tap a word he misses (red), tap again if he needed help (orange), hold to hear it. Unmarked words count as read correctly.
- **Reading alone**: tapping a word shows its sound chunks (sh · i · p) and says it. Untapped words count only as weak evidence (weight 0.3), so mastery mostly comes from together-time until ASR lands.
- **Grown-ups** shows:
  - per-pattern state, with tap-to-override
  - tricky words from the last 2 weeks, with swipe for "knows it"
  - recent per-book accuracy (aim for 93–97%)
  - a focus pattern for the next book
  - page count, pictures, topics to avoid
  - data export

### Learner model (ReaderCore/LearnerModel.swift)

States: **New → Learning → Reviewing → Mastered.**

- **Learning → Reviewing.** A pattern moves on when, over its last 12 weighted exposures, accuracy is at least 90%, the total weight is at least 6, he has read at least 8 distinct words unaided, and there are successes on at least 2 different days. A word moves on with a window of 6, weight of at least 3, accuracy of at least 90%, and 2 days.
- **Reviewing → Mastered.** Spaced reviews at 1, 3 and 7 days, then 14, 30 and 60. Passing the third review makes it Mastered.
- **Misses.** A clear miss sends a Reviewing or Mastered item back to Reviewing. Sustained trouble sends it back to Learning.
- **Credit.** A miss on a word only lightly penalizes patterns he has already mastered (weight 0.3), since the error is probably in the new part. Heart words are tracked as whole words.

All thresholds are in `MasteryRules`. Data is stored as JSON in Application Support: `learner.json`, `events.jsonl` (append-only log of every word read), `books/`, `series.json`, and `settings.json`.

## Rebuilding the lexicon

```bash
pip install cmudict wordfreq
python3 lexicon/build_lexicon.py 10000
```

The lexicon is built from the CMU Pronouncing Dictionary plus wordfreq ranks, plus `lexicon/kid_words.txt`, with `lexicon/blocklist.txt` filtered out. Letters are aligned to phonemes with a cost-minimizing grapheme table, and spans that can't be aligned are marked as the heart part. The tagging is heuristic. Spot-check new patterns, and edit `HEART_OVERRIDES` or the grapheme table in `build_lexicon.py` as needed.

## Costs (rough)

Text is a few cents per book, including repairs. Images are the main cost: 11 images per book at `low` quality is roughly $0.10–0.20, and `medium` is roughly $0.40–0.60. Check current OpenAI pricing.

## Not built yet

- **M2:** read-aloud ASR (on-device realtime plus offline rescoring), the graduated hint ladder with recorded phoneme audio, and a voice eval set.
- **M3:** character reference images for consistency across books.
- **M4:** tuning the thresholds against real data.
