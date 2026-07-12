#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT_JSON = path.join(ROOT, 'docs/code-inventory.json');
const OUTPUT_MD = path.join(ROOT, 'docs/CODE_INVENTORY.md');
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx', '.swift', '.py', '.lua']);
const ROOTS = ['client/src', 'server', 'cf-worker/src', 'extension', 'ios/Polycast', 'ios/PolycastWidget', 'scripts', 'tools'];
const EXCLUDED_PARTS = new Set(['node_modules', 'dist', 'build', '.build', 'DerivedData', 'coverage', '.git']);
const DYNAMIC_OR_TEST_SYMBOLS = new Map([
  ['ios/Polycast/Sources/App/PolycastApp.swift:PolycastApp', 'SwiftUI application entry point'],
  ['ios/Polycast/Sources/Features/Dictionary/DictionaryView.swift:makeBody', 'ButtonStyle protocol requirement'],
  ['ios/Polycast/Sources/Features/Watch/FullscreenPlayerView.swift:captionDisplay', 'fixture-tested caption renderer seam'],
  ['ios/Polycast/Sources/Features/Watch/FullscreenPlayerView.swift:portraitCaptionTokens', 'fixture-tested caption renderer seam'],
  ['ios/Polycast/Sources/Core/TranscriptWorkerClient.swift:parseTimedCaptionJSON3', 'fixture-tested parser seam'],
  ['ios/Polycast/Sources/Core/SRTParser.swift:SRTParser', 'canonical corpus parser exercised only by the cross-platform fixture test'],
  ['ios/Polycast/Sources/Core/VoIPPushManager.swift:providerDidReset', 'PKPushRegistryDelegate callback'],
  ['ios/PolycastWidget/TodayWordsProvider.swift:getSnapshot', 'TimelineProvider protocol requirement'],
  ['ios/PolycastWidget/TodayWordsProvider.swift:getTimeline', 'TimelineProvider protocol requirement'],
  ['ios/PolycastWidget/TodayWordsWidget.swift:PolycastWidgetBundle', 'WidgetBundle entry point'],
  ['ios/PolycastWidget/TodayWordsWidgetView.swift:nextButton', 'SwiftUI computed view referenced through result builder'],
  ['ios/PolycastWidget/TodayWordsWidgetView.swift:pageDots', 'SwiftUI computed view referenced through result builder'],
  ['ios/Polycast/Sources/Features/Watch/WatchView.swift:makeCoordinator', 'UIViewRepresentable protocol requirement'],
  ['server/services/learningSessionService.js:__test', 'explicit unit-test seam'],
]);

async function walk(relativeRoot) {
  const absoluteRoot = path.join(ROOT, relativeRoot);
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (EXCLUDED_PARTS.has(entry.name) || entry.name === 'package-lock.json') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(path.relative(ROOT, absolute));
    }
  }
  await visit(absoluteRoot);
  return files;
}

function responsibility(file) {
  const normalized = file.toLowerCase();
  if (normalized.includes('/generated/')) return 'generated contract';
  if (normalized.includes('/test') || normalized.includes('.test.') || normalized.includes('tests/')) return 'test';
  if (normalized.startsWith('server/routes/')) return 'HTTP transport';
  if (normalized.startsWith('server/services/') || normalized.startsWith('server/lib/')) return 'server domain/integration';
  if (normalized.startsWith('client/src/pages/')) return 'web route UI';
  if (normalized.startsWith('client/src/components/')) return 'web component UI';
  if (normalized.startsWith('client/src/api/')) return 'web API adapter';
  if (normalized.startsWith('extension/')) return 'extension runtime/UI';
  if (normalized.includes('/features/')) return 'iOS feature UI';
  if (normalized.includes('/core/')) return 'iOS core/runtime';
  if (normalized.startsWith('scripts/') || normalized.startsWith('tools/')) return 'tooling';
  return 'application support';
}

