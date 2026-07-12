#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function walk(relativeRoot, extensions) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'build', 'test', 'Tests', 'UITests', 'scripts', 'generated'].includes(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (extensions.includes(path.extname(entry.name))) files.push(target);
    }
  };
  visit(path.join(root, relativeRoot));
  return files;
}

for (const file of [
  ...walk('client/src', ['.ts', '.tsx', '.js']),
  ...walk('extension', ['.js']),
  ...walk('ios/Polycast', ['.swift']),
  ...walk('ios/PolycastWidget', ['.swift']),
]) {
  const source = fs.readFileSync(file, 'utf8');
  if (/CF_TRANSCRIPT_WORKER_SECRET|transcriptWorkerSecret|workerSecret/.test(source)) {
    failures.push(`${path.relative(root, file)}: distributed clients must never contain a Worker signing secret`);
  }
}

for (const file of walk('server', ['.js', '.mjs'])) {
  const relative = path.relative(root, file);
  if (relative === 'server/services/mediaWorkerService.js') continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/CF_TRANSCRIPT_WORKER_SECRET/.test(source)) {
    failures.push(`${relative}: Worker credentials and scoped authorization belong in mediaWorkerService.js`);
  }
}

const authority = fs.readFileSync(path.join(root, 'server/services/mediaWorkerService.js'), 'utf8');
for (const required of ['createHmac', "workerHeaders('tts'", "new Set(['transcript', 'related', 'check', 'tts'])", 'randomBytes']) {
  if (!authority.includes(required)) failures.push(`server/services/mediaWorkerService.js: missing scoped-token invariant ${required}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Worker authorization gate passed: one scoped HMAC authority and no distributed/static bearer path.');
