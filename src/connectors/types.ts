/**
 * Shared contracts for ERP connectors.
 *
 * Every connector is a thin provider file plus one of these shapes:
 *   - OAuthProvider         describe the provider's auth endpoints and scopes
 *   - ConnectorSyncPipeline describe how to page records and ingest one record
 *
 * The hub owns the rest: token storage/refresh, OAuth routes, sync bookkeeping
 * and audit logging live in oauthClient.ts, tokenStore.ts, oauthRoutes.ts and
 * syncPipeline.ts. A new OAuth ERP should not need to copy qboService.ts.
 */

export type TokenAuthStyle = "basic" | "body";
export type RevokeBodyStyle = "form" | "json";

export interface OAuthProvider {
  /** Provider page the browser is sent to, e.g. https://appcenter.intuit.com/connect/oauth2 */
  authorizationUrl: string;
  /** Endpoint that exchanges codes and refresh tokens. */
  tokenUrl: string;
  /** Optional revoke endpoint. Omit when the provider has none. */
  revokeUrl?: string;
  /** Scopes joined with scopeSeparator (default: space). */
  scopes: string[];
  scopeSeparator?: string;
  /** Extra fixed query parameters on the authorize URL. */
  authorizationParams?: Record<string, string>;
  /** "basic" sends client credentials in the Authorization header; "body" sends them in the form body. */
  tokenAuthStyle?: TokenAuthStyle;
  /** Format expected by revokeUrl. Defaults to "form". */
  revokeBodyStyle?: RevokeBodyStyle;
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  refreshTokenExpiresAt?: Date;
  tokenType: string;
  scope?: string;
  /** Untouched token endpoint response, for provider-specific fields. */
  raw: Record<string, any>;
}

export interface SyncPage<TRecord, TCursor> {
  records: TRecord[];
  /** Pass null on the last page. Never repeat the cursor you were given. */
  nextCursor: TCursor | null;
}

export interface SyncRecordError {
  key: string;
  message: string;
}
