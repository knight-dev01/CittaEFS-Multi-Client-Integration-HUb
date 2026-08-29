export const DEFAULT_CITTA_ENDPOINT = 'https://ei-api.azurewebsites.net';

const CITTA_ENDPOINT_STORAGE_KEY = 'citta_gateway_rest_endpoint';

export function getStoredCittaEndpoint(): string {
  if (typeof window === 'undefined') return DEFAULT_CITTA_ENDPOINT;

  try {
    const saved = window.localStorage.getItem(CITTA_ENDPOINT_STORAGE_KEY);
    return saved?.trim() || DEFAULT_CITTA_ENDPOINT;
  } catch {
    return DEFAULT_CITTA_ENDPOINT;
  }
}

export function saveStoredCittaEndpoint(endpoint: string) {
  if (typeof window === 'undefined') return;

  const normalizedEndpoint = endpoint.trim() || DEFAULT_CITTA_ENDPOINT;
  window.localStorage.setItem(CITTA_ENDPOINT_STORAGE_KEY, normalizedEndpoint);
}
