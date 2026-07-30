export function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }
  
  // When running on Vercel frontend pointing to external Render API
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    return 'https://cittaefs-multi-client-integration-hub.onrender.com';
  }
  
  return '';
}

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof Request) {
    url = input.url;
  } else if (input && typeof input === 'object' && 'href' in (input as any)) {
    url = (input as any).href;
  }

  const baseUrl = getApiBaseUrl();
  let finalInput: RequestInfo | URL = input;

  if (url.startsWith('/api/') || url.includes('/api/')) {
    if (baseUrl && url.startsWith('/api/')) {
      finalInput = `${baseUrl}${url}`;
    }
    const token = localStorage.getItem('citta_jwt_token');
    if (token) {
      init = init || {};
      const headers = new Headers(init.headers || {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
        init.headers = headers;
      }
    }
  }

  return fetch(finalInput, init);
}

export async function parseJsonResponse<T = any>(res: Response): Promise<T> {
  const text = await res.text().catch(() => '');

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status} ${res.statusText || 'Error'}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed && (parsed.error || parsed.message)) {
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

