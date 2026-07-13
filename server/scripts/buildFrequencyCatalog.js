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
import { canonicalLemmaKey } from '../lib/normalizeWordFields.js';
import {
  createCatalogBuildRun,
  linkCatalogBuildVersion,
  updateCatalogBuildProgress,
} from '../lib/catalogBuildProgress.js';

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
      const key = canonicalLemmaKey(entry.lemma);
      const record = records.get(key) || {
        language: lang,
        lemmaKey: key,
        canonicalLemma: entry.lemma,
        score: 0,
        sourceCount: 0,
        sourcesJson: '[',
      };
      // Weighted reciprocal-rank fusion is robust to corpora with incomparable raw units.
      record.score += weight / (60 + index + 1);
      if (source.id === 'wordfreq-snapshot') record.occurrencesPerBillion = entry.value;
      const sourceJson = JSON.stringify({ id: source.id, rank: index + 1, weight, value: entry.value });
      record.sourcesJson += `${record.sourceCount > 0 ? ',' : ''}${sourceJson}`;
      record.sourceCount += 1;
      records.set(key, record);
    });
    source.entries.length = 0;
  }
  for (const record of records.values()) {
    record.occurrences = record.occurrencesPerBillion == null
      ? null
      : Math.max(0, Math.round(record.occurrencesPerBillion));
    record.sourcesJson += ']';
    delete record.occurrencesPerBillion;
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

const BUILD_LANGUAGE = 'es';
const FREQUENCY_BATCH_SIZE = 2_000;
const INVENTORY_BATCH_SIZE = 10_000;
const LEMMA_BATCH_SIZE = 10_000;
const SENSE_LEMMA_BATCH_SIZE = 2_000;

if (dryRun) {
  const scores = loadLanguageScores(BUILD_LANGUAGE);
  scores.length = 0;
  collectGarbage();
  console.log(JSON.stringify({ version, activate, dryRun, languages: [BUILD_LANGUAGE], scoreCount, manifest, diagnostics }, null, 2));
  process.exit(0);
}

const poolConfig = { connectionString: process.env.DATABASE_URL };
if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('render.com')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}
const pool = new pg.Pool(poolConfig);
const progressPool = new pg.Pool(poolConfig);
let client;
let runId;
let currentPhase = 'frequency_sources';
let catalog;

async function reportProgress(input) {
  currentPhase = input.phase;
  await updateCatalogBuildProgress({
    db: progressPool,
    runId,
    language: BUILD_LANGUAGE,
    ...input,
  });
}

