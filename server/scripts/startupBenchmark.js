#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

if (process.argv.includes('--help')) {
  console.log('Usage: node server/scripts/startupBenchmark.js\nMeasures app import latency/RSS and first lazy frequency lookup against budgets.');
  process.exit(0);
}

const baselineRss = process.memoryUsage().rss;
const appStarted = performance.now();
await import('../app.js');
const appImportMs = performance.now() - appStarted;
const appRssDeltaMb = (process.memoryUsage().rss - baselineRss) / 1024 / 1024;

const frequencyStarted = performance.now();
const frequency = await import('../lib/wordFrequency.js');
const frequencyImportMs = performance.now() - frequencyStarted;
assert.deepEqual(frequency.frequencyCacheStats().loadedLanguages, [], 'server import eagerly loaded frequency files');

const beforeFirstLookup = process.memoryUsage().rss;
const lookupStarted = performance.now();
const knownFrequency = frequency.applyCorpusFrequency('hello', 'en', null);
const firstLookupMs = performance.now() - lookupStarted;
const firstLookupRssDeltaMb = (process.memoryUsage().rss - beforeFirstLookup) / 1024 / 1024;
const stats = frequency.frequencyCacheStats();

assert.equal(typeof knownFrequency.zipf, 'number');
assert.deepEqual(stats.loadedLanguages, ['en']);
assert.ok(stats.entryCount > 10_000 && stats.entryCount <= 100_000, `unexpected English frequency entry count: ${stats.entryCount}`);
assert.ok(appImportMs < 1_500, `app module import exceeded 1500ms: ${appImportMs.toFixed(1)}ms`);
assert.ok(appRssDeltaMb < 100, `app module import exceeded 100MB RSS: ${appRssDeltaMb.toFixed(1)}MB`);
assert.ok(frequencyImportMs < 100, `frequency module import exceeded 100ms: ${frequencyImportMs.toFixed(1)}ms`);
assert.ok(firstLookupMs < 100, `first frequency lookup exceeded 100ms: ${firstLookupMs.toFixed(1)}ms`);
assert.ok(firstLookupRssDeltaMb < 50, `first frequency lookup exceeded 50MB RSS: ${firstLookupRssDeltaMb.toFixed(1)}MB`);

console.log(JSON.stringify({
  event: 'startup_benchmark_passed',
  appImportMs: Number(appImportMs.toFixed(2)),
  appRssDeltaMb: Number(appRssDeltaMb.toFixed(2)),
  frequencyImportMs: Number(frequencyImportMs.toFixed(2)),
  firstLookupMs: Number(firstLookupMs.toFixed(2)),
  firstLookupRssDeltaMb: Number(firstLookupRssDeltaMb.toFixed(2)),
  frequencyEntries: stats.entryCount,
}));
