/**
 * Build and optionally activate one immutable frequency/sense catalog.
 *
 * This is intentionally an offline command. Runtime dictionary requests only read
 * the active rows produced here.
 *
 * Usage:
 *   npm run catalog:build -- --version 2026-07-12 --activate
 *   npm run catalog:build -- --version test --dry-run
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import v8 from 'node:v8';
import { FREQUENCY_LANGUAGES } from '../lib/frequencyCatalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(root, '.env') });
const args = new Set(process.argv.slice(2));
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};
const version = valueAfter('--version');
const activate = args.has('--activate');
const dryRun = args.has('--dry-run');
const maxEntriesPerSourceRaw = valueAfter('--max-entries-per-source');
const maxEntriesPerSource = maxEntriesPerSourceRaw == null ? null : Number(maxEntriesPerSourceRaw);
if (!version) throw new Error('--version is required');
if (maxEntriesPerSource != null && (!Number.isInteger(maxEntriesPerSource) || maxEntriesPerSource < 1)) {
  throw new Error('--max-entries-per-source must be a positive integer');
}

const manifestPath = path.join(root, 'server', 'data', 'frequency-sources', 'manifest.json');
const configuredManifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { sources: [] };

// The full catalog is intentionally processed one language at a time. Explicit
// collection prevents prior corpus maps from accumulating on memory-constrained
// one-off workers such as Render Starter instances.
v8.setFlagsFromString('--expose_gc');
const collectGarbage = vm.runInNewContext('gc');

function parseWordfreq(lang) {
  const file = path.join(root, 'server', 'data', 'frequency', `${lang}.txt`);
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const split = line.lastIndexOf(' ');
    if (split <= 0) continue;
    const lemma = line.slice(0, split).trim().normalize('NFC');
    const zipf = Number(line.slice(split + 1));
    if (!lemma || !Number.isFinite(zipf)) continue;
    entries.push({ lemma, value: 10 ** zipf, zipf });
    if (maxEntriesPerSource != null && entries.length >= maxEntriesPerSource) break;
  }
  return {
    id: 'wordfreq-snapshot',
    language: lang,
    weight: 1,
    license: 'See wordfreq source manifest',
    path: path.relative(root, file),
    entries,
  };
}

function parseConfiguredSource(config) {
  const file = path.resolve(root, config.path);
  if (!fs.existsSync(file)) {
    if (config.required) throw new Error(`Required frequency source is missing: ${config.id} (${file})`);
    return { missing: true, ...config, path: path.relative(root, file), entries: [] };
  }
  const valuesByLemma = new Map();
  const preAggregatedEntries = [];
  const configuredLimit = Number.isInteger(config.maxEntries) && config.maxEntries > 0
    ? config.maxEntries
    : null;
  const entryLimit = [configuredLimit, maxEntriesPerSource]
    .filter((limit) => limit != null)
    .reduce((lowest, limit) => Math.min(lowest, limit), Number.POSITIVE_INFINITY);
  const sourceText = config.compression === 'xz'
    ? execFileSync('xz', ['-dc', file], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    : fs.readFileSync(file, 'utf8');
  const delimiter = config.delimiter === 'comma' ? ',' : '\t';
  const lines = sourceText.split('\n');
  const header = lines[0]?.split(delimiter) || [];
  const lemmaIndex = Math.max(0, header.indexOf(config.lemmaColumn || 'lemma'));
  const valueIndex = Math.max(1, header.indexOf(config.valueColumn || 'frequency'));
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const columns = line.split(delimiter);
    const lemmaRaw = columns[lemmaIndex];
    const valueRaw = columns[valueIndex];
    const lemma = String(lemmaRaw || '').trim().normalize('NFC');
    const value = Number(valueRaw);
    if (lemma && lemma !== '[TOTAL]' && Number.isFinite(value) && value >= 0) {
      if (config.preAggregated) {
        preAggregatedEntries.push({ lemma, value });
        if (preAggregatedEntries.length >= entryLimit) break;
        continue;
      }
      const key = lemma.toLocaleLowerCase(config.language);
      const existing = valuesByLemma.get(key);
      valuesByLemma.set(key, {
        lemma: existing?.lemma || lemma,
        value: (existing?.value || 0) + value,
      });
    }
  }
  const entries = config.preAggregated ? preAggregatedEntries : [...valuesByLemma.values()];
  if (!config.preAggregated) entries.sort((a, b) => b.value - a.value || a.lemma.localeCompare(b.lemma));
  return {
    ...config,
    path: path.relative(root, file),
    entries: Number.isFinite(entryLimit) ? entries.slice(0, entryLimit) : entries,
  };
}

function buildLanguageScores(lang, sources) {
  const records = new Map();
  for (const source of sources.filter((item) => item.language === lang && item.entries.length)) {
    const weight = Number(source.weight) || 1;
    source.entries.forEach((entry, index) => {
      const key = entry.lemma.toLocaleLowerCase();
      const record = records.get(key) || {
        language: lang,
        lemmaKey: key,
        canonicalLemma: entry.lemma,
        score: 0,
        weightedOccurrences: 0,
        occurrenceWeight: 0,
        sourceCount: 0,
        sourcesJson: '[',
      };
      // Weighted reciprocal-rank fusion is robust to corpora with incomparable raw units.
      record.score += weight / (60 + index + 1);
      record.weightedOccurrences += weight * entry.value;
      record.occurrenceWeight += weight;
      const sourceJson = JSON.stringify({ id: source.id, rank: index + 1, weight, value: entry.value });
      record.sourcesJson += `${record.sourceCount > 0 ? ',' : ''}${sourceJson}`;
      record.sourceCount += 1;
      records.set(key, record);
    });
    source.entries.length = 0;
  }
  for (const record of records.values()) {
    record.occurrences = Math.max(0, Math.round(record.weightedOccurrences / record.occurrenceWeight));
    record.sourcesJson += ']';
    delete record.weightedOccurrences;
    delete record.occurrenceWeight;
  }
  return [...records.values()];
}

const manifest = [];
const diagnostics = [];
let scoreCount = 0;

function loadLanguageScores(lang) {
  const sources = [
    parseWordfreq(lang),
    ...configuredManifest.sources
      .filter((source) => source.language === lang)
      .map(parseConfiguredSource),
  ];
  manifest.push(...sources.map(({ entries, ...source }) => ({ ...source, entryCount: entries.length })));
  diagnostics.push(...sources.filter((source) => source.missing).map((source) => ({
    code: 'catalog_optional_source_missing',
    severity: 'warning',
    pipeline: 'catalog_build',
    stage: 'source-load',
    language: source.language,
    source: source.id,
    detail: `path=${source.path}`,
  })));
  const scores = buildLanguageScores(lang, sources);
  scoreCount += scores.length;
  return scores;
}

if (dryRun) {
  for (const lang of FREQUENCY_LANGUAGES) {
    const scores = loadLanguageScores(lang);
    scores.length = 0;
    collectGarbage();
  }
  console.log(JSON.stringify({ version, activate, dryRun, scoreCount, manifest, diagnostics }, null, 2));
  process.exit(0);
}

const poolConfig = { connectionString: process.env.DATABASE_URL };
if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('render.com')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}
const pool = new pg.Pool(poolConfig);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const { rows: [catalog] } = await client.query(
    `INSERT INTO frequency_catalog_versions (version, status, source_manifest, diagnostics)
     VALUES ($1, 'building', $2::jsonb, $3::jsonb)
     RETURNING id`,
    [version, '[]', '[]'],
  );

  await client.query(
    `INSERT INTO dictionary_lemmas (language, lemma_key, canonical_lemma, provenance)
     SELECT lang, LOWER(BTRIM(key)), BTRIM(word), jsonb_build_object('source', 'wiktionary')
       FROM wiktionary
      WHERE lang = ANY($1) AND BTRIM(key) <> '' AND BTRIM(word) <> ''
     ON CONFLICT (language, lemma_key) DO NOTHING`,
    [FREQUENCY_LANGUAGES],
  );

  // The sense import immediately joins against millions of newly inserted lemmas.
  // Refresh planner statistics inside this transaction so low-memory databases do
  // not choose a plan based on the table's pre-build row count.
  await client.query('ANALYZE dictionary_lemmas');

  await client.query(`
    INSERT INTO dictionary_senses (
      lemma_id, part_of_speech, definition, definition_hash, source,
      source_sense_id, source_order, provenance
    )
    SELECT l.id, w.pos, gloss.value,
           encode(digest(LOWER(REGEXP_REPLACE(BTRIM(gloss.value), '\\s+', ' ', 'g')), 'sha256'), 'hex'),
           'wiktionary',
           CONCAT('wiktionary:', w.id, ':', sense.ordinality, ':', gloss.ordinality),
           ((sense.ordinality - 1) * 1000 + gloss.ordinality)::int,
           jsonb_build_object('wiktionaryRowId', w.id, 'senseIndex', sense.ordinality - 1)
      FROM wiktionary w
      JOIN dictionary_lemmas l ON l.language = w.lang AND l.lemma_key = LOWER(BTRIM(w.key))
      CROSS JOIN LATERAL jsonb_array_elements(w.senses) WITH ORDINALITY sense(value, ordinality)
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(sense.value->'glosses', '[]'::jsonb)) WITH ORDINALITY gloss(value, ordinality)
     WHERE w.lang = ANY($1) AND BTRIM(gloss.value) <> ''
    ON CONFLICT (source, source_sense_id) DO UPDATE SET
      definition = EXCLUDED.definition,
      definition_hash = EXCLUDED.definition_hash,
      part_of_speech = EXCLUDED.part_of_speech,
      source_order = EXCLUDED.source_order,
      active = TRUE,
      updated_at = NOW()
  `, [FREQUENCY_LANGUAGES]);

  // Preserve every existing user sense, including meanings that never matched the source dump.
  await client.query(`
    INSERT INTO dictionary_lemmas (language, lemma_key, canonical_lemma, provenance)
    SELECT target_language,
           LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word))),
           MIN(BTRIM(COALESCE(NULLIF(lemma, ''), word))),
           jsonb_build_object('source', 'legacy-user-dictionary')
      FROM saved_words
     WHERE target_language = ANY($1)
       AND BTRIM(COALESCE(NULLIF(lemma, ''), word)) <> ''
     GROUP BY target_language, LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word)))
    ON CONFLICT (language, lemma_key) DO NOTHING
  `, [FREQUENCY_LANGUAGES]);
  await client.query(`
    INSERT INTO dictionary_senses (
      lemma_id, part_of_speech, definition, definition_hash, source,
      source_sense_id, source_order, provisional, provenance
    )
    SELECT DISTINCT ON (l.id, COALESCE(sw.part_of_speech, ''), normalized.definition_hash)
           l.id, COALESCE(sw.part_of_speech, ''), sw.definition, normalized.definition_hash,
           'polycast-legacy',
           CONCAT('polycast-legacy:', encode(digest(CONCAT_WS(CHR(31), l.id::text,
             COALESCE(sw.part_of_speech, ''), normalized.definition_hash), 'sha256'), 'hex')),
           2147483647, TRUE,
           jsonb_build_object('reason', 'legacy-user-sense-preserved')
      FROM saved_words sw
      JOIN dictionary_lemmas l
        ON l.language = sw.target_language
       AND l.lemma_key = LOWER(BTRIM(COALESCE(NULLIF(sw.lemma, ''), sw.word)))
      CROSS JOIN LATERAL (
        SELECT encode(digest(LOWER(REGEXP_REPLACE(BTRIM(sw.definition), '\\s+', ' ', 'g')), 'sha256'), 'hex') AS definition_hash
      ) normalized
     WHERE sw.target_language = ANY($1) AND BTRIM(sw.definition) <> ''
       AND NOT EXISTS (
         SELECT 1
           FROM dictionary_senses existing
          WHERE existing.lemma_id = l.id
            AND existing.active
            AND existing.part_of_speech = COALESCE(sw.part_of_speech, '')
            AND existing.definition_hash = normalized.definition_hash
       )
    ON CONFLICT (source, source_sense_id) DO UPDATE SET updated_at = NOW(), active = TRUE
  `, [FREQUENCY_LANGUAGES]);

  await client.query(`
    CREATE TEMP TABLE catalog_frequency_stage (
      language TEXT, lemma_key TEXT, canonical_lemma TEXT, score DOUBLE PRECISION,
      occurrences BIGINT, sources JSONB, source_count INTEGER
    ) ON COMMIT DROP
  `);
  const batchSize = 2000;
  for (const lang of FREQUENCY_LANGUAGES) {
    const scores = loadLanguageScores(lang);
    for (let offset = 0; offset < scores.length; offset += batchSize) {
      const batch = scores.slice(offset, offset + batchSize);
      await client.query(
        `INSERT INTO catalog_frequency_stage
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::float8[], $5::bigint[], $6::jsonb[], $7::int[])`,
        [
          batch.map((row) => row.language), batch.map((row) => row.lemmaKey),
          batch.map((row) => row.canonicalLemma), batch.map((row) => row.score),
          batch.map((row) => row.occurrences), batch.map((row) => row.sourcesJson),
          batch.map((row) => row.sourceCount),
        ],
      );
    }
    scores.length = 0;
    collectGarbage();
  }

  await client.query(`
    INSERT INTO dictionary_lemmas (language, lemma_key, canonical_lemma, provenance)
    SELECT language, lemma_key, canonical_lemma, jsonb_build_object('source', 'frequency-catalog')
      FROM catalog_frequency_stage
    ON CONFLICT (language, lemma_key) DO NOTHING
  `);

  // Both inputs were bulk-loaded in this transaction and feed the ranking window
  // below. Accurate cardinalities keep its joins and sorts from spilling needlessly.
  await client.query('ANALYZE dictionary_lemmas');
  await client.query('ANALYZE catalog_frequency_stage');

  await client.query(`
    WITH ordered AS (
      SELECT l.id AS lemma_id, l.language,
             ROW_NUMBER() OVER (
               PARTITION BY l.language
               ORDER BY (s.score IS NOT NULL) DESC, s.score DESC NULLS LAST, l.lemma_key, l.id
             )::int AS lemma_rank,
             s.occurrences, s.sources, COALESCE(s.source_count, 0) AS source_count,
             COUNT(*) OVER (PARTITION BY l.language)::numeric AS total
        FROM dictionary_lemmas l
        LEFT JOIN catalog_frequency_stage s
          ON s.language = l.language AND s.lemma_key = l.lemma_key
       WHERE l.language = ANY($2)
    )
    INSERT INTO lemma_frequency_rankings (
      catalog_version_id, lemma_id, language, lemma_rank, occurrences_per_billion,
      zipf, frequency_band, confidence, percentile, sources
    )
    SELECT $1, lemma_id, language, lemma_rank, occurrences,
           CASE WHEN occurrences > 0 THEN LOG(10, occurrences::numeric) ELSE NULL END,
           CASE WHEN lemma_rank <= 500 THEN 10 WHEN lemma_rank <= 1000 THEN 9
                WHEN lemma_rank <= 2000 THEN 8 WHEN lemma_rank <= 4000 THEN 7
                WHEN lemma_rank <= 7000 THEN 6 WHEN lemma_rank <= 12000 THEN 5
                WHEN lemma_rank <= 20000 THEN 4 WHEN lemma_rank <= 35000 THEN 3
                WHEN lemma_rank <= 60000 THEN 2 ELSE 1 END,
           CASE WHEN source_count >= 3 THEN 'high' WHEN source_count = 2 THEN 'medium'
                WHEN source_count = 1 THEN 'low' ELSE 'unavailable' END,
           CASE WHEN total <= 1 THEN 1 ELSE 1 - ((lemma_rank - 1)::numeric / (total - 1)) END,
           COALESCE(sources, '[]'::jsonb)
      FROM ordered
  `, [catalog.id, FREQUENCY_LANGUAGES]);

  // Sense ranking joins two other bulk-loaded tables immediately. Publish their
  // transaction-local cardinalities before PostgreSQL plans that operation.
  await client.query('ANALYZE dictionary_senses');
  await client.query('ANALYZE lemma_frequency_rankings');

  await client.query(`
    WITH ordered AS (
      SELECT s.id AS sense_id, l.language, lf.lemma_rank,
             ROW_NUMBER() OVER (PARTITION BY s.lemma_id ORDER BY s.source_order, s.id)::int AS sense_order,
             ROW_NUMBER() OVER (
               PARTITION BY l.language
               ORDER BY lf.lemma_rank, s.source_order, s.id
             )::bigint AS sense_rank
        FROM dictionary_senses s
        JOIN dictionary_lemmas l ON l.id = s.lemma_id
        JOIN lemma_frequency_rankings lf ON lf.catalog_version_id = $1 AND lf.lemma_id = l.id
       WHERE s.active
    )
    INSERT INTO sense_rankings (
      catalog_version_id, sense_id, language, lemma_rank, sense_order, sense_rank
    )
    SELECT $1, sense_id, language, lemma_rank, sense_order, sense_rank FROM ordered
  `, [catalog.id]);

  await client.query(`
    WITH mapped AS (
      SELECT DISTINCT ON (sw.id)
             sw.id AS saved_word_id, l.id AS lemma_id, l.canonical_lemma,
             s.id AS sense_id, lf.lemma_rank, sr.sense_rank,
             lf.occurrences_per_billion, lf.frequency_band, lf.confidence, lf.sources
        FROM saved_words sw
        JOIN dictionary_lemmas l
          ON sw.target_language = l.language
         AND LOWER(BTRIM(COALESCE(NULLIF(sw.lemma, ''), sw.word))) = l.lemma_key
        JOIN lemma_frequency_rankings lf ON lf.catalog_version_id = $1 AND lf.lemma_id = l.id
        LEFT JOIN dictionary_senses s
          ON s.lemma_id = l.id AND s.active
         AND s.part_of_speech = COALESCE(sw.part_of_speech, '')
         AND s.definition_hash = encode(digest(LOWER(REGEXP_REPLACE(BTRIM(sw.definition), '\\s+', ' ', 'g')), 'sha256'), 'hex')
        LEFT JOIN sense_rankings sr ON sr.catalog_version_id = $1 AND sr.sense_id = s.id
       ORDER BY sw.id, s.provisional ASC, s.source_order, s.id
    )
    UPDATE saved_words sw
       SET word = mapped.canonical_lemma,
           lemma = mapped.canonical_lemma,
           lemma_id = mapped.lemma_id,
           sense_id = mapped.sense_id,
           rank_version_id = $1,
           lemma_frequency_rank = mapped.lemma_rank,
           sense_rank = mapped.sense_rank,
           lemma_occurrences_per_billion = mapped.occurrences_per_billion,
           frequency_count = mapped.occurrences_per_billion,
           frequency = mapped.frequency_band,
           frequency_confidence = mapped.confidence,
           frequency_sources = mapped.sources
      FROM mapped
     WHERE sw.id = mapped.saved_word_id
  `, [catalog.id]);

  await client.query(`
    WITH mapped AS (
      SELECT DISTINCT ON (shared.id)
             shared.id AS shared_id, l.id AS lemma_id, s.id AS sense_id,
             lf.lemma_rank, sr.sense_rank, lf.occurrences_per_billion,
             lf.frequency_band, lf.confidence, lf.sources
        FROM shared_dictionary_entries shared
        JOIN dictionary_lemmas l
          ON shared.target_language = l.language AND shared.word_key = l.lemma_key
        JOIN lemma_frequency_rankings lf ON lf.catalog_version_id = $1 AND lf.lemma_id = l.id
        LEFT JOIN dictionary_senses s
          ON s.lemma_id = l.id AND s.active
         AND s.part_of_speech = COALESCE(shared.part_of_speech, '')
         AND s.definition_hash = shared.definition_hash
        LEFT JOIN sense_rankings sr ON sr.catalog_version_id = $1 AND sr.sense_id = s.id
       ORDER BY shared.id, s.provisional ASC, s.source_order, s.id
    )
    UPDATE shared_dictionary_entries shared
       SET lemma_id = mapped.lemma_id,
           sense_id = mapped.sense_id,
           rank_version_id = $1,
           lemma_frequency_rank = mapped.lemma_rank,
           sense_rank = mapped.sense_rank,
           lemma_occurrences_per_billion = mapped.occurrences_per_billion,
           frequency_count = mapped.occurrences_per_billion,
           frequency = mapped.frequency_band,
           frequency_confidence = mapped.confidence,
           frequency_sources = mapped.sources
      FROM mapped
     WHERE shared.id = mapped.shared_id
  `, [catalog.id]);

  const { rows: [savedWordBackfill] } = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE lemma_id IS NOT NULL)::int AS lemma_linked,
           COUNT(*) FILTER (WHERE lemma_frequency_rank IS NOT NULL)::int AS ranked,
           COUNT(*) FILTER (WHERE BTRIM(COALESCE(definition, '')) <> '' AND sense_id IS NOT NULL)::int AS defined_sense_linked,
           COUNT(*) FILTER (WHERE BTRIM(COALESCE(definition, '')) <> '')::int AS defined_total,
           COUNT(*) FILTER (WHERE rank_version_id = $1)::int AS catalog_version_linked
      FROM saved_words
     WHERE target_language = ANY($2)
  `, [catalog.id, FREQUENCY_LANGUAGES]);
  const { rows: [sharedEntryBackfill] } = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE lemma_id IS NOT NULL)::int AS lemma_linked,
           COUNT(*) FILTER (WHERE lemma_frequency_rank IS NOT NULL)::int AS ranked,
           COUNT(*) FILTER (WHERE BTRIM(COALESCE(definition, '')) <> '' AND sense_id IS NOT NULL)::int AS defined_sense_linked,
           COUNT(*) FILTER (WHERE BTRIM(COALESCE(definition, '')) <> '')::int AS defined_total,
           COUNT(*) FILTER (WHERE rank_version_id = $1)::int AS catalog_version_linked
      FROM shared_dictionary_entries
     WHERE target_language = ANY($2)
  `, [catalog.id, FREQUENCY_LANGUAGES]);
  const backfill = { savedWords: savedWordBackfill, sharedEntries: sharedEntryBackfill };
  const incompleteBackfills = Object.entries(backfill).filter(([, summary]) =>
    summary.lemma_linked !== summary.total
    || summary.ranked !== summary.total
    || summary.catalog_version_linked !== summary.total
    || summary.defined_sense_linked !== summary.defined_total
  );
  if (incompleteBackfills.length) {
    const diagnostic = {
      code: 'catalog_backfill_verification_failed',
      severity: 'error',
      pipeline: 'catalog_build',
      stage: 'existing-entry-backfill-verification',
      catalogVersion: version,
      detail: backfill,
    };
    console.error(JSON.stringify(diagnostic));
    throw new Error(`Catalog backfill verification failed: ${JSON.stringify(backfill)}`);
  }

  if (activate) {
    await client.query(
      `UPDATE frequency_catalog_versions SET status = 'retired' WHERE status = 'active'`,
    );
  }
  await client.query(
    `UPDATE frequency_catalog_versions
        SET status = $2,
            source_manifest = $3::jsonb,
            diagnostics = $4::jsonb,
            built_at = NOW(), activated_at = CASE WHEN $2 = 'active' THEN NOW() ELSE NULL END
      WHERE id = $1`,
    [
      catalog.id,
      activate ? 'active' : 'retired',
      JSON.stringify(manifest),
      JSON.stringify(diagnostics),
    ],
  );
  await client.query('COMMIT');
  console.log(JSON.stringify({
    event: 'frequency_catalog_built',
    version,
    status: activate ? 'active' : 'retired',
    scoreCount,
    sourceCount: manifest.length,
    backfill,
    diagnostics,
  }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
