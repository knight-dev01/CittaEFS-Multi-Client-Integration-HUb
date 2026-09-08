import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "../config/dbConfig";
import {
  unpackAndDecryptString,
  packEncryptedString,
} from "../config/encryption";
import { OdooAdapter } from "../adapters/connectorAdapters";
import { invoiceQueue } from "../queues/invoiceQueue";
import { invoiceIngestionSchema } from "../schemas/invoice.schema";
import { isValidCittaCode, getCittaCodeType } from "../data/referenceData";

const prisma = new PrismaClient({
  datasources: { db: { url: getDatabaseUrl() } },
});
const odooAdapter = new OdooAdapter();

const SOURCE_SYSTEM = "ODOO";

// Odoo API keys are static (no OAuth expiry) — Integration.accessTokenExpiresAt
// is a non-nullable DateTime column shared with QBO's refresh-token logic, so
// we park a far-future sentinel here instead of overloading the schema.
const STATIC_KEY_SENTINEL_EXPIRY = new Date("2099-12-31T00:00:00Z");
const INERT_REFRESH_TOKEN_MARKER = "odoo-static-api-key-no-refresh-token";

export interface OdooCredentials {
  url: string;
  database: string;
  username: string;
  apiKey: string;
  uid: number;
}

interface OdooErpConfig {
  odooUrl?: string;
  odooDatabase?: string;
  odooUsername?: string;
  odooUid?: number;
  [key: string]: any;
}

function readTenantErpConfig(erpConfigJson: string | null | undefined): OdooErpConfig {
  if (!erpConfigJson) return {};
  try {
    return JSON.parse(erpConfigJson) || {};
  } catch {
    return {};
  }
}

async function updateTenantOdooConfig(tenantId: string, patch: OdooErpConfig): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { erpConfig: true } });
  const existing = readTenantErpConfig(tenant?.erpConfig);
  const merged = { ...existing, ...patch };
  await prisma.tenant.update({ where: { id: tenantId }, data: { erpConfig: JSON.stringify(merged) } });
}

/**
 * Generic Odoo JSON-RPC caller. Every call is stateless — database, uid, and
 * api key are passed on every request rather than relying on a session cookie.
 */
export async function callOdoo(url: string, service: string, method: string, args: any[]): Promise<any> {
  const rpcUrl = `${url.replace(/\/$/, "")}/jsonrpc`;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: Date.now(),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Odoo JSON-RPC call failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as any;
  if (data.error) {
    const message = data.error?.data?.message || data.error?.message || "Unknown Odoo RPC error";
    throw new Error(`Odoo RPC error: ${message}`);
  }
  return data.result;
}

/**
 * Authenticates against Odoo's common service to obtain a uid. Used both at
 * connect-time (to validate credentials) and whenever a caller needs a fresh uid.
 */
export async function authenticateOdoo(
  url: string,
  database: string,
  username: string,
  apiKey: string,
): Promise<number> {
  const uid = await callOdoo(url, "common", "authenticate", [database, username, apiKey, {}]);
  if (!uid || typeof uid !== "number") {
    throw new Error("Odoo authentication failed — check URL, database name, username, and API key.");
  }
  return uid;
}

/**
 * Connects a tenant to an Odoo instance: validates credentials via authenticateOdoo,
 * then persists the encrypted API key on the Integration row and the non-secret
 * connection details (url, database, username, uid) on Tenant.erpConfig.
 */
export async function connectOdoo(
  tenantId: string,
  params: { odooUrl: string; odooDatabase: string; odooUsername: string; odooApiKey: string },
): Promise<{ connected: boolean; uid: number }> {
  const { odooUrl, odooDatabase, odooUsername, odooApiKey } = params;
  const normalizedUrl = odooUrl.replace(/\/$/, "");
  const uid = await authenticateOdoo(normalizedUrl, odooDatabase, odooUsername, odooApiKey);

  const encryptedApiKey = packEncryptedString(odooApiKey);
  const encryptedRefreshMarker = packEncryptedString(INERT_REFRESH_TOKEN_MARKER);

  await prisma.integration.upsert({
    where: { tenantId_sourceSystem: { tenantId, sourceSystem: SOURCE_SYSTEM } },
    create: {
      tenantId,
      sourceSystem: SOURCE_SYSTEM,
      accessToken: encryptedApiKey,
      refreshToken: encryptedRefreshMarker,
      companyId: odooDatabase,
      accessTokenExpiresAt: STATIC_KEY_SENTINEL_EXPIRY,
      status: "CONNECTED",
    },
    update: {
      accessToken: encryptedApiKey,
      refreshToken: encryptedRefreshMarker,
      companyId: odooDatabase,
      accessTokenExpiresAt: STATIC_KEY_SENTINEL_EXPIRY,
      status: "CONNECTED",
    },
  });

  await updateTenantOdooConfig(tenantId, {
    odooUrl: normalizedUrl,
    odooDatabase,
    odooUsername,
    odooUid: uid,
  });

  return { connected: true, uid };
}

