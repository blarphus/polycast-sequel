import crypto from 'node:crypto';
import pool from '../db.js';
import logger from '../logger.js';
import { normalizeFallbackDiagnostic, persistFallbackDiagnostic } from './fallbackDiagnostics.js';
import { canonicalLemmaKey } from './normalizeWordFields.js';

export const FREQUENCY_LANGUAGES = Object.freeze(['en', 'es', 'pt', 'fr', 'de', 'ja']);
const FREQUENCY_LANGUAGE_SET = new Set(FREQUENCY_LANGUAGES);

export function baseFrequencyLanguage(language) {
  const base = String(language || '').trim().toLowerCase().split('-')[0];
  return FREQUENCY_LANGUAGE_SET.has(base) ? base : null;
}

export function definitionFingerprint(definition) {
  return crypto.createHash('sha256')
    .update(String(definition || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase())
    .digest('hex');
}

export function bandForLemmaRank(rank) {
  if (rank <= 500) return 10;
  if (rank <= 1000) return 9;
  if (rank <= 2000) return 8;
  if (rank <= 4000) return 7;
  if (rank <= 7000) return 6;
  if (rank <= 12000) return 5;
  if (rank <= 20000) return 4;
  if (rank <= 35000) return 3;
  if (rank <= 60000) return 2;
  return 1;
}

export async function lookupFrequencyCatalog({
  db = pool,
  language,
  lemma,
  partOfSpeech = null,
  definition = null,
  correlationId = null,
}) {
  const lang = baseFrequencyLanguage(language);
  if (!lang || !lemma) return { entry: null, diagnostics: [] };
  const lemmaKey = canonicalLemmaKey(lemma);
  const definitionHash = definition ? definitionFingerprint(definition) : null;
  const { rows } = await db.query(
    `SELECT
       v.id AS rank_version_id, v.version AS rank_version,
       l.id AS lemma_id, l.canonical_lemma,
       lf.lemma_rank, lf.occurrences_per_billion AS lemma_occurrences_per_billion,
       lf.zipf, lf.frequency_band, lf.confidence AS frequency_confidence,
       lf.percentile AS frequency_percentile, lf.sources AS frequency_sources,
       s.id AS sense_id, sr.sense_order, sr.sense_rank
     FROM frequency_catalog_versions v
     JOIN dictionary_lemmas l ON l.language = $1 AND l.lemma_key = $2
     JOIN lemma_frequency_rankings lf ON lf.catalog_version_id = v.id AND lf.lemma_id = l.id
     LEFT JOIN dictionary_senses s ON s.lemma_id = l.id AND s.active
       AND ($3::text IS NULL OR s.part_of_speech = '' OR LOWER(s.part_of_speech) = LOWER($3))
       AND ($4::text IS NULL OR s.definition_hash = $4)
     LEFT JOIN sense_rankings sr ON sr.catalog_version_id = v.id AND sr.sense_id = s.id
     WHERE v.status = 'active'
     ORDER BY CASE WHEN s.definition_hash = $4 THEN 0 ELSE 1 END, sr.sense_order, s.id
     LIMIT 1`,
    [lang, lemmaKey, partOfSpeech, definitionHash],
  );
  if (rows[0]) return { entry: rows[0], diagnostics: [] };

  const diagnostic = normalizeFallbackDiagnostic({
    code: 'frequency_catalog_entry_unavailable',
    severity: 'warning',
    title: 'Frequency catalog entry unavailable',
    message: `No active saved ranking was found for “${lemma}”. This entry is visibly placed in the unranked tail until the catalog is rebuilt.`,
    source: 'server.frequency-catalog',
    operation: 'lookup-ranking',
    pipeline: 'frequency_lookup',
    stage: 'active-catalog-read',
    language: lang,
    detail: `lemmaKey=${lemmaKey}; partOfSpeech=${partOfSpeech || 'unknown'}; definitionHash=${definitionHash || 'none'}`,
  }, { correlationId });
  logger.warn({ diagnostic, lemmaKey, language: lang }, 'Saved frequency ranking unavailable');
  try {
    await persistFallbackDiagnostic(db, diagnostic);
  } catch (error) {
    logger.error({
      event: 'fallback_diagnostic_persistence_failed',
      operation: 'persist-frequency-catalog-fallback',
      correlationId: diagnostic.correlationId,
      error: error instanceof Error ? error.message : String(error),
    }, 'Frequency catalog fallback remained visible but could not be persisted');
  }
  return { entry: null, diagnostics: [diagnostic] };
}

export async function persistProvisionalSense({
  db = pool,
  language,
  lemma,
  partOfSpeech = null,
  definition,
  correlationId = null,
}) {
  const lang = baseFrequencyLanguage(language);
  if (!lang || !lemma || !definition) return { entry: null, diagnostics: [] };
  const lemmaKey = canonicalLemmaKey(lemma);
  const fingerprint = definitionFingerprint(definition);
  const sourceSenseId = `polycast:${crypto.createHash('sha256').update(`${lang}\0${lemmaKey}\0${partOfSpeech || ''}\0${fingerprint}`).digest('hex')}`;
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const release = client !== db;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`provisional-sense:${lang}`]);
    const { rows: [lemmaRow] } = await client.query(
      `INSERT INTO dictionary_lemmas (language, lemma_key, canonical_lemma, provenance)
       VALUES ($1, $2, $3, jsonb_build_object('source', 'polycast-provisional'))
       ON CONFLICT (language, lemma_key) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [lang, lemmaKey, String(lemma).trim().normalize('NFC')],
    );
    const { rows: [senseRow] } = await client.query(
      `INSERT INTO dictionary_senses (
         lemma_id, part_of_speech, definition, definition_hash, source,
         source_sense_id, source_order, provisional, provenance
       ) VALUES ($1, $2, $3, $4, 'polycast-provisional', $5, 2147483647, TRUE,
                 jsonb_build_object('reason', 'dictionary-source-miss'))
       ON CONFLICT (source, source_sense_id) DO UPDATE SET
         definition = EXCLUDED.definition, definition_hash = EXCLUDED.definition_hash,
         updated_at = NOW(), active = TRUE
       RETURNING id`,
      [lemmaRow.id, partOfSpeech || '', definition, fingerprint, sourceSenseId],
    );
    const { rows: [active] } = await client.query(
      `SELECT id, version FROM frequency_catalog_versions WHERE status = 'active' LIMIT 1`,
    );
    if (active) {
      await client.query(
        `INSERT INTO lemma_frequency_rankings (
           catalog_version_id, lemma_id, language, lemma_rank, frequency_band,
           confidence, percentile, sources
         )
         SELECT $1, $2, $3, COALESCE(MAX(lemma_rank), 0) + 1, 1,
                'unavailable', 0, '[]'::jsonb
           FROM lemma_frequency_rankings
          WHERE catalog_version_id = $1 AND language = $3
         ON CONFLICT (catalog_version_id, lemma_id) DO NOTHING`,
        [active.id, lemmaRow.id, lang],
      );
      await client.query(
        `INSERT INTO sense_rankings (
           catalog_version_id, sense_id, language, lemma_rank, sense_order, sense_rank
         )
         SELECT $1, $2, $3, lf.lemma_rank,
                COALESCE((SELECT MAX(sr.sense_order) + 1
                            FROM sense_rankings sr
                            JOIN dictionary_senses ds ON ds.id = sr.sense_id
                           WHERE sr.catalog_version_id = $1 AND ds.lemma_id = $4), 1),
                COALESCE((SELECT MAX(sr.sense_rank) + 1
                            FROM sense_rankings sr
                           WHERE sr.catalog_version_id = $1 AND sr.language = $3), 1)
           FROM lemma_frequency_rankings lf
          WHERE lf.catalog_version_id = $1 AND lf.lemma_id = $4
         ON CONFLICT (catalog_version_id, sense_id) DO NOTHING`,
        [active.id, senseRow.id, lang, lemmaRow.id],
      );
    }
    await client.query('COMMIT');

    const diagnostic = normalizeFallbackDiagnostic({
      code: 'provisional_dictionary_sense_created',
      severity: 'warning',
      title: 'Provisional dictionary sense created',
      message: `No canonical dictionary sense matched “${lemma}”, so Polycast saved this meaning as a provisional sense with a visible tail ranking.`,
      source: 'server.frequency-catalog',
      operation: 'create-provisional-sense',
      pipeline: 'sense_identity',
      stage: 'dictionary-source-miss',
      language: lang,
      entityType: 'dictionary_sense',
      entityId: senseRow.id,
      selectedAction: active ? 'assigned-provisional-tail-rank' : 'awaiting-catalog-activation',
      catalogVersion: active?.version,
      detail: `lemmaKey=${lemmaKey}; partOfSpeech=${partOfSpeech || 'unknown'}; sourceSenseId=${sourceSenseId}`,
    }, { correlationId });
    await persistFallbackDiagnostic(db, diagnostic);
    const resolved = await lookupFrequencyCatalog({ db, language: lang, lemma, partOfSpeech, definition, correlationId });
    return { entry: resolved.entry, diagnostics: [diagnostic, ...resolved.diagnostics] };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('frequency_catalog_rollback_failed', {
        pipeline: 'sense_identity',
        stage: 'rollback',
        language: lang,
        lemmaKey,
        error: rollbackError,
      });
    }
    throw error;
  } finally {
    if (release) client.release();
  }
}

export function catalogEntryToWordFields(entry) {
  if (!entry) return {};
  return {
    lemma_id: entry.lemma_id,
    sense_id: entry.sense_id || null,
    rank_version_id: entry.rank_version_id,
    rank_version: entry.rank_version,
    lemma_frequency_rank: entry.lemma_rank,
    sense_order: entry.sense_order ?? null,
    sense_rank: entry.sense_rank == null ? null : Number(entry.sense_rank),
    lemma_occurrences_per_billion: entry.lemma_occurrences_per_billion == null
      ? null : Number(entry.lemma_occurrences_per_billion),
    frequency_count: entry.lemma_occurrences_per_billion == null
      ? null : Number(entry.lemma_occurrences_per_billion),
    frequency: entry.frequency_band,
    frequency_confidence: entry.frequency_confidence,
    frequency_percentile: entry.frequency_percentile == null ? null : Number(entry.frequency_percentile),
    frequency_sources: entry.frequency_sources || [],
  };
}
