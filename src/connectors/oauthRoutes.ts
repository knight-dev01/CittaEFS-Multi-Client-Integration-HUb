/**
 * One OAuth connect/callback route factory for every ERP.
 *
 * The factory owns the parts that are identical across providers and easy to
 * get wrong: the role check, a signed short-lived state, token exchange,
 * encrypted persistence, audit logging and the popup bridge page. A connector
 * supplies its endpoints, how to resolve credentials, and where its company /
 * tenant id comes back on the callback.
 */
import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import {
  generateSha256,
  getAuthConfig,
  renderOAuthBridgeHtml,
  safeAuditLogCreate,
} from "../lib/serverHelpers";
import { buildAuthorizationUrl, exchangeAuthorizationCode } from "./oauthClient";
import { saveIntegrationTokens } from "./tokenStore";
import type { OAuthClientCredentials, OAuthProvider, OAuthTokenSet } from "./types";

export interface BridgePayload {
  success: boolean;
  tenantId?: string;
  companyId?: string;
  error?: string;
  redirectQs: string;
}

export interface ConnectedArgs {
  req: any;
  tenantId: string;
  companyId?: string;
  state: Record<string, any>;
  tokens: OAuthTokenSet;
}

export interface OAuthConnectionRouterOptions {
  /** Short provider key used in the route path and redirect query, e.g. "qbo". */
  platformKey: string;
  /** Integration.sourceSystem value, e.g. "QUICKBOOKS_ONLINE". */
  sourceSystem: string;
  /** Merchant-facing name, e.g. "QuickBooks Online". */
  platformLabel: string;
  provider: OAuthProvider;
  /** Resolve app credentials. `state` is the decoded state on callback. */
  getCredentials: (
    tenantId: string,
    state: Record<string, any>,
  ) => Promise<OAuthClientCredentials> | OAuthClientCredentials;
  /** Default redirect URI when getCredentials does not return one. */
  getRedirectUri?: () => string;
  /** Resolve the tenant from the request (query, JWT, or the app's default). */
  resolveTenantId: (req: any) => string;
  /** Extra signed state, e.g. QBO's sandbox/production choice. */
  buildState?: (req: any, tenantId: string) => Promise<Record<string, any>> | Record<string, any>;
  /** Read extra state back on callback. */
  readState?: (decoded: Record<string, any>) => Record<string, any>;
  /** Provider-specific company id from the callback query, e.g. ?realmId=. */
  extractCompanyId?: (req: any) => string | undefined;
  /** Hook for provider-specific persistence after the grant is saved. */
  onConnected?: (args: ConnectedArgs) => Promise<void>;
  successQuery?: (args: { tenantId: string; companyId?: string; state: Record<string, any> }) => string;
  errorQuery?: string;
  connectPath?: string;
  callbackPath?: string;
  requiredRoles?: string[];
  /** Defaults to the shared QBO bridge for backwards compatibility. */
  renderBridge?: (payload: BridgePayload) => string;
  fetchImpl?: typeof fetch;
}

function defaultRenderBridge(payload: BridgePayload, platformLabel: string): string {
  const result = JSON.stringify({
    type: "erp-oauth-result",
    success: payload.success,
    tenantId: payload.tenantId,
    companyId: payload.companyId,
    error: payload.error,
  });
  const message = payload.success
    ? `${platformLabel} authorization successful. Completing setup...`
    : `Connection failed: ${payload.error || "Unknown error"}`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${platformLabel} Connection</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0;font-size:14px;text-align:center}.card{background:#1e293b;border:1px solid #334155;padding:24px 32px;border-radius:12px;max-width:420px}.status{font-size:16px;font-weight:600;margin-bottom:8px;color:${payload.success ? "#34d399" : "#f87171"}}.sub{color:#94a3b8;font-size:13px}</style></head><body><div class="card"><div class="status">${payload.success ? "Authorization Successful" : "Authorization Failed"}</div><div class="sub">${message}</div></div><script>(function(){var result=${result};try{if(typeof BroadcastChannel!=='undefined'){var bc=new BroadcastChannel('citta_erp_oauth');bc.postMessage(result);}}catch(e){}try{localStorage.setItem('citta_erp_oauth_result',JSON.stringify({type:result.type,success:result.success,tenantId:result.tenantId,companyId:result.companyId,error:result.error,_ts:Date.now()}));}catch(e){}try{if(window.opener&&!window.opener.closed){window.opener.postMessage(result,window.location.origin);}}catch(e){}setTimeout(function(){window.location.href='/?tab=connectors&${payload.redirectQs}';},1200);})();<\/script></body></html>`;
}

function missingCredentialMessage(platformLabel: string, missing: string[]): string {
  return `${platformLabel} is not configured for sign-in. Missing: ${missing.join(", ")}. Add the app credentials in the server environment, then try again.`;
}

