import { getSubtitles } from 'youtube-caption-extractor';

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

    let subtitles;
    try {
      subtitles = await getSubtitles({ videoID: videoId, lang });
    } catch (err) {
      console.error(`[cf-worker] getSubtitles threw for ${videoId}:`, err);
      return Response.json({ success: false, error: `Caption extraction failed: ${err.message}` }, { status: 500 });
    }

    // youtube-caption-extractor returns [] when no captions exist (does not throw)
    if (!subtitles || subtitles.length === 0) {
      return Response.json({ success: false, error: 'No captions available for this video/language' }, { status: 404 });
    }

    const segments = subtitles.map((s) => ({
      text: s.text,
      start: Number(s.start),
      dur: Number(s.dur),
    }));

    return Response.json({ success: true, segments });
  },
};
