#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const policy = JSON.parse(await readFile(new URL('../security/npm-audit-exceptions.json', import.meta.url), 'utf8'));
if (policy.version !== 1 || !Array.isArray(policy.exceptions)) throw new Error('Invalid npm advisory exception policy');
const now = new Date();
for (const exception of policy.exceptions) {
  for (const field of ['advisory', 'project', 'owner', 'reason', 'expiresAt']) {
    if (typeof exception[field] !== 'string' || !exception[field].trim()) throw new Error(`Advisory exception missing ${field}`);
  }
  const expiresAt = new Date(exception.expiresAt);
  if (Number.isNaN(expiresAt.valueOf())) throw new Error(`Invalid expiry for ${exception.advisory}`);
  if (expiresAt <= now) throw new Error(`Expired advisory exception ${exception.advisory} (owner ${exception.owner})`);
}
console.log(`Dependency exception policy passed: ${policy.exceptions.length} active exception(s).`);
