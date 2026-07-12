export function parseJson3(json3) {
  const segments = [];
  for (const event of json3?.events || []) {
    if (!event.segs) continue;
    const text = event.segs.map((segment) => segment.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    const start = Number(event.tStartMs);
    const dur = Number(event.dDurationMs);
    if (!text || !Number.isFinite(start) || !Number.isFinite(dur)) continue;
    const words = event.segs
      .filter((segment) => String(segment.utf8 || '').trim())
      .map((segment) => ({
        text: segment.utf8,
        offset: Number.isFinite(Number(segment.tOffsetMs)) ? Number(segment.tOffsetMs) : 0,
      }));
    segments.push({ text, start: start / 1000, dur: dur / 1000, words });
  }
  return segments;
}

function runsText(node) {
  return (node?.runs || []).map((run) => run?.text || '').join('') || node?.simpleText || null;
}

function largestThumbnail(node) {
  return [...(node?.thumbnails || [])].sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0]?.url || null;
}

export function collectRelated(node, output, seen) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const value of node) collectRelated(value, output, seen);
    return;
  }
  const renderer = node.endScreenVideoRenderer;
  if (renderer?.videoId && !seen.has(renderer.videoId)) {
    const title = runsText(renderer.title);
    if (title) {
      seen.add(renderer.videoId);
      output.push({
        youtubeId: renderer.videoId,
        title,
        channel: runsText(renderer.shortBylineText) || '',
        thumbnail: `https://i.ytimg.com/vi/${renderer.videoId}/hqdefault.jpg`,
        durationSeconds: null,
        publishedAt: null,
        viewCount: null,
        hasCaptions: null,
      });
    }
  }
  for (const value of Object.values(node)) collectRelated(value, output, seen);
}

export function findVideoOwner(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const value of node) {
      const result = findVideoOwner(value);
      if (result) return result;
    }
    return null;
  }
  const owner = node.videoOwnerRenderer;
  if (owner) {
    const browse = owner.navigationEndpoint?.browseEndpoint || {};
    const canonical = browse.canonicalBaseUrl || '';
    return {
      channelName: runsText(owner.title),
      channelHandle: canonical.startsWith('/@') ? canonical.slice(2) : null,
      channelID: browse.browseId || null,
      channelAvatarURL: largestThumbnail(owner.thumbnail),
    };
  }
  for (const value of Object.values(node)) {
    const result = findVideoOwner(value);
    if (result) return result;
  }
  return null;
}
