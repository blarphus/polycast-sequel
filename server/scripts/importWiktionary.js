/**
 * Import preprocessed Wiktionary JSONL.gz files into the wiktionary table.
 *
 * Usage:  node server/scripts/importWiktionary.js ~/Desktop/wiktionary-test/
 *
 * Requires DATABASE_URL in root .env (or pass via environment).
 * Discovers *-senses.jsonl.gz files, extracts lang code from filename.
 * Idempotent: deletes existing rows for each language before importing.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.join(path.dirname(__filename), '..', '..', '.env') });

const { Pool } = pg;

const BATCH_SIZE = 1000;
const LOG_EVERY = 50_000;

async function importFile(pool, filePath, lang) {
  console.log(`\nImporting ${path.basename(filePath)} (lang=${lang})...`);

  // Delete existing rows for this language (idempotent re-runs)
  const { rowCount: deleted } = await pool.query('DELETE FROM wiktionary WHERE lang = $1', [lang]);
  if (deleted > 0) console.log(`  Deleted ${deleted} existing rows for lang=${lang}`);

  const gunzip = createGunzip();
  const rl = createInterface({ input: createReadStream(filePath).pipe(gunzip) });

  let batch = [];
  let total = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    const entry = JSON.parse(line);
    batch.push(entry);

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(pool, lang, batch);
      total += batch.length;
      batch = [];
      if (total % LOG_EVERY === 0) {
        console.log(`  ${total.toLocaleString()} rows...`);
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await insertBatch(pool, lang, batch);
    total += batch.length;
  }

  console.log(`  Done: ${total.toLocaleString()} rows imported for lang=${lang}`);
  return total;
}

async function insertBatch(pool, lang, rows) {
  // Build a multi-row INSERT with parameterized values
  const values = [];
  const placeholders = [];
  let idx = 1;

  for (const row of rows) {
    const forms = Array.isArray(row.forms) && row.forms.length > 0 ? row.forms : null;
    const translations = Array.isArray(row.translations) && row.translations.length > 0
      ? JSON.stringify(row.translations)
      : null;

    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`);
    values.push(
      lang,
      row.key,
      row.word,
      row.pos,
      JSON.stringify(row.senses),
      forms,
      translations,
    );
    idx += 7;
  }

  await pool.query(
    `INSERT INTO wiktionary (lang, key, word, pos, senses, forms, translations) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node server/scripts/importWiktionary.js <directory>');
    process.exit(1);
  }

  const absDir = path.resolve(dir);
  const files = fs.readdirSync(absDir).filter(f => f.endsWith('-senses.jsonl.gz')).sort();

  if (files.length === 0) {
    console.error(`No *-senses.jsonl.gz files found in ${absDir}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} files: ${files.join(', ')}`);

  const poolConfig = { connectionString: process.env.DATABASE_URL };
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('render.com')) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  const pool = new Pool(poolConfig);

  let grandTotal = 0;
  for (const file of files) {
    const lang = file.split('-')[0]; // e.g. "es" from "es-senses.jsonl.gz"
    grandTotal += await importFile(pool, path.join(absDir, file), lang);
  }

  console.log(`\nRunning ANALYZE wiktionary...`);
  await pool.query('ANALYZE wiktionary');

  console.log(`\nAll done! ${grandTotal.toLocaleString()} total rows imported.`);
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
