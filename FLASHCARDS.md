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

## Stage movement

- Starts at stage 0 for a new card.
- **Correct (good/easy): up exactly one stage.** Incorrect (again): **down
  exactly one stage.** Hard: stays. Clamped to 0-3.
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

Fallbacks when data is missing (these should be rare — enrichment generates
both fields, and old rows were backfilled June 2026):

- Stage 0 without an example sentence: show the bare word + picture.
- Stage 1 without example or sentence translation: fall back to the stage-2
  (produce the word) layout, because there is no sentence translation to show
  as the answer.
- Stage 3 without example or sentence translation: same fallback to stage 2.

If a card looks "wrong for its stage," check those two columns first — it is
almost always missing sentence data, not a stage-logic bug.

## Audio rules

- Only **target-language** text is ever read aloud; native-language text never is.
- Each side reads what it displays: stage 0/1 fronts auto-read the Spanish
  sentence; stage 2 back reads "word. example sentence"; stage 3 back reads
  the Spanish sentence. Fronts of production stages (2/3) are native-only, so
  they have no speaker button and no autoplay.
- Stage 1's native-language answer side has no autoplay or speaker action.
- Auto-play on card appear and on flip, unless muted (mute toggle on the card,
  persisted via `@AppStorage("flashcardAudioMuted")`). The play button works
  even while muted.
- All clips are preloaded (word clips + sentence TTS) so playback is instant.

## Session counter (top of screen)

`blue + red + green`, with each distinct queued card counted exactly once:

- **Blue** — cards introduced today that are still active, including ordinary
  new-card learning steps. Never-seen cards selected for today are also blue.
- **Red** — active cards that received `Again` on the current local calendar
  day. Scheduler learning steps alone do not make a card red.
- **Green** — previously reviewed cards still active in today's queue that have
  not received `Again` today.
- Each active card ID contributes exactly one count. Queue copies and repeated
  attempts never add another count.
- `Again` moves a blue or green card to red. Another `Again` leaves it red.
  Completing any card removes it from the counts; a failed card is green rather
  than red when it next becomes due on a later day.

With stock Anki lapse defaults, a failed review enters a 10-minute relearning
step and its post-relearning review interval resets to 1 day. Easy from that
single relearning step schedules 2 days.

Sub-day learning steps use exact timestamps. Intervals of 1 day or longer are
calendar-day intervals and become due at midnight in the user's local timezone,
not 24-hour multiples from the time the card was answered.