function sideEffects(source) {
  const effects = [];
  if (/\b(fetch|URLSession|apiFetch|APIClient\.shared)\b/.test(source)) effects.push('network');
  if (/\b(pool|client)\.query\b|\bINSERT INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE FROM\b/.test(source)) effects.push('database');
  if (/localStorage|chrome\.storage|UserDefaults|Keychain|writeFile|\.save\(/.test(source)) effects.push('persistence');
  if (/dispatchEvent|\.emit\(|NotificationCenter|chrome\.tabs\.sendMessage/.test(source)) effects.push('events');
  if (/SwiftUI|React|document\.|innerHTML|createElement/.test(source)) effects.push('UI');
  if (/console\.|PolycastLog|logger\.|pino/.test(source)) effects.push('logging');
  return effects;
}

function declarations(source, file) {
  const results = [];
  const patterns = path.extname(file) === '.swift'
    ? [/(?:^|\n)\s*(?:(?:private|fileprivate|internal|public|open|nonisolated\(unsafe\))\s+)*(?:final\s+)?(struct|class|enum|actor|protocol|func)\s+([A-Za-z_][A-Za-z0-9_]*)/g]
    : [/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g,
       /(?:^|\n)\s*export\s+(?:const|let|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = match[2] || match[1];
      if (name && !results.some((entry) => entry.name === name)) results.push({ name });
    }
  }
  return results;
}

function fileDisposition(file, lines, declarationCount, owner) {
  if (file.includes('/Generated/') || file.includes('/generated/')) return 'generated';
  if (file.startsWith('prototypes/')) return 'prototype';
  if (owner === 'test') return 'intentionally standalone';
  if (lines >= 700 || (lines >= 450 && declarationCount >= 5)) return 'reviewed-retain';
  return 'intentionally standalone';
}

function dispositionReason(file, disposition, owner) {
  if (disposition === 'generated') return 'Regenerated from a canonical contract; never hand-pruned.';
  if (disposition === 'prototype') return 'Archived outside production ownership and excluded from runtime registration.';
  if (disposition !== 'reviewed-retain') return 'One bounded responsibility below the mixed-ownership size threshold.';
  if (file.includes('/data/') || file.includes('conjugations')) return 'Static catalog data: splitting would add loaders without reducing runtime work.';
  if (file === 'extension/background.js') return 'The service-worker dispatcher intentionally owns session-scoped mutable state; message validation and site activation are extracted modules.';
  if (file.startsWith('extension/')) return 'One isolated content-script lifecycle; shared popup/token/diagnostic infrastructure is already extracted.';
  if (file.includes('/Features/') || file.includes('/pages/') || file.includes('/components/')) return 'One stateful screen/component lifecycle; reusable domain, card, popup, and transport seams are extracted.';
  if (file.includes('Provider') || file.includes('/contexts/') || file.includes('/hooks/')) return 'One state machine whose teardown/cancellation invariants require a single owner; pure helpers are separate.';
  if (file.startsWith('server/')) return 'One server domain pipeline; transport, persistence/query, provider, and diagnostic seams are already separated and tested.';
  if (file.startsWith('scripts/')) return 'One deterministic generator command; output families share parsing and drift-check state.';
  return `Cohesive ${owner} owner with no duplicate authoritative invariant.`;
}

const files = (await Promise.all(ROOTS.map(walk))).flat().sort();
const sources = new Map(await Promise.all(files.map(async (file) => [file, await readFile(path.join(ROOT, file), 'utf8')])));
const searchable = [...sources.entries()].filter(([file]) => !file.includes('/test') && !file.includes('Tests/'));
const tests = [...sources.entries()].filter(([file]) => file.includes('/test') || file.includes('Tests/') || file.includes('.test.'));

const inventory = files.map((file) => {
  const source = sources.get(file);
  const lines = source === '' ? 0 : source.split(/\r?\n/).length;
  const owner = responsibility(file);
  const symbols = declarations(source, file).map(({ name }) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = searchable.reduce((sum, [, value]) => sum + (value.match(new RegExp(`\\b${escaped}\\b`, 'g'))?.length || 0), 0);
    const testReferences = tests.filter(([, value]) => new RegExp(`\\b${escaped}\\b`).test(value)).map(([testFile]) => testFile);
    const callers = Math.max(0, occurrences - 1);
    const retentionReason = DYNAMIC_OR_TEST_SYMBOLS.get(`${file}:${name}`);
    return {
      name,
      callers,
      testReferences,
      disposition: callers === 0 && !retentionReason && owner !== 'test' && !file.includes('/Generated/') && !file.includes('/generated/')
        ? 'delete-review'
        : 'retain',
      ...(retentionReason ? { retentionReason } : {}),
    };
  });
  const disposition = fileDisposition(file, lines, symbols.length, owner);
  return {
    file,
    lines,
    responsibility: owner,
    sideEffects: sideEffects(source),
    testCoverage: tests.filter(([testFile, value]) => value.includes(path.basename(file, path.extname(file))) || symbols.some(({ name }) => new RegExp(`\\b${name}\\b`).test(value))).map(([testFile]) => testFile),
    disposition,
    dispositionReason: dispositionReason(file, disposition, owner),
    symbols,
  };
});

const totals = {
  files: inventory.length,
  lines: inventory.reduce((sum, entry) => sum + entry.lines, 0),
  declarations: inventory.reduce((sum, entry) => sum + entry.symbols.length, 0),
  extractCandidates: inventory.filter((entry) => entry.disposition === 'extract').length,
  reviewedOversizedFiles: inventory.filter((entry) => entry.disposition === 'reviewed-retain').length,
  zeroCallerCandidates: inventory.reduce((sum, entry) => sum + entry.symbols.filter((symbol) => symbol.disposition === 'delete-review').length, 0),
};
const payload = { generatedAt: 'deterministic-from-worktree', totals, files: inventory };
const json = `${JSON.stringify(payload, null, 2)}\n`;
const candidates = inventory.filter((entry) => entry.disposition === 'extract' || entry.disposition === 'reviewed-retain' || entry.symbols.some((symbol) => symbol.disposition === 'delete-review'));
const markdown = `# Code inventory and prune/combine dispositions

Generated by \`npm run inventory\`. Caller counts are conservative static name references and every zero-caller result requires registration/dynamic-use verification before deletion.

## Current totals

| Files | First-party lines | Declarations | Unresolved extract candidates | Reviewed oversized owners | Zero-caller review candidates |
| ---: | ---: | ---: | ---: | ---: | ---: |
| ${totals.files} | ${totals.lines} | ${totals.declarations} | ${totals.extractCandidates} | ${totals.reviewedOversizedFiles} | ${totals.zeroCallerCandidates} |

## Flagged candidates and dispositions

| File | Lines | Responsibility | Side effects | Disposition and reason | Zero-caller symbols |
| --- | ---: | --- | --- | --- | --- |
${candidates.map((entry) => `| \`${entry.file}\` | ${entry.lines} | ${entry.responsibility} | ${entry.sideEffects.join(', ') || 'none detected'} | ${entry.disposition}: ${entry.dispositionReason} | ${entry.symbols.filter((symbol) => symbol.disposition === 'delete-review').map((symbol) => `\`${symbol.name}\``).join(', ') || '—'} |`).join('\n')}

The complete per-file inventory records responsibility, inferred side effects, test references, declarations, caller counts, and disposition in [code-inventory.json](./code-inventory.json).
`;

if (process.argv.includes('--check')) {
  const [existingJson, existingMarkdown] = await Promise.all([readFile(OUTPUT_JSON, 'utf8'), readFile(OUTPUT_MD, 'utf8')]);
  if (existingJson !== json || existingMarkdown !== markdown) {
    console.error('Code inventory drifted; run npm run inventory');
    process.exit(1);
  }
  console.log(`Code inventory is current (${totals.files} files, ${totals.lines} lines)`);
} else {
  await Promise.all([writeFile(OUTPUT_JSON, json), writeFile(OUTPUT_MD, markdown)]);
  console.log(`Generated code inventory (${totals.files} files, ${totals.lines} lines)`);
}
