/** Back up and remove records for languages outside Polycast's six-language contract. */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { FREQUENCY_LANGUAGES } from '../lib/frequencyCatalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(root, '.env') });
const args = new Set(process.argv.slice(2));
const backupIndex = process.argv.indexOf('--backup');
const backupPath = backupIndex >= 0 ? path.resolve(process.argv[backupIndex + 1]) : null;
const confirmed = args.has('--confirm');
if (confirmed && !backupPath) throw new Error('--backup <path> is required with --confirm');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('render.com')
    ? { ssl: { rejectUnauthorized: false } } : {}),
});
const client = await pool.connect();
const supported = FREQUENCY_LANGUAGES;
const quoted = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const unsupportedPredicate = (columns, alias = '') => columns.map((column) => {
  const field = `${alias}${quoted(column)}`;
  return `(NULLIF(BTRIM(${field}::text), '') IS NOT NULL
           AND SPLIT_PART(LOWER(${field}::text), '-', 1) <> ALL($1))`;
}).join(' OR ');

async function writeLine(stream, value) {
  if (!stream.write(`${JSON.stringify(value)}\n`)) await once(stream, 'drain');
}

async function streamBackupRows(stream, table, columns) {
  let afterCtid = null;
  let count = 0;
  const predicate = unsupportedPredicate(columns, 'source.');
  while (true) {
    const { rows } = await client.query(
      `SELECT source.ctid::text AS backup_ctid, to_jsonb(source) AS row_data
         FROM ${quoted(table)} source
        WHERE (${predicate})
          AND ($2::text IS NULL OR source.ctid > $2::tid)
        ORDER BY source.ctid
        LIMIT 500`,
      [supported, afterCtid],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      await writeLine(stream, { type: 'row', table, row: row.row_data });
    }
    count += rows.length;
    afterCtid = rows.at(-1).backup_ctid;
  }
  return count;
}

let backupStream = null;
try {
  const { rows: columns } = await client.query(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name IN ('target_language', 'native_language', 'language', 'lang')
       AND table_name NOT IN ('schema_migrations')
     ORDER BY table_name, column_name
  `);
  const columnsByTable = new Map();
  for (const { table_name: table, column_name: column } of columns) {
    const existing = columnsByTable.get(table) || [];
    existing.push(column);
    columnsByTable.set(table, existing);
  }

  const affected = {};
  for (const [table, tableColumns] of columnsByTable) {
    const { rows: [result] } = await client.query(
      `SELECT COUNT(*)::bigint AS count
         FROM ${quoted(table)}
        WHERE ${unsupportedPredicate(tableColumns)}`,
      [supported],
    );
    if (Number(result.count) > 0) affected[table] = Number(result.count);
  }
  console.log(JSON.stringify({ confirmed, backupPath, supported, affected }, null, 2));
  if (!confirmed) process.exit(0);

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  backupStream = fs.createWriteStream(backupPath, { encoding: 'utf8', mode: 0o600, flags: 'wx' });
  await writeLine(backupStream, {
    type: 'manifest',
    format: 'polycast-unsupported-language-backup-v1',
    createdAt: new Date().toISOString(),
    supported,
    affected,
  });
  const backedUp = {};
  for (const [table, tableColumns] of columnsByTable) {
    if (!affected[table]) continue;
    backedUp[table] = await streamBackupRows(backupStream, table, tableColumns);
  }
  backupStream.end();
  await once(backupStream, 'finish');
  backupStream = null;
  for (const [table, count] of Object.entries(affected)) {
    if (backedUp[table] !== count) {
      throw new Error(`Backup row-count mismatch for ${table}: expected ${count}, wrote ${backedUp[table] || 0}`);
    }
  }

  await client.query('BEGIN');
  await client.query(
    `UPDATE users SET
       target_language = CASE WHEN SPLIT_PART(LOWER(COALESCE(target_language, '')), '-', 1) = ANY($1) THEN target_language ELSE NULL END,
       native_language = CASE WHEN SPLIT_PART(LOWER(COALESCE(native_language, '')), '-', 1) = ANY($1) THEN native_language ELSE NULL END
     WHERE ${unsupportedPredicate(['target_language', 'native_language'])}`,
    [supported],
  );
  // Child-heavy tables are attempted first; FK cascades handle the remainder.
  for (const [table, tableColumns] of [...columnsByTable].reverse()) {
    if (table === 'users' || !affected[table]) continue;
    await client.query(
      `DELETE FROM ${quoted(table)} WHERE ${unsupportedPredicate(tableColumns)}`,
      [supported],
    );
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({
    event: 'unsupported_language_data_purged',
    backupPath,
    backedUp,
    removed: affected,
  }));
} catch (error) {
  if (backupStream) {
    backupStream.destroy();
    backupStream = null;
  }
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    console.error(JSON.stringify({
      code: 'unsupported_language_purge_rollback_failed',
      severity: 'error',
      pipeline: 'unsupported_language_purge',
      stage: 'rollback',
      message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
    }));
  }
  throw error;
} finally {
  client.release();
  await pool.end();
}
