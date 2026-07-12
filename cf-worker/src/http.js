import { fallbackDiagnostic } from './diagnostics.js';

export function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Correlation-ID',
  };
}

export function jsonResponse(data, status, cors) {
  return Response.json(data, { status, headers: cors || {} });
}

export function failureResponse({ code, title, message, operation, detail, status = 502, correlationId, cors, severity = 'warning' }) {
  const diagnostic = fallbackDiagnostic({ code, title, message, operation, detail, correlationId, severity });
  return jsonResponse({ success: false, error: message, fallback_notices: [diagnostic] }, status, cors);
}

export async function readJsonBody(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) throw new Error(`Request body exceeds ${maxBytes} bytes`);
  if (!request.body) return {};
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel('body limit exceeded');
      throw new Error(`Request body exceeds ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text || '{}'); } catch { throw new Error('Invalid JSON body'); }
}

export function providerFetch(url, options = {}, timeoutMs = 8_000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}
