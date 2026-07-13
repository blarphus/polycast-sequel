import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getFrequencyCatalogProgress,
  type CatalogBuildDiagnostic,
  type CatalogBuildProgressResponse,
  type CatalogLanguageProgress,
  type CatalogPhaseProgress,
} from '../api/frequencyCatalog';
import { ChevronLeftIcon } from '../components/icons';
import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';
import '../styles/catalogProgress.css';

const runtimeLog = createScopedRuntimeLogger('web.pages.catalog-progress');
const PHASES = [
  ['frequency_sources', 'Frequency sources'],
  ['source_inventory', 'Source inventory'],
  ['lemma_ranking', 'Lemma ranking'],
  ['sense_ranking', 'Sense ranking'],
  ['saved_backfill', 'Saved-word backfill'],
  ['shared_backfill', 'Shared-entry backfill'],
  ['verification', 'Integrity verification'],
  ['activation', 'Atomic activation'],
] as const;

const COUNT_LABELS: Record<string, string> = {
  frequencySourceCount: 'Frequency sources',
  frequencyScoreCount: 'Frequency source lemmas',
  sourceRows: 'Wiktionary source rows',
  lemmas: 'Unique lemmas',
  senses: 'Dictionary senses',
  rankedSenses: 'Ranked senses',
  savedWords: 'Existing saved words',
  savedWordsBackfilled: 'Saved words updated',
  sharedEntries: 'Shared dictionary entries',
  sharedEntriesBackfilled: 'Shared entries updated',
};

export function formatCatalogDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return 'Calculating…';
  const value = Math.max(0, Math.round(Number(seconds)));
  if (value < 60) return `${value}s`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainingSeconds = value % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCount(value: unknown) {
  const parsed = asNumber(value);
  return parsed == null ? '—' : Math.round(parsed).toLocaleString();
}

function percent(completed: number, total: number | null) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, (completed / total) * 100));
}

function timeLabel(value: string | null | undefined) {
  if (!value) return 'Not reported';
  return new Date(value).toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`catalog-status catalog-status--${status}`}>{status.replace('_', ' ')}</span>;
}

