/**
 * categorize-lessons.mjs — Categorize YouTube videos into lesson topics using Gemini.
 *
 * Fetches videos from all channels for a language, sends titles to Gemini,
 * and prints a table showing which videos match each lesson.
 *
 * Usage:  node categorize-lessons.mjs [--lang pt]
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
for (let ci = 0; ci < channels.length; ci++) {
  const ch = channels[ci];
  const videos = await fetchPlaylistVideos(ch.uploadsPlaylist, ch.name);
  for (const v of videos) {
    allVideos.push({ ...v, channel: ch.name });
  }
}

console.log(`\nTotal: ${allVideos.length} videos\n`);

// ---------------------------------------------------------------------------
// Step 2: Build prompts in batches and call Gemini
// ---------------------------------------------------------------------------

const BATCH_SIZE = 100;
const lessonList = lessons.map(l => `- ${l.id}: "${l.title}" (${l.level})`).join('\n');
const lessonIdList = lessons.map(l => l.id);
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

const totalBatches = Math.ceil(allVideos.length / BATCH_SIZE);
console.log(`Categorizing ${allVideos.length} videos in ${totalBatches} batches of ${BATCH_SIZE} via Gemini...\n`);

const categorization = [];
const overallStart = Date.now();

for (let b = 0; b < totalBatches; b++) {
  const start = b * BATCH_SIZE;
  const end = Math.min(start + BATCH_SIZE, allVideos.length);
  const batchVideos = allVideos.slice(start, end);
  const batchSize = batchVideos.length;

  const videoList = batchVideos.map((v, i) => `${i + 1}. "${v.title}" [${v.channel}]`).join('\n');

  const prompt = `You are categorizing YouTube language-learning videos into grammar/topic lessons.

Here are the lesson categories for ${lang === 'pt' ? 'Portuguese' : lang}:
${lessonList}

Here are the videos (numbered, with channel name):
${videoList}

For EVERY video, assign it to the single best-matching lesson from the list above. A video matches a lesson if its title suggests it teaches or discusses that grammar point or topic. Be selective - only match videos that are clearly about a lesson topic, not just incidentally mentioning a word. If a video does not clearly match any lesson, assign null.

Return a JSON array with exactly ${batchSize} elements. Each element is either a lesson ID string (e.g. "ser-estar") or null. The element at index 0 corresponds to video 1, index 1 to video 2, etc.

Valid lesson IDs: ${JSON.stringify(lessonIdList)}

Example format: ["ser-estar","present-tense",null,"greetings",null,...]

Return ONLY the JSON array, no other text.`;

  const batchStart = Date.now();
  const spinner = ['|', '/', '-', '\\'];
  let spinIdx = 0;
  const spinnerInterval = setInterval(() => {
    const elapsed = ((Date.now() - batchStart) / 1000).toFixed(0);
    process.stdout.write(`\r  ${spinner[spinIdx++ % 4]} Batch ${b + 1}/${totalBatches} (videos ${start + 1}-${end})... ${elapsed}s`);
  }, 250);

  const geminiData = await callGemini(prompt);

  clearInterval(spinnerInterval);
  const batchElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
  const usage = geminiData.usageMetadata;
  process.stdout.write(`\r  Batch ${b + 1}/${totalBatches} done in ${batchElapsed}s`);
  if (usage) {
    process.stdout.write(` (${usage.promptTokenCount?.toLocaleString()} in, ${usage.candidatesTokenCount?.toLocaleString()} out)`);
  }
  console.log('');

  const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    console.error(`\nNo response from Gemini for batch ${b + 1}:`, JSON.stringify(geminiData, null, 2));
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
      console.error(`\nFailed to parse Gemini response for batch ${b + 1}. Raw text:`);
      console.error(rawText.slice(0, 2000));
      process.exit(1);
    }
  }

  if (!Array.isArray(batchResult)) {
    console.error(`\nExpected array from Gemini batch ${b + 1}, got:`, typeof batchResult);
    process.exit(1);
  }

  if (batchResult.length !== batchSize) {
    console.warn(`  Warning: batch ${b + 1} returned ${batchResult.length} entries, expected ${batchSize}`);
  }

  categorization.push(...batchResult);
}

const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
console.log(`\nAll batches complete in ${totalElapsed}s\n`);

// ---------------------------------------------------------------------------
// Step 3: Validate and transform flat array → grouped results
// ---------------------------------------------------------------------------

if (!Array.isArray(categorization)) {
  console.error('Expected a JSON array from Gemini, got:', typeof categorization);
  process.exit(1);
}

if (categorization.length !== allVideos.length) {
  console.warn(`Warning: Gemini returned ${categorization.length} entries, expected ${allVideos.length}`);
}

// Group videos by lesson ID
const lessonToVideos = {};
const uncategorized = [];
let categorizedCount = 0;

for (let i = 0; i < allVideos.length; i++) {
  const lessonId = i < categorization.length ? categorization[i] : null;
  const video = allVideos[i];
  const entry = { num: i + 1, title: video.title, channel: video.channel };

  if (lessonId && lessonIdList.includes(lessonId)) {
    if (!lessonToVideos[lessonId]) lessonToVideos[lessonId] = [];
    lessonToVideos[lessonId].push(entry);
    categorizedCount++;
  } else {
    uncategorized.push(entry);
  }
}

// ---------------------------------------------------------------------------
// Step 4: Print results
// ---------------------------------------------------------------------------

const matchedLessonIds = new Set(Object.keys(lessonToVideos));
const unmatchedLessons = [];

for (const lesson of lessons) {
  const videos = lessonToVideos[lesson.id];
  if (!videos || videos.length === 0) {
    unmatchedLessons.push(lesson.title);
    continue;
  }

  console.log(`=== ${lesson.title} (${lesson.level}) — ${videos.length} videos ===`);
  for (const v of videos) {
    console.log(`  ${v.num}. "${v.title}" -- ${v.channel}`);
  }
  console.log('');
}

if (uncategorized.length > 0) {
  console.log(`=== Uncategorized — ${uncategorized.length} videos ===`);
  for (const v of uncategorized) {
    console.log(`  ${v.num}. "${v.title}" -- ${v.channel}`);
  }
  console.log('');
}

if (unmatchedLessons.length > 0) {
  console.log(`=== Lessons with no matches ===`);
  console.log(`  ${unmatchedLessons.join(', ')}`);
  console.log('');
}

console.log(`Done. ${categorizedCount}/${allVideos.length} videos categorized. ${matchedLessonIds.size}/${lessons.length} lessons have matches.`);