async function withProgressHeartbeat(progress, operation) {
  let pendingHeartbeat = Promise.resolve();
  let heartbeatFailure = null;
  const timer = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat.then(async () => {
      try {
        await reportProgress(progress);
      } catch (error) {
        heartbeatFailure = error;
        console.error(JSON.stringify({
          event: 'catalog_progress_heartbeat_failed',
          severity: 'error',
          pipeline: 'catalog_build',
          stage: progress.phase,
          language: BUILD_LANGUAGE,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    });
  }, 15_000);
  try {
    const result = await operation();
    await pendingHeartbeat;
    if (heartbeatFailure) throw heartbeatFailure;
    return result;
  } finally {
    clearInterval(timer);
  }
}

try {
  runId = await createCatalogBuildRun({
    db: progressPool,
    version,
    languages: [BUILD_LANGUAGE],
  });
  const scores = loadLanguageScores(BUILD_LANGUAGE);
  await reportProgress({
    phase: 'frequency_sources', completed: 0, total: scores.length,
    message: `Loaded ${manifest.length} Spanish frequency sources; staging fused scores.`,
    counts: { frequencySourceCount: manifest.length, frequencyScoreCount: scores.length },
    phaseTotals: { frequency_sources: scores.length },
  });

  client = await pool.connect();
  await client.query('BEGIN');
  const { rows: [catalogRow] } = await client.query(
    `INSERT INTO frequency_catalog_versions (
       version, status, source_manifest, diagnostics, languages, build_run_id
     ) VALUES ($1, 'building', '[]'::jsonb, '[]'::jsonb, $2::jsonb, $3)
     RETURNING id`,
    [version, JSON.stringify([BUILD_LANGUAGE]), runId],
  );
  catalog = catalogRow;

  await client.query(`
    CREATE TEMP TABLE catalog_frequency_stage (
      language TEXT, lemma_key TEXT, canonical_lemma TEXT, score DOUBLE PRECISION,
      occurrences BIGINT, sources JSONB, source_count INTEGER,
      PRIMARY KEY (language, lemma_key)
    ) ON COMMIT DROP
  `);
  for (let offset = 0; offset < scores.length; offset += FREQUENCY_BATCH_SIZE) {
    const batch = scores.slice(offset, offset + FREQUENCY_BATCH_SIZE);
    await client.query(
      `INSERT INTO catalog_frequency_stage
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::float8[], $5::bigint[], $6::jsonb[], $7::int[])
       ON CONFLICT (language, lemma_key) DO UPDATE SET
         score = GREATEST(catalog_frequency_stage.score, EXCLUDED.score),
         occurrences = GREATEST(catalog_frequency_stage.occurrences, EXCLUDED.occurrences)`,
      [
        batch.map((row) => row.language), batch.map((row) => row.lemmaKey),
        batch.map((row) => row.canonicalLemma), batch.map((row) => row.score),
        batch.map((row) => row.occurrences), batch.map((row) => row.sourcesJson),
        batch.map((row) => row.sourceCount),
      ],
    );
    await reportProgress({
      phase: 'frequency_sources', completed: Math.min(offset + batch.length, scores.length), total: scores.length,
      message: 'Staging fused Spanish frequency evidence.',
      counts: { frequencySourceCount: manifest.length, frequencyScoreCount: scores.length },
      phaseTotals: { frequency_sources: scores.length },
    });
  }
  scores.length = 0;
  collectGarbage();

  const { rows: [sourceSummary] } = await client.query(
    `SELECT COUNT(*)::bigint AS source_rows FROM wiktionary WHERE lang = $1`,
    [BUILD_LANGUAGE],
  );
  const { rows: [existingCounts] } = await client.query(
    `SELECT
       (SELECT COUNT(*)::bigint FROM saved_words WHERE target_language = $1) AS saved_words,
       (SELECT COUNT(*)::bigint FROM shared_dictionary_entries WHERE target_language = $1) AS shared_entries`,
    [BUILD_LANGUAGE],
  );
  const sourceTotal = Number(sourceSummary.source_rows);
  const savedTotal = Number(existingCounts.saved_words);
  const sharedTotal = Number(existingCounts.shared_entries);
  let sourceCompleted = 0;
  let senseTotal = 0;
  let lastSourceId = 0;
  await reportProgress({
    phase: 'source_inventory', completed: 0, total: sourceTotal,
    message: 'Counting exact Spanish Wiktionary senses in bounded batches.',
    counts: { sourceRows: sourceTotal, senses: 0, savedWords: savedTotal, sharedEntries: sharedTotal },
    phaseTotals: {
      frequency_sources: scoreCount,
      source_inventory: sourceTotal,
      saved_backfill: savedTotal,
      shared_backfill: sharedTotal,
      verification: 6,
      activation: 1,
    },
  });
  while (sourceCompleted < sourceTotal) {
    const { rows: [batch] } = await client.query(
      `WITH source_batch AS (
         SELECT id, senses
           FROM wiktionary
          WHERE lang = $1 AND id > $2
          ORDER BY id
          LIMIT $3
       )
       SELECT COALESCE(MAX(id), $2)::int AS last_id,
              COUNT(*)::int AS source_rows,
              COALESCE(SUM((
                SELECT COUNT(*)
                  FROM jsonb_array_elements(source_batch.senses) sense(value)
                  CROSS JOIN LATERAL jsonb_array_elements_text(
                    COALESCE(sense.value->'glosses', '[]'::jsonb)
                  ) gloss(value)
                 WHERE BTRIM(gloss.value) <> ''
              )), 0)::bigint AS senses
         FROM source_batch`,
      [BUILD_LANGUAGE, lastSourceId, INVENTORY_BATCH_SIZE],
    );
    if (!batch.source_rows) break;
    lastSourceId = Number(batch.last_id);
    sourceCompleted += Number(batch.source_rows);
    senseTotal += Number(batch.senses);
    await reportProgress({
      phase: 'source_inventory', completed: sourceCompleted, total: sourceTotal,
      message: `Inventoried ${sourceCompleted.toLocaleString()} of ${sourceTotal.toLocaleString()} Spanish source entries.`,
      counts: { sourceRows: sourceTotal, senses: senseTotal, savedWords: savedTotal, sharedEntries: sharedTotal },
      phaseTotals: {
        frequency_sources: scoreCount,
        source_inventory: sourceTotal,
        saved_backfill: savedTotal,
        shared_backfill: sharedTotal,
        verification: 6,
        activation: 1,
      },
    });
  }

  await reportProgress({
    phase: 'lemma_ranking', completed: 0, total: null,
    message: 'Preparing the exact compact Spanish lemma order.',
    counts: { sourceRows: sourceTotal, senses: senseTotal, savedWords: savedTotal, sharedEntries: sharedTotal },
    phaseTotals: {
      frequency_sources: scoreCount,
      source_inventory: sourceTotal,
      sense_ranking: senseTotal,
      saved_backfill: savedTotal,
      shared_backfill: sharedTotal,
      verification: 6,
      activation: 1,
    },
  });
  await withProgressHeartbeat({
    phase: 'lemma_ranking', completed: 0, total: null,
    message: 'Preparing the exact compact Spanish lemma order; the database aggregation is still active.',
    counts: { sourceRows: sourceTotal, senses: senseTotal, savedWords: savedTotal, sharedEntries: sharedTotal },
    phaseTotals: {
      frequency_sources: scoreCount, source_inventory: sourceTotal,
      sense_ranking: senseTotal, saved_backfill: savedTotal,
      shared_backfill: sharedTotal, verification: 6, activation: 1,
    },
  }, () => client.query(`
    CREATE TEMP TABLE catalog_lemma_stage ON COMMIT DROP AS
    WITH candidate_rows AS (
      SELECT LOWER(BTRIM(word)) AS lemma_key, MIN(BTRIM(word)) AS canonical_lemma
        FROM wiktionary
       WHERE lang = 'es' AND BTRIM(word) <> ''
       GROUP BY LOWER(BTRIM(word))
      UNION ALL
      SELECT lemma_key, MIN(canonical_lemma)
        FROM catalog_frequency_stage
       WHERE language = 'es'
       GROUP BY lemma_key
      UNION ALL
      SELECT LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word))) AS lemma_key,
             MIN(BTRIM(COALESCE(NULLIF(lemma, ''), word))) AS canonical_lemma
        FROM saved_words
       WHERE target_language = 'es' AND BTRIM(COALESCE(NULLIF(lemma, ''), word)) <> ''
       GROUP BY LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word)))
      UNION ALL
      SELECT LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word))) AS lemma_key,
             MIN(BTRIM(COALESCE(NULLIF(lemma, ''), word)))
        FROM shared_dictionary_entries
       WHERE target_language = 'es' AND BTRIM(COALESCE(NULLIF(lemma, ''), word)) <> ''
       GROUP BY LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word)))
    ), candidates AS (
      SELECT lemma_key, MIN(canonical_lemma) AS canonical_lemma
        FROM candidate_rows
       WHERE BTRIM(lemma_key) <> ''
       GROUP BY lemma_key
    )
    SELECT c.lemma_key,
           COALESCE(f.canonical_lemma, c.canonical_lemma) AS canonical_lemma,
           ROW_NUMBER() OVER (
             ORDER BY (f.score IS NOT NULL) DESC, f.score DESC NULLS LAST, c.lemma_key
           )::int AS lemma_rank,
           f.occurrences,
           CASE WHEN f.occurrences > 0 THEN LOG(10, f.occurrences::numeric) ELSE NULL END AS zipf,
           CASE WHEN f.source_count >= 3 THEN 'high'
                WHEN f.source_count = 2 THEN 'medium'
                WHEN f.source_count = 1 THEN 'low' ELSE 'unavailable' END AS confidence,
           COALESCE(f.sources, '[]'::jsonb) AS sources,
           COUNT(*) OVER ()::numeric AS total
      FROM candidates c
      LEFT JOIN catalog_frequency_stage f
        ON f.language = 'es' AND f.lemma_key = c.lemma_key
  `));
  await client.query('CREATE UNIQUE INDEX catalog_lemma_stage_rank ON catalog_lemma_stage (lemma_rank)');
  await client.query('ANALYZE catalog_lemma_stage');
  const { rows: [lemmaSummary] } = await client.query('SELECT COUNT(*)::int AS count FROM catalog_lemma_stage');
  const lemmaTotal = Number(lemmaSummary.count);
  let lemmaCompleted = 0;
  await reportProgress({
    phase: 'lemma_ranking', completed: 0, total: lemmaTotal,
    message: `Writing ${lemmaTotal.toLocaleString()} compact Spanish lemma ranks.`,
    counts: { sourceRows: sourceTotal, lemmas: lemmaTotal, senses: senseTotal, savedWords: savedTotal, sharedEntries: sharedTotal },
    phaseTotals: {
      frequency_sources: scoreCount, source_inventory: sourceTotal,
      lemma_ranking: lemmaTotal, sense_ranking: senseTotal,
      saved_backfill: savedTotal, shared_backfill: sharedTotal,
      verification: 6, activation: 1,
    },
  });
  while (lemmaCompleted < lemmaTotal) {
    const { rowCount } = await client.query(
      `INSERT INTO compact_lemma_rankings (
         catalog_version_id, language, lemma_key, canonical_lemma, lemma_rank,
         occurrences_per_billion, zipf, frequency_band, confidence, percentile, sources
       )
       SELECT $1, 'es', lemma_key, canonical_lemma, lemma_rank, occurrences, zipf,
              CASE WHEN lemma_rank <= 500 THEN 10 WHEN lemma_rank <= 1000 THEN 9
                   WHEN lemma_rank <= 2000 THEN 8 WHEN lemma_rank <= 4000 THEN 7
                   WHEN lemma_rank <= 7000 THEN 6 WHEN lemma_rank <= 12000 THEN 5
                   WHEN lemma_rank <= 20000 THEN 4 WHEN lemma_rank <= 35000 THEN 3
                   WHEN lemma_rank <= 60000 THEN 2 ELSE 1 END,
              confidence,
              CASE WHEN total <= 1 THEN 1 ELSE 1 - ((lemma_rank - 1)::numeric / (total - 1)) END,
              sources
         FROM catalog_lemma_stage
        WHERE lemma_rank > $2
        ORDER BY lemma_rank
        LIMIT $3`,
      [catalog.id, lemmaCompleted, LEMMA_BATCH_SIZE],
    );
    if (!rowCount) break;
    lemmaCompleted += rowCount;
    await reportProgress({
      phase: 'lemma_ranking', completed: lemmaCompleted, total: lemmaTotal,
      message: `Ranked ${lemmaCompleted.toLocaleString()} of ${lemmaTotal.toLocaleString()} Spanish lemmas.`,
      counts: { lemmas: lemmaTotal, senses: senseTotal },
      phaseTotals: {
        frequency_sources: scoreCount, source_inventory: sourceTotal,
        lemma_ranking: lemmaTotal, sense_ranking: senseTotal,
        saved_backfill: savedTotal, shared_backfill: sharedTotal,
        verification: 6, activation: 1,
      },
    });
  }
  await client.query('ANALYZE compact_lemma_rankings');

  // Wiktionary's stored lookup key intentionally preserves a small number of
  // compatibility characters that PostgreSQL's unaccent() expands (for
  // example smart quotes, inverted punctuation, œ, and ℆). Keep those rows on
  // a tiny exact-lemma side path so the indexed common path stays fast without
  // dropping any dictionary senses.
  await client.query(`
    CREATE TEMP TABLE catalog_wiktionary_key_exceptions ON COMMIT DROP AS
    SELECT id AS wiktionary_id, LOWER(BTRIM(word)) AS lemma_key
      FROM wiktionary
     WHERE lang = 'es' AND BTRIM(word) <> ''
       AND key IS DISTINCT FROM unaccent(LOWER(BTRIM(word)))
  `);
  await client.query(`
    CREATE UNIQUE INDEX catalog_wiktionary_key_exceptions_id
      ON catalog_wiktionary_key_exceptions (wiktionary_id)
  `);
  await client.query(`
    CREATE INDEX catalog_wiktionary_key_exceptions_lemma
      ON catalog_wiktionary_key_exceptions (lemma_key)
  `);
  await client.query('ANALYZE catalog_wiktionary_key_exceptions');

  let senseCompleted = 0;
  let lastLemmaRank = 0;
  await reportProgress({
    phase: 'sense_ranking', completed: 0, total: senseTotal,
    message: `Writing ${senseTotal.toLocaleString()} compact Spanish sense references without copying definitions.`,
    counts: { lemmas: lemmaTotal, senses: senseTotal },
    phaseTotals: {
      frequency_sources: scoreCount, source_inventory: sourceTotal,
      lemma_ranking: lemmaTotal, sense_ranking: senseTotal,
      saved_backfill: savedTotal, shared_backfill: sharedTotal,
      verification: 6, activation: 1,
    },
  });
  while (lastLemmaRank < lemmaTotal) {
    const upperLemmaRank = Math.min(lemmaTotal, lastLemmaRank + SENSE_LEMMA_BATCH_SIZE);
    const { rows: [batch] } = await client.query(
      `WITH selected AS (
         SELECT lemma_key, lemma_rank
           FROM compact_lemma_rankings
          WHERE catalog_version_id = $1 AND language = 'es'
            AND lemma_rank > $2 AND lemma_rank <= $3
       ), indexed_expanded AS (
         SELECT w.id AS wiktionary_id,
                (sense.ordinality - 1)::int AS sense_index,
                (gloss.ordinality - 1)::int AS gloss_index,
                selected.lemma_key,
                selected.lemma_rank
           FROM selected
           JOIN wiktionary w ON w.lang = 'es' AND w.key = unaccent(selected.lemma_key)
                            AND LOWER(BTRIM(w.word)) = selected.lemma_key
           CROSS JOIN LATERAL jsonb_array_elements(w.senses) WITH ORDINALITY sense(value, ordinality)
           CROSS JOIN LATERAL jsonb_array_elements_text(
             COALESCE(sense.value->'glosses', '[]'::jsonb)
          ) WITH ORDINALITY gloss(value, ordinality)
          WHERE BTRIM(gloss.value) <> ''
       ), exception_expanded AS (
         SELECT w.id AS wiktionary_id,
                (sense.ordinality - 1)::int AS sense_index,
                (gloss.ordinality - 1)::int AS gloss_index,
                selected.lemma_key,
                selected.lemma_rank
           FROM selected
           JOIN catalog_wiktionary_key_exceptions exception
             ON exception.lemma_key = selected.lemma_key
           JOIN wiktionary w ON w.id = exception.wiktionary_id
           CROSS JOIN LATERAL jsonb_array_elements(w.senses) WITH ORDINALITY sense(value, ordinality)
           CROSS JOIN LATERAL jsonb_array_elements_text(
             COALESCE(sense.value->'glosses', '[]'::jsonb)
           ) WITH ORDINALITY gloss(value, ordinality)
          WHERE BTRIM(gloss.value) <> ''
       ), expanded AS (
         SELECT * FROM indexed_expanded
         UNION ALL
         SELECT * FROM exception_expanded
       ), ordered AS (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY lemma_key
           ORDER BY wiktionary_id, sense_index, gloss_index
         )::int AS sense_order
           FROM expanded
       ), numbered AS (
           SELECT *, ($4::int + ROW_NUMBER() OVER (
             ORDER BY lemma_rank, wiktionary_id, sense_index, gloss_index
           ))::int AS sense_rank
           FROM ordered
       ), inserted AS (
         INSERT INTO compact_sense_rankings (
           catalog_version_id, wiktionary_id, sense_index,
           gloss_index, sense_order, sense_rank
         )
         SELECT $1, wiktionary_id, sense_index, gloss_index, sense_order, sense_rank
           FROM numbered
         RETURNING sense_rank
       )
       SELECT COUNT(*)::int AS inserted,
              COALESCE(MAX(sense_rank), $4)::bigint AS max_sense_rank
         FROM inserted`,
      [catalog.id, lastLemmaRank, upperLemmaRank, senseCompleted],
    );
    lastLemmaRank = upperLemmaRank;
    senseCompleted += Number(batch.inserted);
    await reportProgress({
      phase: 'sense_ranking', completed: senseCompleted, total: senseTotal,
      message: `Ranked ${senseCompleted.toLocaleString()} of ${senseTotal.toLocaleString()} Spanish senses.`,
      counts: { lemmas: lemmaTotal, senses: senseTotal, rankedSenses: senseCompleted },
      phaseTotals: {
        frequency_sources: scoreCount, source_inventory: sourceTotal,
        lemma_ranking: lemmaTotal, sense_ranking: senseTotal,
        saved_backfill: savedTotal, shared_backfill: sharedTotal,
        verification: 6, activation: 1,
      },
    });
  }
  await client.query('ANALYZE compact_sense_rankings');

  await client.query(`
    INSERT INTO catalog_provisional_lemmas (language, lemma_key, canonical_lemma)
    SELECT 'es', lemma_key, MIN(canonical_lemma)
      FROM (
        SELECT LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word))) AS lemma_key,
               BTRIM(COALESCE(NULLIF(lemma, ''), word)) AS canonical_lemma
          FROM saved_words WHERE target_language = 'es'
        UNION ALL
        SELECT LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word))),
               BTRIM(COALESCE(NULLIF(lemma, ''), word))
          FROM shared_dictionary_entries WHERE target_language = 'es'
      ) existing
     WHERE lemma_key <> ''
     GROUP BY lemma_key
    ON CONFLICT (language, lemma_key) DO UPDATE SET updated_at = NOW()
  `);
  await client.query(`
    INSERT INTO catalog_provisional_senses (
      lemma_id, part_of_speech, definition, definition_hash, sense_order
    )
    SELECT DISTINCT ON (pl.id, existing.part_of_speech, existing.definition_hash)
           pl.id, existing.part_of_speech, existing.definition,
           existing.definition_hash,
           ROW_NUMBER() OVER (PARTITION BY pl.id ORDER BY existing.part_of_speech, existing.definition_hash)::int
      FROM (
        SELECT LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word))) AS lemma_key,
               COALESCE(part_of_speech, '') AS part_of_speech,
               definition,
               encode(digest(LOWER(REGEXP_REPLACE(BTRIM(definition), '\\s+', ' ', 'g')), 'sha256'), 'hex') AS definition_hash
          FROM saved_words
         WHERE target_language = 'es' AND BTRIM(definition) <> ''
        UNION ALL
        SELECT LOWER(BTRIM(COALESCE(NULLIF(lemma, ''), word))),
               COALESCE(part_of_speech, ''), definition, definition_hash
          FROM shared_dictionary_entries
         WHERE target_language = 'es' AND BTRIM(definition) <> ''
      ) existing
      JOIN catalog_provisional_lemmas pl
        ON pl.language = 'es' AND pl.lemma_key = existing.lemma_key
     WHERE NOT EXISTS (
       SELECT 1
         FROM wiktionary w
         CROSS JOIN LATERAL jsonb_array_elements(w.senses) sense(value)
         CROSS JOIN LATERAL jsonb_array_elements_text(
           COALESCE(sense.value->'glosses', '[]'::jsonb)
         ) gloss(value)
        WHERE w.lang = 'es' AND w.key = unaccent(existing.lemma_key)
          AND LOWER(BTRIM(w.word)) = existing.lemma_key
          AND LOWER(w.pos) = LOWER(existing.part_of_speech)
          AND encode(digest(LOWER(REGEXP_REPLACE(BTRIM(gloss.value), '\\s+', ' ', 'g')), 'sha256'), 'hex') = existing.definition_hash
     )
    ON CONFLICT (lemma_id, part_of_speech, definition_hash) DO UPDATE SET updated_at = NOW()
  `);

  const maxSenseRank = senseCompleted;
  const { rowCount: savedUpdated } = await client.query(`
    WITH mapped AS (
      SELECT DISTINCT ON (sw.id)
             sw.id, lr.lemma_key, lr.canonical_lemma, lr.lemma_rank,
             lr.occurrences_per_billion, lr.frequency_band, lr.confidence, lr.sources,
             source_sense.wiktionary_id, source_sense.sense_index,
             source_sense.gloss_index, source_sense.sense_rank,
             provisional.id AS provisional_sense_id
        FROM saved_words sw
        JOIN compact_lemma_rankings lr
          ON lr.catalog_version_id = $1 AND lr.language = 'es'
         AND lr.lemma_key = LOWER(BTRIM(COALESCE(NULLIF(sw.lemma, ''), sw.word)))
        LEFT JOIN LATERAL (
          SELECT w.id AS wiktionary_id,
                 (sense.ordinality - 1)::int AS sense_index,
                 (gloss.ordinality - 1)::int AS gloss_index,
                 sr.sense_rank
            FROM wiktionary w
            CROSS JOIN LATERAL jsonb_array_elements(w.senses) WITH ORDINALITY sense(value, ordinality)
            CROSS JOIN LATERAL jsonb_array_elements_text(
              COALESCE(sense.value->'glosses', '[]'::jsonb)
            ) WITH ORDINALITY gloss(value, ordinality)
            JOIN compact_sense_rankings sr
              ON sr.catalog_version_id = $1 AND sr.wiktionary_id = w.id
             AND sr.sense_index = sense.ordinality - 1 AND sr.gloss_index = gloss.ordinality - 1
           WHERE w.lang = 'es' AND w.key = unaccent(lr.lemma_key)
             AND LOWER(BTRIM(w.word)) = lr.lemma_key
             AND LOWER(w.pos) = LOWER(COALESCE(sw.part_of_speech, ''))
             AND encode(digest(LOWER(REGEXP_REPLACE(BTRIM(gloss.value), '\\s+', ' ', 'g')), 'sha256'), 'hex') =
                 encode(digest(LOWER(REGEXP_REPLACE(BTRIM(sw.definition), '\\s+', ' ', 'g')), 'sha256'), 'hex')
           ORDER BY sr.sense_order, w.id
           LIMIT 1
        ) source_sense ON BTRIM(sw.definition) <> ''
        LEFT JOIN catalog_provisional_lemmas pl
          ON pl.language = 'es' AND pl.lemma_key = lr.lemma_key
        LEFT JOIN catalog_provisional_senses provisional
          ON provisional.lemma_id = pl.id
         AND provisional.part_of_speech = COALESCE(sw.part_of_speech, '')
         AND provisional.definition_hash = encode(digest(LOWER(REGEXP_REPLACE(BTRIM(sw.definition), '\\s+', ' ', 'g')), 'sha256'), 'hex')
         AND source_sense.wiktionary_id IS NULL
       WHERE sw.target_language = 'es'
       ORDER BY sw.id, source_sense.sense_rank, provisional.id
    )
    UPDATE saved_words sw
       SET word = mapped.canonical_lemma,
           lemma = mapped.canonical_lemma,
           catalog_lemma_key = mapped.lemma_key,
           catalog_wiktionary_id = mapped.wiktionary_id,
           catalog_sense_index = mapped.sense_index,
           catalog_gloss_index = mapped.gloss_index,
           catalog_provisional_sense_id = mapped.provisional_sense_id,
           rank_version_id = $1,
           lemma_frequency_rank = mapped.lemma_rank,
           sense_rank = COALESCE(mapped.sense_rank, $2::bigint + mapped.provisional_sense_id),
           lemma_occurrences_per_billion = mapped.occurrences_per_billion,
           frequency_count = mapped.occurrences_per_billion,
           frequency = mapped.frequency_band,
           frequency_confidence = mapped.confidence,
           frequency_sources = mapped.sources
      FROM mapped
     WHERE sw.id = mapped.id
  `, [catalog.id, maxSenseRank]);
  await reportProgress({
    phase: 'saved_backfill', completed: savedUpdated || 0, total: savedTotal,
    message: `Backfilled ${savedUpdated || 0} of ${savedTotal} existing Spanish saved words.`,
    counts: { savedWords: savedTotal, savedWordsBackfilled: savedUpdated || 0 },
    phaseTotals: {
      frequency_sources: scoreCount, source_inventory: sourceTotal,
      lemma_ranking: lemmaTotal, sense_ranking: senseTotal,
      saved_backfill: savedTotal, shared_backfill: sharedTotal,
      verification: 6, activation: 1,
    },
  });

  const { rowCount: sharedUpdated } = await client.query(`
    WITH mapped AS (
      SELECT DISTINCT ON (shared.id)
             shared.id, lr.lemma_key, lr.lemma_rank,
             lr.occurrences_per_billion, lr.frequency_band, lr.confidence, lr.sources,
             source_sense.wiktionary_id, source_sense.sense_index,
             source_sense.gloss_index, source_sense.sense_rank,
             provisional.id AS provisional_sense_id
        FROM shared_dictionary_entries shared
        JOIN compact_lemma_rankings lr
          ON lr.catalog_version_id = $1 AND lr.language = 'es'
         AND lr.lemma_key = LOWER(BTRIM(COALESCE(NULLIF(shared.lemma, ''), shared.word)))
        LEFT JOIN LATERAL (
          SELECT w.id AS wiktionary_id,
                 (sense.ordinality - 1)::int AS sense_index,
                 (gloss.ordinality - 1)::int AS gloss_index,
                 sr.sense_rank
            FROM wiktionary w
            CROSS JOIN LATERAL jsonb_array_elements(w.senses) WITH ORDINALITY sense(value, ordinality)
            CROSS JOIN LATERAL jsonb_array_elements_text(
              COALESCE(sense.value->'glosses', '[]'::jsonb)
            ) WITH ORDINALITY gloss(value, ordinality)
            JOIN compact_sense_rankings sr
              ON sr.catalog_version_id = $1 AND sr.wiktionary_id = w.id
             AND sr.sense_index = sense.ordinality - 1 AND sr.gloss_index = gloss.ordinality - 1
           WHERE w.lang = 'es' AND w.key = unaccent(lr.lemma_key)
             AND LOWER(BTRIM(w.word)) = lr.lemma_key
             AND LOWER(w.pos) = LOWER(COALESCE(shared.part_of_speech, ''))
             AND encode(digest(LOWER(REGEXP_REPLACE(BTRIM(gloss.value), '\\s+', ' ', 'g')), 'sha256'), 'hex') = shared.definition_hash
           ORDER BY sr.sense_order, w.id
           LIMIT 1
        ) source_sense ON BTRIM(shared.definition) <> ''
        LEFT JOIN catalog_provisional_lemmas pl
          ON pl.language = 'es' AND pl.lemma_key = lr.lemma_key
        LEFT JOIN catalog_provisional_senses provisional
          ON provisional.lemma_id = pl.id
         AND provisional.part_of_speech = COALESCE(shared.part_of_speech, '')
         AND provisional.definition_hash = shared.definition_hash
         AND source_sense.wiktionary_id IS NULL
       WHERE shared.target_language = 'es'
       ORDER BY shared.id, source_sense.sense_rank, provisional.id
    )
    UPDATE shared_dictionary_entries shared
       SET catalog_lemma_key = mapped.lemma_key,
           catalog_wiktionary_id = mapped.wiktionary_id,
           catalog_sense_index = mapped.sense_index,
           catalog_gloss_index = mapped.gloss_index,
           catalog_provisional_sense_id = mapped.provisional_sense_id,
           rank_version_id = $1,
           lemma_frequency_rank = mapped.lemma_rank,
           sense_rank = COALESCE(mapped.sense_rank, $2::bigint + mapped.provisional_sense_id),
           lemma_occurrences_per_billion = mapped.occurrences_per_billion,
           frequency_count = mapped.occurrences_per_billion,
           frequency = mapped.frequency_band,
           frequency_confidence = mapped.confidence,
           frequency_sources = mapped.sources
      FROM mapped
     WHERE shared.id = mapped.id
  `, [catalog.id, maxSenseRank]);
  await reportProgress({
    phase: 'shared_backfill', completed: sharedUpdated || 0, total: sharedTotal,
    message: `Backfilled ${sharedUpdated || 0} of ${sharedTotal} shared Spanish entries.`,
    counts: { sharedEntries: sharedTotal, sharedEntriesBackfilled: sharedUpdated || 0 },
    phaseTotals: {
      frequency_sources: scoreCount, source_inventory: sourceTotal,
      lemma_ranking: lemmaTotal, sense_ranking: senseTotal,
      saved_backfill: savedTotal, shared_backfill: sharedTotal,
      verification: 6, activation: 1,
    },
  });

  const { rows: [catalogCounts] } = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM compact_lemma_rankings WHERE catalog_version_id = $1 AND language = 'es') AS lemmas,
      (SELECT COUNT(DISTINCT lemma_rank)::int FROM compact_lemma_rankings WHERE catalog_version_id = $1 AND language = 'es') AS unique_lemma_ranks,
      (SELECT COUNT(*)::bigint FROM compact_sense_rankings WHERE catalog_version_id = $1) AS senses,
      (SELECT COUNT(DISTINCT sense_rank)::bigint FROM compact_sense_rankings WHERE catalog_version_id = $1) AS unique_sense_ranks
  `, [catalog.id]);
  const { rows: [savedWordBackfill] } = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE catalog_lemma_key IS NOT NULL AND lemma_frequency_rank IS NOT NULL)::int AS ranked,
           COUNT(*) FILTER (WHERE BTRIM(COALESCE(definition, '')) <> '')::int AS defined_total,
           COUNT(*) FILTER (WHERE BTRIM(COALESCE(definition, '')) <> '' AND
             (catalog_wiktionary_id IS NOT NULL OR catalog_provisional_sense_id IS NOT NULL))::int AS defined_sense_linked,
           COUNT(*) FILTER (WHERE rank_version_id = $1)::int AS catalog_version_linked
      FROM saved_words WHERE target_language = 'es'
  `, [catalog.id]);
  const { rows: [sharedEntryBackfill] } = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE catalog_lemma_key IS NOT NULL AND lemma_frequency_rank IS NOT NULL)::int AS ranked,
           COUNT(*) FILTER (WHERE BTRIM(COALESCE(definition, '')) <> '')::int AS defined_total,
           COUNT(*) FILTER (WHERE BTRIM(COALESCE(definition, '')) <> '' AND
             (catalog_wiktionary_id IS NOT NULL OR catalog_provisional_sense_id IS NOT NULL))::int AS defined_sense_linked,
           COUNT(*) FILTER (WHERE rank_version_id = $1)::int AS catalog_version_linked
      FROM shared_dictionary_entries WHERE target_language = 'es'
  `, [catalog.id]);
  const checks = [
    Number(catalogCounts.lemmas) === lemmaTotal,
    Number(catalogCounts.unique_lemma_ranks) === lemmaTotal,
    Number(catalogCounts.senses) === senseTotal,
    Number(catalogCounts.unique_sense_ranks) === senseTotal,
    savedWordBackfill.ranked === savedWordBackfill.total
      && savedWordBackfill.defined_sense_linked === savedWordBackfill.defined_total
      && savedWordBackfill.catalog_version_linked === savedWordBackfill.total,
    sharedEntryBackfill.ranked === sharedEntryBackfill.total
      && sharedEntryBackfill.defined_sense_linked === sharedEntryBackfill.defined_total
      && sharedEntryBackfill.catalog_version_linked === sharedEntryBackfill.total,
  ];
  for (let index = 0; index < checks.length; index += 1) {
    await reportProgress({
      phase: 'verification', completed: index + 1, total: checks.length,
      message: `Completed catalog integrity check ${index + 1} of ${checks.length}.`,
      counts: { catalogCounts, savedWordBackfill, sharedEntryBackfill },
      phaseTotals: {
        frequency_sources: scoreCount, source_inventory: sourceTotal,
        lemma_ranking: lemmaTotal, sense_ranking: senseTotal,
        saved_backfill: savedTotal, shared_backfill: sharedTotal,
        verification: checks.length, activation: 1,
      },
    });
    if (!checks[index]) {
      const diagnostic = {
        code: 'compact_catalog_verification_failed',
        severity: 'error',
        title: 'Compact catalog verification failed',
        message: `Spanish catalog integrity check ${index + 1} failed. The build will roll back and remain visibly failed.`,
        source: 'server.catalog-builder',
        operation: 'verify-compact-catalog',
        pipeline: 'catalog_build',
        stage: 'verification',
        language: BUILD_LANGUAGE,
        occurredAt: new Date().toISOString(),
        detail: JSON.stringify({ catalogCounts, savedWordBackfill, sharedEntryBackfill }),
      };
      console.error(JSON.stringify(diagnostic));
      throw Object.assign(new Error(diagnostic.message), { diagnostic });
    }
  }

  await reportProgress({
    phase: 'activation', completed: 0, total: 1,
    message: 'Committing the verified Spanish catalog atomically.',
    counts: { catalogCounts, savedWordBackfill, sharedEntryBackfill },
    phaseTotals: {
      frequency_sources: scoreCount, source_inventory: sourceTotal,
      lemma_ranking: lemmaTotal, sense_ranking: senseTotal,
      saved_backfill: savedTotal, shared_backfill: sharedTotal,
      verification: checks.length, activation: 1,
    },
  });
  if (activate) await client.query(`UPDATE frequency_catalog_versions SET status = 'retired' WHERE status = 'active'`);
  await client.query(
    `UPDATE frequency_catalog_versions
        SET status = $2, source_manifest = $3::jsonb, diagnostics = $4::jsonb,
            built_at = NOW(), activated_at = CASE WHEN $2 = 'active' THEN NOW() ELSE NULL END
      WHERE id = $1`,
    [catalog.id, activate ? 'active' : 'retired', JSON.stringify(manifest), JSON.stringify(diagnostics)],
  );
  await client.query('COMMIT');
  await linkCatalogBuildVersion({ db: progressPool, runId, catalogVersionId: catalog.id });
  await reportProgress({
    phase: 'activation', completed: 1, total: 1, status: 'succeeded',
    message: `Spanish compact catalog ${activate ? 'activated' : 'built'} successfully.`,
    counts: { catalogCounts, savedWordBackfill, sharedEntryBackfill },
    phaseTotals: {
      frequency_sources: scoreCount, source_inventory: sourceTotal,
      lemma_ranking: lemmaTotal, sense_ranking: senseTotal,
      saved_backfill: savedTotal, shared_backfill: sharedTotal,
      verification: checks.length, activation: 1,
    },
  });
  console.log(JSON.stringify({
    event: 'compact_spanish_frequency_catalog_built', version,
    status: activate ? 'active' : 'retired', runId,
    scoreCount, sourceCount: manifest.length, catalogCounts,
    backfill: { savedWords: savedWordBackfill, sharedEntries: sharedEntryBackfill },
    diagnostics,
  }));
} catch (error) {
  if (client) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      console.error(JSON.stringify({
        event: 'compact_catalog_rollback_failed', severity: 'error',
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      }));
    }
  }
  const diagnostic = error.diagnostic || {
    code: 'compact_catalog_build_failed',
    severity: 'error',
    title: 'Compact Spanish catalog build failed',
    message: 'The compact Spanish catalog transaction rolled back. No partial ranking was activated.',
    source: 'server.catalog-builder',
    operation: 'build-compact-catalog',
    pipeline: 'catalog_build',
    stage: currentPhase,
    language: BUILD_LANGUAGE,
    occurredAt: new Date().toISOString(),
    detail: error instanceof Error ? error.message : String(error),
  };
  console.error(JSON.stringify(diagnostic));
  if (runId) {
    try {
      await reportProgress({
        phase: currentPhase, completed: 0, total: null, status: 'rolled_back',
        message: diagnostic.message, diagnostic,
      });
    } catch (progressError) {
      console.error(JSON.stringify({
        event: 'catalog_progress_failure_not_persisted', severity: 'error',
        originalDiagnostic: diagnostic,
        error: progressError instanceof Error ? progressError.message : String(progressError),
      }));
    }
  }
  throw error;
} finally {
  client?.release();
  await Promise.allSettled([pool.end(), progressPool.end()]);
}
