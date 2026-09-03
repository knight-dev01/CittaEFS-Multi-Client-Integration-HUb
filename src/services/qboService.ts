import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "../config/dbConfig";
import {
  unpackAndDecryptString,
  packEncryptedString,
} from "../config/encryption";
import { QuickBooksAdapter } from "../adapters/connectorAdapters";
import { invoiceQueue } from "../queues/invoiceQueue";
import { invoiceIngestionSchema } from "../schemas/invoice.schema";
import { CITTA_HS_CODES_REFERENCE, CITTA_SERVICE_CODES_REFERENCE } from "../data/referenceData";

const prisma = new PrismaClient({
  datasources: { db: { url: getDatabaseUrl() } },
});
const qboAdapter = new QuickBooksAdapter();

export interface QboOAuthConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production" | string;
  redirectUri: string;
}

export interface QboTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
  token_type: string;
}

/**
 * Custom fetch-backed QuickBooks Online OAuth2 client.
 * Encapsulates authorization URL generation, authorization code exchange, and token refresh
 * using standard native fetch API without external library dependencies.
 */
export class QboOAuthClient {
  clientId: string;
  clientSecret: string;
  environment: string;
  redirectUri: string;

  constructor(config: QboOAuthConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.environment = (config.environment || "sandbox").toLowerCase();
    this.redirectUri = config.redirectUri;
  }

  /**
   * Generates Intuit OAuth2 Authorization URL
   */
  authorizeUri(options?: { scope?: string[]; state?: string }): string {
    const scopes = options?.scope
      ? options.scope.join(" ")
      : "com.intuit.quickbooks.accounting";
    const state = options?.state || "citta_efs_state";

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      scope: scopes,
      redirect_uri: this.redirectUri,
      state,
    });

    return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
  }

  /**
   * Alias for authorizeUri
   */
  getAuthorizationUrl(options?: { scope?: string[]; state?: string }): string {
    return this.authorizeUri(options);
  }

  /**
   * Exchanges authorization code for Access & Refresh Tokens using standard fetch
   */
  async createToken(
    authCodeOrUrl: string,
  ): Promise<{ token: QboTokenResponse }> {
    let code = authCodeOrUrl;
    if (authCodeOrUrl.includes("code=")) {
      try {
        const urlObj = new URL(
          authCodeOrUrl.startsWith("http")
            ? authCodeOrUrl
            : `http://localhost${authCodeOrUrl}`,
        );
        code = urlObj.searchParams.get("code") || authCodeOrUrl;
      } catch {
        // retain original authorization code string
      }
    }

    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");
    const response = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: this.redirectUri,
        }).toString(),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Failed to exchange authorization code (${response.status}): ${errText}`,
      );
    }

    const tokenData = (await response.json()) as QboTokenResponse;
    return { token: tokenData };
  }

  /**
   * Refreshes access token using refresh token via standard fetch
   */
  async refreshTokens(
    refreshToken: string,
  ): Promise<{ token: QboTokenResponse }> {
    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");
    const response = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Failed to refresh token (${response.status}): ${errText}`,
      );
    }

    const tokenData = (await response.json()) as QboTokenResponse;
    return { token: tokenData };
  }

  /**
   * RevoNGN token
   */
  async revokeToken(token: string): Promise<boolean> {
    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");
    const response = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/revoke",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ token }),
      },
    );

    return response.ok;
  }
}

/**
 * Creates and returns a fetch-backed Intuit OAuth2 client instance.
 * Encapsulates token management logic without requiring external intuit-oauth SDK.
 */
export function getIntuitOAuthClient() {
  if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
    throw new Error(
      "QBO_CLIENT_ID and QBO_CLIENT_SECRET environment variables are required.",
    );
  }
  if (!process.env.QBO_REDIRECT_URI) {
    throw new Error("QBO_REDIRECT_URI environment variable is required.");
  }

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  const environment =
    (process.env.QBO_ENVIRONMENT || "sandbox").toLowerCase() === "production"
      ? "production"
      : "sandbox";

  return new QboOAuthClient({
    clientId,
    clientSecret,
    environment,
    redirectUri,
  });
}

/**
 * Returns the base URL for QBO API calls depending on the environment.
 */
