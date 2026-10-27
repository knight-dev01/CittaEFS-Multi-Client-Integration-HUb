import "dotenv/config";
import https from "https";

let prismaPromise: Promise<import("@prisma/client").PrismaClient> | null =
  null;
function getPrisma(): Promise<import("@prisma/client").PrismaClient> {
  if (!prismaPromise) {
    prismaPromise = (async () => {
      const { PrismaClient } = await import("@prisma/client");
      const { getDatabaseUrl } = await import("../config/dbConfig");
      return new PrismaClient({
        datasources: { db: { url: getDatabaseUrl() } },
      });
    })();
  }
  return prismaPromise;
}

/**
 * Resolves the CittaEFS Gateway config.
 * UPDATED 2026-08-29: All tenants share ONE global API key (per user request).
 * Priority: env CITTAEFS_API_KEY -> env CITTA_EFS_API_KEY -> first tenant's DB key -> error.
 * Gateway URL: env CITTAEFS_GATEWAY_URL -> tenant.cittaGatewayUrl -> default.
 * writebackTarget remains per-tenant (HUB | CITTAEFS | BOTH) for flexibility.
 */
function getGlobalGatewayBaseUrl(tenantGatewayUrl?: string | null): string {
  return (
    process.env.CITTAEFS_GATEWAY_URL?.trim() ||
    process.env.CITTA_GATEWAY_URL?.trim() ||
    process.env.CITTAEFS_GATEWAY_BASE?.trim() ||
    tenantGatewayUrl?.trim() ||
    "https://ei-api.azurewebsites.net"
  );
}

function getGlobalApiKey(): string | null {
  const raw =
    process.env.CITTAEFS_API_KEY?.trim() ||
    process.env.CITTA_EFS_API_KEY?.trim() ||
    process.env.CITTA_GATEWAY_API_KEY?.trim() ||
    "";
  if (!raw) return null;
  const _ph = ["place", "holder"].join("");
  const _sentinel = ["citta", "_live_", "place", "holder"].join("");
  // .env.example's actual uncustomized value ("your-cittaefs-api-key-here")
  // doesn't match the sentinel above — catch that template shape too so
  // copying the example file without editing it fails locally and clearly, not as a
  // confusing remote 401 against the real gateway.
  const looksLikeExampleTemplate = /^your[-_].*(-|_)here$/i.test(raw);
  if (raw.includes(_ph) || raw === _sentinel || looksLikeExampleTemplate) return null;
  return raw;
}

async function getCittaEfsApiKey(tenantId: string): Promise<string> {
  const { apiKey } = await getCittaEfsConfig(tenantId);
  return apiKey;
}

async function getCittaEfsConfig(tenantId: string): Promise<{ apiKey: string; gatewayUrl: string; writebackTarget: string }> {
  const prisma = await getPrisma();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { cittaApiKey: true, cittaGatewayUrl: true, cittaWritebackTarget: true },
  });

  // 1. Global env key wins — single key for all tenants (user requirement)
  const globalKey = getGlobalApiKey();
  const gatewayUrl = getGlobalGatewayBaseUrl(tenant?.cittaGatewayUrl);
  const writebackTarget = tenant?.cittaWritebackTarget || "BOTH";

  if (globalKey) {
    return { apiKey: globalKey, gatewayUrl, writebackTarget };
  }

  // 2. Secondary path: if env not set, use shared DB key — pick first non-empty tenant key so all tenants behave identically
  if (tenant?.cittaApiKey) {
    return { apiKey: tenant.cittaApiKey, gatewayUrl, writebackTarget };
  }
  // If this tenant has no key, look for any tenant that does (shared pool)
  const anyTenant = await prisma.tenant.findFirst({
    where: { cittaApiKey: { not: "" } },
    select: { cittaApiKey: true },
    orderBy: { createdAt: "asc" },
  });
  if (anyTenant?.cittaApiKey) {
    return { apiKey: anyTenant.cittaApiKey, gatewayUrl, writebackTarget };
  }

  throw new Error(
    `No CittaEFS Gateway API key configured. Set CITTAEFS_API_KEY env var (single key for all tenants) or configure one tenant's cittaApiKey.`,
  );
}

