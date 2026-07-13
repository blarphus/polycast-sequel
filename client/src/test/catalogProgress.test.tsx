import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogBuildProgressResponse } from '../api/frequencyCatalog';

const { getFrequencyCatalogProgress } = vi.hoisted(() => ({
  getFrequencyCatalogProgress: vi.fn(),
}));
vi.mock('../api/frequencyCatalog', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/frequencyCatalog')>();
  return { ...original, getFrequencyCatalogProgress };
});

import CatalogProgress, { formatCatalogDuration } from '../pages/CatalogProgress';

const progress: CatalogBuildProgressResponse = {
  build: {
    id: 'build-1', version: 'spanish-compact-1', status: 'running',
    requested_languages: ['es'], current_language: 'es', current_phase: 'sense_ranking',
    message: 'Ranking senses', diagnostics: [{
      code: 'catalog_optional_source_missing', severity: 'warning',
      message: 'One optional source is missing.', detail: 'source=example',
    }], catalog_version_id: null, started_at: '2026-07-13T10:00:00.000Z',
    heartbeat_at: '2026-07-13T10:01:00.000Z', completed_at: null,
    created_at: '2026-07-13T10:00:00.000Z', updated_at: '2026-07-13T10:01:00.000Z',
  },
  stale: false,
  languages: [{
    build_id: 'build-1', language: 'es', sequence: 0, status: 'running', phase: 'sense_ranking',
    phase_completed: 2500, phase_total: 10000, overall_completed: 4000, overall_total: 20000,
    throughput_per_second: 12.5, eta_seconds: 1280,
    counts: { sourceRows: 5000, lemmas: 3000, senses: 10000, rankedSenses: 2500 },
    phases: {
      sense_ranking: {
        status: 'running', completed: 2500, total: 10000,
        throughputPerSecond: 12.5, etaSeconds: 600, updatedAt: '2026-07-13T10:01:00.000Z',
      },
    },
    diagnostics: [], message: 'Ranked 2,500 of 10,000 Spanish senses.',
    phase_started_at: '2026-07-13T10:00:30.000Z', heartbeat_at: '2026-07-13T10:01:00.000Z',
    completed_at: null, created_at: '2026-07-13T10:00:00.000Z', updated_at: '2026-07-13T10:01:00.000Z',
  }],
};

describe('CatalogProgress', () => {
  afterEach(() => {
    getFrequencyCatalogProgress.mockReset();
  });

  it('formats exact ETAs for the tracker', () => {
    expect(formatCatalogDuration(59)).toBe('59s');
    expect(formatCatalogDuration(125)).toBe('2m 5s');
    expect(formatCatalogDuration(3720)).toBe('1h 2m');
    expect(formatCatalogDuration(null)).toBe('Calculating…');
  });

  it('shows exact Spanish counts, every phase, ETA, and visible diagnostics', async () => {
    getFrequencyCatalogProgress.mockResolvedValue(progress);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<MemoryRouter><CatalogProgress /></MemoryRouter>);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('spanish-compact-1');
    expect(container.textContent).toContain('Spanish');
    expect(container.textContent).toContain('2,500 of 10,000 Spanish senses');
    expect(container.textContent).toContain('10,000');
    expect(container.textContent).toContain('21m 20s');
    expect(container.textContent).toContain('Atomic activation');
    expect(container.textContent).toContain('catalog_optional_source_missing');
    expect(container.textContent).toContain('One optional source is missing.');

    act(() => root.unmount());
    container.remove();
  });
});
