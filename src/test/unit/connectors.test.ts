import { describe, it, expect, vi } from "vitest";
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  toTokenSet,
  OAuthRequestError,
} from "../../connectors/oauthClient";
import { ensureFreshAccessToken } from "../../connectors/tokenStore";
import { runPagedSync } from "../../connectors/syncPipeline";
import type { OAuthProvider } from "../../connectors/types";
import { packEncryptedString, unpackAndDecryptString } from "../../config/encryption";

const basicProvider: OAuthProvider = {
  authorizationUrl: "https://auth.example.com/oauth2/authorize",
  tokenUrl: "https://auth.example.com/oauth2/token",
  scopes: ["invoices.read", "invoices.write"],
  tokenAuthStyle: "basic",
};

const bodyProvider: OAuthProvider = {
  ...basicProvider,
  authorizationUrl: "https://accounts.example.org/oauth/v2/auth",
  tokenUrl: "https://accounts.example.org/oauth/v2/token",
  scopes: ["ZohoBooks.invoices.READ"],
  tokenAuthStyle: "body",
  authorizationParams: { access_type: "offline", prompt: "consent" },
};

function jsonFetch(body: any, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("connector kit — OAuth client", () => {
  it("builds an authorize URL without leaking the client secret", () => {
    const url = new URL(
      buildAuthorizationUrl(
        basicProvider,
        { clientId: "client-1", clientSecret: "never-in-url", redirectUri: "https://hub.test/cb" },
        { state: "signed-state" },
      ),
    );

    expect(url.origin + url.pathname).toBe("https://auth.example.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://hub.test/cb");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("invoices.read invoices.write");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.toString()).not.toContain("never-in-url");
  });

  it("keeps provider-specific authorize params and PKCE", () => {
    const url = new URL(
      buildAuthorizationUrl(
        bodyProvider,
        { clientId: "zoho-1", clientSecret: "secret", redirectUri: "https://hub.test/cb" },
        { state: "s1", codeChallenge: "challenge-1" },
      ),
    );

    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges a code with Basic auth and returns a normalized token set", async () => {
    const fetchImpl = jsonFetch({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 1200,
      token_type: "Bearer",
    });

    const tokens = await exchangeAuthorizationCode(
      basicProvider,
      { clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://hub.test/cb" },
      "code-1",
      { fetchImpl, now: 1_700_000_000_000 },
    );

    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
    expect(tokens.tokenType).toBe("Bearer");
    expect(tokens.expiresAt.getTime()).toBe(1_700_000_000_000 + 1200 * 1000);

    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("https://auth.example.com/oauth2/token");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
    );
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("redirect_uri")).toBe("https://hub.test/cb");
  });

  it("sends client credentials in the body for providers that require it", async () => {
    const fetchImpl = jsonFetch({ access_token: "access-2", expires_in: 3600 });

    await refreshAccessToken(
      bodyProvider,
      { clientId: "zoho-1", clientSecret: "secret-2" },
      "refresh-2",
      { fetchImpl },
    );

    const [, init] = (fetchImpl as any).mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-2");
    expect(body.get("client_id")).toBe("zoho-1");
    expect(body.get("client_secret")).toBe("secret-2");
  });

  it("turns a rejected refresh into a reauthorization error", async () => {
    const fetchImpl = jsonFetch({ error: "invalid_grant" }, 400);

    await expect(
      refreshAccessToken(
        basicProvider,
        { clientId: "client-1", clientSecret: "secret-1" },
        "expired-refresh",
        { fetchImpl },
      ),
    ).rejects.toMatchObject({ status: 400, needsReauth: true });

    await expect(
      refreshAccessToken(
        basicProvider,
        { clientId: "client-1", clientSecret: "secret-1" },
        "expired-refresh",
        { fetchImpl },
      ),
    ).rejects.toBeInstanceOf(OAuthRequestError);
  });

  it("defaults a missing expires_in to one hour", () => {
    const tokens = toTokenSet({ access_token: "a" }, 1_000);
    expect(tokens.expiresAt.getTime()).toBe(1_000 + 3600 * 1000);
    expect(tokens.tokenType).toBe("Bearer");
  });
});