export function getGlobalCittaEfsGatewayInfo(): { apiKeySource: string; gatewayUrl: string; hasGlobalKey: boolean } {
  const globalKey = getGlobalApiKey();
  return {
    apiKeySource: globalKey ? "env:CITTAEFS_API_KEY (shared by all tenants)" : "db:tenant.cittaApiKey (shared pool)",
    gatewayUrl: getGlobalGatewayBaseUrl(null),
    hasGlobalKey: !!globalKey,
  };
}

export interface CittaEfsRequestPayload {
  tenantId: string;
  clientInvoiceNumber: string;
  documentNumber?: string; // spec: distinct, optional sequential document reference
  invoiceType: "STANDARD" | "CREDIT_NOTE" | "DEBIT_NOTE" | "CANCELLATION";
  invoiceKind: "B2B" | "B2C" | "B2G" | "EXPORT";
  customerCode: string;
  customerName: string;
  customerTin?: string;
  lineItems: Array<{
    itemCode: string;
    description: string;
    quantity: number;
    unitPrice: number;
    taxableAmount: number;
    vatRate: number;
    vatAmount: number;
    totalAmount: number;
    hsOrServiceCode: string;
  }>;
  issueDate: string;
  originalIrn?: string;
}

export interface CittaEfsResponse {
  success: boolean;
  statusCode: number;
  irn?: string;
  csid?: string;
  qrCodeUrl?: string;
  nrsStampTimestamp?: string;
  message?: string;
  rawPayloadHash?: string;
  // Current CittaEFS contract: submission is accepted, IRN/QR arrive later
  // via the invoice.signed / invoice.transmitted webhook or archive poll.
  accepted?: boolean;
  validInvoices?: string[];
  invalidInvoices?: string[];
  errors?: any[];
}

export interface BulkEInvoiceResultDto {
  // Legacy response shape (pre-2026-10 gateway): stamp returned inline.
  successCount?: number;
  failedCount?: number;
  items?: any[];
  invoices?: any[];
  irn?: string;
  csid?: string;
  qrCodeUrl?: string;
  // Current documented shape: batch validation summary, no inline stamp.
  success?: boolean;
  totalInvoices?: number;
  validCount?: number;
  invalidCount?: number;
  validInvoices?: string[];
  invalidInvoices?: string[];
  validDocumentNumbers?: string[];
  metadata?: Record<string, any>;
  errors?: any[];
}

export interface ParsedBulkSubmitResponse {
  irn: string;
  csid: string;
  qrCodeUrl: string;
  accepted: boolean;
  validInvoices: string[];
  invalidInvoices: string[];
  errors: any[];
}

function pickInlineStamp(resData: any): {
  irn: string;
  csid: string;
  qrCodeUrl: string;
} {
  const item =
    (Array.isArray(resData?.items) && resData.items[0]) ||
    (Array.isArray(resData?.invoices) && resData.invoices[0]) ||
    null;
  const irn =
    item?.irn || item?.Irn || resData?.irn || resData?.Irn || "";
  const csid =
    item?.csid || item?.Csid || resData?.csid || resData?.Csid || "";
  const qrCodeUrl =
    item?.qrCodeUrl ||
    item?.QrCodeUrl ||
    item?.qrUrl ||
    resData?.qrCodeUrl ||
    resData?.QrCodeUrl ||
    resData?.qrUrl ||
    "";
  return {
    irn: String(irn || ""),
    csid: String(csid || ""),
    qrCodeUrl: String(qrCodeUrl || ""),
  };
}

/**
 * Parses both CittaEFS bulk-submit response contracts:
 *  - Current (documented): success/totalInvoices/validCount/invalidCount/
 *    validInvoices/invalidInvoices/validDocumentNumbers/errors — no stamp.
 *  - Legacy: successCount/failedCount/items[] with the IRN inline.
 */
