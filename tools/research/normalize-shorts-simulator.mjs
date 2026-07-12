#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(root, 'research/shorts_feed_simulator.html');
const help = process.argv.includes('--help');
if (help) {
  console.log('Usage: node tools/research/normalize-shorts-simulator.mjs [--check|--write]\nEnsures the research simulator loads its one source catalog at runtime instead of embedding a duplicate.');
  process.exit(0);
}
const source = await readFile(target, 'utf8');
let normalized = source.replace(
  /\s*<script id="catalog-data" type="application\/json">[\s\S]*?<\/script>\s*<script>/,
  '\n  <script type="module">',
);
normalized = normalized.replace(
  "const catalog = JSON.parse(document.getElementById('catalog-data').textContent);",
  "const catalog = await fetch('./spanish_shorts_creators.json').then((response) => { if (!response.ok) throw new Error(`Catalog load failed: ${response.status}`); return response.json(); });",
);
if (normalized.includes('id="catalog-data"') || !normalized.includes("fetch('./spanish_shorts_creators.json')")) {
  throw new Error('Could not normalize the simulator catalog source');
}
if (process.argv.includes('--check')) {
  if (source !== normalized) throw new Error('Research simulator contains an embedded catalog; run with --write');
  console.log('Research simulator catalog check passed.');
} else {
  await writeFile(target, normalized);
  console.log('Research simulator now loads research/spanish_shorts_creators.json as its single catalog source.');
}
