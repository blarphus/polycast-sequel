/**
 * Backfill saved_words.sentence_translation for cards that have an example
 * sentence but no native-language sentence translation.
 *
 * Usage:
 *   node server/scripts/backfillSentenceTranslations.js
 *   node server/scripts/backfillSentenceTranslations.js --dry-run
 *   node server/scripts/backfillSentenceTranslations.js --limit=25
 *   node server/scripts/backfillSentenceTranslations.js --concurrency=2
 *
 * Requires DATABASE_URL and GEMINI_API_KEY. Loads the root .env when run locally.
 */

import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { callGemini, parseGeminiJson } from '../lib/gemini.js';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.join(path.dirname(__filename), '..', '..', '.env') });

const { Pool } = pg;

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const dryRun = process.argv.includes('--dry-run');
const limit = Number.parseInt(argValue('limit', '0'), 10) || 0;
const concurrency = Math.max(1, Number.parseInt(argValue('concurrency', '1'), 10) || 1);
const passes = Math.max(1, Number.parseInt(argValue('passes', '2'), 10) || 2);

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY');
  process.exit(1);
}

const poolConfig = { connectionString: process.env.DATABASE_URL };
if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('render.com')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function progressBar(completed, total, width = 28) {
  if (total === 0) return `[${'-'.repeat(width)}]`;
  const filled = Math.min(width, Math.round((completed / total) * width));
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

function renderProgress({ completed, total, updated, failed, skipped, startedAt }) {
  const elapsed = Date.now() - startedAt;
  const avg = completed > 0 ? elapsed / completed : 0;
  const eta = completed > 0 ? avg * (total - completed) : Number.NaN;
  const pct = total > 0 ? ((completed / total) * 100).toFixed(1) : '100.0';
  const line = `${progressBar(completed, total)} ${completed}/${total} ${pct}% | updated ${updated} | failed ${failed} | skipped ${skipped} | elapsed ${formatDuration(elapsed)} | ETA ${formatDuration(eta)}`;

  if (process.stdout.isTTY) {
    process.stdout.write(`\r${line}`);
    if (completed === total) process.stdout.write('\n');
  } else {
    console.log(line);
  }
}

function buildPrompt(row) {
  const nativeLang = row.native_language || 'en';
  const targetLang = row.target_language || 'target language';
  return `Translate this ${targetLang} flashcard example sentence into ${nativeLang}.

The target word or inflected form is wrapped in tildes in the source sentence. In your translation, wrap only the natural ${nativeLang} equivalent of that marked word or phrase in tildes.

Return ONLY JSON with exactly this key:
{"sentence_translation":"..."}

Source sentence: ${row.example_sentence}
Target word: ${row.word}`;
}

async function generateSentenceTranslation(row) {
  const raw = await callGemini(
    buildPrompt(row),
    {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 160,
      responseMimeType: 'application/json',
    },
  );
  const parsed = parseGeminiJson(raw, `Sentence translation backfill for ${row.word}`);
  const sentenceTranslation = String(parsed.sentence_translation || '').trim();
  if (!sentenceTranslation) {
    throw new Error('Gemini returned an empty sentence_translation');
  }
  return sentenceTranslation;
}

async function getMissingRows() {
  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';
  const { rows } = await pool.query(`
    SELECT
      sw.id,
      sw.word,
      sw.target_language,
      sw.example_sentence,
      COALESCE(NULLIF(u.native_language, ''), 'en') AS native_language
    FROM saved_words sw
    LEFT JOIN users u ON u.id = sw.user_id
    WHERE NULLIF(BTRIM(sw.example_sentence), '') IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(sw.sentence_translation, '')), '') IS NULL
    ORDER BY sw.created_at ASC, sw.id ASC
    ${limitClause}
  `);
  return rows;
}

async function processRow(row) {
  const sentenceTranslation = await generateSentenceTranslation(row);
  if (dryRun) {
    return { status: 'skipped', sentenceTranslation };
  }

  await pool.query(
    'UPDATE saved_words SET sentence_translation = $1 WHERE id = $2',
    [sentenceTranslation, row.id],
  );
  return { status: 'updated', sentenceTranslation };
}

async function worker(rows, state, startedAt) {
  while (true) {
    const index = state.nextIndex++;
    if (index >= rows.length) return;

    const row = rows[index];
    try {
      const result = await processRow(row);
      if (result.status === 'updated') state.updated++;
      else state.skipped++;
      console.log(`${result.status.toUpperCase()} ${row.word}: ${result.sentenceTranslation}`);
    } catch (err) {
      state.failed++;
      console.error(`FAILED ${row.word} (${row.id}): ${err.message}`);
    } finally {
      state.completed++;
      renderProgress({ ...state, total: rows.length, startedAt });
    }
  }
}

async function runPass(pass) {
  const rows = await getMissingRows();
  console.log(`Pass ${pass}/${passes}: missing sentence translations: ${rows.length}`);
  console.log(`Mode: ${dryRun ? 'dry run' : 'update'} | concurrency: ${concurrency}${limit > 0 ? ` | limit: ${limit}` : ''}`);

  if (rows.length === 0) {
    return { found: 0, updated: 0, failed: 0, skipped: 0 };
  }

  const state = {
    nextIndex: 0,
    completed: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
  };
  const startedAt = Date.now();
  renderProgress({ ...state, total: rows.length, startedAt });

  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, () => worker(rows, state, startedAt)),
  );

  console.log(`Pass ${pass} done. Updated: ${state.updated}. Failed: ${state.failed}. Skipped: ${state.skipped}.`);
  return { found: rows.length, ...state };
}

async function main() {
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (let pass = 1; pass <= passes; pass++) {
    const result = await runPass(pass);
    totalUpdated += result.updated;
    totalFailed += result.failed;
    totalSkipped += result.skipped;
    if (result.found === 0 || dryRun || limit > 0) break;
  }

  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS remaining
    FROM saved_words
    WHERE NULLIF(BTRIM(example_sentence), '') IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(sentence_translation, '')), '') IS NULL
  `);

  console.log(`Done. Updated: ${totalUpdated}. Failed: ${totalFailed}. Skipped: ${totalSkipped}. Remaining missing: ${rows[0].remaining}.`);
}

try {
  await main();
} finally {
  await pool.end();
}
