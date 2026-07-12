/**
 * Fetch a user's already-saved definitions for a word and its lemma-siblings, so they can be
 * offered as candidate senses when the word is looked up again. Matches by the word itself, its
 * resolved lemma, and any saved row that shares that lemma (i.e. another inflection of the same
 * base). Used so the sense-picker can decide whether a new click is an existing sense or new.
 */
export async function fetchUserSavedSensesForWord(db, userId, targetLang, word, lemma) {
  const { rows } = await db.query(
    `SELECT id, word, definition, translation, part_of_speech, lemma, forms
       FROM saved_words
      WHERE user_id = $1
        AND target_language IS NOT DISTINCT FROM $2
        AND definition <> ''
        AND (
          LOWER(word) = LOWER($3)
          OR LOWER(lemma) = LOWER($3)
          OR ($4 <> '' AND (LOWER(word) = LOWER($4) OR LOWER(lemma) = LOWER($4)))
        )
      ORDER BY created_at DESC
      LIMIT 20`,
    [userId, targetLang || null, word, lemma || ''],
  );
  return rows;
}
