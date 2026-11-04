/**
 * One encrypted token store for every ERP.
 *
 * Integration.accessToken / refreshToken are already encrypted AES-256-GCM
 * strings. This module is the only place that should know that: connectors ask
 * for a valid access token and the store decrypts, refreshes when expiring and
 * persists the replacement.
 */
import { packEncryptedString, unpackAndDecryptString } from "../config/encryption";
import { refreshAccessToken } from "./oauthClient";
import { isTokenExpiring } from "./oauthClient";
import type { OAuthClientCredentials, OAuthProvider, OAuthTokenSet } from "./types";

export interface IntegrationRecord {
  id: string;
  tenantId: string;
  sourceSystem: string;
  accessToken: string;
  refreshToken: string;
  companyId: string;
  accessTokenExpiresAt: Date;
  status: string;
  lastSyncAt: Date | null;
}

interface IntegrationClient {
  integration: {
    findFirst(args: any): Promise<IntegrationRecord | null>;
    upsert(args: any): Promise<any>;
    update(args: any): Promise<any>;
    updateMany(args: any): Promise<any>;
  };
}

async function clientOf(client?: IntegrationClient): Promise<IntegrationClient> {
  if (client) return client;
  const { getPrisma } = await import("../lib/prisma");
  return getPrisma() as unknown as IntegrationClient;
}

export async function findIntegration(
  tenantId: string,
  sourceSystem: string,
  client?: IntegrationClient,
): Promise<IntegrationRecord | null> {
  const db = await clientOf(client);
  return db.integration.findFirst({ where: { tenantId, sourceSystem } });
}

export interface SaveTokensInput {
  tenantId: string;
  sourceSystem: string;
  companyId?: string | null;
  tokens: Pick<OAuthTokenSet, "accessToken" | "refreshToken" | "expiresAt">;
  /** Refresh token from the previous grant, used when the provider does not rotate it. */
  previousRefreshToken?: string;
  status?: string;
  client?: IntegrationClient;
}

/** Upsert a full grant after an OAuth callback or a token refresh. */
export async function saveIntegrationTokens(input: SaveTokensInput): Promise<void> {
  const client = await clientOf(input.client);
  const refreshToken = input.tokens.refreshToken || input.previousRefreshToken || "";
  const encryptedRefresh = packEncryptedString(refreshToken);

  await client.integration.upsert({
    where: {
      tenantId_sourceSystem: {
        tenantId: input.tenantId,
        sourceSystem: input.sourceSystem,
      },
    },
    create: {
      tenantId: input.tenantId,
      sourceSystem: input.sourceSystem,
      accessToken: packEncryptedString(input.tokens.accessToken),
      refreshToken: encryptedRefresh,
      companyId: input.companyId || "UNKNOWN",
      accessTokenExpiresAt: input.tokens.expiresAt,
      status: input.status ?? "CONNECTED",
    },
    update: {
      accessToken: packEncryptedString(input.tokens.accessToken),
      refreshToken: encryptedRefresh,
      accessTokenExpiresAt: input.tokens.expiresAt,
      status: input.status ?? "CONNECTED",
      ...(input.companyId ? { companyId: input.companyId } : {}),
    },
  });
}

/** Decrypt the access token saved by a connection that has no refresh cycle (API key). */
export async function readStoredAccessToken(
  tenantId: string,
  sourceSystem: string,
  platformLabel: string,
  client?: IntegrationClient,
): Promise<string> {
  const integration = await findIntegration(tenantId, sourceSystem, client);
  if (!integration) {
    throw new Error(`No ${platformLabel} integration found for tenant ${tenantId}`);
  }
  try {
    return unpackAndDecryptString(integration.accessToken);
  } catch (error: any) {
    const db = await clientOf(client);
    await db.integration
      .update({ where: { id: integration.id }, data: { status: "DISCONNECTED" } })
      .catch(() => {});
    throw new Error(`${platformLabel} connection needs reauthorization — could not read the saved credentials.`);
  }
}

export interface EnsureAccessTokenOptions {
  tenantId: string;
  sourceSystem: string;
  /** Merchant-facing name. Also used in the reauthorization message. */
  platformLabel: string;
  provider: OAuthProvider;
  credentials: OAuthClientCredentials | (() => Promise<OAuthClientCredentials> | OAuthClientCredentials);
  refreshSkewMs?: number;
  fetchImpl?: typeof fetch;
  client?: IntegrationClient;
  /** Status written when the provider rejects the refresh. Defaults to DISCONNECTED (existing behaviour). */
  onRefreshFailureStatus?: "DISCONNECTED" | "NEEDS_REAUTH";
}

/**
 * Returns a decrypted access token, refreshing it first when it expires within
 * the skew window (5 minutes by default). A refresh failure marks the
 * connection as needing reauthorization and throws a plain-English error.
 */
export async function ensureFreshAccessToken(options: EnsureAccessTokenOptions): Promise<string> {
  const client = await clientOf(options.client);
  const integration = await findIntegration(options.tenantId, options.sourceSystem, options.client);

  if (!integration) {
    throw new Error(`No ${options.platformLabel} integration found for tenant ${options.tenantId}`);
  }

  const expiresSoon = isTokenExpiring(
    integration.accessTokenExpiresAt,
    options.refreshSkewMs ?? 5 * 60 * 1000,
  );

  if (!expiresSoon) {
    try {
      return unpackAndDecryptString(integration.accessToken);
    } catch (error) {
      console.warn(`[${options.platformLabel}] stored access token could not be decrypted; refreshing.`, error);
    }
  }

  let refreshToken = "";
  try {
    refreshToken = unpackAndDecryptString(integration.refreshToken);
  } catch (error: any) {
    await client.integration
      .update({ where: { id: integration.id }, data: { status: "DISCONNECTED" } })
      .catch(() => {});
    throw new Error(`${options.platformLabel} connection needs reauthorization — could not read the saved refresh token.`);
  }

  if (!refreshToken) {
    await client.integration
      .update({ where: { id: integration.id }, data: { status: "DISCONNECTED" } })
      .catch(() => {});
    throw new Error(`${options.platformLabel} connection needs reauthorization — no refresh token on file.`);
  }

  const credentials =
    typeof options.credentials === "function" ? await options.credentials() : options.credentials;

  try {
    const tokens = await refreshAccessToken(options.provider, credentials, refreshToken, {
      fetchImpl: options.fetchImpl,
    });

    await client.integration.update({
      where: { id: integration.id },
      data: {
        accessToken: packEncryptedString(tokens.accessToken),
        refreshToken: packEncryptedString(tokens.refreshToken || refreshToken),
        accessTokenExpiresAt: tokens.expiresAt,
        status: "CONNECTED",
      },
    });

    return tokens.accessToken;
  } catch (error: any) {
    await client.integration
      .update({
        where: { id: integration.id },
        data: { status: options.onRefreshFailureStatus ?? "DISCONNECTED" },
      })
      .catch(() => {});

    const status = error?.status ? ` ${error.status}` : "";
    throw new Error(
      `${options.platformLabel} connection needs reauthorization (token refresh failed${status}): ${error?.message || error}`,
    );
  }
}
