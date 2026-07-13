import crypto from 'node:crypto';
import pool from '../db.js';

export const CATALOG_PROGRESS_PHASES = Object.freeze([
  'frequency_sources',
  'source_inventory',
  'lemma_ranking',
  'sense_ranking',
  'saved_backfill',
  'shared_backfill',
  'verification',
  'activation',
]);

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'rolled_back']);

function asCount(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function calculateProgress(phases, startedAt) {
  let completed = 0;
  let total = 0;
  let exact = true;
  for (const phase of CATALOG_PROGRESS_PHASES) {
    const snapshot = phases[phase];
    if (!snapshot || snapshot.total == null) {
      exact = false;
      continue;
    }
    total += snapshot.total;
    completed += Math.min(snapshot.completed || 0, snapshot.total);
  }
  if (!exact || total <= 0) return { completed, total: null, throughput: null, etaSeconds: null };
  const elapsedSeconds = Math.max(1, (Date.now() - new Date(startedAt).getTime()) / 1000);
  const throughput = completed > 0 ? completed / elapsedSeconds : null;
  const etaSeconds = throughput && completed < total ? Math.ceil((total - completed) / throughput) : 0;
  return { completed, total, throughput, etaSeconds };
}

export async function createCatalogBuildRun({
  db = pool,
  version,
  languages,
}) {
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO frequency_catalog_build_runs (
       id, version, status, requested_languages, current_language, current_phase,
       message, started_at, heartbeat_at
     ) VALUES ($1, $2, 'running', $3::jsonb, $4, 'frequency_sources',
               'Loading saved frequency sources.', $5, $5)`,
    [runId, version, JSON.stringify(languages), languages[0] || null, now],
  );
  for (let index = 0; index < languages.length; index += 1) {
    await db.query(
      `INSERT INTO frequency_catalog_language_progress (
         build_id, language, sequence, status, phase, message,
         phase_started_at, heartbeat_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [
        runId,
        languages[index],
        index,
        index === 0 ? 'running' : 'queued',
        index === 0 ? 'frequency_sources' : 'queued',
        index === 0 ? 'Loading saved frequency sources.' : 'Waiting for the preceding language.',
        now,
      ],
    );
  }
  return runId;
}

