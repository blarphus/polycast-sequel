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

function cloneCachedValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return value;
}

function getCacheKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function invalidateApiCache() {
  cacheEpoch += 1;
  responseCache.clear();
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

  if (body !== undefined && !(body instanceof FormData)) {
    (fetchOpts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    fetchOpts.body = body;
  }

  const executeRequest = async (): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, fetchOpts);

    if (!res.ok) {
      if (res.status === 304) {
        throw new Error(`${upperMethod} ${path} returned 304 without a fresh response body`);
      }
      let payload: any;
      try {
        payload = await res.json();
      } catch (parseErr) {
        console.error(`${upperMethod} ${path} — failed to parse error response (${res.status}):`, parseErr);
        throw new Error(`${upperMethod} ${path} failed (${res.status} ${res.statusText})`);
      }
      throw new Error(payload.error ?? payload.message ?? `${upperMethod} ${path} failed (${res.status})`);
    }

    if (res.status === 204) return undefined as unknown as T;

    return res.json() as Promise<T>;
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