/**
 * Loads and decrypts a tenant's Odoo connection details. No refresh logic is
 * needed (unlike QBO) since Odoo API keys are static.
 */
export async function getValidOdooCredentials(tenantId: string): Promise<OdooCredentials> {
  const integration = await prisma.integration.findUnique({
    where: { tenantId_sourceSystem: { tenantId, sourceSystem: SOURCE_SYSTEM } },
  });
  if (!integration) {
    throw new Error(`No Odoo integration found for tenant ${tenantId}`);
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { erpConfig: true } });
  const cfg = readTenantErpConfig(tenant?.erpConfig);
  if (!cfg.odooUrl || !cfg.odooUsername || cfg.odooUid === undefined) {
    await prisma.integration.update({ where: { id: integration.id }, data: { status: "DISCONNECTED" } }).catch(() => {});
    throw new Error("Odoo connection needs reauthorization — missing connection details. Please reconnect Odoo.");
  }

  let apiKey = "";
  try {
    apiKey = unpackAndDecryptString(integration.accessToken);
  } catch (e: any) {
    await prisma.integration.update({ where: { id: integration.id }, data: { status: "DISCONNECTED" } }).catch(() => {});
    throw new Error(`Failed to decrypt Odoo API key: ${e.message}`);
  }

  return {
    url: cfg.odooUrl,
    database: cfg.odooDatabase || integration.companyId,
    username: cfg.odooUsername,
    apiKey,
    uid: cfg.odooUid,
  };
}

/**
 * Fetches basic company info for a tenant's connected Odoo instance — a
 * lightweight, real connectivity check used by "Test Connection" actions in the UI.
 */
export async function fetchOdooCompanyInfo(tenantId: string): Promise<any> {
  const creds = await getValidOdooCredentials(tenantId);
  const companyIds = await callOdoo(creds.url, "object", "execute_kw", [
    creds.database, creds.uid, creds.apiKey,
    "res.company", "search_read",
    [[]],
    { fields: ["name", "currency_id"], limit: 1 },
  ]);
  return companyIds?.[0] || null;
}

/**
 * Batched line-item fetch for a set of account.move ids. Odoo's search_read
 * does not support nested fields, so line items always require a separate call.
 */
async function fetchOdooInvoiceLines(creds: OdooCredentials, invoiceIds: number[]): Promise<Record<number, any[]>> {
  if (!invoiceIds.length) return {};
  // Real billable lines are display_type=False/null on Odoo <=15, and display_type='product'
  // from Odoo 16+ (where display_type also gained 'tax'/'rounding'/'payment_term'/'cogs'/
  // 'discount'/'epd' values for non-product technical lines, alongside the older
  // 'line_section'/'line_note' layout markers) — match both so real product/service lines
  // are found across versions without also pulling in tax/rounding/section/note rows.
  const lines = await callOdoo(creds.url, "object", "execute_kw", [
    creds.database, creds.uid, creds.apiKey,
    "account.move.line", "search_read",
    [[["move_id", "in", invoiceIds], ["display_type", "in", [false, "product"]]]],
    { fields: ["move_id", "product_id", "name", "quantity", "price_unit", "price_subtotal", "price_total"] },
  ]);
  const byInvoice: Record<number, any[]> = {};
  for (const line of lines || []) {
    const moveId = Array.isArray(line.move_id) ? line.move_id[0] : line.move_id;
    if (!byInvoice[moveId]) byInvoice[moveId] = [];
    byInvoice[moveId].push(line);
  }
  return byInvoice;
}

/**
 * Batched partner tax-ID (vat) fetch for a set of res.partner ids.
 */
async function fetchOdooPartnerVat(creds: OdooCredentials, partnerIds: number[]): Promise<Record<number, string>> {
  if (!partnerIds.length) return {};
  const partners = await callOdoo(creds.url, "object", "execute_kw", [
    creds.database, creds.uid, creds.apiKey,
    "res.partner", "read",
    [partnerIds],
    { fields: ["vat"] },
  ]);
  const byPartner: Record<number, string> = {};
  for (const p of partners || []) {
    if (p.vat) byPartner[p.id] = p.vat;
  }
  return byPartner;
}

