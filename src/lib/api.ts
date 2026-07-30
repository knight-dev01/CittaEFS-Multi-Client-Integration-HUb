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
