import { failureResponse, jsonResponse, providerFetch } from '../http.js';
import { collectRelated, findVideoOwner } from '../youtubePayload.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export async function handleRelated({ url, apiKey, cors, correlationId }) {
  const videoId = url.searchParams.get('videoId') || '';
  if (!VIDEO_ID.test(videoId)) return jsonResponse({ success: false, error: 'videoId must be an 11-character YouTube ID' }, 400, cors);
  try {
    const response = await providerFetch(
      `https://www.youtube.com/youtubei/v1/next?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } }, videoId }),
      },
    );
    if (!response.ok) return failureResponse({
      code: 'related_provider_http_error', title: 'Related videos unavailable',
      message: 'The related-video provider returned an error, so no related list is available.',
      operation: 'related', detail: `videoId=${videoId}; status=${response.status}`,
      correlationId, cors,
    });
    const data = await response.json();
    const videos = [];
    collectRelated(data, videos, new Set());
    return jsonResponse({ success: true, ...(findVideoOwner(data) || {}), videos }, 200, cors);
  } catch (error) {
    return failureResponse({
      code: error?.name === 'TimeoutError' ? 'related_provider_timeout' : 'related_provider_failed',
      title: 'Related videos unavailable',
      message: 'The related-video request failed, so no related list is available.',
      operation: 'related', detail: `videoId=${videoId}; reason=${error?.message || String(error)}`,
      correlationId, cors,
    });
  }
}
