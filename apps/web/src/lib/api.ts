/**
 * Minimal API client. Tokens live in localStorage (MVP); a 401 triggers one
 * silent refresh-and-retry before surfacing the error.
 */

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${status}`,
    );
  }
}

const storage = {
  get access() {
    return localStorage.getItem('approvex.access');
  },
  get refresh() {
    return localStorage.getItem('approvex.refresh');
  },
  set(tokens: { accessToken: string; refreshToken: string }) {
    localStorage.setItem('approvex.access', tokens.accessToken);
    localStorage.setItem('approvex.refresh', tokens.refreshToken);
  },
  clear() {
    localStorage.removeItem('approvex.access');
    localStorage.removeItem('approvex.refresh');
  },
};

export const tokens = storage;

async function rawRequest(path: string, options: RequestInit): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const access = storage.access;
  if (access) headers.set('Authorization', `Bearer ${access}`);
  return fetch(`${BASE}${path}`, { ...options, headers });
}

async function tryRefresh(): Promise<boolean> {
  const refresh = storage.refresh;
  if (!refresh) return false;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  });
  if (!res.ok) {
    storage.clear();
    return false;
  }
  storage.set(await res.json());
  return true;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  };

  let res = await rawRequest(path, init);
  if (res.status === 401 && (await tryRefresh())) {
    res = await rawRequest(path, init);
  }
  if (res.status === 401) {
    storage.clear();
    window.dispatchEvent(new Event('approvex:logout'));
  }

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
