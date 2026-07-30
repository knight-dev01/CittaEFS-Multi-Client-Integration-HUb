export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof Request) {
    url = input.url;
  } else if (input && typeof input === 'object' && 'href' in (input as any)) {
    url = (input as any).href;
  }

  if (url.includes('/api/')) {
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
  return fetch(input, init);
}

export async function parseJsonResponse<T = any>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    let errorMessage = `HTTP ${res.status} ${res.statusText || 'Error'}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.error) errorMessage = parsed.error;
      else if (parsed && parsed.message) errorMessage = parsed.message;
    } catch {
      if (text) {
        const cleanText = text.replace(/<[^>]*>/g, '').trim();
        errorMessage = cleanText.slice(0, 150) || errorMessage;
      }
    }
    throw new Error(errorMessage);
  }
  
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const errorMessage = data?.error || data?.message || `HTTP ${res.status} ${res.statusText || 'Error'}`;
    throw new Error(errorMessage);
  }

  return res.json();
}

export async function safeFetchJson<T = any>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(input, init);
  return parseJsonResponse<T>(res);
}
