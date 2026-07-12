import { fallbackDiagnostic } from '../diagnostics.js';
import { jsonResponse, providerFetch, readJsonBody } from '../http.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export async function handlePlayability({ request, apiKey, cors, correlationId }) {
  let body;
  try { body = await readJsonBody(request, 32_768); } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 400, cors);
  }
  const videoIds = body?.videoIds;
  if (!Array.isArray(videoIds) || videoIds.length < 1 || videoIds.length > 50 || videoIds.some((id) => typeof id !== 'string' || !VIDEO_ID.test(id))) {
    return jsonResponse({ success: false, error: 'videoIds must contain 1 to 50 valid YouTube IDs' }, 400, cors);
  }
  const checks = videoIds.map(async (id) => {
    try {
      const response = await providerFetch(
        `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: { client: { clientName: 'IOS', clientVersion: '20.10.4' } }, videoId: id }),
        },
      );
      if (!response.ok) throw new Error(`provider HTTP ${response.status}`);
      const data = await response.json();
      const dimensions = (data?.streamingData?.adaptiveFormats || []).find((format) => format.width && format.height);
      return { id, status: data?.playabilityStatus?.status || 'UNKNOWN', isShort: !!dimensions && dimensions.height > dimensions.width };
    } catch (error) {
      return {
        id, status: 'ERROR', isShort: false,
        diagnostic: fallbackDiagnostic({
          code: error?.name === 'TimeoutError' ? 'playability_provider_timeout' : 'playability_provider_failed',
          title: 'Playability check fallback used',
          message: 'Polycast kept this video because its playability could not be verified.',
          operation: 'check-playability', correlationId,
          detail: `videoId=${id}; reason=${error?.message || String(error)}`,
        }),
      };
    }
  });
  const results = {};
  for (const result of await Promise.all(checks)) {
    results[result.id] = { status: result.status, isShort: result.isShort, ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}) };
  }
  return jsonResponse({ success: true, results }, 200, cors);
}
