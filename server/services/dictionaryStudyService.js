import pool from '../db.js';
import {
  listCalendarCounts,
  listCalendarDayWords,
  listDictionaryGroupPage,
  listDueWords,
  listNewTodayWords,
  listNewWordPreview,
  listStudyOverview,
  listWidgetPreview,
} from '../lib/dictionaryQueries.js';
import { runIdempotentMutation } from '../lib/idempotency.js';
import { applySrsReview } from '../lib/srsUpdate.js';
import { generateStageSentence } from '../lib/stageSentence.js';
import { recordFlashcardReview } from './learningSessionService.js';
import logger from '../logger.js';
import { refreshDictionarySchedule } from './dictionaryScheduleService.js';

export async function scheduleStageSentence({ db, card, newStage }) {
  const { rows: langRows } = await db.query(
    'SELECT target_language, native_language FROM users WHERE id = $1', [card.user_id],
  );
  const generated = await generateStageSentence({
    word: card.word,
    translation: card.translation,
    definition: card.definition,
    lemma: card.lemma,
    forms: card.forms,
    partOfSpeech: card.part_of_speech,
    targetLang: langRows[0]?.target_language || null,
    nativeLang: langRows[0]?.native_language || 'en',
    previousSentences: Array.isArray(card.stage_sentences) ? card.stage_sentences : [],
  });
  const client = await db.connect();
  try {
    await client.query(
      `UPDATE saved_words
       SET stage_sentences = COALESCE(stage_sentences, '[]'::jsonb) || $1::jsonb
       WHERE id = $2 AND user_id = $3`,
      [JSON.stringify([{ stage: newStage, example: generated.example, translation: generated.translation }]), card.id, card.user_id],
    );
    logger.info({ cardId: card.id, stage: newStage }, 'stage-sentence generated');
  } finally {
    client.release();
  }
  return { fallback_notices: generated.fallback_notices || [] };
}

export function createDictionaryStudyService({
  db = pool,
  reviewCard = applySrsReview,
  recordReview = recordFlashcardReview,
  idempotentMutation = runIdempotentMutation,
  refreshSchedule = refreshDictionarySchedule,
} = {}) {
  return {
    calendar(userId, year, month, timeZone) {
      return listCalendarCounts(db, userId, year, month, timeZone);
    },
    calendarDay(userId, date, timeZone) {
      return listCalendarDayWords(db, userId, date, timeZone);
    },
    async newToday(userId, timeZone) {
      return (await listNewTodayWords(db, userId, timeZone)).rows;
    },
    async newPreview(userId, limit, timeZone) {
      return (await listNewWordPreview(db, userId, limit, timeZone)).rows;
    },
    widgetPreview(userId, limit, timeZone) {
      return listWidgetPreview(db, userId, limit, timeZone);
    },
    studyOverview(userId, timeZone) {
      return listStudyOverview(db, userId, timeZone);
    },
    async due(userId, { timeZone, newLimitOverride, limit, offset }) {
      return (await listDueWords(db, userId, timeZone, newLimitOverride ?? null, limit ?? null, offset ?? 0)).rows;
    },
    groups(userId, options) {
      return listDictionaryGroupPage(db, userId, options);
    },
    async reorder(userId, items) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        for (const { id, queue_position } of items) {
          const { rowCount } = await client.query(
            'UPDATE saved_words SET queue_position = $1 WHERE id = $2 AND user_id = $3',
            [queue_position, id, userId],
          );
          if (!rowCount) {
            const error = new Error(`Word ${id} not found`);
            error.status = 404;
            error.code = 'dictionary_word_not_found';
            error.expose = true;
            throw error;
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async rebuildFrequencyOrder(userId) {
      const { rowCount } = await db.query(
        `WITH ranked AS (
           SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY target_language
                    ORDER BY priority DESC,
                             frequency_count DESC NULLS LAST,
                             frequency DESC NULLS LAST,
                             lemma_frequency_rank ASC NULLS LAST,
                             sense_rank ASC NULLS LAST,
                             created_at, id
                  ) - 1 AS position
             FROM saved_words
            WHERE user_id = $1
              AND srs_interval = 0
              AND learning_step IS NULL
              AND last_reviewed_at IS NULL
         )
         UPDATE saved_words sw
            SET queue_position = ranked.position
           FROM ranked
          WHERE sw.id = ranked.id`,
        [userId],
      );
      return { reordered: rowCount ?? 0 };
    },
    review(userId, wordId, { answer, timeZone, learningSessionId, idempotencyKey }) {
      return idempotentMutation(db, {
        userId,
        key: idempotencyKey,
        operation: 'review-word',
        body: { wordId, answer, timeZone, learningSessionId: learningSessionId || null },
      }, async () => {
        const updated = await reviewCard(db, wordId, userId, answer, timeZone, {
          onAdvanceToNewStage: scheduleStageSentence,
        });
        if (!updated) return { status: 404, body: { error: 'Word not found', code: 'dictionary_word_not_found' } };
        await recordReview(db, userId, learningSessionId, answer === 'good');
        await refreshSchedule({
          db,
          userId,
          timeZone,
          source: 'mutation',
        });
        return { status: 200, body: updated };
      });
    },
  };
}

export const dictionaryStudyService = createDictionaryStudyService();
