/**
 * build-catalog.mjs — Enrich categorization state with YouTube metadata.
 *
 * Reads .categorization-state.json (has {title, channel} per video),
 * fetches ALL videos from PT YouTube channels with pagination,
 * batch-fetches video details (duration, captions) via videos.list API,
 * matches state file entries to YouTube data by title + channel,
 * and outputs server/data/pt-catalog.json.
 *
 * Usage:  node build-catalog.mjs
 *
 * Requires YOUTUBE_API_KEY in .env (or environment).
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

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
if (!YOUTUBE_API_KEY) { console.error('Missing YOUTUBE_API_KEY'); process.exit(1); }

const statePath = path.join(__dirname, '.categorization-state.json');
const outputPath = path.join(__dirname, 'server', 'data', 'pt-catalog.json');

// ---------------------------------------------------------------------------
// Step 1: Read categorization state
// ---------------------------------------------------------------------------

const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
const categories = state.categories;

const totalCategorized = Object.values(categories).reduce((s, c) => s + c.videos.length, 0);
console.log(`Categorization state: ${Object.keys(categories).length} categories, ${totalCategorized} videos\n`);

// ---------------------------------------------------------------------------
// Step 2: Fetch ALL videos from PT channels (paginated)
// ---------------------------------------------------------------------------

const channels = CHANNELS_BY_LANG.pt;
if (!channels) { console.error('No PT channels found'); process.exit(1); }

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

console.log(`Fetching videos from ${channels.length} PT channels...\n`);

const allYouTubeVideos = [];
for (const ch of channels) {
  const videos = await fetchPlaylistVideos(ch.uploadsPlaylist, ch.name);
  for (const v of videos) {
    allYouTubeVideos.push({ ...v, channel: ch.name });
  }
}

console.log(`\nTotal YouTube videos fetched: ${allYouTubeVideos.length}\n`);

// ---------------------------------------------------------------------------
// Step 3: Batch-fetch video details (duration, captions)
// ---------------------------------------------------------------------------

function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] || '0', 10) * 3600) +
         (parseInt(m[2] || '0', 10) * 60) +
         parseInt(m[3] || '0', 10);
}

console.log('Fetching video details (duration, captions)...\n');

const videoDetailsMap = new Map(); // youtube_id -> { duration_seconds, has_captions }
const BATCH_SIZE = 50;

for (let i = 0; i < allYouTubeVideos.length; i += BATCH_SIZE) {
  const batch = allYouTubeVideos.slice(i, i + BATCH_SIZE);
  const ids = batch.map(v => v.id).join(',');

  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  YouTube video details API error: ${res.status}`);
    continue;
  }

  const data = await res.json();
  for (const item of (data.items || [])) {
    videoDetailsMap.set(item.id, {
      duration_seconds: parseDuration(item.contentDetails.duration),
      has_captions: item.contentDetails.caption === 'true',
    });
  }

  process.stdout.write(`\r  Details fetched: ${Math.min(i + BATCH_SIZE, allYouTubeVideos.length)}/${allYouTubeVideos.length}`);
}

console.log('\n');

// ---------------------------------------------------------------------------
// Step 3.5: Detect YouTube Shorts via oEmbed dimensions
// ---------------------------------------------------------------------------

console.log('Detecting YouTube Shorts via oEmbed...\n');

const shortsSet = new Set();
const OEMBED_BATCH = 10; // concurrent requests to avoid rate-limiting

for (let i = 0; i < allYouTubeVideos.length; i += OEMBED_BATCH) {
  const batch = allYouTubeVideos.slice(i, i + OEMBED_BATCH);

  const results = await Promise.allSettled(batch.map(async (v) => {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${v.id}&format=json`;
      const res = await fetch(oembedUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.height && data.width && data.height > data.width) {
          return v.id;
        }
        return null;
      }
      // oEmbed failed — fall back to /shorts/ redirect check
      const shortsRes = await fetch(`https://www.youtube.com/shorts/${v.id}`, { redirect: 'manual' });
      // 200 = Short, 303 = not a Short
      if (shortsRes.status === 200) return v.id;
      return null;
    } catch {
      return null;
    }
  }));

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      shortsSet.add(r.value);
    }
  }

  process.stdout.write(`\r  Checked: ${Math.min(i + OEMBED_BATCH, allYouTubeVideos.length)}/${allYouTubeVideos.length} (${shortsSet.size} Shorts found)`);
}

console.log('\n');

// ---------------------------------------------------------------------------
// Step 4: Build lookup index and match state entries to YouTube data
// ---------------------------------------------------------------------------

// Build a lookup by normalized title + channel
function normalize(s) {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Index YouTube videos by normalized "title|channel"
const ytIndex = new Map();
for (const v of allYouTubeVideos) {
  const key = normalize(v.title) + '|' + normalize(v.channel);
  ytIndex.set(key, v);
}

// Also build a secondary index by title only (for fuzzy matching when channel name differs slightly)
const ytByTitle = new Map();
for (const v of allYouTubeVideos) {
  const key = normalize(v.title);
  if (!ytByTitle.has(key)) ytByTitle.set(key, v);
}

let matched = 0;
let unmatched = 0;
const unmatchedVideos = [];

const catalog = [];

for (const [catId, cat] of Object.entries(categories)) {
  if (cat.videos.length === 0) continue;

  const enrichedVideos = [];

  for (const sv of cat.videos) {
    const key = normalize(sv.title) + '|' + normalize(sv.channel);
    let ytVideo = ytIndex.get(key);

    // Fallback: try title-only match
    if (!ytVideo) {
      ytVideo = ytByTitle.get(normalize(sv.title));
    }

    if (ytVideo) {
      // Skip YouTube Shorts
      if (shortsSet.has(ytVideo.id)) continue;

      const details = videoDetailsMap.get(ytVideo.id);
      enrichedVideos.push({
        youtube_id: ytVideo.id,
        title: sv.title,
        channel: sv.channel,
        thumbnail: `https://img.youtube.com/vi/${ytVideo.id}/mqdefault.jpg`,
        duration_seconds: details?.duration_seconds ?? null,
        has_captions: details?.has_captions ?? false,
      });
      matched++;
    } else {
      unmatched++;
      unmatchedVideos.push({ title: sv.title, channel: sv.channel, category: catId });
    }
  }

  catalog.push({
    id: catId,
    title: cat.title,
    level: cat.level || null,
    videos: enrichedVideos,
  });
}

// Sort catalog: categories with levels first (A1, A2, B1, B2, C1), then by video count desc
const levelOrder = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };
catalog.sort((a, b) => {
  const aLevel = levelOrder[a.level] || 99;
  const bLevel = levelOrder[b.level] || 99;
  if (aLevel !== bLevel) return aLevel - bLevel;
  return b.videos.length - a.videos.length;
});

// ---------------------------------------------------------------------------
// Step 5: Write output
// ---------------------------------------------------------------------------

fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2));

console.log(`Matched: ${matched}`);
console.log(`Shorts filtered: ${shortsSet.size}`);
console.log(`Unmatched: ${unmatched}`);
console.log(`Categories with videos: ${catalog.length}`);
console.log(`Output: ${outputPath}`);

if (unmatchedVideos.length > 0) {
  console.log(`\nUnmatched videos (likely deleted from YouTube or title changed):`);
  for (const v of unmatchedVideos.slice(0, 20)) {
    console.log(`  - [${v.category}] "${v.title}" (${v.channel})`);
  }
  if (unmatchedVideos.length > 20) {
    console.log(`  ... and ${unmatchedVideos.length - 20} more`);
  }
}