/**
 * Composes a page of raw account.move records with their line items and partner
 * VAT batch-attached (as _lines / _partnerVat) so ingestOdooInvoice can consume
 * each one exactly like a single self-contained payload, without an N+1 fetch pattern.
 */
async function composeInvoicePage(creds: OdooCredentials, moves: any[]): Promise<any[]> {
  if (!moves.length) return [];
  const invoiceIds = moves.map((m) => m.id);
  const partnerIds = Array.from(new Set(moves.map((m) => (Array.isArray(m.partner_id) ? m.partner_id[0] : null)).filter((id): id is number => id !== null)));

  const [linesByInvoice, vatByPartner] = await Promise.all([
    fetchOdooInvoiceLines(creds, invoiceIds),
    fetchOdooPartnerVat(creds, partnerIds),
  ]);

  return moves.map((move) => {
    const partnerId = Array.isArray(move.partner_id) ? move.partner_id[0] : undefined;
    return {
      ...move,
      _lines: linesByInvoice[move.id] || [],
      _partnerVat: partnerId !== undefined ? vatByPartner[partnerId] : undefined,
    };
  });
}

const POSTED_INVOICE_DOMAIN = [
  ["move_type", "in", ["out_invoice", "out_refund"]],
  ["state", "=", "posted"],
];
const INVOICE_FIELDS = ["id", "name", "invoice_date", "move_type", "partner_id", "amount_untaxed", "amount_tax", "amount_total", "currency_id", "write_date"];

/**
 * Fetches all historical posted invoices from Odoo using offset/limit pagination.
 */
export async function fetchAllOdooInvoicesPaginated(tenantId: string): Promise<any[]> {
  const creds = await getValidOdooCredentials(tenantId);
  const integration = await prisma.integration.findUnique({
    where: { tenantId_sourceSystem: { tenantId, sourceSystem: SOURCE_SYSTEM } },
  });
  if (!integration) throw new Error(`Integration details not found for tenant ${tenantId}`);

  let allMoves: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    let page: any[];
    try {
      page = await callOdoo(creds.url, "object", "execute_kw", [
        creds.database, creds.uid, creds.apiKey,
        "account.move", "search_read",
        [POSTED_INVOICE_DOMAIN],
        { fields: INVOICE_FIELDS, offset, limit },
      ]);
    } catch (e: any) {
      throw new Error(`Could not reach Odoo, please try again: ${e.message}`);
    }

    if (!page || page.length === 0) break;
    allMoves.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }

  const composed = await composeInvoicePage(creds, allMoves);

  await prisma.integration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date() } });

  return composed;
}

/**
 * Fetches posted invoices updated since the last sync (write_date domain filter).
 */
export async function fetchOdooInvoicesSince(tenantId: string, lastSyncAt?: Date): Promise<any[]> {
  const creds = await getValidOdooCredentials(tenantId);
  const integration = await prisma.integration.findUnique({
    where: { tenantId_sourceSystem: { tenantId, sourceSystem: SOURCE_SYSTEM } },
  });
  if (!integration) throw new Error(`Integration details not found for tenant ${tenantId}`);

  const since = lastSyncAt || integration.lastSyncAt;
  const domain = since
    ? [...POSTED_INVOICE_DOMAIN, ["write_date", ">", new Date(since).toISOString().replace("T", " ").substring(0, 19)]]
    : POSTED_INVOICE_DOMAIN;

  let moves: any[];
  try {
    moves = await callOdoo(creds.url, "object", "execute_kw", [
      creds.database, creds.uid, creds.apiKey,
      "account.move", "search_read",
      [domain],
      { fields: INVOICE_FIELDS },
    ]);
  } catch (e: any) {
    throw new Error(`Could not reach Odoo, please try again: ${e.message}`);
  }

  const composed = await composeInvoicePage(creds, moves || []);

  await prisma.integration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date() } });

  return composed;
}

/**
 * Upserts Customer and Item master records from a validated Odoo invoice ingestion,
 * mirroring qboService's upsertQboMasterData. Existing records are left untouched.
 */
async function upsertOdooMasterData(
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
        companyName: customerName || "Odoo Customer",
        taxId: customerTin || null,
        taxClassification: customerTin ? "B2B" : "B2C",
        street: "Synced from Odoo ERP",
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
          name: item.description,
          description: item.description,
          hsOrServiceCode: item.hsOrServiceCode,
          categoryType: getCittaCodeType(item.hsOrServiceCode) === "SERVICE_CODE" ? "SERVICE" : "GOODS",
          isService: getCittaCodeType(item.hsOrServiceCode) === "SERVICE_CODE",
          defaultVatRate: item.vatRate,
        },
      });
    }
  }
}

