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

function parseJson3(json3) {
  const segments = [];
  for (const event of json3?.events || []) {
    if (!event.segs) continue;
    const text = event.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = Number(event.tStartMs);
    const dur = Number(event.dDurationMs);
    if (!Number.isFinite(start) || !Number.isFinite(dur)) continue;
    segments.push({ text, start: start / 1000, dur: dur / 1000 });
  }
  return segments;
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
                context: { client: { clientName: 'WEB', clientVersion: '2.20250312.00.00' } },
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

    // --- Transcript fetch (GET ?videoId=...) ---
    const videoId = url.searchParams.get('videoId');
    const lang = url.searchParams.get('lang') || 'en';
    if (!videoId) {
      return jsonResponse({ success: false, error: 'Missing required parameter: videoId' }, 400, cors);
    }

    // Step 1: InnerTube Player API — get caption tracks
    let playerData;
    try {
      const playerRes = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion: '2.20250312.00.00' } },
            videoId,
          }),
        },
      );
      if (!playerRes.ok) {
        console.error(`[cf-worker] Player API HTTP ${playerRes.status}`);
        return jsonResponse(
          { success: false, error: `Player API returned ${playerRes.status}` },
          playerRes.status === 429 ? 429 : 502,
          cors,
        );
      }
      playerData = await playerRes.json();
    } catch (err) {
      console.error(`[cf-worker] Player API fetch failed:`, err);
      return jsonResponse({ success: false, error: `Player API request failed: ${err.message}` }, 502, cors);
    }

    const playability = playerData?.playabilityStatus?.status;
    // LOGIN_REQUIRED / ERROR = YouTube is blocking this request (not a caption issue)
    if (playability === 'LOGIN_REQUIRED' || playability === 'ERROR') {
      console.error(`[cf-worker] YouTube blocked: ${playability} - ${playerData?.playabilityStatus?.reason || 'none'}`);
      return jsonResponse(
        { success: false, error: `YouTube blocked request: ${playability}` },
        503,
        cors,
      );
    }

    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      console.error(`[cf-worker] No captions. Playability: ${playability} - ${playerData?.playabilityStatus?.reason || 'none'}`);
      return jsonResponse({ success: false, error: 'No captions available for this video' }, 404, cors);
    }

    // Find matching language track, fall back to first
    const track = captionTracks.find((t) => t.languageCode === lang) || captionTracks[0];
    const timedtextUrl = track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';

    // Step 2: Fetch timedtext as JSON3
    let json3;
    try {
      const ttRes = await fetch(timedtextUrl);
      if (!ttRes.ok) {
        console.error(`[cf-worker] Timedtext HTTP ${ttRes.status}`);
        return jsonResponse(
          { success: false, error: `Timedtext returned ${ttRes.status}` },
          ttRes.status === 429 ? 429 : 502,
          cors,
        );
      }
      json3 = await ttRes.json();
    } catch (err) {
      console.error(`[cf-worker] Timedtext fetch failed:`, err);
      return jsonResponse({ success: false, error: `Timedtext request failed: ${err.message}` }, 502, cors);
    }

    const segments = parseJson3(json3);
    if (segments.length === 0) {
      return jsonResponse({ success: false, error: 'No captions available for this video/language' }, 404, cors);
    }

    return jsonResponse({ success: true, segments }, 200, cors);
  },
};
