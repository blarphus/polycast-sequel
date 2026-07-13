import { request } from './core';

export type CatalogBuildStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'rolled_back';

export interface CatalogBuildDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  title?: string;
  message: string;
  source?: string;
  operation?: string;
  pipeline?: string;
  stage?: string;
  language?: string | null;
  occurredAt?: string;
  detail?: string;
}

export interface CatalogPhaseProgress {
  status: CatalogBuildStatus;
  completed: number;
  total: number | null;
  throughputPerSecond?: number | null;
  etaSeconds?: number | null;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface CatalogLanguageProgress {
  build_id: string;
  language: string;
  sequence: number;
  status: CatalogBuildStatus;
  phase: string;
  phase_completed: number;
  phase_total: number | null;
  overall_completed: number;
  overall_total: number | null;
  throughput_per_second: number | null;
  eta_seconds: number | null;
  counts: Record<string, number | string | null | Record<string, unknown>>;
  phases: Record<string, CatalogPhaseProgress>;
  diagnostics: CatalogBuildDiagnostic[];
  message: string | null;
  phase_started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CatalogBuildRun {
  id: string;
  version: string;
  status: CatalogBuildStatus;
  requested_languages: string[];
  current_language: string | null;
  current_phase: string | null;
  message: string | null;
  diagnostics: CatalogBuildDiagnostic[];
  catalog_version_id: string | null;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CatalogBuildProgressResponse {
  build: CatalogBuildRun | null;
  languages: CatalogLanguageProgress[];
  stale: boolean;
}

export function getFrequencyCatalogProgress() {
  return request<CatalogBuildProgressResponse>('/frequency-catalog/progress');
}