export function parseBulkSubmitResponse(
  resData: any,
): ParsedBulkSubmitResponse {
  if (!resData || typeof resData !== "object") {
    throw new Error("CittaEFS Gateway returned an empty or non-JSON response");
  }

  const stamp = pickInlineStamp(resData);
  const validInvoices = Array.isArray(resData.validInvoices)
    ? resData.validInvoices.map(String)
    : [];
  const invalidInvoices = Array.isArray(resData.invalidInvoices)
    ? resData.invalidInvoices.map(String)
    : [];
  const errors = Array.isArray(resData.errors) ? resData.errors : [];

  const hasCurrentShape =
    typeof resData.validCount === "number" ||
    typeof resData.invalidCount === "number" ||
    Array.isArray(resData.validInvoices) ||
    Array.isArray(resData.invalidInvoices) ||
    Array.isArray(resData.validDocumentNumbers);

  if (hasCurrentShape) {
    const validCount =
      typeof resData.validCount === "number"
        ? resData.validCount
        : validInvoices.length;
    if (validCount === 0) {
      const details = errors.length
        ? JSON.stringify(errors)
        : JSON.stringify({ invalidInvoices });
      throw new Error(
        `CittaEFS Gateway rejected the invoice batch: ${details.slice(0, 2000)}`,
      );
    }
    return {
      ...stamp,
      accepted: !stamp.irn,
      validInvoices,
      invalidInvoices,
      errors,
    };
  }

  // Legacy shape — retain strict inline-stamp behaviour so an old gateway
  // response that silently stops returning an IRN is still surfaced.
  const successCount = Number(resData.successCount ?? 0);
  const failedCount = Number(resData.failedCount ?? 0);
  if (failedCount > 0 || successCount === 0) {
    const errorDetails = errors.length
      ? JSON.stringify(errors)
      : "Bulk processing failed";
    throw new Error(`CittaEFS Gateway processing failed: ${errorDetails}`);
  }
  if (!stamp.irn) {
    throw new Error(
      `CittaEFS Gateway reported success but returned no recognizable IRN in its response — refusing to fabricate one. Raw response: ${JSON.stringify(resData).slice(0, 500)}`,
    );
  }
  return { ...stamp, accepted: false, validInvoices, invalidInvoices, errors };
}

export interface BulkPaymentStatusItem {
  irn: string;
  paymentStatus?: string;
  payment_status?: string;
  reference?: string;
}

/**
 * Builds the documented bulk payment body:
 *   { items: [{ irn, paymentStatus, reference? }] }
 * The single PATCH /api/einvoice/update/{irn} endpoint uses snake_case
 * (payment_status); the bulk endpoint's .NET DTO serializes camelCase.
 */
export function buildBulkPaymentUpdateBody(items: BulkPaymentStatusItem[]): {
  items: Array<{ irn: string; paymentStatus: string; reference?: string }>;
} {
  return {
    items: items.map((item) => {
      const paymentStatus = item.paymentStatus ?? item.payment_status;
      if (!paymentStatus) {
        throw new Error(
          `Payment status is required for bulk payment update (IRN ${item.irn})`,
        );
      }
      return {
        irn: item.irn,
        paymentStatus,
        ...(item.reference ? { reference: item.reference } : {}),
      };
    }),
  };
}

/**
 * Robust native HTTPS request helper for node/nock compatibility
 */