function ProgressBar({ completed, total, label }: { completed: number; total: number | null; label: string }) {
  const value = percent(completed, total);
  return (
    <div
      className={`catalog-progress-track${total == null ? ' catalog-progress-track--indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total ?? undefined}
      aria-valuenow={total == null ? undefined : Math.min(completed, total)}
    >
      <div className="catalog-progress-fill" style={{ width: total == null ? '35%' : `${value}%` }} />
    </div>
  );
}

function DiagnosticCard({ diagnostic }: { diagnostic: CatalogBuildDiagnostic }) {
  return (
    <article className={`catalog-diagnostic catalog-diagnostic--${diagnostic.severity || 'warning'}`}>
      <div className="catalog-diagnostic-heading">
        <strong>{diagnostic.title || diagnostic.code}</strong>
        <code>{diagnostic.code}</code>
      </div>
      <p>{diagnostic.message}</p>
      <dl>
        {diagnostic.stage && <><dt>Stage</dt><dd>{diagnostic.stage}</dd></>}
        {diagnostic.source && <><dt>Source</dt><dd>{diagnostic.source}</dd></>}
        {diagnostic.occurredAt && <><dt>Time</dt><dd>{timeLabel(diagnostic.occurredAt)}</dd></>}
        {diagnostic.detail && <><dt>Detail</dt><dd>{diagnostic.detail}</dd></>}
      </dl>
    </article>
  );
}

function PhaseRow({ name, label, phase, active }: {
  name: string;
  label: string;
  phase?: CatalogPhaseProgress;
  active: boolean;
}) {
  const completed = Number(phase?.completed || 0);
  const total = phase?.total == null ? null : Number(phase.total);
  const status = phase?.status || 'queued';
  return (
    <div className={`catalog-phase${active ? ' catalog-phase--active' : ''}`}>
      <div className="catalog-phase-heading">
        <div>
          <strong>{label}</strong>
          <span>{formatCount(completed)} / {total == null ? 'total pending' : formatCount(total)}</span>
        </div>
        <StatusBadge status={status} />
      </div>
      <ProgressBar completed={completed} total={total} label={`${label} progress`} />
      <div className="catalog-phase-metrics">
        <span>Rate: {phase?.throughputPerSecond == null ? 'Calculating…' : `${Number(phase.throughputPerSecond).toLocaleString(undefined, { maximumFractionDigits: 1 })}/s`}</span>
        <span>Phase ETA: {formatCatalogDuration(phase?.etaSeconds)}</span>
        <span>Updated: {timeLabel(phase?.updatedAt)}</span>
      </div>
      <span className="catalog-phase-code">{name}</span>
    </div>
  );
}

function LanguagePanel({ progress }: { progress: CatalogLanguageProgress }) {
  const total = progress.overall_total == null ? null : Number(progress.overall_total);
  const completed = Number(progress.overall_completed || 0);
  const countEntries = Object.entries(progress.counts || {})
    .filter(([key, value]) => key in COUNT_LABELS && asNumber(value) != null);
  return (
    <section className="catalog-language-card">
      <div className="catalog-language-heading">
        <div>
          <span className="catalog-eyebrow">Language {progress.sequence + 1}</span>
          <h2>{progress.language === 'es' ? 'Spanish' : progress.language.toUpperCase()}</h2>
        </div>
        <StatusBadge status={progress.status} />
      </div>

      <div className="catalog-overall-summary">
        <div className="catalog-overall-label">
          <strong>Overall progress</strong>
          <span>{formatCount(completed)} / {total == null ? 'exact total pending' : formatCount(total)} · {total ? `${percent(completed, total).toFixed(2)}%` : 'measuring'}</span>
        </div>
        <ProgressBar completed={completed} total={total} label={`${progress.language} overall progress`} />
        <p>{progress.message || 'Waiting for a build update.'}</p>
      </div>

      <div className="catalog-metric-grid">
        <div><span>Current phase</span><strong>{progress.phase.replace(/_/g, ' ')}</strong></div>
        <div><span>Overall rate</span><strong>{progress.throughput_per_second == null ? 'Calculating…' : `${Number(progress.throughput_per_second).toLocaleString(undefined, { maximumFractionDigits: 1 })}/s`}</strong></div>
        <div><span>Overall ETA</span><strong>{formatCatalogDuration(progress.eta_seconds)}</strong></div>
        <div><span>Last heartbeat</span><strong>{timeLabel(progress.heartbeat_at)}</strong></div>
      </div>

      {countEntries.length > 0 && (
        <div className="catalog-count-grid">
          {countEntries.map(([key, value]) => (
            <div key={key}><span>{COUNT_LABELS[key]}</span><strong>{formatCount(value)}</strong></div>
          ))}
        </div>
      )}

      <div className="catalog-phases">
        {PHASES.map(([name, label]) => (
          <PhaseRow key={name} name={name} label={label} phase={progress.phases?.[name]} active={progress.phase === name} />
        ))}
      </div>

      {progress.diagnostics?.length > 0 && (
        <div className="catalog-diagnostics">
          <h3>Language diagnostics</h3>
          {progress.diagnostics.map((diagnostic, index) => <DiagnosticCard key={`${diagnostic.code}-${index}`} diagnostic={diagnostic} />)}
        </div>
      )}
    </section>
  );
}

export default function CatalogProgress() {
  const navigate = useNavigate();
  const [data, setData] = useState<CatalogBuildProgressResponse | null>(null);
  const [requestDiagnostic, setRequestDiagnostic] = useState<CatalogBuildDiagnostic | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await getFrequencyCatalogProgress());
      setRequestDiagnostic(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      runtimeLog.error('Catalog progress request failed', error);
      setRequestDiagnostic({
        code: 'catalog_progress_request_failed',
        severity: 'error',
        title: 'Live catalog progress could not be loaded',
        message: 'The tracker could not reach the progress endpoint. The last confirmed values remain visible.',
        source: 'web.catalog-progress',
        operation: 'poll-progress',
        stage: 'progress-read',
        occurredAt: new Date().toISOString(),
        detail,
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const diagnostics = useMemo(() => [
    ...(requestDiagnostic ? [requestDiagnostic] : []),
    ...(data?.build?.diagnostics || []),
  ], [data?.build?.diagnostics, requestDiagnostic]);

  return (
    <main className="catalog-page">
      <div className="catalog-page-inner">
        <header className="catalog-page-header">
          <button className="channel-back-btn" onClick={() => navigate(-1)}>
            <ChevronLeftIcon size={18} /> Back
          </button>
          <div>
            <span className="catalog-eyebrow">Frequency infrastructure</span>
            <h1>Dictionary ranking build</h1>
            <p>Live, exact telemetry for the compact Spanish lemma and sense catalog.</p>
          </div>
          <button className="btn btn-small" type="button" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </header>

        {data?.build ? (
          <section className="catalog-build-card">
            <div className="catalog-build-heading">
              <div><span>Build version</span><strong>{data.build.version}</strong></div>
              <StatusBadge status={data.build.status} />
            </div>
            <div className="catalog-build-facts">
              <div><span>Build ID</span><code>{data.build.id}</code></div>
              <div><span>Started</span><strong>{timeLabel(data.build.started_at)}</strong></div>
              <div><span>Heartbeat</span><strong>{timeLabel(data.build.heartbeat_at)}</strong></div>
              <div><span>Catalog ID</span><code>{data.build.catalog_version_id || 'Not activated'}</code></div>
            </div>
            {data.stale && <div className="catalog-stale-banner">The build heartbeat is stale. This is an error state, not a success state.</div>}
          </section>
        ) : data ? (
          <section className="catalog-empty">
            <h2>No catalog build has started</h2>
            <p>The tracker is connected and waiting for the first compact Spanish build.</p>
          </section>
        ) : (
          <section className="catalog-empty"><h2>Connecting to live progress…</h2></section>
        )}

        {diagnostics.length > 0 && (
          <section className="catalog-diagnostics catalog-diagnostics--build" aria-live="polite">
            <h2>Visible diagnostics</h2>
            {diagnostics.map((diagnostic, index) => <DiagnosticCard key={`${diagnostic.code}-${index}`} diagnostic={diagnostic} />)}
          </section>
        )}

        {data?.languages.map((language) => <LanguagePanel key={language.language} progress={language} />)}
      </div>
    </main>
  );
}
