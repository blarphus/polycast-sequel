/**
 * 025-stage-sentences — Per-stage sentence pairs for stages >= 3.
 *
 * Stages 0-2 keep using the base `example_sentence` / `sentence_translation`
 * columns. The stage-3 pair is the same base data and is mirrored into this
 * array so the stage-lookup logic (server + iOS) can find it in one place.
 * Stages 4, 5, ... are appended on demand by srsUpdate.js as the user advances.
 *
 * Shape: [{ "stage": 3, "example": "...", "translation": "..." }, ...]
 * Always sorted ascending by stage, one entry per stage the card has reached.
 */
export async function up(client) {
  await client.query(`
    ALTER TABLE saved_words
      ADD COLUMN IF NOT EXISTS stage_sentences JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  // Backfill: existing cards that have an example sentence get a stage-3 entry
  // (and stage-4 if they were stuck at the legacy five-stage ladder) so the
  // new lookup logic finds a pair for any current prompt_stage.
  await client.query(`
    UPDATE saved_words
    SET stage_sentences = (
      CASE
        WHEN example_sentence IS NOT NULL AND example_sentence <> '' THEN
          CASE
            WHEN COALESCE(prompt_stage, 0) >= 4 THEN
              jsonb_build_array(
                jsonb_build_object(
                  'stage', 3,
                  'example', example_sentence,
                  'translation', COALESCE(sentence_translation, '')
                ),
                jsonb_build_object(
                  'stage', 4,
                  'example', example_sentence,
                  'translation', COALESCE(sentence_translation, '')
                )
              )
            ELSE
              jsonb_build_array(
                jsonb_build_object(
                  'stage', 3,
                  'example', example_sentence,
                  'translation', COALESCE(sentence_translation, '')
                )
              )
          END
        ELSE '[]'::jsonb
      END
    )
    WHERE stage_sentences = '[]'::jsonb
  `);
}
