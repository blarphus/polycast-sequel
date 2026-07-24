export async function up(client) {
  await client.query(`
    CREATE TABLE dictionary_review_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      saved_word_id UUID REFERENCES saved_words(id) ON DELETE SET NULL,
      word TEXT NOT NULL,
      translation TEXT NOT NULL DEFAULT '',
      answer TEXT CHECK (answer IN ('again', 'good')),
      source TEXT NOT NULL DEFAULT 'review' CHECK (source IN ('review', 'legacy_latest')),
      reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_dictionary_review_events_user_reviewed
      ON dictionary_review_events (user_id, reviewed_at DESC);

    INSERT INTO dictionary_review_events (
      user_id, saved_word_id, word, translation, answer, source, reviewed_at
    )
    SELECT user_id, id, word, translation, NULL, 'legacy_latest', last_reviewed_at
      FROM saved_words
     WHERE last_reviewed_at IS NOT NULL;
  `);
}
