# Flashcard Stages — Design Spec

This is the intended design for Polycast's flashcard practice, as specified by
Josh. Future changes to `PracticeView.swift`, `SRS.swift`, or
`server/lib/srsUpdate.js` must preserve this behavior unless he says otherwise.

Terminology: "Spanish" below means the user's **target** language (could be
pt, etc.); "English" means the user's **native** language.

## The four stages (`prompt_stage` 0-3)

Each card moves through a difficulty ladder. The stage decides what the card
asks. The ladder goes comprehension → production, removing one crutch at a
time.

| Stage | Front shows | Picture on front? | Task | Back shows |
|---|---|---|---|---|
| 0 — Meet the word | Spanish sentence with the target word **highlighted** | YES | What does the highlighted word mean? | English word translation, picture, definition, English sentence translation |
| 1 — Translate the sentence | Spanish sentence with the word highlighted | NO | Translate the full Spanish sentence into English | English sentence translation (word's translation highlighted), picture, `word -- translation` |
| 2 — Produce the word | English word translation + definition | YES | Give the Spanish word | Spanish word (green), picture, definition, Spanish example sentence |
| 3 — Produce the sentence | English sentence translation with the word's translation **highlighted** | YES | Say it in Spanish | Spanish example sentence (word highlighted), picture, `word -- translation` |

**Why pictures are where they are:** on production stages (2 and 3) the
picture tells the user *which definition/idea* is being asked for — they only
have to produce the word, not guess the concept. On stage 1 the picture is
removed because understanding the sentence unaided IS the test. Stage 0 is a
first meeting, so it gets every support.

## Stages 4+: the sentence ladder

Stages 0-3 are fixed. From stage 4 onward the layout is the same as stage 3
(produce the sentence), but each rung uses a **fresh example sentence** with
the same word in a different form or context. The user climbs the ladder by
beating each stage; falling back shows the sentence they saw at the lower
stage last time.

Generation rules:

- The stage-3 sentence is the enrichment-time pair stored on
  `example_sentence` / `sentence_translation`. It is also mirrored into
  `stage_sentences[0]` so all stages >= 3 can be looked up uniformly.
- When the user answers `good` (correct) and the card's new stage has **no
  entry** in `stage_sentences` yet, the server fires one Gemini call
  off the request path that produces a new pair:
  - Same word, **different form/inflection** than the previous stages
    (when the card has a `forms` list; otherwise a different topic).
  - Target-language sentence and English translation, each with the
    target form wrapped in tildes, matching the enrichment convention.
- The new pair is appended to `stage_sentences` (JSONB on `saved_words`).
  The next fetch picks it up; the user may briefly see the stage-2
  fallback layout if they encounter the card while generation is in
  flight, but the per-stage pair is ready by the next study session.
- Going down a stage (an `again` answer) does **not** generate anything.
  The card simply shows the pair that was stored for the lower stage.
  The user sees the same sentence they saw at that stage last time.

Stage data shape (`saved_words.stage_sentences` JSONB):

```json
[
  { "stage": 3, "example": "Ella ~es~ alta.",   "translation": "She ~is~ tall." },
  { "stage": 4, "example": "Ellos ~son~ altos.", "translation": "They ~are~ tall." },
  { "stage": 5, "example": "Nosotros ~somos~ altos.", "translation": "We ~are~ tall." }
]
```

The array is ordered ascending by stage. There is no hard cap on stage
number; a soft safety cap (`MAX_PROMPT_STAGE = 20` on the server, mirrored
on iOS) prevents pathological growth while still allowing long ladders.

## Stage movement

- Starts at stage 0 for a new card.
- The rating is binary — the UI shows only **correct** (`good`) and
  **incorrect** (`again`); there is no hard/easy.
- **Correct (`good`): up exactly one stage. Incorrect (`again`): down exactly
  one stage.** Clamped to `[0, MAX_PROMPT_STAGE]`.
- Implemented server-side in `server/lib/srsUpdate.js` (`prompt_stage`), and
  mirrored client-side in `SRS.swift` (`nextPromptStage`) for previews and
  offline requeue.
- The stage track is fully independent of the time/SRS scheduling track
  (learning steps, intervals) — do not couple them.
- The card shows a "Stage N" badge (top-left) and each answer button shows the
  stage the answer would move the card to. The post-answer feedback overlay
  shows "Stage A → B".

## Data requirements and fallbacks

Stages 0, 1, and 3 need sentence data on `saved_words`:

- `example_sentence` — Spanish sentence with the target word wrapped in
  tildes: `Ella ~supo~ la verdad.`
- `sentence_translation` — English translation with the word's equivalent
  wrapped in tildes: `She ~found out~ the truth.`

Stages 4+ look up their pair from `stage_sentences` (added in migration
`025-stage-sentences`); the stage-3 entry is mirrored from the base
columns so the lookup logic is uniform across the ladder.

Fallbacks when data is missing (these should be rare — enrichment generates
the base fields, migration 025 backfills `stage_sentences`, and the new
generation pipeline fills stage-4+ entries as users advance):

- Stage 0 without an example sentence: show the bare word + picture.
- Stage 1 without example or sentence translation: fall back to the stage-2
  (produce the word) layout, because there is no sentence translation to show
  as the answer.
- Stage 3 without example or sentence translation: same fallback to stage 2.
- Stage 4+ without a matching entry in `stage_sentences`: same fallback to
  stage 2. The next correct answer from the same stage will trigger another
  generation attempt.

If a card looks "wrong for its stage," check those columns first — it is
almost always missing sentence data, not a stage-logic bug.

## Audio rules

- Only **target-language** text is ever read aloud; native-language text never is.
- Each side reads what it displays: stage 0/1 fronts auto-read the Spanish
  sentence; stage 2 back reads "word. example sentence"; stage 3+ back reads
  the Spanish sentence (per-stage for stages 4+). Fronts of production stages
  (2/3/4+/...) are native-only, so they have no speaker button and no autoplay.
- Stage 1's native-language answer side has no autoplay or speaker action.
- Auto-play on card appear and on flip, unless muted (mute toggle on the card,
  persisted via `@AppStorage("flashcardAudioMuted")`). The play button works
  even while muted.
- All clips are preloaded (word clips + sentence TTS) so playback is instant.
  Preloading iterates the per-stage pair for the card's current stage, so
  every stage 4+ sentence gets cached before the user sees it.

## Session counter (top of screen)

`blue + red + green`, with each distinct queued card counted exactly once:

- **Blue** — never-answered cards (no first answer yet). A card is blue only
  until its first answer this session; the first answer (right or wrong) moves
  it out of the new bucket immediately.
- **Red** — active cards whose **most recent answer** was `Again`. Red tracks
  the last answer only: a card answered `Again` and then `good` later the same
  day is no longer red. A new card answered incorrectly on its first attempt
  becomes red. Scheduler learning steps alone do not make a card red.
- **Green** — cards that have been answered (so no longer new) and still active
  in today's queue whose most recent answer was correct. A new card answered
  correctly on its first attempt moves straight here.
- Each active card ID contributes exactly one count. Queue copies and repeated
  attempts never add another count.
- `Again` moves a blue or green card to red. A correct (`good`) answer clears
  the red mark, moving the card to green — or out of today's queue entirely if
  the correct answer schedules it past today. Completing any card removes it
  from the counts.

A failed (`again`) review enters a **1-minute** relearning step (Josh's choice —
not the stock Anki 10-minute default) and its post-relearning review interval
resets to 1 day. A correct (`good`) answer on that single relearning step graduates the card back
to its stored interval.

Sub-day learning steps use exact timestamps. Intervals of 1 day or longer are
calendar-day intervals and become due at midnight in the user's local timezone,
not 24-hour multiples from the time the card was answered.