/**
 * Ingests a composed raw Odoo invoice (account.move + _lines + _partnerVat).
 * Mirrors ingestQboInvoice's pipeline: dedup, validate, transform, HS/service-code
 * inference + validation, master-data upsert, and conditional auto-enqueue.
 */
export async function ingestOdooInvoice(
  tenantId: string,
  rawMove: any,
  opts?: { autoEnqueue?: boolean },
): Promise<any> {
  const odooId = String(rawMove.id);
  const clientInvoiceId = String(rawMove.name || `ODOO-${odooId}`).trim();

  const existing = await prisma.invoice.findFirst({ where: { tenantId, clientInvoiceId } });
  if (existing) {
    if (!existing.odooInvoiceId) {
      try { await prisma.invoice.update({ where: { id: existing.id }, data: { odooInvoiceId: odooId } }); } catch {}
    }
    console.log(`Invoice ${clientInvoiceId} (odooId ${odooId}) already exists for tenant ${tenantId}. Skipping.`);
    return existing;
  }

  const validation = odooAdapter.validate(rawMove);
  if (!validation.valid) {
    const errorMsg = validation.errors.join(" | ");
    await prisma.validationError.create({
      data: {
        tenantId,
        clientInvoiceNumber: clientInvoiceId,
        errorCategory: "INVALID_TIN_FORMAT",
        fieldAffected: "metadata",
        errorMessage: `Odoo validation failed: ${errorMsg}`,
        rawPayloadSample: JSON.stringify(rawMove),
        status: "OPEN",
      },
    });
    throw new Error(`Validation failed for Odoo Invoice ${clientInvoiceId}: ${errorMsg}`);
  }

  const transformed = odooAdapter.transform(rawMove);

  const tenantItems = await prisma.item.findMany({ where: { tenantId } });
  const processedLineItems = transformed.lineItems.map((li: any) => {
    const mapping = tenantItems.find((m) => m.clientSku === li.clientSku);
    const mappingCode = mapping?.hsOrServiceCode;
    const mappingIsGeneric = !mappingCode || !isValidCittaCode(mappingCode);
    const hsOrServiceCode = mappingIsGeneric ? li.hsOrServiceCode : mappingCode;
    const qty = Number(li.quantity || 1);
    const price = Number(li.unitPrice || 0);
    const taxable = li.taxableAmount !== undefined ? Number(li.taxableAmount) : qty * price;
    const vatRate = li.vatRate !== undefined ? Number(li.vatRate) : Number(mapping?.defaultVatRate || 7.5); // Nigeria STANDARD_VAT is 7.5%, not 16%
    const vatAmount = li.vatAmount !== undefined ? Number(li.vatAmount) : (taxable * vatRate) / 100;
    const totalAmount = taxable + vatAmount;

    return {
      itemCode: li.clientSku || "SKU-GENERIC",
      description: li.description || "Odoo Invoice Line",
      quantity: qty,
      unitPrice: price,
      taxableAmount: taxable,
      vatRate,
      vatAmount,
      totalAmount,
      hsOrServiceCode,
    };
  });

  if (!processedLineItems.length) {
    await prisma.validationError.create({
      data: {
        tenantId,
        clientInvoiceNumber: clientInvoiceId,
        errorCategory: "MISSING_HS_CODE",
        fieldAffected: "lineItems",
        errorMessage: `No invoice data provided — Odoo invoice ${clientInvoiceId} has no line items`,
        rawPayloadSample: JSON.stringify(rawMove).slice(0, 2000),
        status: "OPEN",
      },
    });
    throw new Error(`No invoice data provided for Odoo Invoice ${clientInvoiceId}`);
  }

  for (const li of processedLineItems) {
    if (!isValidCittaCode(li.hsOrServiceCode)) {
      await prisma.validationError.create({
        data: {
          tenantId,
          clientInvoiceNumber: clientInvoiceId,
          errorCategory: "MISSING_HS_CODE",
          fieldAffected: "hsOrServiceCode",
          errorMessage: `Invalid Product Code - must be valid HS Code or Service Code (found ${li.hsOrServiceCode} for ${li.itemCode}) — map in Item Dictionary`,
          rawPayloadSample: JSON.stringify(rawMove).slice(0, 2000),
          status: "OPEN",
        },
      });
      throw new Error(`Invalid Product Code - must be valid HS Code or Service Code (found ${li.hsOrServiceCode})`);
    }
  }

  const subtotal = processedLineItems.reduce((acc, item) => acc + item.taxableAmount, 0);
  const totalVat = processedLineItems.reduce((acc, item) => acc + item.vatAmount, 0);
  const grandTotal = subtotal + totalVat;

  await upsertOdooMasterData(tenantId, transformed.customerCode!, transformed.customerName, transformed.customerTin, processedLineItems);

  let shouldAutoEnqueue = opts?.autoEnqueue;
  if (shouldAutoEnqueue === undefined) {
    try {
      // autoEnqueueQbo is a generic "preview inbox vs auto-enqueue" toggle despite its
      // QBO-era name — reused here rather than adding an Odoo-specific column.
      const odooErp = await prisma.tenantErp.findFirst({ where: { tenantId, platformType: "Odoo ERP" }, select: { autoEnqueueQbo: true } });
      shouldAutoEnqueue = odooErp?.autoEnqueueQbo ?? false;
    } catch { shouldAutoEnqueue = false; }
  }

  const dbInvoice = await prisma.invoice.create({
    data: {
      tenantId,
      sourceErp: "odoo",
      odooInvoiceId: odooId,
      clientInvoiceId,
      documentNumber: transformed.documentNumber,
      invoiceType: transformed.invoiceType || "STANDARD",
      invoiceKind: transformed.invoiceKind || "B2C",
      issueDate: new Date(transformed.issueDate),
      customerCode: transformed.customerCode!,
      customerName: transformed.customerName,
      customerTin: transformed.customerTin || null,
      currency: transformed.currency || "NGN",
      subtotal,
      taxAmount: totalVat,
      totalAmount: grandTotal,
      status: "PENDING_NRS_STAMP",
      ledgerWritebackStatus: "PENDING",
      lineItems: { create: processedLineItems },
    },
    include: { lineItems: true },
  });

  if (shouldAutoEnqueue) {
    const validatedPayload = invoiceIngestionSchema.parse({
      tenantId,
      clientInvoiceNumber: clientInvoiceId,
      documentNumber: transformed.documentNumber,
      invoiceType: (transformed.invoiceType || "STANDARD") as any,
      invoiceKind: (transformed.invoiceKind || "B2C") as any,
      issueDate: transformed.issueDate,
      customerCode: transformed.customerCode,
      customerName: transformed.customerName,
      customerTin: transformed.customerTin || undefined,
      lineItems: processedLineItems.map((li) => ({
        itemCode: li.itemCode,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discountAmount: 0,
        hsOrServiceCode: li.hsOrServiceCode,
        codeType: (getCittaCodeType(li.hsOrServiceCode) || "SERVICE_CODE") as any,
        vatRate: li.vatRate,
      })),
    });
    await invoiceQueue.add("signInvoice", { ...validatedPayload, dbInvoiceId: dbInvoice.id }, { idempotencyKey: `${tenantId}:${clientInvoiceId}` });
    console.log(`Successfully ingested and enqueued Odoo Invoice ${clientInvoiceId} (odooId ${odooId}) for tenant ${tenantId} — auto-enqueue ON`);
  } else {
    console.log(`Odoo Invoice ${clientInvoiceId} (odooId ${odooId}) ingested to preview inbox for tenant ${tenantId} — awaiting operator approval (autoEnqueue OFF)`);
  }
  return dbInvoice;
}

