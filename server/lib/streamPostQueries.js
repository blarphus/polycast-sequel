/**
 * Shared SQL fragments for stream post queries.
 * Avoids duplicating these subqueries across multiple route handlers.
 */

export const WORD_COUNT_JOIN = `LEFT JOIN (
  SELECT post_id, COUNT(*) AS cnt FROM stream_post_words GROUP BY post_id
) wc ON wc.post_id = sp.id`;

export const COMPLETION_COUNT_JOIN = `LEFT JOIN (
  SELECT post_id, COUNT(*) AS cnt FROM stream_word_list_completions GROUP BY post_id
) comp ON comp.post_id = sp.id`;
