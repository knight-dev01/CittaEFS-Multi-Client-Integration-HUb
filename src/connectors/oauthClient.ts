/**
 * One fetch-backed OAuth 2.0 client for every ERP.
 *
 * Providers differ in three ways only: which URLs they use, whether client
 * credentials go in the Basic header or the form body, and how the token
 * response is shaped. Those are configuration, not code — a new ERP supplies
 * an OAuthProvider and gets authorize, exchange, refresh and revoke for free.
 */
import type {
  OAuthClientCredentials,
  OAuthProvider,
  OAuthTokenSet,
  RevokeBodyStyle,
  TokenAuthStyle,
} from "./types";

export interface OAuthRequestOptions {
  fetchImpl?: typeof fetch;
  now?: number;
}

export interface AuthorizationUrlOptions {
  state?: string;
  /** PKCE code challenge (S256). Sent as code_challenge / code_challenge_method. */
  codeChallenge?: string;
  extraParams?: Record<string, string>;
}

export interface CodeExchangeOptions extends OAuthRequestOptions {
  codeVerifier?: string;
  extraParams?: Record<string, string>;
}

export class OAuthRequestError extends Error {
  status: number;
  body: string;
  needsReauth: boolean;

  constructor(
    message: string,
    options: { status?: number; body?: string; needsReauth?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "OAuthRequestError";
    this.status = options.status ?? 0;
    this.body = options.body ?? "";
    this.needsReauth = options.needsReauth ?? true;
    if (options.cause !== undefined) (this as any).cause = options.cause;
  }
}

function authStyle(provider: OAuthProvider): TokenAuthStyle {
  return provider.tokenAuthStyle ?? "basic";
}

function revokeStyle(provider: OAuthProvider): RevokeBodyStyle {
  return provider.revokeBodyStyle ?? "form";
}

function authorizationParams(
  provider: OAuthProvider,
  client: OAuthClientCredentials,
  options?: AuthorizationUrlOptions,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("response_type", "code");
  params.set("client_id", client.clientId);
  if (client.redirectUri) params.set("redirect_uri", client.redirectUri);
  if (provider.scopes.length) {
    params.set("scope", provider.scopes.join(provider.scopeSeparator ?? " "));
  }
  for (const [key, value] of Object.entries(provider.authorizationParams ?? {})) {
    params.set(key, value);
  }
  if (options?.state) params.set("state", options.state);
  if (options?.codeChallenge) {
    params.set("code_challenge", options.codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  for (const [key, value] of Object.entries(options?.extraParams ?? {})) {
    params.set(key, value);
  }
  return params;
}

export function buildAuthorizationUrl(
  provider: OAuthProvider,
  client: OAuthClientCredentials,
  options?: AuthorizationUrlOptions,
): string {
  const url = new URL(provider.authorizationUrl);
  const params = authorizationParams(provider, client, options);
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function toTokenSet(raw: Record<string, any>, now = Date.now()): OAuthTokenSet {
  if (!raw || typeof raw.access_token !== "string" || !raw.access_token) {
    throw new OAuthRequestError("Token endpoint returned no access_token.");
  }

  const expiresIn = Number(raw.expires_in);
  const refreshExpiresIn = Number(raw.x_refresh_token_expires_in);
  const tokenType = typeof raw.token_type === "string" && raw.token_type ? raw.token_type : "Bearer";

  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" && raw.refresh_token ? raw.refresh_token : undefined,
    expiresAt: new Date(now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000),
    refreshTokenExpiresAt:
      Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
        ? new Date(now + refreshExpiresIn * 1000)
        : undefined,
    tokenType,
    scope: typeof raw.scope === "string" ? raw.scope : undefined,
    raw,
  };
}

export function isTokenExpiring(
  expiresAt: Date | string | number | null | undefined,
  skewMs = 5 * 60 * 1000,
  now = Date.now(),
): boolean {
  if (expiresAt === null || expiresAt === undefined) return true;
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return true;
  return at - now < skewMs;
}

interface TokenRequestOptions extends OAuthRequestOptions {
  extraParams?: Record<string, string>;
}

async function requestToken(
  provider: OAuthProvider,
  client: OAuthClientCredentials,
  body: Record<string, string>,
  options?: TokenRequestOptions,
): Promise<OAuthTokenSet> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const params = new URLSearchParams(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (authStyle(provider) === "basic") {
    const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  } else {
    params.set("client_id", client.clientId);
    params.set("client_secret", client.clientSecret);
  }

  for (const [key, value] of Object.entries(options?.extraParams ?? {})) {
    params.set(key, value);
  }

  let response: Response;
  try {
    response = await fetchImpl(provider.tokenUrl, {
      method: "POST",
      headers,
      body: params.toString(),
    });
  } catch (error: any) {
    throw new OAuthRequestError(`Could not reach the token endpoint: ${error?.message || error}`, {
      cause: error,
    });
  }

  const text = await response.text();
  if (!response.ok) {
    throw new OAuthRequestError(
      `Token endpoint rejected the request (${response.status}): ${text}`,
      { status: response.status, body: text },
    );
  }

  let raw: Record<string, any>;
  try {
    raw = JSON.parse(text);
  } catch (error: any) {
    throw new OAuthRequestError("Token endpoint returned a response that was not JSON.", {
      status: response.status,
      body: text,
      cause: error,
    });
  }

  return toTokenSet(raw, options?.now);
}

export async function exchangeAuthorizationCode(
  provider: OAuthProvider,
  client: OAuthClientCredentials,
  code: string,
  options?: CodeExchangeOptions,
): Promise<OAuthTokenSet> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
  };
  if (client.redirectUri) body.redirect_uri = client.redirectUri;
  if (options?.codeVerifier) body.code_verifier = options.codeVerifier;

  return requestToken(provider, client, body, options);
}

export async function refreshAccessToken(
  provider: OAuthProvider,
  client: OAuthClientCredentials,
  refreshToken: string,
  options?: OAuthRequestOptions,
): Promise<OAuthTokenSet> {
  return requestToken(provider, client, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }, options);
}

export async function revokeAccessToken(
  provider: OAuthProvider,
  client: OAuthClientCredentials,
  token: string,
  options?: OAuthRequestOptions,
): Promise<boolean> {
  if (!provider.revokeUrl) return false;

  const fetchImpl = options?.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string;

  if (revokeStyle(provider) === "json") {
    const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ token });
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const params = new URLSearchParams({ token });
    if (authStyle(provider) === "body") {
      params.set("client_id", client.clientId);
      params.set("client_secret", client.clientSecret);
    } else {
      const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }
    body = params.toString();
  }

  try {
    const response = await fetchImpl(provider.revokeUrl, { method: "POST", headers, body });
    return response.ok;
  } catch {
    return false;
  }
}