export function createOAuthConnectionRouter(options: OAuthConnectionRouterOptions): Router {
  const router = Router();
  const { JWT_SECRET } = getAuthConfig();
  const requiredRoles = options.requiredRoles ?? ["ADMIN", "INTEGRATION_MANAGER"];
  const connectPath = options.connectPath ?? `/api/integrations/${options.platformKey}/connect`;
  const callbackPath = options.callbackPath ?? `/api/integrations/${options.platformKey}/callback`;
  const errorQuery = options.errorQuery ?? `${options.platformKey}=error`;
  const renderBridge =
    options.renderBridge ?? ((payload: BridgePayload) => defaultRenderBridge(payload, options.platformLabel));

  const successQuery =
    options.successQuery ??
    (({ tenantId, companyId }: { tenantId: string; companyId?: string }) =>
      `${options.platformKey}=success&tenantId=${encodeURIComponent(tenantId)}${
        companyId ? `&companyId=${encodeURIComponent(companyId)}` : ""
      }`);

  router.get(connectPath, async (req: any, res) => {
    const wantsJson = Boolean(req.headers.accept?.includes("application/json"));
    const fail = (status: number, error: string) => {
      if (wantsJson) return res.status(status).json({ error });
      return res.status(status).send(renderBridge({ success: false, error, redirectQs: errorQuery }));
    };

    try {
      const role = req.user?.role;
      if (role && !requiredRoles.includes(role)) {
        return fail(403, `Forbidden: Requires ${requiredRoles.join(" or ")} role`);
      }

      const tenantId = options.resolveTenantId(req);
      const extraState = options.buildState ? await options.buildState(req, tenantId) : {};
      const stateToken = jwt.sign(
        { ...extraState, tenantId, timestamp: Date.now() },
        JWT_SECRET,
        { expiresIn: "15m" },
      );

      const credentials = await options.getCredentials(tenantId, { ...extraState, tenantId });
      const redirectUri = credentials.redirectUri || options.getRedirectUri?.() || "";
      const missing: string[] = [];
      if (!credentials.clientId) missing.push("client ID");
      if (!credentials.clientSecret) missing.push("client secret");
      if (!redirectUri) missing.push("redirect URI");
      if (missing.length) return fail(400, missingCredentialMessage(options.platformLabel, missing));

      const url = buildAuthorizationUrl(
        options.provider,
        { ...credentials, redirectUri },
        { state: stateToken },
      );

      if (wantsJson) return res.json({ url });
      return res.redirect(url);
    } catch (error: any) {
      console.error(`[${options.platformLabel}] OAuth connect failed:`, error);
      return fail(500, `Could not start the ${options.platformLabel} sign-in. Please try again.`);
    }
  });

  router.get(callbackPath, async (req: any, res) => {
    const fail = (status: number, error: string) =>
      res.status(status).send(renderBridge({ success: false, error, redirectQs: errorQuery }));

    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const stateToken = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !stateToken) {
        return fail(400, "The provider did not return an authorization code. Please start the connection again.");
      }

      let decoded: Record<string, any>;
      try {
        decoded = jwt.verify(stateToken, JWT_SECRET) as Record<string, any>;
      } catch {
        return fail(401, "This sign-in link has expired. Please start the connection again.");
      }

      const tenantId = String(decoded.tenantId || "");
      if (!tenantId) return fail(401, "This sign-in link is missing its tenant. Please start again.");

      const state = options.readState ? options.readState(decoded) : decoded;
      const credentials = await options.getCredentials(tenantId, { ...decoded, ...state });
      const redirectUri = credentials.redirectUri || options.getRedirectUri?.() || "";
      if (!credentials.clientId || !credentials.clientSecret || !redirectUri) {
        console.error(
          `[${options.platformLabel}] OAuth callback is missing app credentials or redirect URI.`,
        );
        return fail(
          500,
          `${options.platformLabel} sign-in is not configured correctly. Check the app credentials in the server environment.`,
        );
      }

      let tokens: OAuthTokenSet;
      try {
        tokens = await exchangeAuthorizationCode(
          options.provider,
          { ...credentials, redirectUri },
          code,
          { fetchImpl: options.fetchImpl },
        );
      } catch (error: any) {
        console.error(`[${options.platformLabel}] OAuth token exchange failed:`, {
          status: error?.status,
          body: error?.body,
          message: error?.message,
        });
        return fail(
          400,
          `${options.platformLabel} did not accept the sign-in. Check the app credentials and redirect URI, then try again.`,
        );
      }

      const companyId = options.extractCompanyId?.(req) || undefined;

      await saveIntegrationTokens({
        tenantId,
        sourceSystem: options.sourceSystem,
        companyId,
        tokens,
      });

      if (options.onConnected) {
        await options.onConnected({ req, tenantId, companyId, state, tokens });
      }

      await safeAuditLogCreate(prisma, {
        tenantId,
        action: "CONNECTOR_AUTHENTICATED",
        entityType: "INTEGRATION",
        entityRef: companyId || options.sourceSystem,
        details: `${options.platformLabel} OAuth authenticated successfully${
          companyId ? ` for ${companyId}` : ""
        }`,
        sha256PayloadHash: generateSha256(String(companyId || options.sourceSystem)),
        performedBy: `${options.platformLabel} OAuth Callback`,
        rawJson: { sourceSystem: options.sourceSystem, companyId, state },
      });

      const redirectQs = successQuery({ tenantId, companyId, state });
      return res.send(
        renderBridge({
          success: true,
          tenantId,
          companyId,
          redirectQs,
        }),
      );
    } catch (error: any) {
      console.error(`[${options.platformLabel}] OAuth callback failed:`, error);
      return fail(500, `Could not finish connecting ${options.platformLabel}. Please try again.`);
    }
  });

  return router;
}

export { renderOAuthBridgeHtml };
