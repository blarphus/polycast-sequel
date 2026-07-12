#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function filesBelow(relativeRoot, extensions) {
  const output = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'build', 'test', 'Tests', 'UITests', 'scripts', 'migrations', 'generated'].includes(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (extensions.includes(path.extname(entry.name))) output.push(target);
    }
  };
  visit(path.join(root, relativeRoot));
  return output;
}

for (const file of filesBelow('client/src', ['.ts', '.tsx'])) {
  const relative = path.relative(root, file);
  if (['client/src/utils/runtimeDiagnostics.ts', 'client/src/utils/fallbackDiagnostics.ts'].includes(relative)) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bconsole\.(?:log|warn|error|info|debug)\b/g)) {
    failures.push(`${relative}:${source.slice(0, match.index).split('\n').length}: use the scoped structured runtime logger`);
  }
}

for (const file of filesBelow('server', ['.js', '.mjs'])) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bconsole\.(?:log|warn|error|info|debug)\b/g)) {
    failures.push(`${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}: use the server pino logger`);
  }
}

for (const file of filesBelow('extension', ['.js'])) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bconsole\.(?:log|warn|error|info|debug)\s*\(\s*(['"`])([^'"`]*)/g)) {
    if (!match[2].startsWith('[polycast:fallback') && !match[2].startsWith('[polycast:diagnostic')) {
      failures.push(`${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}: extension logs must use a structured Polycast diagnostic envelope`);
    }
  }
}

for (const file of [...filesBelow('ios/Polycast', ['.swift']), ...filesBelow('ios/PolycastWidget', ['.swift'])]) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bprint\s*\(/g)) {
    failures.push(`${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}: use PolycastLog/OSLog`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Runtime logging gate passed: structured adapters only.');
