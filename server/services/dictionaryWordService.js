import pool from '../db.js';
import { mergeForm } from '../lib/normalizeWordFields.js';
import { awardWordSaveXp } from '../lib/progression.js';
import { NotFoundError, ValidationError } from '../lib/httpErrors.js';
import { refreshDictionarySchedule } from './dictionaryScheduleService.js';

export function createDictionaryWordService({
  db = pool,
  refreshSchedule = refreshDictionarySchedule,
  awardSaveXp = awardWordSaveXp,
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
      } = input;
      const mergedForms = surface_form ? mergeForm(forms, surface_form) : (forms || null);
      const refreshWord = async (id) => {
        const schedule = await refreshSchedule({ db, userId, timeZone, options: { force: true }, correlationId });
        const { rows } = await db.query('SELECT * FROM saved_words WHERE id = $1 AND user_id = $2', [id, userId]);
        return { word: rows[0], diagnostic: schedule.diagnostic };
      };

      const { rows: existing } = await db.query(
        `SELECT * FROM saved_words WHERE user_id = $1 AND word = $2
         AND target_language IS NOT DISTINCT FROM $3 AND definition = $4`,
        [userId, word, target_language || null, definition || ''],
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
        return { status: 200, body: { ...scheduled.word, created: false, _created: false }, diagnostic: scheduled.diagnostic };
      }

      const { rows } = await db.query(
        `INSERT INTO saved_words (user_id, word, translation, definition, target_language, sentence_context, frequency, example_sentence, sentence_translation, part_of_speech, image_url, lemma, forms, frequency_count, image_term, shared_entry_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [userId, word, translation || '', definition || '', target_language || null, sentence_context || null, frequency || null, example_sentence || null, sentence_translation || null, part_of_speech || null, image_url || null, lemma || null, mergedForms, frequency_count ?? null, image_term || null, shared_entry_id || null],
      );
      const scheduled = await refreshWord(rows[0].id);
      const reward = await awardSaveXp(db, userId, scheduled.word, timeZone);
      return { status: 201, body: { ...scheduled.word, created: true, _created: true, ...reward }, diagnostic: scheduled.diagnostic };
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