/**
 * Writes the IRN and QR code URL back to Odoo as a chatter (message_post) entry
 * on the source account.move record. Odoo has no guaranteed custom fields on a
 * client's instance, so the universal notes/log API is used instead of QBO's
 * CustomField sparse-update trick.
 */
export async function writebackToOdoo(
  tenantId: string,
  clientInvoiceId: string,
  irn: string,
  qrCodeUrl: string,
): Promise<any> {
  console.log(`Ledger Writeback: Writing back IRN & QR to Odoo invoice ${clientInvoiceId} for tenant ${tenantId}`);

  const creds = await getValidOdooCredentials(tenantId);
  const invoice = await prisma.invoice.findFirst({ where: { tenantId, clientInvoiceId } });
  if (!invoice || !invoice.odooInvoiceId) {
    throw new Error(`No Odoo invoice id on file for ${clientInvoiceId} (tenant ${tenantId})`);
  }

  const body = `CittaEFS Compliance Stamp — IRN: ${irn} | QR Code: ${qrCodeUrl}`;
  await callOdoo(creds.url, "object", "execute_kw", [
    creds.database, creds.uid, creds.apiKey,
    "account.move", "message_post",
    [[Number(invoice.odooInvoiceId)]],
    { body },
  ]);

  console.log(`Odoo Ledger Writeback completed successfully for invoice ${clientInvoiceId}`);

  await prisma.invoice.updateMany({
    where: { tenantId, clientInvoiceId },
    data: { ledgerWritebackStatus: "SYNCED" },
  });

  return { success: true };
}
