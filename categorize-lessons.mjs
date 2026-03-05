/**
 * categorize-lessons.mjs — Categorize YouTube videos into lesson topics using Gemini.
 *
 * Fetches ALL videos from all channels, then sorts each into a category.
 * Categories start from the lesson list but new ones are created dynamically
 * when Gemini identifies recurring topics. Non-language-lesson videos (vlogs,
 * conversations, etc.) are discarded. State is saved after every batch so
 * the script can be interrupted and resumed.
 *
 * Usage:  node categorize-lessons.mjs [--lang pt] [--reset]
 *
 * Requires YOUTUBE_API_KEY and GEMINI_API_KEY in .env (or environment).
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match) process.env[match[1]] = match[2];
  }
}

const { CHANNELS_BY_LANG } = await import(path.join(__dirname, 'server', 'data', 'channels.js'));
const { LESSONS_BY_LANG } = await import(path.join(__dirname, 'server', 'data', 'lessons.js'));

// CLI args
const args = process.argv.slice(2);
const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'pt';
const reset = args.includes('--reset');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!YOUTUBE_API_KEY) { console.error('Missing YOUTUBE_API_KEY'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

const channels = CHANNELS_BY_LANG[lang];
const lessons = LESSONS_BY_LANG[lang];
if (!channels || !lessons) { console.error(`No data for language: ${lang}`); process.exit(1); }

// ---------------------------------------------------------------------------
// Step 1: Fetch videos from YouTube
// ---------------------------------------------------------------------------

async function fetchPlaylistVideos(playlistId, channelName) {
  const videos = [];
  let pageToken = '';
  let page = 0;

  while (true) {
    page++;
    process.stdout.write(`\r  ${channelName}: fetching page ${page}...`);
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`\n  YouTube API error for ${playlistId}: ${res.status} ${res.statusText}`);
      break;
    }
    const data = await res.json();
    for (const item of data.items) {
      videos.push({
        id: item.snippet.resourceId.videoId,
        title: item.snippet.title,
      });
    }
    process.stdout.write(`\r  ${channelName}: ${videos.length} videos (page ${page})...`);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  process.stdout.write(`\r  ${channelName}: ${videos.length} videos              \n`);
  return videos;
}

console.log(`Fetching videos for ${lang} (${channels.length} channels)...\n`);

const allVideos = [];
for (const ch of channels) {
  const videos = await fetchPlaylistVideos(ch.uploadsPlaylist, ch.name);
  for (const v of videos) {
    allVideos.push({ ...v, channel: ch.name });
  }
}

console.log(`\nTotal: ${allVideos.length} videos\n`);

// ---------------------------------------------------------------------------
// Step 2: State management
// ---------------------------------------------------------------------------

const statePath = path.join(__dirname, '.categorization-state.json');
const outputPath = path.join(__dirname, 'categorized-videos.txt');
const BATCH_SIZE = 20;

// State shape: { categories: { id: { title, level?, videos: [{title, channel}] } }, uncategorized: [...], removed: [...], processedCount: N }
let state;

if (!reset && fs.existsSync(statePath)) {
  state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  console.log(`Resuming from saved state: ${state.processedCount}/${allVideos.length} processed\n`);
} else {
  // Initialize with lesson categories (empty)
  const categories = {};
  for (const l of lessons) {
    categories[l.id] = { title: l.title, level: l.level, videos: [] };
  }
  state = { categories, uncategorized: [], removed: [], processedCount: 0 };
  if (reset) console.log('Reset: starting fresh.\n');
}

function saveState() {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function writeDocument() {
  const lines = [];
  lines.push(`CATEGORIZED VIDEOS -- ${lang.toUpperCase()}`);
  lines.push('='.repeat(60));

  const catCount = Object.values(state.categories).reduce((s, c) => s + c.videos.length, 0);
  lines.push(`Processed: ${state.processedCount}/${allVideos.length}`);
  lines.push(`Categorized: ${catCount}`);
  lines.push(`Uncategorized: ${state.uncategorized.length}`);
  lines.push(`Removed (not lessons): ${state.removed.length}`);
  lines.push('');

  // Sort categories: ones with videos first, sorted by video count descending
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

  // Empty categories
  const emptyCats = Object.entries(state.categories).filter(([, c]) => c.videos.length === 0);
  if (emptyCats.length > 0) {
    lines.push('-'.repeat(60));
    lines.push(`Categories with no videos yet:`);
    lines.push(`  ${emptyCats.map(([, c]) => c.title).join(', ')}`);
    lines.push('');
  }

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}

// ---------------------------------------------------------------------------
// Step 3: Gemini helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Step 4: Process videos in batches
// ---------------------------------------------------------------------------

const totalBatches = Math.ceil((allVideos.length - state.processedCount) / BATCH_SIZE);
const startIndex = state.processedCount;

if (startIndex >= allVideos.length) {
  console.log('All videos already processed.\n');
} else {
  console.log(`Processing ${allVideos.length - startIndex} remaining videos in batches of ${BATCH_SIZE}...\n`);
}

const overallStart = Date.now();
let batchNum = 0;

for (let i = startIndex; i < allVideos.length; i += BATCH_SIZE) {
  batchNum++;
  const end = Math.min(i + BATCH_SIZE, allVideos.length);
  const batchVideos = allVideos.slice(i, end);

  // Build current category list for the prompt
  const catList = Object.entries(state.categories)
    .map(([id, c]) => {
      const levelStr = c.level ? ` (${c.level})` : '';
      return `- ${id}: "${c.title}"${levelStr}`;
    })
    .join('\n');

  const videoList = batchVideos.map((v, idx) => `${idx + 1}. "${v.title}" [${v.channel}]`).join('\n');

  const prompt = `You are categorizing YouTube language-learning videos for ${lang === 'pt' ? 'Portuguese' : lang}.

EXISTING CATEGORIES:
${catList}

VIDEOS TO CATEGORIZE:
${videoList}

For each video, decide ONE of:

1. EXISTING CATEGORY: If the video clearly teaches a topic that matches an existing category, return its category ID.

2. NEW CATEGORY: If the video teaches a language topic that does NOT fit any existing category, BUT seems like a topic that would come up repeatedly and be useful as its own category (e.g. "pronunciation", "vocabulary-food", "numbers", "colors", "slang"), return an object: {"new": "category-id", "title": "Category Title"}. Use lowercase-hyphenated IDs.

3. UNCATEGORIZED: If it's a language-related video but truly a one-off that doesn't fit any category and wouldn't warrant its own, return "uncategorized".

4. REMOVE: If it is NOT a language lesson at all (vlogs, personal stories, motivational talks, cooking, interviews/conversations that aren't teaching, channel promos, Q&A about personal life, music commentary), return "remove".

Return a JSON array with exactly ${batchVideos.length} elements. Each element is either:
- A string category ID (existing)
- An object {"new": "category-id", "title": "Category Title"} (new category)
- "uncategorized"
- "remove"

Return ONLY the JSON array.`;

  const batchStart = Date.now();
  const spinner = ['|', '/', '-', '\\'];
  let spinIdx = 0;
  const spinnerInterval = setInterval(() => {
    const elapsed = ((Date.now() - batchStart) / 1000).toFixed(0);
    process.stdout.write(`\r  ${spinner[spinIdx++ % 4]} Batch ${batchNum}/${totalBatches} (videos ${i + 1}-${end})... ${elapsed}s`);
  }, 250);

  const geminiData = await callGemini(prompt);

  clearInterval(spinnerInterval);
  const batchElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
  const usage = geminiData.usageMetadata;
  process.stdout.write(`\r  Batch ${batchNum}/${totalBatches} done in ${batchElapsed}s`);
  if (usage) {
    process.stdout.write(` (${usage.promptTokenCount?.toLocaleString()} in, ${usage.candidatesTokenCount?.toLocaleString()} out)`);
  }
  console.log('');

  const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    console.error(`\nNo response from Gemini for batch ${batchNum}:`, JSON.stringify(geminiData, null, 2));
    process.exit(1);
  }

  let batchResult;
  try {
    batchResult = JSON.parse(rawText);
  } catch (e) {
    const jsonMatch = rawText.match(/```json?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      batchResult = JSON.parse(jsonMatch[1].trim());
    } else {
      console.error(`\nFailed to parse Gemini response for batch ${batchNum}. Raw text:`);
      console.error(rawText.slice(0, 2000));
      process.exit(1);
    }
  }

  if (!Array.isArray(batchResult)) {
    console.error(`\nExpected array from Gemini batch ${batchNum}, got:`, typeof batchResult);
    process.exit(1);
  }

  // Process results
  let newCats = 0;
  for (let j = 0; j < batchVideos.length; j++) {
    const video = { title: batchVideos[j].title, channel: batchVideos[j].channel };
    const result = j < batchResult.length ? batchResult[j] : 'uncategorized';

    if (result === 'remove') {
      state.removed.push(video);
    } else if (result === 'uncategorized') {
      state.uncategorized.push(video);
    } else if (typeof result === 'object' && result.new) {
      // New category
      const catId = result.new;
      if (!state.categories[catId]) {
        state.categories[catId] = { title: result.title, videos: [] };
        newCats++;
      }
      state.categories[catId].videos.push(video);
    } else if (typeof result === 'string' && state.categories[result]) {
      state.categories[result].videos.push(video);
    } else if (typeof result === 'string') {
      // Gemini returned a category ID that doesn't exist yet — create it
      state.categories[result] = { title: result.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), videos: [video] };
      newCats++;
    } else {
      state.uncategorized.push(video);
    }
  }

  state.processedCount = end;

  if (newCats > 0) {
    console.log(`    + ${newCats} new categor${newCats === 1 ? 'y' : 'ies'} created`);
  }

  // Save state and document after every batch
  saveState();
  writeDocument();
}

const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
const catCount = Object.values(state.categories).reduce((s, c) => s + c.videos.length, 0);
const totalCats = Object.keys(state.categories).length;

console.log(`\nDone in ${totalElapsed}s.`);
console.log(`  ${catCount} videos in ${totalCats} categories`);
console.log(`  ${state.uncategorized.length} uncategorized`);
console.log(`  ${state.removed.length} removed (not lessons)`);
console.log(`\nResults: ${outputPath}`);
console.log(`State:   ${statePath}`);
