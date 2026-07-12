#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const extensions = /\.(?:js|mjs|ts|tsx|json|swift|css|md|yml|yaml|sh|lua|py)$/;
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .trim().split('\n').filter((file) => file && extensions.test(file));
const failures = [];
for (const file of files) {
  const text = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (text === null) continue;
  if (text && !text.endsWith('\n') && !file.endsWith('.json')) failures.push(`${file}: missing final newline`);
  text.split('\n').forEach((line, index) => {
    if (/[\t ]+$/.test(line)) failures.push(`${file}:${index + 1}: trailing whitespace`);
  });
}
if (failures.length) throw new Error(`Format policy failed:\n${failures.slice(0, 100).join('\n')}`);
console.log(`Format policy passed for ${files.length} text source file(s).`);
