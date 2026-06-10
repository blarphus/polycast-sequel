// 023-backfill-frequency.js
//
// Recompute every saved word's frequency with the new lemma-aggregated wordfreq logic. This is
// a pure data backfill: it reuses each word's existing word/lemma/forms/target_language, so no
// re-enrichment or external API calls are needed. Words not present in the wordfreq corpus keep
// their existing (Gemini-estimated) frequency rather than being nulled out.
import { applyCorpusFrequency } from '../lib/wordFrequency.js';

export async function up(client) {
  const { rows } = await client.query(
    'SELECT id, word, lemma, forms, target_language FROM saved_words',
  );

  let updated = 0;
  for (const row of rows) {
    const result = applyCorpusFrequency(row.word, row.target_language, null, {
      lemma: row.lemma,
      forms: row.forms,
    });
    // Out of corpus → leave the existing frequency untouched.
    if (result.frequency_count === null) continue;
    await client.query(
      'UPDATE saved_words SET frequency = $1, frequency_count = $2 WHERE id = $3',
      [result.frequency, result.frequency_count, row.id],
    );
    updated++;
  }

  console.log(`[023-backfill-frequency] recomputed ${updated}/${rows.length} saved words`);
}
