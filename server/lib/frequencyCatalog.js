import crypto from 'node:crypto';
import pool from '../db.js';
import logger from '../logger.js';
import { normalizeFallbackDiagnostic, persistFallbackDiagnostic } from './fallbackDiagnostics.js';
import { canonicalLemmaKey } from './normalizeWordFields.js';
import { lookupEmbeddedFrequency } from './embeddedFrequencyCatalog.js';

// Spanish uses the materialized multi-source catalog. English uses the bounded,
// committed wordfreq snapshot until its full sense catalog is materialized.
export const FREQUENCY_LANGUAGES = Object.freeze(['es', 'en']);
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

async function reportFallbackDiagnostic(db, input, context, logMessage) {
  const diagnostic = normalizeFallbackDiagnostic(input, context);
  logger.warn({ diagnostic }, logMessage);
  try {
    await persistFallbackDiagnostic(db, diagnostic);
  } catch (error) {
    logger.error({
      event: 'fallback_diagnostic_persistence_failed',
      operation: input.operation,
      correlationId: diagnostic.correlationId,
      error: error instanceof Error ? error.message : String(error),
    }, 'Frequency catalog fallback remained visible but could not be persisted');
  }
  return diagnostic;
}

export async function lookupFrequencyCatalog({
  db = pool,
  language,
  lemma,
  partOfSpeech = null,
  definition = null,
  correlationId = null,
}) {
  const requestedLanguage = String(language || '').trim().toLowerCase().split('-')[0];
  const lang = baseFrequencyLanguage(language);
  if (!lemma) return { entry: null, diagnostics: [] };
  if (!lang) {
    const diagnostic = await reportFallbackDiagnostic(db, {
      code: 'frequency_catalog_language_unavailable',
      severity: 'warning',
      title: 'Saved frequency ranking unavailable for this language',
      message: `The compact frequency catalog currently supports English and Spanish only. “${lemma}” remains visibly unranked.`,
      source: 'server.frequency-catalog',
      operation: 'lookup-ranking',
      pipeline: 'frequency_lookup',
      stage: 'language-not-materialized',
      language: requestedLanguage || null,
      selectedAction: 'preserve-unranked-entry',
      detail: `supportedLanguages=${FREQUENCY_LANGUAGES.join(',')}`,
    }, { correlationId }, 'Frequency catalog language unavailable');
    return { entry: null, diagnostics: [diagnostic] };
  }

  const lemmaKey = canonicalLemmaKey(lemma);
  const definitionHash = definition ? definitionFingerprint(definition) : null;
  const embeddedEntry = lang === 'en'
    ? lookupEmbeddedFrequency(lang, lemma, bandForLemmaRank)
    : null;
  if (embeddedEntry) return { entry: embeddedEntry, diagnostics: [] };
  const { rows: [lemmaRow] } = await db.query(
    `SELECT
       v.id AS rank_version_id, v.version AS rank_version,
       lr.lemma_key AS catalog_lemma_key, lr.canonical_lemma,
       lr.lemma_rank, lr.occurrences_per_billion AS lemma_occurrences_per_billion,
       lr.zipf, lr.frequency_band, lr.confidence AS frequency_confidence,
       lr.percentile AS frequency_percentile, lr.sources AS frequency_sources
     FROM frequency_catalog_versions v
     JOIN compact_lemma_rankings lr
       ON lr.catalog_version_id = v.id AND lr.language = $1 AND lr.lemma_key = $2
     WHERE v.status = 'active'
     LIMIT 1`,
    [lang, lemmaKey],
  );

  if (!lemmaRow) {
    const embeddedFallback = lookupEmbeddedFrequency(lang, lemma, bandForLemmaRank);
    if (embeddedFallback) {
      const diagnostic = await reportFallbackDiagnostic(db, {
        code: 'frequency_catalog_embedded_fallback',
        severity: 'warning',
        title: 'Embedded frequency ranking used',
        message: `The active Spanish catalog was unavailable, so Polycast used its committed Spanish frequency snapshot for “${lemma}”.`,
        source: 'server.frequency-catalog',
        operation: 'lookup-ranking',
        pipeline: 'frequency_lookup',
        stage: 'embedded-catalog-fallback',
        language: lang,
        selectedAction: 'use-embedded-frequency-rank',
        detail: `lemmaKey=${lemmaKey}; embeddedRank=${embeddedFallback.lemma_rank}`,
      }, { correlationId }, 'Embedded Spanish frequency ranking used');
      return { entry: embeddedFallback, diagnostics: [diagnostic] };
    }
    const diagnostic = await reportFallbackDiagnostic(db, {
      code: 'frequency_catalog_entry_unavailable',
      severity: 'warning',
      title: 'Frequency catalog entry unavailable',
      message: `No active saved ${lang === 'es' ? 'Spanish' : 'English'} ranking was found for “${lemma}”. This entry is visibly placed in the unranked tail until the catalog is rebuilt.`,
      source: 'server.frequency-catalog',
      operation: 'lookup-ranking',
      pipeline: 'frequency_lookup',
      stage: 'active-catalog-read',
      language: lang,
      selectedAction: 'preserve-unranked-entry',
      detail: `lemmaKey=${lemmaKey}; partOfSpeech=${partOfSpeech || 'unknown'}; definitionHash=${definitionHash || 'none'}`,
    }, { correlationId }, `Saved ${lang === 'es' ? 'Spanish' : 'English'} frequency ranking unavailable`);
    return { entry: null, diagnostics: [diagnostic] };
  }

  const { rows: [senseRow] } = await db.query(
    `SELECT w.id AS catalog_wiktionary_id,
            (sense.ordinality - 1)::int AS catalog_sense_index,
            (gloss.ordinality - 1)::int AS catalog_gloss_index,
            sr.sense_order, sr.sense_rank
       FROM wiktionary w
       CROSS JOIN LATERAL jsonb_array_elements(w.senses) WITH ORDINALITY sense(value, ordinality)
       CROSS JOIN LATERAL jsonb_array_elements_text(
         COALESCE(sense.value->'glosses', '[]'::jsonb)
       ) WITH ORDINALITY gloss(value, ordinality)
       JOIN compact_sense_rankings sr
         ON sr.catalog_version_id = $3
        AND sr.wiktionary_id = w.id
        AND sr.sense_index = sense.ordinality - 1
        AND sr.gloss_index = gloss.ordinality - 1
      WHERE w.lang = $1 AND w.key = unaccent($2)
        AND LOWER(BTRIM(w.word)) = $2
        AND ($4::text IS NULL OR LOWER(w.pos) = LOWER($4))
        AND ($5::text IS NULL OR encode(digest(
              LOWER(REGEXP_REPLACE(BTRIM(gloss.value), '\\s+', ' ', 'g')),
              'sha256'
            ), 'hex') = $5)
      ORDER BY CASE WHEN $5::text IS NOT NULL THEN 0 ELSE 1 END,
               sr.sense_order, w.id, sense.ordinality, gloss.ordinality
      LIMIT 1`,
    [lang, lemmaKey, lemmaRow.rank_version_id, partOfSpeech, definitionHash],
  );

  return {
    entry: {
      ...lemmaRow,
      ...(senseRow || {
        catalog_wiktionary_id: null,
        catalog_sense_index: null,
        catalog_gloss_index: null,
        sense_order: null,
        sense_rank: null,
      }),
      catalog_provisional_sense_id: null,
    },
    diagnostics: [],
  };
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
  // The provisional-sense table belongs to the materialized Spanish sense
  // catalog. English ranking is lemma-only, so inserting English rows here
  // would create a misleading fallback for an otherwise successful lookup.
  if (lang !== 'es' || !lemma || !definition) return { entry: null, diagnostics: [] };
  const lemmaKey = canonicalLemmaKey(lemma);
  const fingerprint = definitionFingerprint(definition);
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const release = client !== db;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`provisional-sense:${lang}`]);
    const { rows: [lemmaRow] } = await client.query(
      `INSERT INTO catalog_provisional_lemmas (language, lemma_key, canonical_lemma)
       VALUES ($1, $2, $3)
       ON CONFLICT (language, lemma_key) DO UPDATE SET updated_at = NOW()
       RETURNING id, canonical_lemma`,
      [lang, lemmaKey, String(lemma).trim().normalize('NFC')],
    );
    const { rows: [senseRow] } = await client.query(
      `INSERT INTO catalog_provisional_senses (
         lemma_id, part_of_speech, definition, definition_hash, sense_order
       )
       SELECT $1, $2, $3, $4,
              COALESCE((SELECT MAX(sense_order) + 1 FROM catalog_provisional_senses WHERE lemma_id = $1), 1)
       ON CONFLICT (lemma_id, part_of_speech, definition_hash) DO UPDATE SET
         definition = EXCLUDED.definition, updated_at = NOW()
       RETURNING id, sense_order`,
      [lemmaRow.id, partOfSpeech || '', definition, fingerprint],
    );
    const { rows: [active] } = await client.query(
      `SELECT v.id, v.version,
              lr.lemma_rank, lr.occurrences_per_billion,
              lr.zipf, lr.frequency_band, lr.confidence, lr.percentile, lr.sources,
              COALESCE((SELECT MAX(lemma_rank) FROM compact_lemma_rankings WHERE catalog_version_id = v.id AND language = $1), 0) AS max_lemma_rank,
              COALESCE((SELECT MAX(sense_rank) FROM compact_sense_rankings WHERE catalog_version_id = v.id), 0) AS max_sense_rank
         FROM frequency_catalog_versions v
         LEFT JOIN compact_lemma_rankings lr
           ON lr.catalog_version_id = v.id AND lr.language = $1 AND lr.lemma_key = $2
        WHERE v.status = 'active' LIMIT 1`,
      [lang, lemmaKey],
    );
    await client.query('COMMIT');

    const diagnostic = await reportFallbackDiagnostic(db, {
      code: 'provisional_dictionary_sense_created',
      severity: 'warning',
      title: 'Provisional dictionary sense created',
      message: `No canonical Wiktionary sense matched “${lemma}”, so Polycast preserved this user meaning in the compact provisional tail.`,
      source: 'server.frequency-catalog',
      operation: 'create-provisional-sense',
      pipeline: 'sense_identity',
      stage: 'dictionary-source-miss',
      language: lang,
      entityType: 'catalog_provisional_sense',
      entityId: senseRow.id,
      selectedAction: active ? 'assigned-provisional-tail-rank' : 'awaiting-catalog-activation',
      catalogVersion: active?.version,
      detail: `lemmaKey=${lemmaKey}; partOfSpeech=${partOfSpeech || 'unknown'}; definitionHash=${fingerprint}`,
    }, { correlationId }, 'Compact provisional sense created');
    if (!active) return { entry: null, diagnostics: [diagnostic] };

    const provisionalLemmaRank = active.lemma_rank == null
      ? Number(active.max_lemma_rank) + Number(lemmaRow.id)
      : Number(active.lemma_rank);
    const provisionalSenseRank = Number(active.max_sense_rank) + Number(senseRow.id);
    return {
      entry: {
        rank_version_id: active.id,
        rank_version: active.version,
        catalog_lemma_key: lemmaKey,
        canonical_lemma: lemmaRow.canonical_lemma,
        lemma_rank: provisionalLemmaRank,
        lemma_occurrences_per_billion: active.occurrences_per_billion,
        zipf: active.zipf,
        frequency_band: active.frequency_band ?? 1,
        frequency_confidence: active.confidence ?? 'unavailable',
        frequency_percentile: active.percentile ?? 0,
        frequency_sources: active.sources || [],
        catalog_wiktionary_id: null,
        catalog_sense_index: null,
        catalog_gloss_index: null,
        catalog_provisional_sense_id: senseRow.id,
        sense_order: senseRow.sense_order,
        sense_rank: provisionalSenseRank,
      },
      diagnostics: [diagnostic],
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({
        event: 'frequency_catalog_rollback_failed',
        pipeline: 'sense_identity',
        stage: 'rollback',
        language: lang,
        lemmaKey,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      }, 'Compact provisional sense rollback failed visibly');
    }
    throw error;
  } finally {
    if (release) client.release();
  }
}

export function catalogEntryToWordFields(entry) {
  if (!entry) return {};
  return {
    catalog_lemma_key: entry.catalog_lemma_key,
    catalog_wiktionary_id: entry.catalog_wiktionary_id || null,
    catalog_sense_index: entry.catalog_sense_index ?? null,
    catalog_gloss_index: entry.catalog_gloss_index ?? null,
    catalog_provisional_sense_id: entry.catalog_provisional_sense_id || null,
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
