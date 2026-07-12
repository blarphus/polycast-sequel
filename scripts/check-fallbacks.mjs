#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
  'client/src',
  'server',
  'ios/Polycast/Sources',
  'ios/PolycastWidget',
  'extension',
  'cf-worker/src',
];
const extensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.swift']);
const ignoredDirectories = new Set(['node_modules', 'build', 'dist', 'DerivedData', 'data', 'test', 'Tests', 'UITests']);

async function filesBelow(relativeDirectory) {
  const output = [];
  const visit = async (relativePath) => {
    const entries = await readdir(path.join(root, relativePath), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) continue;
      const child = path.join(relativePath, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (extensions.has(path.extname(entry.name))) output.push(child);
    }
  };
  await visit(relativeDirectory);
  return output;
}

const failures = [];
for (const file of (await Promise.all(roots.map(filesBelow))).flat()) {
  const source = await readFile(path.join(root, file), 'utf8');
  const emptyCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:(?:\/\/[^\n]*\n)|(?:\/\*[\s\S]*?\*\/\s*))*\}/g;
  for (const match of source.matchAll(emptyCatch)) {
    const line = source.slice(0, match.index).split('\n').length;
    failures.push(`${file}:${line}: catch path contains no observable handling`);
  }
  const stringDiagnostic = /diagnostic\s*:\s*['"`]([^'"`]*(?:fallback|offline|unavailable)[^'"`]*)['"`]/gi;
  for (const match of source.matchAll(stringDiagnostic)) {
    const line = source.slice(0, match.index).split('\n').length;
    failures.push(`${file}:${line}: fallback diagnostic must be a structured object, not a string`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Fallback visibility check passed: no empty catches or string-only diagnostics.');