function getQboBaseUrl(): string {
  const env = process.env.QBO_ENVIRONMENT || "sandbox";
  return env.toLowerCase() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

/**
 * Retrieves a valid, non-expired Access Token for a tenant's QBO integration.
 * Performs auto-refresh if the token is expired or close to expiring.
 * Throws explicit error if integration is missing, refresh token is invalid, or token exchange fails.
 */
export async function getValidQboAccessToken(
  tenantId: string,
): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: "QUICKBOOKS_ONLINE",
      },
    },
  });

  if (!integration) {
    throw new Error(
      `No QuickBooks Online integration found for tenant ${tenantId}`,
    );
  }

  // If token is valid for more than 5 minutes, use it
  const isExpired =
    new Date(integration.accessTokenExpiresAt).getTime() - Date.now() <
    5 * 60 * 1000;
  if (!isExpired) {
    try {
      return unpackAndDecryptString(integration.accessToken);
    } catch (e) {
      console.warn(
        "Failed to decrypt cached access token, forcing refresh:",
        e,
      );
    }
  }

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "QBO_CLIENT_ID and QBO_CLIENT_SECRET environment variables are required.",
    );
  }

  let decryptedRefreshToken = "";
  try {
    decryptedRefreshToken = unpackAndDecryptString(integration.refreshToken);
  } catch (e: any) {
    await prisma.integration
      .update({
        where: { id: integration.id },
        data: { status: "DISCONNECTED" },
      })
      .catch(() => {});
    throw new Error(`Failed to decrypt refresh token: ${e.message}`);
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const response = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: decryptedRefreshToken,
        }).toString(),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      // Update integration status to DISCONNECTED so UI prompts user to re-authenticate
      await prisma.integration
        .update({
          where: { id: integration.id },
          data: { status: "DISCONNECTED" },
        })
        .catch(() => {});

      throw new Error(
        `QuickBooks connection needs reauthorization (token exchange failed ${response.status}): ${errText}`,
      );
    }

    const data = (await response.json()) as any;
    const encryptedAccessToken = packEncryptedString(data.access_token);
    const encryptedRefreshToken = packEncryptedString(
      data.refresh_token || decryptedRefreshToken,
    );
    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        accessTokenExpiresAt: expiresAt,
        status: "CONNECTED",
      },
    });

    return data.access_token;
  } catch (error: any) {
    await prisma.integration
      .update({
        where: { id: integration.id },
        data: { status: "DISCONNECTED" },
      })
      .catch(() => {});
    throw new Error(
      `Error refreshing QBO token for tenant ${tenantId}: ${error.message}`,
    );
  }
}

/**
 * Fetches company info for a tenant's connected QBO realm — a lightweight, real
 * connectivity check used by the "Test Connection" actions in the UI.
 */
export async function fetchQboCompanyInfo(tenantId: string): Promise<any> {
  const accessToken = await getValidQboAccessToken(tenantId);
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: "QUICKBOOKS_ONLINE",
      },
    },
  });

  if (!integration) {
    throw new Error(`Integration details not found for tenant ${tenantId}`);
  }

  const realmId = integration.companyId;
  const baseUrl = getQboBaseUrl();
  const url = `${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`QBO company info fetch failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as any;
  return data.CompanyInfo;
}

/**
 * Fetches recent invoices from QBO based on last sync date or a specific query.
 */