describe("connector kit — token store", () => {
  function fakeIntegration(overrides: Partial<any> = {}) {
    return {
      id: "integration-1",
      tenantId: "tenant-1",
      sourceSystem: "TEST_ERP",
      accessToken: packEncryptedString("old-access"),
      refreshToken: packEncryptedString("refresh-1"),
      companyId: "company-1",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "CONNECTED",
      lastSyncAt: null,
      ...overrides,
    };
  }

  it("returns a cached token without calling the provider", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = {
      integration: {
        findFirst: async () => fakeIntegration(),
        update: async () => null,
        upsert: async () => null,
        updateMany: async () => null,
      },
    };

    const token = await ensureFreshAccessToken({
      tenantId: "tenant-1",
      sourceSystem: "TEST_ERP",
      platformLabel: "Test ERP",
      provider: basicProvider,
      credentials: { clientId: "client-1", clientSecret: "secret-1" },
      fetchImpl,
      client: client as any,
    });

    expect(token).toBe("old-access");
    expect((fetchImpl as any).mock.calls).toHaveLength(0);
  });

  it("refreshes an expiring token and persists the encrypted replacement", async () => {
    const integration = fakeIntegration({
      accessTokenExpiresAt: new Date(Date.now() - 1000),
    });
    const updates: any[] = [];
    const client = {
      integration: {
        findFirst: async () => integration,
        update: async (args: any) => {
          updates.push(args);
          return null;
        },
        upsert: async () => null,
        updateMany: async () => null,
      },
    };

    const token = await ensureFreshAccessToken({
      tenantId: "tenant-1",
      sourceSystem: "TEST_ERP",
      platformLabel: "Test ERP",
      provider: basicProvider,
      credentials: { clientId: "client-1", clientSecret: "secret-1" },
      fetchImpl: jsonFetch({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
      client: client as any,
    });

    expect(token).toBe("new-access");
    expect(updates).toHaveLength(1);
    expect(unpackAndDecryptString(updates[0].data.accessToken)).toBe("new-access");
    expect(unpackAndDecryptString(updates[0].data.refreshToken)).toBe("new-refresh");
    expect(updates[0].data.status).toBe("CONNECTED");
  });

  it("marks the connection and throws a plain-English error when refresh is rejected", async () => {
    const integration = fakeIntegration({
      accessTokenExpiresAt: new Date(Date.now() - 1000),
    });
    const updates: any[] = [];
    const client = {
      integration: {
        findFirst: async () => integration,
        update: async (args: any) => {
          updates.push(args);
          return null;
        },
        upsert: async () => null,
        updateMany: async () => null,
      },
    };

    await expect(
      ensureFreshAccessToken({
        tenantId: "tenant-1",
        sourceSystem: "TEST_ERP",
        platformLabel: "Test ERP",
        provider: basicProvider,
        credentials: { clientId: "client-1", clientSecret: "secret-1" },
        fetchImpl: jsonFetch({ error: "invalid_grant" }, 401),
        client: client as any,
      }),
    ).rejects.toThrow("Test ERP connection needs reauthorization");

    expect(updates[0].data.status).toBe("DISCONNECTED");
  });
});

describe("connector kit — sync pipeline", () => {
  const base = {
    tenantId: "tenant-1",
    sourceSystem: "TEST_ERP",
    platformLabel: "Test ERP",
    auditAction: "TEST_ERP_SYNC",
    writeAudit: false,
    markSyncedAt: false,
  };

  it("pages until nextCursor is null and counts new versus already-synced records", async () => {
    const fetchPage = vi.fn(async (cursor: number | null) => {
      if (cursor === null) {
        return { records: [{ id: "1" }, { id: "2" }], nextCursor: 2 };
      }
      return { records: [{ id: "3" }], nextCursor: null };
    });

    const result = await runPagedSync<any, number>({
      ...base,
      fetchPage,
      dedupeKey: (record) => record.id,
      ingest: async (record) => ({ ...record, ingested: true }),
      isAlreadySynced: async (_record, key) => key === "2",
    });

    expect(result.totalFound).toBe(3);
    expect(result.newSynced).toBe(2);
    expect(result.alreadySynced).toBe(1);
    expect(result.processed).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.pages).toBe(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, null);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2);
  });

  it("isolates a bad record so the rest of the page still syncs", async () => {
    const result = await runPagedSync<any, number>({
      ...base,
      fetchPage: async () => ({
        records: [{ id: "1" }, { id: "2" }, { id: "3" }],
        nextCursor: null,
      }),
      dedupeKey: (record) => record.id,
      ingest: async (record) => {
        if (record.id === "2") throw new Error("bad invoice");
        return record;
      },
      isAlreadySynced: async () => false,
    });

    expect(result.totalFound).toBe(3);
    expect(result.newSynced).toBe(2);
    expect(result.processed).toHaveLength(2);
    expect(result.errors).toEqual([{ key: "2", message: "bad invoice" }]);
  });

  it("stops instead of looping forever when a provider repeats its cursor", async () => {
    await expect(
      runPagedSync<any, number>({
        ...base,
        fetchPage: async () => ({ records: [{ id: "1" }], nextCursor: 0 }),
        dedupeKey: (record) => record.id,
        ingest: async (record) => record,
        isAlreadySynced: async () => false,
      }),
    ).rejects.toThrow("same cursor twice");
  });

  it("honours maxPages for bounded runs", async () => {
    const fetchPage = vi.fn(async (cursor: number | null) => ({
      records: [{ id: String(cursor ?? "start") }],
      nextCursor: (cursor ?? 0) + 1,
    }));

    const result = await runPagedSync<any, number>({
      ...base,
      fetchPage,
      dedupeKey: (record) => record.id,
      ingest: async (record) => record,
      isAlreadySynced: async () => false,
      maxPages: 3,
    });

    expect(result.pages).toBe(3);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
