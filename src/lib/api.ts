export function getApiBaseUrl(): string {
  // Canonical config: set VITE_API_BASE_URL to the backend origin in the Vercel
  // project environment (e.g. https://cittaefs-multi-client-integration-hub.onrender.com).
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  // Secondary resolution for *.vercel.app preview/production hosts that have
  // not set VITE_API_BASE_URL: call the Render backend directly. All API,
  // WebSocket (/api/ws-events) and SSE (/api/events) traffic goes cross-origin
  // to Render, which the backend's CORS middleware reflects back per-request.
  // Do NOT route /api through a Vercel rewrite — Vercel rewrites are HTTP-only
  // and would break the WebSocket upgrade used for live telemetry.
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    return 'https://cittaefs-multi-client-integration-hub.onrender.com';
  }

  // Same-origin (local dev served by the Express+Vite server, or any same-host deploy).
  return '';
}

function isApiRequest(url: string): boolean {
  return url.startsWith('/api/') || url.includes('/api/');
}

function resolveApiInput(input: RequestInfo | URL): { url: string; finalInput: RequestInfo | URL } {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof Request) {
    url = input.url;
  } else if (input && typeof input === 'object' && 'href' in (input as any)) {
    url = (input as any).href;
  }

  const baseUrl = getApiBaseUrl();
  const finalInput = baseUrl && url.startsWith('/api/') ? `${baseUrl}${url}` : input;
  return { url, finalInput };
}

function withBearerToken(init?: RequestInit, token?: string | null): RequestInit | undefined {
  if (!token) return init;
  const nextInit = { ...(init || {}) };
  const headers = new Headers(nextInit.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  nextInit.headers = headers;
  return nextInit;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('citta_refresh_token');
  if (!refreshToken) return null;

  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });

  if (!res.ok) {
    localStorage.removeItem('citta_jwt_token');
    localStorage.removeItem('citta_refresh_token');
    localStorage.removeItem('cittaefs_user_session');
    return null;
  }

  const data = await res.json();
  if (!data?.success || !data.token) return null;

  localStorage.setItem('citta_jwt_token', data.token);
  if (data.refreshToken) {
    localStorage.setItem('citta_refresh_token', data.refreshToken);
  }
  return data.token;
}

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { url, finalInput } = resolveApiInput(input);

  if (!isApiRequest(url)) {
    return fetch(finalInput, init);
  }

  const isAuthEndpoint =
    url.includes('/api/auth/login') ||
    url.includes('/api/auth/logout') ||
    url.includes('/api/auth/refresh');

  const token = localStorage.getItem('citta_jwt_token');
  const authedInit = withBearerToken(init, token);
  const firstRes = await fetch(finalInput, authedInit);

  if (firstRes.status !== 401 || isAuthEndpoint) {
    return firstRes;
  }

  const refreshedToken = await refreshAccessToken();
  if (!refreshedToken) {
    return firstRes;
  }

  return fetch(finalInput, withBearerToken(init, refreshedToken));
}

export async function parseJsonResponse<T = any>(res: Response): Promise<T> {
  const text = await res.text().catch(() => '');

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status} ${res.statusText || 'Error'}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        errorMessage = parsed.errors.join(' | ');
      } else if (parsed && (parsed.error || parsed.message)) {
        errorMessage = parsed.error || parsed.message;
      }
    } catch {
      if (text) {
        const cleanText = text.replace(/<[^>]*>/g, '').trim();
        if (cleanText) errorMessage = cleanText.slice(0, 150);
      }
    }
    throw new Error(errorMessage);
  }

  try {
    return JSON.parse(text);
  } catch {
    const cleanText = text.replace(/<[^>]*>/g, '').trim();
    const snippet = cleanText.slice(0, 100) || text.slice(0, 100);
    throw new Error(`Invalid JSON response from server (${res.status}): ${snippet}`);
  }
}

export async function safeFetchJson<T = any>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(input, init);
  return parseJsonResponse<T>(res);
}