export async function fetchQboInvoices(
  tenantId: string,
  options?: { lastSyncAt?: Date },
): Promise<any[]> {
  const accessToken = await getValidQboAccessToken(tenantId);
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: "QUICKBOOKS_ONLINE",
      },
    },
  });

  if (!integration) {
    throw new Error(`Integration details not found for tenant ${tenantId}`);
  }

  const realmId = integration.companyId;
  const baseUrl = getQboBaseUrl();

  let query = "SELECT * FROM Invoice";
  if (options?.lastSyncAt) {
    const formattedDate = options.lastSyncAt.toISOString();
    query += ` WHERE MetaData.LastUpdatedTime > '${formattedDate}'`;
  } else if (integration.lastSyncAt) {
    const formattedDate = new Date(integration.lastSyncAt).toISOString();
    query += ` WHERE MetaData.LastUpdatedTime > '${formattedDate}'`;
  }
  query += " ORDERBY MetaData.LastUpdatedTime DESC";

  const url = `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 401 || response.status === 400) {
      throw new Error("QuickBooks connection needs reauthorization");
    }
    throw new Error(
      `Could not reach QuickBooks, please try again (${response.status}): ${errText}`,
    );
  }

  const data = (await response.json()) as any;
  const rawInvoices = data.QueryResponse?.Invoice || [];

  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });

  return rawInvoices;
}

/**
 * Fetches all historical invoices from QBO using paginated queries (STARTPOSITION / MAXRESULTS).
 */
export async function fetchAllQboInvoicesPaginated(
  tenantId: string,
): Promise<any[]> {
  const accessToken = await getValidQboAccessToken(tenantId);
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: "QUICKBOOKS_ONLINE",
      },
    },
  });

  if (!integration) {
    throw new Error(`Integration details not found for tenant ${tenantId}`);
  }

  const realmId = integration.companyId;
  const baseUrl = getQboBaseUrl();

  let allInvoices: any[] = [];
  let startPosition = 1;
  const maxResults = 1000;

  while (true) {
    const query = `SELECT * FROM Invoice STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const url = `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 401 || response.status === 400) {
        throw new Error("QuickBooks connection needs reauthorization");
      }
      throw new Error(
        `Could not reach QuickBooks, please try again (${response.status}): ${errText}`,
      );
    }

    const data = (await response.json()) as any;
    const pageInvoices = data.QueryResponse?.Invoice || [];

    if (pageInvoices.length === 0) {
      break;
    }

    allInvoices.push(...pageInvoices);

    if (pageInvoices.length < maxResults) {
      break;
    }

    startPosition += maxResults;
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });

  return allInvoices;
}

/**
 * Fetches a single invoice by its QBO internal ID.
 */
export async function fetchSingleQboInvoice(
  tenantId: string,
  qboInvoiceId: string,
): Promise<any> {
  const accessToken = await getValidQboAccessToken(tenantId);
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: "QUICKBOOKS_ONLINE",
      },
    },
  });

  if (!integration) {
    throw new Error(`Integration details not found for tenant ${tenantId}`);
  }

  const realmId = integration.companyId;
  const baseUrl = getQboBaseUrl();
  const url = `${baseUrl}/v3/company/${realmId}/invoice/${qboInvoiceId}?minorversion=65`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Failed to fetch QBO Invoice ${qboInvoiceId} (${response.status}): ${errText}`,
    );
  }

  const data = (await response.json()) as any;
  return data.Invoice;
}

/**
 * Upserts Customer and Item master records from a validated QBO invoice ingestion,
 * so the Customers/Items directories stay populated from real QBO sync activity
 * instead of only the Invoices table. Existing records are left untouched.
 */
async function upsertQboMasterData(
  tenantId: string,
  customerCode: string,
  customerName: string,
  customerTin: string | undefined,
  lineItems: Array<{
    itemCode: string;
    description: string;
    unitPrice: number;
    hsOrServiceCode: string;
    vatRate: number;
  }>,
): Promise<void> {
  const existingCustomer = await prisma.customer.findFirst({
    where: { tenantId, clientSystemCustId: customerCode },
  });
  if (!existingCustomer) {
    await prisma.customer.create({
      data: {
        tenantId,
        clientSystemCustId: customerCode,
        companyName: customerName || "QuickBooks Customer",
        taxId: customerTin || null,
        taxClassification: customerTin ? "B2B" : "B2C",
        street: "Synced from QuickBooks Online",
        city: "Nairobi",
      },
    });
  }
  for (const item of lineItems) {
    const existingItem = await prisma.item.findFirst({
      where: { tenantId, clientSku: item.itemCode },
    });
    if (!existingItem) {
      await prisma.item.create({
        data: {
          tenantId,
          clientSku: item.itemCode,
          description: item.description,
          hsOrServiceCode: item.hsOrServiceCode,
          categoryType: /^SRV|^SERV/.test(item.hsOrServiceCode)
            ? "SERVICE"
            : "GOODS",
          defaultVatRate: item.vatRate,
        },
      });
    }
  }
}

/**
 * Ingests a raw QBO invoice payload. Performs validation, transforms it,
 * inserts into the DB (as PENDING_NRS_STAMP), and enqueues a signing job.
 */
