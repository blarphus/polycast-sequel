import pool from '../db.js';
import { mergeForm, normalizeLemma } from '../lib/normalizeWordFields.js';
import { catalogEntryToWordFields, lookupFrequencyCatalog, persistProvisionalSense } from '../lib/frequencyCatalog.js';
import { awardWordSaveXp } from '../lib/progression.js';
import { NotFoundError, ValidationError } from '../lib/httpErrors.js';
import { refreshDictionarySchedule } from './dictionaryScheduleService.js';

export function createDictionaryWordService({
  db = pool,
  refreshSchedule = refreshDictionarySchedule,
  awardSaveXp = awardWordSaveXp,
  resolveCatalog = lookupFrequencyCatalog,
  createProvisionalSense = persistProvisionalSense,
} = {}) {
  return {
    async list(userId, targetLanguage) {
      const { rows } = await db.query(
        `SELECT * FROM saved_words WHERE user_id = $1
           AND target_language = COALESCE($2, (SELECT target_language FROM users WHERE id = $1))
         ORDER BY created_at DESC`,
        [userId, targetLanguage || null],
      );
      return rows;
    },

    async save(userId, input, { timeZone, correlationId }) {
      const {
        word, translation, definition, target_language, sentence_context, frequency, frequency_count,
        example_sentence, sentence_translation, part_of_speech, image_url, lemma, forms, surface_form,
        image_term, shared_entry_id,
        lemma_id, sense_id, rank_version_id, lemma_frequency_rank, sense_rank,
        lemma_occurrences_per_billion, frequency_confidence, frequency_sources,
      } = input;
      const canonicalWord = normalizeLemma(lemma || word, part_of_speech, target_language) || String(word).trim().normalize('NFC');
      let mergedForms = mergeForm(forms, surface_form || word);
      const diagnostics = [];
      let catalogFields = {
        lemma_id, sense_id, rank_version_id, lemma_frequency_rank, sense_rank,
        lemma_occurrences_per_billion, frequency_confidence,
        frequency_sources: frequency_sources || [], frequency, frequency_count,
      };
      if (target_language) {
        const resolved = await resolveCatalog({
          db, language: target_language, lemma: canonicalWord,
          partOfSpeech: part_of_speech, definition, correlationId,
        });
        diagnostics.push(...resolved.diagnostics);
        let catalogEntry = resolved.entry;
        if (!catalogEntry?.sense_id && definition) {
          const provisional = await createProvisionalSense({
            db, language: target_language, lemma: canonicalWord,
            partOfSpeech: part_of_speech, definition, correlationId,
          });
          diagnostics.push(...provisional.diagnostics);
          catalogEntry = provisional.entry || catalogEntry;
        }
        if (catalogEntry) catalogFields = { ...catalogFields, ...catalogEntryToWordFields(catalogEntry) };
      }
      const refreshWord = async (id) => {
        const schedule = await refreshSchedule({ db, userId, timeZone, options: { force: true }, correlationId });
        const { rows } = await db.query('SELECT * FROM saved_words WHERE id = $1 AND user_id = $2', [id, userId]);
        return { word: rows[0], diagnostic: schedule.diagnostic };
      };

      const { rows: existing } = await db.query(
        `SELECT * FROM saved_words WHERE user_id = $1
         AND target_language IS NOT DISTINCT FROM $2
         AND (($3::uuid IS NOT NULL AND sense_id = $3)
           OR ($3::uuid IS NULL AND word = $4 AND definition = $5))`,
        [userId, target_language || null, catalogFields.sense_id || null, canonicalWord, definition || ''],
      );
      if (existing.length) {
        let row = existing[0];
        if (surface_form || (shared_entry_id && !row.shared_entry_id)) {
          const withForm = mergeForm(row.forms, surface_form);
          if (withForm !== row.forms || (shared_entry_id && !row.shared_entry_id)) {
            const { rows } = await db.query(
              `UPDATE saved_words SET forms = $3, shared_entry_id = COALESCE(shared_entry_id, $4)
               WHERE id = $1 AND user_id = $2 RETURNING *`,
              [row.id, userId, withForm, shared_entry_id || null],
            );
            row = rows[0];
          }
        }
        const scheduled = await refreshWord(row.id);
        return {
          status: 200,
          body: {
            ...scheduled.word, created: false, _created: false,
            ...(diagnostics.length ? { fallback_notices: diagnostics } : {}),
          },
          diagnostic: scheduled.diagnostic,
        };
      }

      const { rows } = await db.query(
        `INSERT INTO saved_words (
           user_id, word, translation, definition, target_language, sentence_context,
           frequency, example_sentence, sentence_translation, part_of_speech, image_url,
           lemma, forms, frequency_count, image_term, shared_entry_id,
           lemma_id, sense_id, rank_version_id, lemma_frequency_rank, sense_rank,
           lemma_occurrences_per_billion, frequency_confidence, frequency_sources, ranking_diagnostics
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
           $17, $18, $19, $20, $21, $22, $23, $24::jsonb, $25::jsonb
         ) RETURNING *`,
        [
          userId, canonicalWord, translation || '', definition || '', target_language || null,
          sentence_context || null, catalogFields.frequency ?? null, example_sentence || null,
          sentence_translation || null, part_of_speech || null, image_url || null,
          canonicalWord, mergedForms, catalogFields.frequency_count ?? null, image_term || null,
          shared_entry_id || null, catalogFields.lemma_id || null, catalogFields.sense_id || null,
          catalogFields.rank_version_id || null, catalogFields.lemma_frequency_rank ?? null,
          catalogFields.sense_rank ?? null, catalogFields.lemma_occurrences_per_billion ?? null,
          catalogFields.frequency_confidence || null, JSON.stringify(catalogFields.frequency_sources || []),
          JSON.stringify(diagnostics),
        ],
      );
      const scheduled = await refreshWord(rows[0].id);
      const reward = await awardSaveXp(db, userId, scheduled.word, timeZone);
      return {
        status: 201,
        body: {
          ...scheduled.word, created: true, _created: true, ...reward,
          ...(diagnostics.length ? { fallback_notices: diagnostics } : {}),
        },
        diagnostic: scheduled.diagnostic,
      };
    },

    async update(userId, id, input) {
      const fields = ['word', 'translation', 'definition', 'example_sentence', 'sentence_translation', 'part_of_speech', 'image_url', 'image_term'];
      const sets = [];
      const values = [id, userId];
      for (const field of fields) {
        if (input[field] !== undefined) {
          values.push(input[field]);
          sets.push(`${field} = $${values.length}`);
        }
      }
      if (!sets.length) throw new ValidationError([{ path: 'body', message: 'No fields to update' }]);
      const { rows } = await db.query(`UPDATE saved_words SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`, values);
      if (!rows.length) throw new NotFoundError('Word not found', { code: 'dictionary_word_not_found' });
      return rows[0];
    },

    async addForm(userId, id, form) {
      const { rows: existing } = await db.query('SELECT forms FROM saved_words WHERE id = $1 AND user_id = $2', [id, userId]);
      if (!existing.length) throw new NotFoundError('Word not found', { code: 'dictionary_word_not_found' });
      const { rows } = await db.query(
        'UPDATE saved_words SET forms = $3 WHERE id = $1 AND user_id = $2 RETURNING *',
        [id, userId, mergeForm(existing[0].forms, form)],
      );
      return rows[0];
    },

    async remove(userId, id) {
      const { rowCount } = await db.query('DELETE FROM saved_words WHERE id = $1 AND user_id = $2', [id, userId]);
      if (!rowCount) throw new NotFoundError('Word not found', { code: 'dictionary_word_not_found' });
    },
  };
}

export const dictionaryWordService = createDictionaryWordService();
