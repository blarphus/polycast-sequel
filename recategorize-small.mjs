/**
 * recategorize-small.mjs — Re-categorize videos from small categories (≤5 videos)
 * into larger ones, or move to uncategorized if no fit.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match) process.env[match[1]] = match[2];
  }
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

const statePath = path.join(__dirname, '.categorization-state.json');
const outputPath = path.join(__dirname, 'categorized-videos.txt');
const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

// Identify small vs large categories
const THRESHOLD = 5;
const smallCats = {};
const largeCats = {};

for (const [id, cat] of Object.entries(state.categories)) {
  if (cat.videos.length > 0 && cat.videos.length <= THRESHOLD) {
    smallCats[id] = cat;
  } else if (cat.videos.length > THRESHOLD) {
    largeCats[id] = cat;
  }
}

// Collect all videos from small categories
const videosToRecategorize = [];
for (const [id, cat] of Object.entries(smallCats)) {
  for (const v of cat.videos) {
    videosToRecategorize.push({ ...v, oldCategory: id, oldCategoryTitle: cat.title });
  }
}

console.log(`${Object.keys(smallCats).length} small categories (≤${THRESHOLD} videos)`);
console.log(`${Object.keys(largeCats).length} large categories (>${THRESHOLD} videos)`);
console.log(`${videosToRecategorize.length} videos to re-categorize\n`);

if (videosToRecategorize.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

// Gemini helper
const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${GEMINI_API_KEY}`;

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 65536,
      },
    });

    const req = https.request(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 0,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          reject(new Error(`Gemini API error: ${res.statusCode}\n${text}`));
          return;
        }
        resolve(JSON.parse(text));
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Build category list (large only)
const catList = Object.entries(largeCats)
  .map(([id, c]) => `- ${id}: "${c.title}" (${c.videos.length} videos)`)
  .join('\n');

const videoList = videosToRecategorize
  .map((v, idx) => `${idx + 1}. "${v.title}" [${v.channel}] (was: "${v.oldCategoryTitle}")`)
  .join('\n');

const prompt = `You are re-categorizing Portuguese language-learning YouTube videos. These videos were previously in small categories that are being dissolved.

AVAILABLE CATEGORIES (only these):
${catList}

VIDEOS TO RE-CATEGORIZE:
${videoList}

For each video, decide ONE of:
1. An existing category ID from the list above — if the video fits well
2. "uncategorized" — if it truly doesn't fit any category above

Return a JSON array with exactly ${videosToRecategorize.length} elements. Each element is either a category ID string or "uncategorized".

Return ONLY the JSON array.`;

console.log('Calling Gemini...\n');
const start = Date.now();

const geminiData = await callGemini(prompt);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const usage = geminiData.usageMetadata;
console.log(`Done in ${elapsed}s`);
if (usage) {
  console.log(`  ${usage.promptTokenCount?.toLocaleString()} in, ${usage.candidatesTokenCount?.toLocaleString()} out`);
}

const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
if (!rawText) {
  console.error('No response from Gemini:', JSON.stringify(geminiData, null, 2));
  process.exit(1);
}

let results;
try {
  results = JSON.parse(rawText);
} catch (e) {
  const jsonMatch = rawText.match(/```json?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    results = JSON.parse(jsonMatch[1].trim());
  } else {
    console.error('Failed to parse:', rawText.slice(0, 2000));
    process.exit(1);
  }
}

if (!Array.isArray(results) || results.length !== videosToRecategorize.length) {
  console.error(`Expected array of ${videosToRecategorize.length}, got ${results?.length}`);
  process.exit(1);
}

// Apply results
let moved = 0, uncategorized = 0, notFound = 0;

for (let i = 0; i < videosToRecategorize.length; i++) {
  const video = { title: videosToRecategorize[i].title, channel: videosToRecategorize[i].channel };
  const result = results[i];

  if (result === 'uncategorized') {
    state.uncategorized.push(video);
    uncategorized++;
  } else if (largeCats[result]) {
    state.categories[result].videos.push(video);
    moved++;
  } else {
    // Unknown category — put in uncategorized
    state.uncategorized.push(video);
    notFound++;
  }
}

// Remove small categories
for (const id of Object.keys(smallCats)) {
  delete state.categories[id];
}

console.log(`\nResults:`);
console.log(`  ${moved} moved to larger categories`);
console.log(`  ${uncategorized} marked uncategorized`);
if (notFound > 0) console.log(`  ${notFound} had unknown category (moved to uncategorized)`);
console.log(`  ${Object.keys(smallCats).length} small categories removed`);
console.log(`  ${Object.keys(state.categories).length} categories remaining`);

// Save state
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

// Rewrite document
const lines = [];
lines.push('CATEGORIZED VIDEOS -- PT');
lines.push('='.repeat(60));

const catCount = Object.values(state.categories).reduce((s, c) => s + c.videos.length, 0);
lines.push(`Processed: ${state.processedCount}/2567`);
lines.push(`Categorized: ${catCount}`);
lines.push(`Uncategorized: ${state.uncategorized.length}`);
lines.push(`Removed (not lessons): ${state.removed.length}`);
lines.push('');

const sortedCats = Object.entries(state.categories)
  .filter(([, c]) => c.videos.length > 0)
  .sort((a, b) => b[1].videos.length - a[1].videos.length);

for (const [id, cat] of sortedCats) {
  const levelStr = cat.level ? ` (${cat.level})` : '';
  lines.push('-'.repeat(60));
  lines.push(`${cat.title}${levelStr} -- ${cat.videos.length} videos  [${id}]`);
  lines.push('-'.repeat(60));
  for (const v of cat.videos) {
    lines.push(`  - ${v.title}  [${v.channel}]`);
  }
  lines.push('');
}

if (state.uncategorized.length > 0) {
  lines.push('-'.repeat(60));
  lines.push(`Uncategorized -- ${state.uncategorized.length} videos`);
  lines.push('-'.repeat(60));
  for (const v of state.uncategorized) {
    lines.push(`  - ${v.title}  [${v.channel}]`);
  }
  lines.push('');
}

const emptyCats = Object.entries(state.categories).filter(([, c]) => c.videos.length === 0);
if (emptyCats.length > 0) {
  lines.push('-'.repeat(60));
  lines.push('Categories with no videos yet:');
  lines.push(`  ${emptyCats.map(([, c]) => c.title).join(', ')}`);
  lines.push('');
}

fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
console.log(`\nSaved: ${statePath}`);
console.log(`Saved: ${outputPath}`);