export async function ingestQboInvoice(
  tenantId: string,
  rawInvoice: any,
  opts?: { autoEnqueue?: boolean },
): Promise<any> {
  const qboId = String(rawInvoice.Id);
  const docNumber = String(rawInvoice.DocNumber || `QBO-${qboId}`).trim();
  const clientInvoiceId = docNumber; // DocNumber is business key — qboId preserved in qboInvoiceId column

  // Check if invoice already exists by DocNumber (primary) or by legacy qboId
  let existing = await prisma.invoice.findFirst({
    where: { tenantId, clientInvoiceId },
  });
  if (!existing) {
    existing = await prisma.invoice.findFirst({
      where: { tenantId, qboInvoiceId: qboId },
    });
    if (existing) {
      // Legacy row still keyed by numeric Id — will be backfilled by migration; update in place
      console.log(`Legacy QBO invoice ${qboId} found with DocNumber ${existing.clientInvoiceId} — will update qboInvoiceId`);
    }
  }

  if (existing) {
    // If legacy row has no qboInvoiceId, patch it
    if (!existing.qboInvoiceId) {
      try { await prisma.invoice.update({ where: { id: existing.id }, data: { qboInvoiceId: qboId, documentNumber: docNumber } }); } catch {}
    }
    console.log(`Invoice ${clientInvoiceId} (qboId ${qboId}) already exists for tenant ${tenantId}. Skipping.`);
    return existing;
  }

  // Validate the raw payload
  const validation = qboAdapter.validate(rawInvoice);
  if (!validation.valid) {
    // Save as a pre-flight validation error
    const errorMsg = validation.errors.join(" | ");
    await prisma.validationError.create({
      data: {
        tenantId,
        clientInvoiceNumber: docNumber,
        errorCategory: "INVALID_TIN_FORMAT",
        fieldAffected: "metadata",
        errorMessage: `QuickBooks validation failed: ${errorMsg}`,
        rawPayloadSample: JSON.stringify(rawInvoice),
        status: "OPEN",
      },
    });
    throw new Error(
      `Validation failed for QBO Invoice ${docNumber}: ${errorMsg}`,
    );
  }

  // Transform raw invoice to canonical structure
  const transformed = qboAdapter.transform(rawInvoice);

  // Validate unmapped HS/Service codes — Option B auto-map + service detection, Option A strict will be checked before enqueue
  const tenantItems = await prisma.item.findMany({ where: { tenantId } });
  const inferServiceCode = (sku: string, desc: string) => {
    const text = `${sku} ${desc}`.toLowerCase();
    if (/gardening|sod|rocks|fountain|pump|sprinkler|design|service|labor|labour|installation|maintenance|repair/.test(text)) return "SRV-7212.10";
    if (/laptop|computer|router|switch|server/.test(text)) return "HS-8471.30";
    return (sku || "").toUpperCase().startsWith("SRV") ? "SRV-7212.10" : "HS-8471.30";
  };
  const processedLineItems = transformed.lineItems.map(
    (li: any, idx: number) => {
      let mapping = tenantItems.find((m) => m.clientSku === li.clientSku);
      const inferredDefault = inferServiceCode(li.clientSku || "", li.description || "");
      const rawHs = li.hsOrServiceCode;
      const hsOrServiceCode =
        mapping?.hsOrServiceCode ||
        (rawHs && rawHs !== "UNMAPPED" && rawHs !== "SERV-DEFAULT" && rawHs !== "HS-8471.30"
          ? rawHs
          : inferredDefault);
      const qty = Number(li.quantity || 1);
      const price = Number(li.unitPrice || 0);
      const discount = Number(li.discountAmount || 0);
      const taxable = qty * price - discount;
      const vatRate =
        li.vatRate !== undefined
          ? Number(li.vatRate)
          : Number(mapping?.defaultVatRate || 16);
      const vatAmount = (taxable * vatRate) / 100;
      const totalAmount = taxable + vatAmount;

      return {
        itemCode: li.clientSku || "SKU-GENERIC",
        description: li.description || "Generic Item",
        quantity: qty,
        unitPrice: price,
        taxableAmount: taxable,
        vatRate,
        vatAmount,
        totalAmount,
        hsOrServiceCode,
      };
    },
  );

  // Strict pre-queue: empty lines → Validation (handles 1013 No invoice data provided)
  if (!processedLineItems.length) {
    await prisma.validationError.create({
      data: {
        tenantId,
        clientInvoiceNumber: docNumber,
        errorCategory: 'MISSING_HS_CODE',
        fieldAffected: 'lineItems',
        errorMessage: `No invoice data provided — QBO invoice ${docNumber} has no SalesItemLineDetail lines`,
        rawPayloadSample: JSON.stringify(rawInvoice).slice(0,2000),
        status: 'OPEN',
      }
    });
    throw new Error(`No invoice data provided for QBO Invoice ${docNumber}`);
  }
  // Strict HS validation — unified general list same as Validation + Invoice edit (referenceData)
  const validSet = new Set([...CITTA_HS_CODES_REFERENCE.map(c=>c.code), ...CITTA_SERVICE_CODES_REFERENCE.map(s=>s.code), "HS-8471.50"]);
  for (const li of processedLineItems) {
    if (!validSet.has(li.hsOrServiceCode)) {
      await prisma.validationError.create({
        data: {
          tenantId,
          clientInvoiceNumber: docNumber,
          errorCategory: 'MISSING_HS_CODE',
          fieldAffected: 'hsOrServiceCode',
          errorMessage: `Invalid Product Code - must be valid HS Code or Service Code (found ${li.hsOrServiceCode} for ${li.itemCode}) — map in Item Dictionary`,
          rawPayloadSample: JSON.stringify(rawInvoice).slice(0,2000),
          status: 'OPEN',
        }
      });
      throw new Error(`Invalid Product Code - must be valid HS Code or Service Code (found ${li.hsOrServiceCode})`);
    }
  }

  const subtotal = processedLineItems.reduce(
    (acc, item) => acc + item.taxableAmount,
    0,
  );
  const totalVat = processedLineItems.reduce(
    (acc, item) => acc + item.vatAmount,
    0,
  );
  const grandTotal = subtotal + totalVat;

  const rawCust = String(rawInvoice.CustomerRef?.value || "").trim();
  const customerCode = rawCust ? (/^CUST/i.test(rawCust) ? rawCust.toUpperCase() : `CUST${rawCust}`) : "CUST-QBO";

  // Keep the Customers/Items master directories in sync with real QBO data
  await upsertQboMasterData(
    tenantId,
    customerCode,
    transformed.customerName,
    transformed.customerTin,
    processedLineItems,
  );

  // Determine auto-enqueue vs preview inbox (tenantErp.autoEnqueueQbo, default false = preview required for security)
  let shouldAutoEnqueue = opts?.autoEnqueue;
  if (shouldAutoEnqueue === undefined) {
    try {
      const qboErp = await prisma.tenantErp.findFirst({ where: { tenantId, platformType: "QuickBooks Online" }, select: { autoEnqueueQbo: true } });
      shouldAutoEnqueue = qboErp?.autoEnqueueQbo ?? false;
    } catch { shouldAutoEnqueue = false; }
  }
  // Resolve invoiceType/Kind from QBO payload when present, not hard-coded
  const resolvedInvoiceType = (rawInvoice.invoiceType as any) || (rawInvoice.TxnType === "CreditMemo" ? "CREDIT_NOTE" : "STANDARD");
  const resolvedInvoiceKind = (rawInvoice.invoiceKind as any) || (transformed.customerTin ? "B2B" : "B2C");

  // Insert into local invoices DB in PENDING_NRS_STAMP state
  const dbInvoice = await prisma.invoice.create({
    data: {
      tenantId,
      sourceErp: "qbo",
      qboInvoiceId: qboId,
      clientInvoiceId,
      documentNumber: docNumber,
      invoiceType: resolvedInvoiceType,
      invoiceKind: resolvedInvoiceKind,
      issueDate: new Date(transformed.issueDate),
      customerCode,
      customerName: transformed.customerName,
      customerTin: transformed.customerTin || null,
      currency: "NGN",
      subtotal,
      taxAmount: totalVat,
      totalAmount: grandTotal,
      status: "PENDING_NRS_STAMP",
      ledgerWritebackStatus: "PENDING",
      lineItems: {
        create: processedLineItems,
      },
    },
    include: { lineItems: true },
  });

  // Enqueue only if auto-enqueue enabled; otherwise stays in preview inbox for operator to approve
  if (shouldAutoEnqueue) {
    const validatedPayload = invoiceIngestionSchema.parse({
      tenantId,
      clientInvoiceNumber: docNumber,
      documentNumber: docNumber,
      invoiceType: resolvedInvoiceType as any,
      invoiceKind: resolvedInvoiceKind as any,
      issueDate: transformed.issueDate,
      customerCode,
      customerName: transformed.customerName,
      customerTin: transformed.customerTin || undefined,
      lineItems: processedLineItems.map((li) => ({
        itemCode: li.itemCode,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discountAmount: 0,
        hsOrServiceCode: li.hsOrServiceCode,
        codeType: (li.hsOrServiceCode?.startsWith("HS") ? "HS_CODE" : "SERVICE_CODE") as any,
        vatRate: li.vatRate,
      })),
    });
    await invoiceQueue.add("signInvoice", { ...validatedPayload, dbInvoiceId: dbInvoice.id }, { idempotencyKey: `${tenantId}:${docNumber}` });
    console.log(`Successfully ingested and enqueued QBO Invoice ${clientInvoiceId} (qboId ${qboId}) for tenant ${tenantId} — auto-enqueue ON`);
  } else {
    console.log(`QBO Invoice ${clientInvoiceId} (qboId ${qboId}) ingested to preview inbox for tenant ${tenantId} — awaiting operator approval (autoEnqueue OFF)`);
  }
  return dbInvoice;
}

