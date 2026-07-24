import { fallbackDiagnostic } from '../diagnostics.js';
import { jsonResponse, providerFetch, readJsonBody } from '../http.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYABILITY_CONCURRENCY = 6;
const PLAYABILITY_TIMEOUT_MS = 12_000;
const PLAYABILITY_TIMEOUT_RETRY_BUDGET = 8;

function playerRequest(apiKey, id, client) {
  return providerFetch(
    `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client }, videoId: id }),
    },
    PLAYABILITY_TIMEOUT_MS,
  );
}

export async function handlePlayability({ request, apiKey, cors, correlationId }) {
  let body;
  try { body = await readJsonBody(request, 32_768); } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 400, cors);
  }
  const videoIds = body?.videoIds;
  if (!Array.isArray(videoIds) || videoIds.length < 1 || videoIds.length > 50 || videoIds.some((id) => typeof id !== 'string' || !VIDEO_ID.test(id))) {
    return jsonResponse({ success: false, error: 'videoIds must contain 1 to 50 valid YouTube IDs' }, 400, cors);
  }
  let nextIndex = 0;
  let timeoutRetriesRemaining = PLAYABILITY_TIMEOUT_RETRY_BUDGET;
  const results = {};

  async function check(id) {
    let attempts = 0;
    try {
      attempts += 1;
      let response;
      try {
        response = await playerRequest(apiKey, id, { clientName: 'IOS', clientVersion: '20.10.4' });
      } catch (error) {
        if (error?.name !== 'TimeoutError' || timeoutRetriesRemaining <= 0) throw error;
        timeoutRetriesRemaining -= 1;
        attempts += 1;
        response = await playerRequest(apiKey, id, { clientName: 'ANDROID', clientVersion: '20.10.38' });
      }
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
          detail: `videoId=${id}; attempts=${attempts}; reason=${error?.message || String(error)}`,
        }),
      };
    }
  }

  async function runChecks() {
    while (nextIndex < videoIds.length) {
      const id = videoIds[nextIndex];
      nextIndex += 1;
      const result = await check(id);
      results[result.id] = { status: result.status, isShort: result.isShort, ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}) };
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(PLAYABILITY_CONCURRENCY, videoIds.length) },
    () => runChecks(),
  ));
  return jsonResponse({ success: true, results }, 200, cors);
}
