import { emitFallbackDiagnostic, type FallbackDiagnostic } from '../utils/fallbackDiagnostics';
import { logRuntimeDiagnostic } from '../utils/runtimeDiagnostics';

const BASE = '/api';

export interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  cacheTtlMs?: number;
}

const inflightGetRequests = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { data: unknown; expiresAt: number }>();
let cacheEpoch = 0;
let apiSessionActive = false;
let sessionExpirationReported = false;

export const SESSION_EXPIRED_EVENT = 'polycast:session-expired';

export interface SessionExpiredDetail {
  diagnostic: FallbackDiagnostic;
  path: string;
  status: 401;
}

if (typeof window !== 'undefined') {
  window.addEventListener('polycast-offline-dictionary-external-sync', () => {
    invalidateApiCache();
  });
}

function emitServerFallbackNotices(payload: unknown) {
  if (!payload || typeof payload !== 'object') return;
  const notices = (payload as { fallback_notices?: unknown }).fallback_notices;
  if (!Array.isArray(notices)) return;
  for (const notice of notices) {
    if (!notice || typeof notice !== 'object') continue;
    emitFallbackDiagnostic(notice as Partial<FallbackDiagnostic>, {
      source: 'web.api',
      operation: 'server-response',
    });
  }
}

function emitServerFallbackHeaders(response: Response) {
  const encoded = response.headers.get('X-Polycast-Fallback-Diagnostics');
  if (!encoded) return;
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = decodeURIComponent(Array.from(atob(padded), (character) =>
      `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    const notices = JSON.parse(json);
    if (!Array.isArray(notices)) throw new Error('diagnostic header is not an array');
    for (const notice of notices) emitFallbackDiagnostic(notice, { source: 'web.api', operation: 'response-header' });
  } catch (error) {
    emitFallbackDiagnostic({
      code: 'fallback_header_invalid',
      severity: 'warning',
      title: 'Fallback details could not be read',
      message: 'The server reported an alternate path, but its diagnostic header was malformed.',
      detail: error instanceof Error ? error.message : String(error),
    }, { source: 'web.api', operation: 'parse-response-header' });
  }
}

function emitOfflineFallback(path: string, reason: string) {
  emitFallbackDiagnostic({
    code: 'offline_dictionary_used',
    severity: 'warning',
    title: 'Offline fallback used',
    message: `${path} used local offline data.`,
    detail: reason,
  }, { source: 'web.api', operation: `${path}` });
}

async function getOfflineFallback(path: string, method: string, body: unknown) {
  const { handleOfflineRequest } = await import('./offlineDictionary');
  return handleOfflineRequest(path, method, body);
}

function cloneCachedValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return value;
}

function getCacheKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function shouldTryOfflineFirst(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_POLYCAST_OFFLINE === '1') return true;
  return typeof window !== 'undefined' &&
    window.localStorage.getItem('polycast.offline.enabled') === 'true';
}

function isUnavailableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export function invalidateApiCache() {
  cacheEpoch += 1;
  responseCache.clear();
}

/**
 * AuthProvider owns whether the browser currently represents an authenticated
 * session. Keeping that state explicit prevents a normal anonymous /me probe
 * from being mislabeled as an expired session.
 */
export function setApiSessionActive(active: boolean) {
  apiSessionActive = active;
  if (active) sessionExpirationReported = false;
  if (!active) invalidateApiCache();
}

function reportSessionExpiration(path: string, correlationId: string) {
  if (!apiSessionActive || sessionExpirationReported) return;
  sessionExpirationReported = true;
  apiSessionActive = false;
  invalidateApiCache();
  const diagnostic = emitFallbackDiagnostic({
    code: 'session_expired',
    severity: 'error',
    title: 'Session expired',
    message: 'Your signed-in session is no longer valid. Polycast signed this browser out; please log in again.',
    detail: `status=401; path=${path}`,
    correlationId,
  }, { source: 'web.api', operation: 'invalidate-session' });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SessionExpiredDetail>(SESSION_EXPIRED_EVENT, {
      detail: { diagnostic, path, status: 401 },
    }));
  }
}

export async function request<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, cacheTtlMs = 0 } = opts;
  const upperMethod = method.toUpperCase();
  const cacheKey = getCacheKey(upperMethod, path);

  if (upperMethod === 'GET') {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cloneCachedValue(cached.data as T);
    }

    const inflight = inflightGetRequests.get(cacheKey);
    if (inflight) {
      return inflight as Promise<T>;
    }
  }

  const fetchOpts: RequestInit = {
    method: upperMethod,
    credentials: 'include',
    headers: { ...headers },
  };
  const requestCorrelationId = headers['X-Correlation-ID'] || globalThis.crypto?.randomUUID?.() || `web-${Date.now()}`;
  (fetchOpts.headers as Record<string, string>)['X-Correlation-ID'] = requestCorrelationId;

  if (body !== undefined && !(body instanceof FormData)) {
    (fetchOpts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    fetchOpts.body = body;
  }

  const executeRequest = async (): Promise<T> => {
    if (shouldTryOfflineFirst()) {
      const fallback = await getOfflineFallback(path, upperMethod, body);
      if (fallback.handled) {
        emitOfflineFallback(path, 'Offline mode is enabled.');
        return fallback.data as T;
      }
    }

    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, fetchOpts);
    } catch (err) {
      const fallback = await getOfflineFallback(path, upperMethod, body);
      if (fallback.handled) {
        emitOfflineFallback(path, err instanceof Error ? err.message : 'Network request failed.');
        return fallback.data as T;
      }
      throw err;
    }

    emitServerFallbackHeaders(res);
    const responseCorrelationId = res.headers.get('X-Correlation-ID') || requestCorrelationId;

    if (!res.ok) {
      if (res.status === 304) {
        throw new Error(`${upperMethod} ${path} returned 304 without a fresh response body`);
      }
      if (isUnavailableStatus(res.status)) {
        const fallback = await getOfflineFallback(path, upperMethod, body);
        if (fallback.handled) {
          emitOfflineFallback(path, `Server returned ${res.status} ${res.statusText}.`);
          return fallback.data as T;
        }
      }
      let payload: any;
      try {
        payload = await res.json();
        emitServerFallbackNotices(payload);
      } catch (parseErr) {
        if (res.status === 401) reportSessionExpiration(path, responseCorrelationId);
        logRuntimeDiagnostic({
          code: 'api_error_payload_invalid',
          source: 'web.api',
          operation: `${upperMethod} ${path}`,
          correlationId: responseCorrelationId,
          message: `The server error response could not be parsed (${res.status}).`,
          detail: parseErr,
        });
        throw new Error(`${upperMethod} ${path} failed (${res.status} ${res.statusText})`);
      }
      if (res.status === 401) reportSessionExpiration(path, responseCorrelationId);
      throw new Error(payload.error ?? payload.message ?? `${upperMethod} ${path} failed (${res.status})`);
    }

    if (res.status === 204) return undefined as unknown as T;

    const payload = await res.json();
    emitServerFallbackNotices(payload);
    return payload as T;
  };

  if (upperMethod === 'GET') {
    const requestEpoch = cacheEpoch;
    const promise = executeRequest()
      .then((data) => {
        if (cacheTtlMs > 0 && requestEpoch === cacheEpoch) {
          responseCache.set(cacheKey, {
            data,
            expiresAt: Date.now() + cacheTtlMs,
          });
        } else {
          responseCache.delete(cacheKey);
        }
        return cloneCachedValue(data);
      })
      .finally(() => {
        inflightGetRequests.delete(cacheKey);
      });

    inflightGetRequests.set(cacheKey, promise);
    return promise;
  }

  const data = await executeRequest();
  invalidateApiCache();
  return data;
}
