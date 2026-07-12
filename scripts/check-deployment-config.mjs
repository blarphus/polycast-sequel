#!/usr/bin/env node
import fs from 'node:fs';

const render = fs.readFileSync('render.yaml', 'utf8');
const wrangler = fs.readFileSync('cf-worker/wrangler.toml', 'utf8');
const failures = [];
const productionOrigin = 'https://polycast-sequel.onrender.com';

for (const key of [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'CLIENT_ORIGIN',
  'CF_TRANSCRIPT_WORKER_URL',
  'CF_TRANSCRIPT_WORKER_SECRET',
  'EXTENSION_ORIGIN',
]) {
  if (!render.includes(`- key: ${key}`)) failures.push(`render.yaml: missing required production variable ${key}`);
}
if (!render.includes(`value: ${productionOrigin}`)) {
  failures.push(`render.yaml: CLIENT_ORIGIN must be the exact deployed web origin ${productionOrigin}`);
}
if (!/\[\[kv_namespaces\]\]\s+binding\s*=\s*"AUTH_REPLAY"/m.test(wrangler)) {
  failures.push('cf-worker/wrangler.toml: missing AUTH_REPLAY KV binding');
}
if (!wrangler.includes(`ALLOWED_ORIGINS = "${productionOrigin}"`)) {
  failures.push('cf-worker/wrangler.toml: Worker CORS allowlist must match the exact deployed web origin');
}
if (!/\[observability\]\s+enabled\s*=\s*true/m.test(wrangler)) {
  failures.push('cf-worker/wrangler.toml: production diagnostic logging must remain enabled');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Deployment configuration gate passed: exact origins, replay KV, required secrets, and observability are declared.');