/**
 * Fetches and ingests a single specific QuickBooks Invoice by ID.
 */
export async function fetchAndIngestSpecificQboInvoice(
  tenantId: string,
  qboInvoiceId: string,
): Promise<any> {
  console.log(
    `Webhook Trigger: Fetching and ingesting specific QBO Invoice ${qboInvoiceId} for tenant ${tenantId}`,
  );
  const rawInvoice = await fetchSingleQboInvoice(tenantId, qboInvoiceId);
  return ingestQboInvoice(tenantId, rawInvoice);
}

/**
 * Performs Ledger Writeback (sparse update) to QBO to record the IRN and QR Code URL on the invoice.
 */
export async function writebackToQbo(
  tenantId: string,
  clientInvoiceId: string,
  irn: string,
  qrCodeUrl: string,
): Promise<any> {
  console.log(
    `Ledger Writeback: Writing back IRN & QR to QBO invoice ${clientInvoiceId} for tenant ${tenantId}`,
  );

  const accessToken = await getValidQboAccessToken(tenantId);
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: "QUICKBOOKS_ONLINE",
      },
    },
  });

  if (!integration) {
    throw new Error(`Integration details not found for tenant ${tenantId}`);
  }

  const realmId = integration.companyId;
  const baseUrl = getQboBaseUrl();

  // 1. Fetch current invoice first to get the latest SyncToken
  let syncToken = "0";
  try {
    const rawInvoice = await fetchSingleQboInvoice(tenantId, clientInvoiceId);
    syncToken = rawInvoice.SyncToken || "0";
  } catch (e) {
    console.warn(
      `Could not fetch latest SyncToken for invoice ${clientInvoiceId}, defaulting to '0':`,
      e,
    );
  }

  // 2. Perform Sparse Update with Custom Fields for IRN and QR Code
  const url = `${baseUrl}/v3/company/${realmId}/invoice?minorversion=65`;
  const updatePayload = {
    Id: clientInvoiceId,
    SyncToken: syncToken,
    sparse: true,
    CustomField: [
      {
        DefinitionId: "1",
        Name: "IRN",
        Type: "StringType",
        StringValue: irn,
      },
      {
        DefinitionId: "2",
        Name: "QR_CODE_URL",
        Type: "StringType",
        StringValue: qrCodeUrl,
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(updatePayload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `QBO Ledger Writeback sparse update failed (${response.status}): ${errText}`,
    );
  }

  const data = (await response.json()) as any;
  console.log(
    `QBO Ledger Writeback completed successfully for invoice ${clientInvoiceId}`,
  );

  // Update invoice writeback status locally
  await prisma.invoice.updateMany({
    where: { tenantId, clientInvoiceId },
    data: { ledgerWritebackStatus: "SYNCED" },
  });

  return data;
}
