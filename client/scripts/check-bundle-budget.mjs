#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const budgets = JSON.parse(await readFile(new URL('../bundle-budgets.json', import.meta.url), 'utf8'));
const assetDirectory = new URL('../dist/assets/', import.meta.url);
const files = await readdir(assetDirectory);
const assets = await Promise.all(files.map(async (name) => ({
  name,
  bytes: (await stat(new URL(name, assetDirectory))).size,
})));
const javascript = assets.filter(({ name }) => name.endsWith('.js'));
const css = assets.filter(({ name }) => name.endsWith('.css'));
const initialJs = javascript.find(({ name }) => /^index-[^.]+\.js$/.test(name));
const initialCss = css.find(({ name }) => /^index-[^.]+\.css$/.test(name));
if (!initialJs || !initialCss) throw new Error('Could not identify initial Vite assets');
const initialJsGzip = gzipSync(await readFile(new URL(initialJs.name, assetDirectory))).length;
const largestJs = javascript.reduce((largest, asset) => asset.bytes > largest.bytes ? asset : largest);
const largestCss = css.reduce((largest, asset) => asset.bytes > largest.bytes ? asset : largest);

const failures = [];
if (initialJs.bytes > budgets.initialJavaScriptBytes) failures.push(`initial JS ${initialJs.bytes} > ${budgets.initialJavaScriptBytes}`);
if (initialCss.bytes > budgets.initialCssBytes) failures.push(`initial CSS ${initialCss.bytes} > ${budgets.initialCssBytes}`);
if (initialJsGzip > budgets.maximumInitialJavaScriptGzipBytes) failures.push(`initial JS gzip ${initialJsGzip} > ${budgets.maximumInitialJavaScriptGzipBytes}`);
if (largestJs.bytes > budgets.maximumJavaScriptChunkBytes) failures.push(`largest JS ${largestJs.name} ${largestJs.bytes} > ${budgets.maximumJavaScriptChunkBytes}`);
if (largestCss.bytes > budgets.maximumCssChunkBytes) failures.push(`largest CSS ${largestCss.name} ${largestCss.bytes} > ${budgets.maximumCssChunkBytes}`);
if (failures.length) throw new Error(`Bundle budget failed:\n${failures.join('\n')}`);

console.log(JSON.stringify({
  event: 'bundle_budget_passed',
  initialJavaScript: { name: initialJs.name, bytes: initialJs.bytes, gzipBytes: initialJsGzip },
  initialCss: { name: initialCss.name, bytes: initialCss.bytes },
  largestJavaScript: largestJs,
  largestCss,
  javascriptChunks: javascript.length,
  cssChunks: css.length,
}));
