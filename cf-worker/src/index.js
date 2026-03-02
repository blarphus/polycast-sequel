const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

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
    if (request.method !== 'GET') {
      return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
    }

    const authHeader = request.headers.get('Authorization');
    if (!env.AUTH_SECRET || authHeader !== `Bearer ${env.AUTH_SECRET}`) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const videoId = url.searchParams.get('videoId');
    const lang = url.searchParams.get('lang') || 'en';
    if (!videoId) {
      return Response.json({ success: false, error: 'Missing required parameter: videoId' }, { status: 400 });
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
            context: { client: { clientName: 'IOS', clientVersion: '20.10.4' } },
            videoId,
          }),
        },
      );
      if (!playerRes.ok) {
        console.error(`[cf-worker] Player API HTTP ${playerRes.status}`);
        return Response.json(
          { success: false, error: `Player API returned ${playerRes.status}` },
          { status: playerRes.status === 429 ? 429 : 502 },
        );
      }
      playerData = await playerRes.json();
    } catch (err) {
      console.error(`[cf-worker] Player API fetch failed:`, err);
      return Response.json({ success: false, error: `Player API request failed: ${err.message}` }, { status: 502 });
    }

    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      const status = playerData?.playabilityStatus;
      console.error(`[cf-worker] No captions. Playability: ${status?.status} - ${status?.reason || 'none'}`);
      return Response.json({ success: false, error: 'No captions available for this video' }, { status: 404 });
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
        return Response.json(
          { success: false, error: `Timedtext returned ${ttRes.status}` },
          { status: ttRes.status === 429 ? 429 : 502 },
        );
      }
      json3 = await ttRes.json();
    } catch (err) {
      console.error(`[cf-worker] Timedtext fetch failed:`, err);
      return Response.json({ success: false, error: `Timedtext request failed: ${err.message}` }, { status: 502 });
    }

    const segments = parseJson3(json3);
    if (segments.length === 0) {
      return Response.json({ success: false, error: 'No captions available for this video/language' }, { status: 404 });
    }

    return Response.json({ success: true, segments });
  },
};
