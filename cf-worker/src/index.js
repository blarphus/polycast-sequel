import { authorizeWorkerRequest } from './auth.js';
import { fallbackDiagnostic } from './diagnostics.js';
import { handlePlayability } from './handlers/playability.js';
import { handleRelated } from './handlers/related.js';
import { handleTranscript } from './handlers/transcript.js';
import { handleTts } from './handlers/tts.js';
import { corsHeaders, jsonResponse } from './http.js';

const ACTIONS = Object.freeze({
  related: { method: 'GET', requiresProviderKey: true, handler: handleRelated },
  tts: { method: 'POST', requiresProviderKey: false, handler: handleTts },
  check: { method: 'POST', requiresProviderKey: true, handler: handlePlayability },
  transcript: { method: 'GET', requiresProviderKey: true, handler: handleTranscript },
});

function requestedAction(url) {
  const raw = url.searchParams.get('action');
  return raw || 'transcript';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') {
      if (!cors) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const action = requestedAction(url);
    const policy = ACTIONS[action];
    if (!policy) return jsonResponse({ success: false, error: `Unknown media action: ${action}` }, 404, cors);
    if (request.method !== policy.method) return jsonResponse({ success: false, error: `${action} requires ${policy.method}` }, 405, cors);

    const authorization = await authorizeWorkerRequest(request, env, action);
    if (!authorization.ok) {
      return jsonResponse({ success: false, error: authorization.error, fallback_notices: [authorization.diagnostic] }, authorization.status, cors);
    }

    const apiKey = String(env.INNERTUBE_API_KEY || '').trim();
    if (policy.requiresProviderKey && !apiKey) {
      const diagnostic = fallbackDiagnostic({
        code: 'media_provider_configuration_missing',
        title: 'Media provider unavailable',
        message: 'The media provider is not configured, so this request cannot continue.',
        operation: action,
        correlationId: authorization.correlationId,
      });
      return jsonResponse({ success: false, error: 'Media provider is not configured', fallback_notices: [diagnostic] }, 503, cors);
    }

    return policy.handler({ request, env, url, apiKey, cors, correlationId: authorization.correlationId });
  },
};
