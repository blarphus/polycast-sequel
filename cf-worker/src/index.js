const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const matched = allowed.includes(origin) ? origin : null;
  if (!matched) return null;
  return {
    'Access-Control-Allow-Origin': matched,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

function jsonResponse(data, status, cors) {
  return Response.json(data, {
    status,
    headers: cors || {},
  });
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// Parse YouTube timedtext XML format: <text start="1.23" dur="4.56">caption</text>
function parseTimedtextXml(xml) {
  const segments = [];
  const regex = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const start = parseFloat(m[1]);
    const dur = parseFloat(m[2] || '0');
    const text = decodeEntities(m[3]).replace(/\s+/g, ' ').trim();
    if (!text || !Number.isFinite(start)) continue;
    segments.push({ text, start, dur: Number.isFinite(dur) ? dur : 0 });
  }
  return segments;
}

function parseJson3(json3) {
  const segments = [];
  for (const event of json3?.events || []) {
    if (!event.segs) continue;
    const text = event.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = Number(event.tStartMs);
    if (!Number.isFinite(start)) continue;
    // json3 uses dDurMs; some older responses used dDurationMs
    const dur = Number(event.dDurMs ?? event.dDurationMs ?? 0);
    segments.push({ text, start: start / 1000, dur: dur / 1000 });
  }
  return segments;
}

// Scrape YouTube watch page to extract caption tracks from ytInitialPlayerResponse.
// YouTube blocks InnerTube API from datacenter IPs (LOGIN_REQUIRED),
// but regular page loads still work.
async function getCaptionTracks(videoId) {
  const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!watchRes.ok) {
    throw new Error(`Watch page returned ${watchRes.status}`);
  }
  const html = await watchRes.text();

  const match = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.*?\});/s)
    || html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
  if (!match) {
    throw new Error('Could not find ytInitialPlayerResponse in watch page HTML');
  }

  const playerData = JSON.parse(match[1]);
  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks || captionTracks.length === 0) {
    const playability = playerData?.playabilityStatus?.status;
    throw new Error(`No captions available (playability: ${playability})`);
  }

  return captionTracks;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      if (!cors) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      return jsonResponse({ success: false, error: 'Method not allowed' }, 405, cors);
    }

    // Dual auth: allow if origin matches allowed origins OR bearer token matches
    const originAllowed = Boolean(cors);
    const authHeader = request.headers.get('Authorization');
    const bearerAllowed = env.AUTH_SECRET && authHeader === `Bearer ${env.AUTH_SECRET}`;

    if (!originAllowed && !bearerAllowed) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 403, null);
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // --- Batch playability check (POST ?action=check) ---
    if (request.method === 'POST' && action === 'check') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400, cors);
      }

      const videoIds = body?.videoIds;
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return jsonResponse({ success: false, error: 'videoIds must be a non-empty array' }, 400, cors);
      }
      if (videoIds.length > 50) {
        return jsonResponse({ success: false, error: 'Maximum 50 video IDs per request' }, 400, cors);
      }

      const checks = videoIds.map(async (id) => {
        try {
          const playerRes = await fetch(
            `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                context: { client: { clientName: 'IOS', clientVersion: '20.10.4' } },
                videoId: id,
              }),
            },
          );
          if (!playerRes.ok) return { id, status: 'ERROR', isShort: false };
          const data = await playerRes.json();
          const status = data?.playabilityStatus?.status || 'UNKNOWN';

          // Check video dimensions from adaptive formats to detect vertical (Shorts)
          let isShort = false;
          const formats = data?.streamingData?.adaptiveFormats || [];
          for (const fmt of formats) {
            if (fmt.width && fmt.height) {
              isShort = fmt.height > fmt.width;
              break;
            }
          }

          return { id, status, isShort };
        } catch {
          return { id, status: 'ERROR', isShort: false };
        }
      });

      const settled = await Promise.allSettled(checks);
      const results = {};
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          results[outcome.value.id] = {
            status: outcome.value.status,
            isShort: outcome.value.isShort,
          };
        }
      }

      return jsonResponse({ success: true, results }, 200, cors);
    }

    // --- Get caption track URLs (GET ?action=captions&videoId=...) ---
    // Returns caption track metadata so the browser can fetch timedtext directly
    // using its residential IP (YouTube blocks datacenter IPs for timedtext).
    if (action === 'captions') {
      const videoId = url.searchParams.get('videoId');
      if (!videoId) {
        return jsonResponse({ success: false, error: 'Missing videoId' }, 400, cors);
      }
      try {
        const tracks = await getCaptionTracks(videoId);
        const trackList = tracks.map((t) => ({
          languageCode: t.languageCode,
          kind: t.kind || '',
          name: t.name?.simpleText || '',
          baseUrl: decodeEntities(t.baseUrl),
        }));
        return jsonResponse({ success: true, tracks: trackList }, 200, cors);
      } catch (err) {
        console.error('[cf-worker] getCaptionTracks failed:', err);
        return jsonResponse({ success: false, error: err.message }, 502, cors);
      }
    }

    // --- Transcript fetch (GET ?videoId=...) ---
    // Server-side fetch for when client-side isn't available.
    const videoId = url.searchParams.get('videoId');
    const lang = url.searchParams.get('lang') || 'en';
    if (!videoId) {
      return jsonResponse({ success: false, error: 'Missing required parameter: videoId' }, 400, cors);
    }

    // Step 1: Get caption tracks via watch page scraping
    let captionTracks;
    try {
      captionTracks = await getCaptionTracks(videoId);
    } catch (err) {
      console.error('[cf-worker] getCaptionTracks failed:', err);
      return jsonResponse({ success: false, error: err.message }, 502, cors);
    }

    // Find matching language track, fall back to first
    const track = captionTracks.find((t) => t.languageCode === lang) || captionTracks[0];
    const cleanBaseUrl = decodeEntities(track.baseUrl);
    const cleanUrl = cleanBaseUrl.replace(/&fmt=[^&]*/, '');
    const timedtextUrl = cleanUrl + '&fmt=json3';

    // Step 2: Try fetching timedtext (may fail from datacenter IPs)
    let json3;
    try {
      const ttRes = await fetch(timedtextUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
      if (!ttRes.ok) {
        return jsonResponse(
          { success: false, error: `Timedtext returned ${ttRes.status}` },
          ttRes.status === 429 ? 429 : 502,
          cors,
        );
      }
      const ttText = await ttRes.text();
      if (!ttText || ttText.length === 0) {
        return jsonResponse({ success: false, error: 'Timedtext returned empty response (datacenter IP likely blocked)' }, 502, cors);
      }
      try {
        json3 = JSON.parse(ttText);
      } catch {
        const xmlSegments = parseTimedtextXml(ttText);
        if (xmlSegments.length > 0) {
          return jsonResponse({ success: true, segments: xmlSegments }, 200, cors);
        }
        return jsonResponse({ success: false, error: 'Timedtext response not parseable' }, 502, cors);
      }
    } catch (err) {
      return jsonResponse({ success: false, error: `Timedtext request failed: ${err.message}` }, 502, cors);
    }

    const segments = parseJson3(json3);
    if (segments.length === 0) {
      return jsonResponse({ success: false, error: 'No captions available for this video/language' }, 404, cors);
    }

    return jsonResponse({ success: true, segments }, 200, cors);
  },
};
