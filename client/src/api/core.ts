const BASE = '/api';

export interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function request<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = opts;

  const fetchOpts: RequestInit = {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: { ...headers },
  };

  if (body !== undefined && !(body instanceof FormData)) {
    (fetchOpts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    fetchOpts.body = body;
  }

  const res = await fetch(`${BASE}${path}`, fetchOpts);

  if (!res.ok) {
    if (res.status === 304) {
      throw new Error(`${method} ${path} returned 304 without a fresh response body`);
    }
    let payload: any;
    try {
      payload = await res.json();
    } catch (parseErr) {
      console.error(`${method} ${path} — failed to parse error response (${res.status}):`, parseErr);
      throw new Error(`${method} ${path} failed (${res.status} ${res.statusText})`);
    }
    throw new Error(payload.error ?? payload.message ?? `${method} ${path} failed (${res.status})`);
  }

  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}