export async function updateCatalogBuildProgress({
  db = pool,
  runId,
  language,
  phase,
  completed,
  total,
  status = 'running',
  message,
  counts = {},
  phaseTotals = {},
  diagnostic = null,
}) {
  const { rows: [row] } = await db.query(
    `SELECT phases, diagnostics, phase, phase_started_at, created_at AS started_at
       FROM frequency_catalog_language_progress
      WHERE build_id = $1 AND language = $2`,
    [runId, language],
  );
  if (!row) throw new Error(`Missing catalog progress row for ${runId}/${language}`);

  const now = new Date();
  const phases = row.phases || {};
  for (const [phaseName, phaseTotal] of Object.entries(phaseTotals)) {
    phases[phaseName] = {
      status: phases[phaseName]?.status || 'queued',
      completed: phases[phaseName]?.completed || 0,
      total: asCount(phaseTotal),
      ...(phases[phaseName] || {}),
    };
    phases[phaseName].total = asCount(phaseTotal);
  }

  const phaseChanged = row.phase !== phase;
  if (phaseChanged && CATALOG_PROGRESS_PHASES.includes(row.phase) && phases[row.phase]) {
    phases[row.phase] = {
      ...phases[row.phase],
      status: 'succeeded',
      completed: phases[row.phase].total ?? phases[row.phase].completed ?? 0,
      completedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }
  const phaseStartedAt = phaseChanged || !row.phase_started_at ? now : new Date(row.phase_started_at);
  const phaseCompleted = asCount(completed) || 0;
  const phaseTotal = asCount(total);
  const elapsedSeconds = Math.max(1, (now.getTime() - phaseStartedAt.getTime()) / 1000);
  const phaseThroughput = phaseCompleted > 0 ? phaseCompleted / elapsedSeconds : null;
  const phaseEtaSeconds = phaseTotal != null && phaseThroughput && phaseCompleted < phaseTotal
    ? Math.ceil((phaseTotal - phaseCompleted) / phaseThroughput)
    : phaseTotal != null && phaseCompleted >= phaseTotal ? 0 : null;
  phases[phase] = {
    ...(phases[phase] || {}),
    status,
    completed: phaseCompleted,
    total: phaseTotal,
    throughputPerSecond: phaseThroughput,
    etaSeconds: phaseEtaSeconds,
    startedAt: phaseStartedAt.toISOString(),
    updatedAt: now.toISOString(),
    ...(TERMINAL_STATUSES.has(status) || (phaseTotal != null && phaseCompleted >= phaseTotal)
      ? { completedAt: now.toISOString() }
      : {}),
  };
  const overall = calculateProgress(phases, row.started_at);
  const diagnostics = [...(row.diagnostics || [])];
  if (diagnostic) diagnostics.push(diagnostic);

  await db.query(
    `UPDATE frequency_catalog_language_progress
        SET status = $3, phase = $4, phase_completed = $5, phase_total = $6,
            overall_completed = $7, overall_total = $8,
            throughput_per_second = $9, eta_seconds = $10,
            counts = counts || $11::jsonb, phases = $12::jsonb,
            diagnostics = $13::jsonb, message = $14,
            phase_started_at = $15::timestamptz, heartbeat_at = $16::timestamptz,
            completed_at = CASE WHEN $3 = ANY($17::text[]) THEN $16::timestamptz ELSE NULL END,
            updated_at = $16::timestamptz
      WHERE build_id = $1 AND language = $2`,
    [
      runId, language, status, phase, phaseCompleted, phaseTotal,
      overall.completed, overall.total, overall.throughput, overall.etaSeconds,
      JSON.stringify(counts), JSON.stringify(phases), JSON.stringify(diagnostics),
      message || null, phaseStartedAt, now, [...TERMINAL_STATUSES],
    ],
  );
  await db.query(
    `UPDATE frequency_catalog_build_runs
        SET status = $2, current_language = $3, current_phase = $4,
            message = $5, heartbeat_at = $6::timestamptz,
            completed_at = CASE WHEN $2 = ANY($7::text[]) THEN $6::timestamptz ELSE NULL END,
            diagnostics = CASE WHEN $8::jsonb IS NULL THEN diagnostics ELSE diagnostics || $8::jsonb END,
            updated_at = $6::timestamptz
      WHERE id = $1`,
    [
      runId, status, language, phase, message || null, now,
      [...TERMINAL_STATUSES], diagnostic ? JSON.stringify([diagnostic]) : null,
    ],
  );
}

export async function linkCatalogBuildVersion({ db = pool, runId, catalogVersionId }) {
  await db.query(
    `UPDATE frequency_catalog_build_runs SET catalog_version_id = $2, updated_at = NOW() WHERE id = $1`,
    [runId, catalogVersionId],
  );
}

export async function getLatestCatalogBuildProgress({ db = pool } = {}) {
  const { rows: [run] } = await db.query(
    `SELECT * FROM frequency_catalog_build_runs ORDER BY created_at DESC LIMIT 1`,
  );
  if (!run) return { build: null, languages: [], stale: false };
  const { rows: languages } = await db.query(
    `SELECT * FROM frequency_catalog_language_progress WHERE build_id = $1 ORDER BY sequence`,
    [run.id],
  );
  const heartbeat = run.heartbeat_at ? new Date(run.heartbeat_at).getTime() : 0;
  const stale = run.status === 'running' && Date.now() - heartbeat > 90_000;
  const diagnostics = [...(run.diagnostics || [])];
  if (stale) {
    diagnostics.push({
      code: 'catalog_build_heartbeat_stale',
      severity: 'error',
      title: 'Catalog build heartbeat is stale',
      message: 'The catalog build stopped reporting progress. Its last confirmed state remains visible below.',
      source: 'server.catalog-progress',
      operation: 'read-build-progress',
      pipeline: 'catalog_build',
      stage: run.current_phase || 'unknown',
      occurredAt: new Date().toISOString(),
      detail: `lastHeartbeat=${run.heartbeat_at || 'never'}`,
    });
  }
  return { build: { ...run, diagnostics }, languages, stale };
}
