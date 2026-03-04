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

async function fetchPlaylistVideos(playlistId, maxPages = 3) {
  const videos = [];
  let pageToken = '';

  for (let page = 0; page < maxPages; page++) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`YouTube API error for ${playlistId}: ${res.status} ${res.statusText}`);
      break;
    }
    const data = await res.json();
    for (const item of data.items) {
      videos.push({
        id: item.snippet.resourceId.videoId,
        title: item.snippet.title,
      });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return videos;
}

console.log(`Fetching videos for ${lang} (${channels.length} channels)...\n`);

const allVideos = [];
for (const ch of channels) {
  const videos = await fetchPlaylistVideos(ch.uploadsPlaylist);
  console.log(`  ${ch.name}: ${videos.length} videos`);
  for (const v of videos) {
    allVideos.push({ ...v, channel: ch.name });
  }
}

console.log(`\nTotal: ${allVideos.length} videos\n`);

// ---------------------------------------------------------------------------
// Step 2: Build prompt and call Gemini
// ---------------------------------------------------------------------------

const videoList = allVideos.map((v, i) => `${i + 1}. "${v.title}" [${v.channel}]`).join('\n');

const lessonList = lessons.map(l => `- ${l.id}: "${l.title}" (${l.level})`).join('\n');

const prompt = `You are categorizing YouTube language-learning videos into grammar/topic lessons.

Here are the lesson categories for ${lang === 'pt' ? 'Portuguese' : lang}:
${lessonList}

Here are the videos (numbered, with channel name):
${videoList}

For each lesson, identify which videos are relevant to that topic. A video is relevant if its title suggests it teaches or discusses that grammar point or topic. Be selective - only match videos that are clearly about the lesson topic, not just incidentally mentioning a word.

Return a JSON object where keys are lesson IDs and values are arrays of video numbers (the numbers from the list above). Only include lessons that have at least one matching video. Limit to the 10 MOST relevant videos per lesson. Use compact format:
{"ser-estar":[3,15,42],"present-tense":[7,23]}

Return ONLY the JSON object, no other text.`;

console.log('Calling Gemini (gemini-3-pro-preview)...\n');

const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${GEMINI_API_KEY}`;

const geminiRes = await fetch(geminiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 32768,
    },
  }),
});

if (!geminiRes.ok) {
  const errText = await geminiRes.text();
  console.error(`Gemini API error: ${geminiRes.status}\n${errText}`);
  process.exit(1);
}

const geminiData = await geminiRes.json();
const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

if (!rawText) {
  console.error('No response from Gemini:', JSON.stringify(geminiData, null, 2));
  process.exit(1);
}

let categorization;
try {
  categorization = JSON.parse(rawText);
} catch (e) {
  // Try to extract JSON from markdown code block
  const jsonMatch = rawText.match(/```json?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    categorization = JSON.parse(jsonMatch[1].trim());
  } else {
    console.error('Failed to parse Gemini response. Raw text:');
    console.error(rawText.slice(0, 2000));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 3: Print results table
// ---------------------------------------------------------------------------

const matchedLessonIds = new Set(Object.keys(categorization));
const unmatchedLessons = [];

for (const lesson of lessons) {
  const videoNums = categorization[lesson.id];
  if (!videoNums || videoNums.length === 0) {
    unmatchedLessons.push(lesson.title);
    continue;
  }

  console.log(`=== ${lesson.title} (${lesson.level}) ===`);
  for (const num of videoNums) {
    const video = allVideos[num - 1]; // 1-indexed
    if (video) {
      console.log(`  ${num}. "${video.title}" -- ${video.channel}`);
    }
  }
  console.log('');
}

if (unmatchedLessons.length > 0) {
  console.log(`=== No matches ===`);
  console.log(`  ${unmatchedLessons.join(', ')}`);
  console.log('');
}

console.log(`Done. ${matchedLessonIds.size}/${lessons.length} lessons have matches.`);