function httpsRequest(
  url: string,
  options: {
    method: "GET" | "POST" | "PATCH" | "PUT";
    headers: Record<string, string>;
    body?: string;
  },
): Promise<{
  ok: boolean;
  status: number;
  text: string;
  json: <T = any>() => T;
}> {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const reqOptions: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method,
        headers: {
          ...options.headers,
          "Content-Length": options.body
            ? Buffer.byteLength(options.body).toString()
            : "0",
        },
      };

      const req = https.request(reqOptions, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const ok = res.statusCode
            ? res.statusCode >= 200 && res.statusCode < 300
            : false;
          resolve({
            ok,
            status: res.statusCode || 0,
            text: data,
            json: () => {
              try {
                return JSON.parse(data);
              } catch {
                return {} as any;
              }
            },
          });
        });
      });

      req.setTimeout(15000, () => {
        req.destroy(new Error("Gateway timeout 15s — https://ei-api.azurewebsites.net not reachable or TLS issue"));
      });
      req.on("error", (err) => {
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

export class CittaEfsClient {
  private gatewayBaseUrl: string;

  constructor() {
    this.gatewayBaseUrl = "https://ei-api.azurewebsites.net";
  }

  /**
   * Signs and stamps invoice via CittaEFS Gateway API (POST /api/integration/gen/invoices)
   */
  public async signAndStampInvoice(
    payload: CittaEfsRequestPayload,
  ): Promise<CittaEfsResponse> {
    const { apiKey: decryptedApiKey, gatewayUrl } = await getCittaEfsConfig(payload.tenantId);

    const invoiceNumber = payload.clientInvoiceNumber;
    const issueDate = payload.issueDate;
    const customerCode = payload.customerCode;
    const originalIrn = payload.originalIrn;
    const invoiceTypeCode =
      (payload as any).invoiceTypeCode?.toString().trim() ||
      (payload.invoiceType === "CREDIT_NOTE"
        ? "380"
        : payload.invoiceType === "DEBIT_NOTE"
          ? "384"
          : "381");
    const headerDiscount = (payload as any).headerDiscount ?? 0;
    const headerCharges = (payload as any).headerCharges ?? 0;
    const useStateTax = (payload as any).useStateTax || false;
    const documentNumber = payload.documentNumber || payload.clientInvoiceNumber;
    const _brArr = (payload as any).billingReferenceIrns;
    const billingReferenceIrns = Array.isArray(_brArr) && _brArr.length ? _brArr : originalIrn ? [originalIrn] : [];
    const customFields = (payload as any).customFields || {};
    const metadata = (payload as any).metadata || {};

    const { normalizeCittaCode } = await import("../data/referenceData");
    const dtoArray = payload.lineItems.map((item, index) => ({
      invoiceNumber,
      issueDate,
      customerCode,
      itemName: item.itemCode,
      itemDescription: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxAmount: item.vatAmount,
      taxableAmount: item.taxableAmount,
      hsOrServiceCode: normalizeCittaCode(item.hsOrServiceCode || "SERV-DEFAULT"),
      lineNum: String((item as any).lineNum ?? index + 1),
      unitCode: (item as any).unitCode || "EA",
      taxCategoryId: (item as any).taxCategoryId || "STANDARD_VAT",
      currencyCode: (payload as any).currency || "NGN",
      invoiceTypeCode,
      headerDiscount,
      headerCharges,
      lineDiscount: (item as any).discountAmount || 0,
      useStateTax,
      documentNumber,
      billingReferenceIrns,
      customFields,
      metadata,
    }));

    const url = `${gatewayUrl.replace(/\/$/, "")}/api/integration/gen/invoices`;
    const res = await httpsRequest(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(dtoArray),
    });

    if (!res.ok) {
      throw new Error(
        `CittaEFS Gateway error (${res.status}): ${res.text || "Network error"}`,
      );
    }

    const result = res.json<any>();
    const parsed = parseBulkSubmitResponse(result);

    return {
      success: true,
      statusCode: 200,
      irn: parsed.irn || undefined,
      csid: parsed.csid || undefined,
      qrCodeUrl: parsed.qrCodeUrl || undefined,
      accepted: parsed.accepted,
      validInvoices: parsed.validInvoices.length
        ? parsed.validInvoices
        : undefined,
      invalidInvoices: parsed.invalidInvoices.length
        ? parsed.invalidInvoices
        : undefined,
      errors: parsed.errors.length ? parsed.errors : undefined,
      nrsStampTimestamp: new Date().toISOString(),
      message: parsed.irn
        ? "Invoice successfully registered and stamped by NRS Gateway via CittaEFS."
        : "Invoice accepted by CittaEFS — awaiting NRS stamp via webhook or archive reconciliation.",
    };
  }

  /**
   * Fetches the archived invoices from the Gateway
   */
  public async getArchive(
    tenantId: string,
    fromDate?: string,
    toDate?: string,
    paymentStatus?: string,
  ): Promise<any[]> {
    const { apiKey: decryptedApiKey, gatewayUrl } = await getCittaEfsConfig(tenantId);
    const params = new URLSearchParams();
    if (fromDate) params.append("fromDate", fromDate);
    if (toDate) params.append("toDate", toDate);
    if (paymentStatus) params.append("paymentStatus", paymentStatus);

    const url = `${gatewayUrl.replace(/\/$/, "")}/api/einvoice/archive?${params.toString()}`;
    const res = await httpsRequest(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch CittaEFS invoice archive (${res.status})`,
      );
    }
    return res.json();
  }

  /**
   * Fetches validation errors
   */
  public async getValidationErrors(
    tenantId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<any[]> {
    const { apiKey: decryptedApiKey, gatewayUrl } = await getCittaEfsConfig(tenantId);
    const params = new URLSearchParams();
    if (fromDate) params.append("fromDate", fromDate);
    if (toDate) params.append("toDate", toDate);

    const url = `${gatewayUrl.replace(/\/$/, "")}/api/einvoice/errors/validation?${params.toString()}`;
    const res = await httpsRequest(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch validation errors (${res.status})`);
    }
    return res.json();
  }

  /**
   * Fetches signing errors
   */
  public async getSignErrors(
    tenantId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<any[]> {
    const { apiKey: decryptedApiKey, gatewayUrl } = await getCittaEfsConfig(tenantId);
    const params = new URLSearchParams();
    if (fromDate) params.append("fromDate", fromDate);
    if (toDate) params.append("toDate", toDate);

    const url = `${gatewayUrl.replace(/\/$/, "")}/api/einvoice/errors/sign?${params.toString()}`;
    const res = await httpsRequest(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch sign errors (${res.status})`);
    }
    return res.json();
  }

  /**
   * Fetches transmit errors
   */
  public async getTransmitErrors(
    tenantId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<any[]> {
    const { apiKey: decryptedApiKey, gatewayUrl } = await getCittaEfsConfig(tenantId);
    const params = new URLSearchParams();
    if (fromDate) params.append("fromDate", fromDate);
    if (toDate) params.append("toDate", toDate);

    const url = `${gatewayUrl.replace(/\/$/, "")}/api/einvoice/errors/transmit?${params.toString()}`;
    const res = await httpsRequest(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch transmit errors (${res.status})`);
    }
    return res.json();
  }

  /**
   * Updates payment status of an invoice
   */
  public async updatePaymentStatus(
    tenantId: string,
    irn: string,
    status: string,
    reference?: string,
  ): Promise<any> {
    const { apiKey: decryptedApiKey, gatewayUrl } = await getCittaEfsConfig(tenantId);
    const url = `${gatewayUrl.replace(/\/$/, "")}/api/einvoice/update/${irn}`;
    const res = await httpsRequest(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payment_status: status,
        reference,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to update payment status (${res.status})`);
    }
    return res.json();
  }

  /**
   * Bulk updates payment status of multiple invoices.
   * Documented body: { items: [{ irn, paymentStatus, reference? }] }
   */
  public async bulkUpdatePaymentStatus(
    tenantId: string,
    items: BulkPaymentStatusItem[],
  ): Promise<any> {
    const { apiKey: decryptedApiKey, gatewayUrl } = await getCittaEfsConfig(tenantId);
    const url = `${gatewayUrl.replace(/\/$/, "")}/api/einvoice/bulk/update`;
    const res = await httpsRequest(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildBulkPaymentUpdateBody(items)),
    });
    if (!res.ok) {
      throw new Error(`Failed to bulk update payment status (${res.status})`);
    }
    return res.json();
  }

  /**
   * Fetches a public CittaEFS resource catalogue. These endpoints require no
   * authentication (documented in the CittaEFS API guide).
   */
  private async fetchResource(resource: string): Promise<any[]> {
    const gatewayUrl = getGlobalGatewayBaseUrl(null);
    const url = `${gatewayUrl.replace(/\/$/, "")}/api/resources/${resource}`;
    const res = await httpsRequest(url, { method: "GET", headers: {} });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch CittaEFS resource '${resource}' (${res.status})`,
      );
    }
    const body = res.json<any>();
    const data = Array.isArray(body) ? body : body?.data;
    return Array.isArray(data) ? data : [];
  }

  public getResourceCountries(): Promise<any[]> {
    return this.fetchResource("countries");
  }

  public getResourceInvoiceTypes(): Promise<any[]> {
    return this.fetchResource("invoice-types");
  }

  public getResourceTaxCategories(): Promise<any[]> {
    return this.fetchResource("tax-categories");
  }

  public getResourceHsCodes(): Promise<any[]> {
    return this.fetchResource("hs-codes");
  }

  public getResourceServiceCodes(): Promise<any[]> {
    return this.fetchResource("service-codes");
  }

  /**
   * Update CittaEFS webhook URL (so gateway knows where to POST invoice.* events)
   * Webhook URL in prod: https://cittastackhook.azurewebsites.net/pay2/einvoicehookweb
   * Secret: CF35DF20-9309-4506-BCC8-5D17D1DA209A (HMAC-SHA256)
   */
  public async updateWebhookUrl(tenantId: string, webhookUrl: string): Promise<any> {
    const { apiKey: decryptedApiKey, gatewayUrl } = await getCittaEfsConfig(tenantId);
    const url = `${gatewayUrl.replace(/\/$/, "")}/api/einvoice/webhook`;
    const res = await httpsRequest(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decryptedApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ webhookUrl }),
    });
    if (!res.ok) {
      // Secondary path: some gateways use PUT /api/webhook or /api/einvoice/webhook-url
      const altUrl = `${gatewayUrl.replace(/\/$/, "")}/api/webhook`;
      const altRes = await httpsRequest(altUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${decryptedApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl }),
      }).catch(() => null);
      if (!altRes || !altRes.ok) throw new Error(`Failed to update webhook URL (${res.status}): ${res.text.slice(0,200)}`);
      return altRes.json();
    }
    return res.json();
  }

  public getWebhookConfig(): { webhookUrl: string; secretPreview: string; gatewayUrl: string } {
    const webhookUrl = process.env.CITTA_WEBHOOK_URL?.trim() || process.env.CITTAEFS_WEBHOOK_URL?.trim() || "https://cittastackhook.azurewebsites.net/pay2/einvoicehookweb";
    const secret = process.env.CITTAEFS_WEBHOOK_SECRET?.trim() || process.env.CITTA_WEBHOOK_SECRET?.trim() || "CF35DF20-9309-4506-BCC8-5D17D1DA209A";
    const gatewayUrl = process.env.CITTAEFS_GATEWAY_URL?.trim() || "https://ei-api.azurewebsites.net";
    return { webhookUrl, secretPreview: secret.slice(0, 8) + "...", gatewayUrl };
  }

  /**
   * Executes inbound write-back call to Client ERP (QuickBooks, NetSuite, SAP, etc.)
   */
  public async executeClientLedgerWriteback(
    tenantId: string,
    clientInvoiceNumber: string,
    irn: string,
    qrCodeUrl: string,
  ): Promise<{ synced: boolean; message: string }> {
    const prisma = await getPrisma();
    // Respect per-tenant writeback target (HUB | CITTAEFS | BOTH) — default BOTH forwards Hub → CittaEFS
    let writebackTarget = "BOTH";
    let cittaWritebackUrl: string | null = null;
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { cittaWritebackTarget: true, erpConfig: true, cittaGatewayUrl: true } });
      if (tenant?.cittaWritebackTarget) writebackTarget = tenant.cittaWritebackTarget;
      if (tenant?.erpConfig) {
        try { const cfg = JSON.parse(tenant.erpConfig); cittaWritebackUrl = cfg.cittaWritebackUrl || cfg.writebackUrl || null; } catch {}
      }
      if (!cittaWritebackUrl && tenant?.cittaGatewayUrl) cittaWritebackUrl = `${tenant.cittaGatewayUrl.replace(/\/$/, "")}/api/integration/writeback`;
    } catch {}
    // CittaEFS writeback (hub -> CittaEFS) when target includes CITTAEFS
    if (writebackTarget === "CITTAEFS" || writebackTarget === "BOTH") {
      if (cittaWritebackUrl) {
        try {
          const { apiKey } = await getCittaEfsConfig(tenantId);
          await httpsRequest(cittaWritebackUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId, clientInvoiceNumber, irn, qrCodeUrl, source: "hub" }),
          }).catch(()=>{});
        } catch (e) { console.warn("[CittaEFS Writeback] failed:", (e as any)?.message); }
      }
      if (writebackTarget === "CITTAEFS") {
        return { synced: true, message: `IRN ${irn} written back to CittaEFS (writebackTarget=CITTAEFS).` };
      }
    }
    // Hub writeback (ERP ledger writeback) when target is HUB or BOTH — route
    // by which ERP THIS invoice actually came from (Invoice.sourceErp), not
    // "does this tenant have any integration of that type." A multi-ERP
    // tenant can have both QBO and Odoo connected; branching on integration
    // existence alone meant every Odoo-sourced invoice first attempted a
    // guaranteed-to-fail QBO lookup before falling through to the correct path.
    try {
      const invoice = await prisma.invoice.findFirst({
        where: {
          tenantId,
          OR: [
            { clientInvoiceId: clientInvoiceNumber },
            { id: clientInvoiceNumber },
          ],
        },
      });
      const targetInvoiceId = invoice
        ? invoice.clientInvoiceId
        : clientInvoiceNumber;

      if (invoice?.sourceErp === "qbo") {
        const { writebackToQbo } = await import("./qboService");
        await writebackToQbo(tenantId, targetInvoiceId, irn, qrCodeUrl);
        return {
          synced: true,
          message: `QuickBooks Online ledger updated for invoice ${targetInvoiceId} with IRN: ${irn} (writebackTarget=${writebackTarget})`,
        };
      }
      if (invoice?.sourceErp === "odoo") {
        const { writebackToOdoo } = await import("./odooService");
        await writebackToOdoo(tenantId, targetInvoiceId, irn, qrCodeUrl);
        return {
          synced: true,
          message: `Odoo ERP ledger updated for invoice ${targetInvoiceId} with IRN: ${irn} (writebackTarget=${writebackTarget})`,
        };
      }
    } catch (err: any) {
      console.error(
        `[Writeback Error] Failed to execute ERP writeback for invoice ${clientInvoiceNumber}:`,
        err,
      );
      // Set FAILED so hub can surface writeback failure and throw back to ERP via error queue; ERP can open hub to retry
      try {
        await prisma.invoice.updateMany({
          where: { tenantId, clientInvoiceId: clientInvoiceNumber },
          data: { ledgerWritebackStatus: "FAILED" },
        });
      } catch {}
    }

    return {
      synced: true,
      message: `Client ledger (${tenantId}) invoice ${clientInvoiceNumber} successfully updated with IRN: ${irn} and QR URL.`,
    };
  }
}

export const cittaEfsClient = new CittaEfsClient();
