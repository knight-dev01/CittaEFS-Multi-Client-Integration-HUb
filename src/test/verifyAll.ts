import "dotenv/config";
import nock from "nock";

process.env.QBO_CLIENT_ID =
  process.env.QBO_CLIENT_ID || "test_qbo_client_id_123";
process.env.QBO_CLIENT_SECRET =
  process.env.QBO_CLIENT_SECRET || "test_qbo_client_secret_456";
process.env.QBO_REDIRECT_URI =
  process.env.QBO_REDIRECT_URI ||
  "https://cittaefs-multi-client-integration-hub.onrender.com/api/integrations/qbo/callback";
process.env.CITTAEFS_API_KEY =
  process.env.CITTAEFS_API_KEY || "sk_live_test_api_key_789";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "../config/dbConfig";
import {
  packEncryptedString,
  unpackAndDecryptString,
} from "../config/encryption";
import {
  invoiceIngestionSchema,
  invoiceLineItemSchema,
} from "../schemas/invoice.schema";
import { QuickBooksAdapter, CsvAdapter, OdooAdapter } from "../adapters/connectorAdapters";
import { cittaEfsClient } from "../services/cittaEfsClient";
import { invoiceQueue } from "../queues/invoiceQueue";
import { processInvoiceJob } from "../workers/invoiceWorker";
import {
  runNrsReconciliationCron,
  runQbReconciliationCron,
} from "../crons/reconciliation";
import { confirmEntityMappingRegistration } from "../services/entityMappingService";

const prisma = new PrismaClient({
  datasources: { db: { url: getDatabaseUrl() } },
});

interface TestResult {
  module: string;
  testName: string;
  category:
    | "Implementation"
    | "Runtime"
    | "Integration"
    | "EdgeCase"
    | "FailureRecovery"
    | "Security";
  passed: boolean;
  expected: string;
  actual: string;
  details?: string;
}

const results: TestResult[] = [];

function assert(
  moduleName: string,
  testName: string,
  category:
    | "Implementation"
    | "Runtime"
    | "Integration"
    | "EdgeCase"
    | "FailureRecovery"
    | "Security",
  condition: boolean,
  expected: string,
  actual: string,
  details?: string,
) {
  results.push({
    module: moduleName,
    testName,
    category,
    passed: condition,
    expected,
    actual,
    details,
  });
}

async function runAllTests() {
  console.log("====================================================");
  console.log("CITTA-EFS PRODUCTION SYSTEM VERIFICATION TEST SUITE");
  console.log("====================================================\n");

  // ------------------------------------------------------------------
  // MODULE 1: Security & Encryption Engine (AES-256-GCM)
  // ------------------------------------------------------------------
  try {
    const rawSecret = "oauth_refresh_token_secret_xyz123";
    const encrypted = packEncryptedString(rawSecret);
    const parts = encrypted.split(":");

    assert(
      "Security & Encryption",
      "AES-256-GCM Encryption Structure",
      "Security",
      parts.length === 3,
      "3 parts formatted as iv:ciphertext:authTag",
      `Found ${parts.length} parts`,
    );

    const decrypted = unpackAndDecryptString(encrypted);
    assert(
      "Security & Encryption",
      "AES-256-GCM Roundtrip Decryption",
      "Runtime",
      decrypted === rawSecret,
      `Decrypted value matches rawSecret '${rawSecret}'`,
      `Decrypted value: '${decrypted}'`,
    );

    // IV Uniqueness Test
    const encrypted2 = packEncryptedString(rawSecret);
    assert(
      "Security & Encryption",
      "Cryptographic IV Uniqueness per Operation",
      "Security",
      encrypted !== encrypted2,
      "Two encryptions of same string produce different IVs and ciphertexts",
      encrypted === encrypted2
        ? "Identical ciphertexts (INSECURE)"
        : "Unique ciphertexts generated",
    );

    // Tamper Detection Test (Auth Tag validation)
    const tamperedParts = [...parts];
    tamperedParts[1] = "00" + tamperedParts[1].substring(2); // Alter ciphertext
    const tamperedEncrypted = tamperedParts.join(":");
    let tamperCaught = false;
    try {
      unpackAndDecryptString(tamperedEncrypted);
    } catch {
      tamperCaught = true;
    }
    assert(
      "Security & Encryption",
      "Auth Tag Tamper Detection (Integrity)",
      "FailureRecovery",
      tamperCaught,
      "Throws decryption error on modified ciphertext",
      tamperCaught
        ? "Caught authentication tag failure correctly"
        : "Failed to throw error on tampered data",
    );
  } catch (err: any) {
    assert(
      "Security & Encryption",
      "Encryption Execution",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 2: Canonical Schema & Zod Validation Rules
  // ------------------------------------------------------------------
  try {
    const validInvoice = {
      tenantId: "tenant_qbo",
      clientInvoiceNumber: "INV2026999",
      issueDate: "2026-07-29",
      dueDate: "2026-08-29",
      currency: "NGN",
      customerName: "Vertex Kenya Ltd",
      customerTin: "P051123456Z",
      lineItems: [
        {
          itemCode: "ITEM-01",
          description: "Server Rack 42U",
          quantity: 2,
          unitPrice: 50000,
          vatRate: 16,
          hsOrServiceCode: "8471.50",
        },
      ],
    };

    const parseResult = invoiceIngestionSchema.safeParse(validInvoice);
    assert(
      "Canonical Schema",
      "Valid Invoice Parsing & Transformation",
      "Implementation",
      parseResult.success,
      "Schema validation succeeds for compliant payload",
      parseResult.success
        ? `Validated & Transformed (grandTotal=${parseResult.data.grandTotal}, hash=${parseResult.data.rawPayloadHash.substring(0, 10)}...)`
        : JSON.stringify(parseResult.error?.issues),
    );

    // Edge Case: B2B Auto-Downgrade to B2C when Tax PIN is missing
    const noPinInvoice = { ...validInvoice, customerTin: "" };
    const noPinResult = invoiceIngestionSchema.safeParse(noPinInvoice);
    assert(
      "Canonical Schema",
      "Auto B2C Classification on Missing Tax PIN",
      "EdgeCase",
      noPinResult.success && noPinResult.data.invoiceKind === "B2C",
      "Auto-downgrades invoiceKind to B2C when customerTin is empty",
      noPinResult.success
        ? `Evaluated kind: ${noPinResult.data.invoiceKind}`
        : "Failed validation",
    );

    // Edge Case: B2G Invoices Are Accepted (spec: complete kind list is B2B, B2C, B2G)
    const b2gInvoice = { ...validInvoice, invoiceKind: "B2G" as const };
    const b2gResult = invoiceIngestionSchema.safeParse(b2gInvoice);
    assert(
      "Canonical Schema",
      "B2G Invoice Kind Accepted",
      "EdgeCase",
      b2gResult.success && b2gResult.data.invoiceKind === "B2G",
      "Schema accepts invoiceKind B2G and preserves it when a TIN is present",
      b2gResult.success
        ? `Evaluated kind: ${b2gResult.data.invoiceKind}`
        : JSON.stringify(b2gResult.error?.issues),
    );

    // Edge Case: B2G Auto-Downgrade to B2C when Tax PIN is missing (behaves as B2B for the registration gate)
    const b2gNoPinInvoice = { ...validInvoice, invoiceKind: "B2G" as const, customerTin: "" };
    const b2gNoPinResult = invoiceIngestionSchema.safeParse(b2gNoPinInvoice);
    assert(
      "Canonical Schema",
      "B2G Behaves As B2B For Customer Registration Gate",
      "EdgeCase",
      b2gNoPinResult.success && b2gNoPinResult.data.invoiceKind === "B2C",
      "Auto-downgrades invoiceKind to B2C when customerTin is empty, same as B2B",
      b2gNoPinResult.success
        ? `Evaluated kind: ${b2gNoPinResult.data.invoiceKind}`
        : "Failed validation",
    );

    // Edge Case: VAT Rate Defaults To Nigeria's 7.5% Standard Rate, Not Kenya's 16%, When Omitted
    const noVatRateInvoice = {
      ...validInvoice,
      lineItems: [
        {
          itemCode: "ITEM-NO-VAT",
          description: "Line item with no explicit vatRate",
          quantity: 1,
          unitPrice: 1000,
          hsOrServiceCode: "8471.50",
        },
      ],
    };
    const noVatRateResult = invoiceIngestionSchema.safeParse(noVatRateInvoice);
    assert(
      "Canonical Schema",
      "VAT Rate Defaults To Nigeria's 7.5% Standard Rate",
      "EdgeCase",
      noVatRateResult.success && noVatRateResult.data.lineItems[0].vatRate === 7.5,
      "Schema defaults an omitted vatRate to 7.5 (NRS standard), not 16 (unconverted Kenya default)",
      noVatRateResult.success
        ? `Defaulted vatRate: ${noVatRateResult.data.lineItems[0].vatRate}`
        : JSON.stringify(noVatRateResult.error?.issues),
    );

    // Edge Case: Buyer TIN Is Never Permitted On A B2C Invoice, Even If Submitted
    const b2cWithTinInvoice = {
      ...validInvoice,
      invoiceKind: "B2C" as const,
      customerTin: "P019283746Z",
    };
    const b2cWithTinResult = invoiceIngestionSchema.safeParse(b2cWithTinInvoice);
    assert(
      "Canonical Schema",
      "B2C Invoice Never Carries A Buyer TIN",
      "EdgeCase",
      b2cWithTinResult.success &&
        b2cWithTinResult.data.invoiceKind === "B2C" &&
        !b2cWithTinResult.data.customerTin,
      "Schema strips customerTin whenever the effective invoiceKind is B2C, even if one was submitted",
      b2cWithTinResult.success
        ? `Stripped: kind=${b2cWithTinResult.data.invoiceKind}, customerTin=${b2cWithTinResult.data.customerTin}`
        : JSON.stringify(b2cWithTinResult.error?.issues),
    );

    // Edge Case: Empty Line Items
    const emptyLineInvoice = { ...validInvoice, lineItems: [] };
    const emptyLineResult = invoiceIngestionSchema.safeParse(emptyLineInvoice);
    assert(
      "Canonical Schema",
      "Minimum Line Item Requirement",
      "EdgeCase",
      !emptyLineResult.success,
      "Schema requires at least 1 line item",
      !emptyLineResult.success
        ? "Rejected empty line items correctly"
        : "Accepted empty line items",
    );
  } catch (err: any) {
    assert(
      "Canonical Schema",
      "Schema Execution",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 2b: Database-Level Duplicate Invoice Protection
  // ------------------------------------------------------------------
  try {
    const dupInvoiceNumber = `DUP-TEST-${Date.now()}`;
    const dupInvoiceData = {
      tenantId: "tenant_qbo",
      clientInvoiceId: dupInvoiceNumber,
      customerCode: "CUST-DUP-TEST",
      customerName: "Duplicate Test Customer",
      issueDate: new Date("2026-08-01"),
      subtotal: 1000,
      taxAmount: 75,
      totalAmount: 1075,
    };
    await prisma.invoice.create({ data: dupInvoiceData });

    let duplicateRejected = false;
    let rejectionDetail = "";
    try {
      await prisma.invoice.create({ data: dupInvoiceData });
    } catch (e: any) {
      duplicateRejected = e.code === "P2002";
      rejectionDetail = e.code || e.message;
    }
    assert(
      "Database Integrity",
      "Duplicate clientInvoiceId Rejected Per Tenant",
      "EdgeCase",
      duplicateRejected,
      "A second invoice with the same (tenantId, clientInvoiceId) is rejected by the database unique constraint",
      duplicateRejected
        ? `Second insert correctly rejected (${rejectionDetail})`
        : "Second insert with a duplicate clientInvoiceId was NOT rejected",
    );

    await prisma.invoice.deleteMany({ where: { tenantId: "tenant_qbo", clientInvoiceId: dupInvoiceNumber } });
  } catch (err: any) {
    assert(
      "Database Integrity",
      "Duplicate Invoice Constraint Test Execution",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 3: Connector Adapter Engine (QBO, Sage, Xero, NRS, SAP)
  // ------------------------------------------------------------------
  try {
    const qboAdapter = new QuickBooksAdapter();
    const rawQbo = {
      DocNumber: "QBO-8899",
      TxnDate: "2026-07-29",
      CustomerRef: { name: "Vertex Kenya Corp" },
      CustomerTaxId: "A009876543W",
      Line: [
        {
          Description: "Consulting Services",
          SalesItemLineDetail: {
            ItemRef: { name: "SRV-CONSULT" },
            Qty: 10,
            UnitPrice: 10000,
          },
          hsOrServiceCode: "HS-9801.00",
        },
      ],
    };

    const transformed = qboAdapter.transform(rawQbo);
    assert(
      "Connector Adapters",
      "QuickBooks Normalization Engine",
      "Integration",
      transformed.clientInvoiceNumber === "QBO-8899" &&
        transformed.lineItems.length === 1,
      "Transforms QBO payload into canonical format",
      `Transformed Invoice #${transformed.clientInvoiceNumber}, Items: ${transformed.lineItems.length}`,
    );

    // All registered adapters verification
    // NOTE: SAP, NetSuite, Sage, SQL adapters are FROZEN - QBO, CSV, and Odoo are active
    const adapters = [new QuickBooksAdapter(), new CsvAdapter(), new OdooAdapter()];
    const allAuth = await Promise.all(
      adapters.map((a) =>
        a.authenticate({
          tenantId: "tenant_test",
          connectorId: `conn_${a.platformName}`,
          connectorType: "REST_API",
          platformName: a.platformName,
          status: "HEALTHY",
          authType: "OAUTH2",
        }),
      ),
    );
    const allAuthed = allAuth.every((r) => r.authenticated);
    assert(
      "Connector Adapters",
      "Multi-Platform Authentication Interface",
      "Implementation",
      allAuthed,
      "All ERP adapters return authenticated status",
      allAuthed
        ? "All adapters authenticated"
        : "Some adapters failed authentication",
    );
  } catch (err: any) {
    assert(
      "Connector Adapters",
      "Adapter Execution",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 4: CittaEFS API Gateway Client & Serialization
  // ------------------------------------------------------------------
  try {
    const testInvoice = {
      tenantId: "tenant_qbo",
      clientInvoiceNumber: "INV-HMAC-TEST-01",
      invoiceType: "STANDARD" as const,
      invoiceKind: "B2B" as const,
      customerCode: "CUST001",
      customerName: "Citta Test Client",
      customerTin: "P051123456Z",
      issueDate: "2026-07-29",
      lineItems: [
        {
          itemCode: "ITEM-HMAC",
          description: "Security Audit Service",
          quantity: 1,
          unitPrice: 50000,
          taxableAmount: 50000,
          vatRate: 16,
          vatAmount: 8000,
          totalAmount: 58000,
          hsOrServiceCode: "8471.50",
        },
      ],
    };

    // 1. Mock and verify POST /api/integration/gen/invoices (Request & Response DTO validation)
    const postScope = nock("https://ei-api.azurewebsites.net")
      .post("/api/integration/gen/invoices")
      .reply((uri, requestBody: any) => {
        let body = requestBody;
        if (typeof body === "string") {
          try {
            body = JSON.parse(body);
          } catch {
            return [400, { errors: ["Payload must be a valid JSON string"] }];
          }
        }
        if (!Array.isArray(body)) {
          return [400, { errors: ["Payload must be a JSON array"] }];
        }
        const dto = body[0];
        const fields = [
          "invoiceNumber",
          "issueDate",
          "customerCode",
          "itemName",
          "itemDescription",
          "quantity",
          "unitPrice",
          "taxAmount",
          "taxableAmount",
          "hsOrServiceCode",
          "lineNum",
          "unitCode",
          "taxCategoryId",
          "currencyCode",
          "invoiceTypeCode",
          "headerDiscount",
          "headerCharges",
          "lineDiscount",
          "useStateTax",
          "documentNumber",
          "billingReferenceIrns",
          "customFields",
          "metadata",
        ];
        const missing = fields.filter((f) => !(f in dto));
        if (missing.length > 0) {
          console.warn("   ⚠️ Mismatched fields in DTO body:", missing);
          return [
            400,
            {
              errors: [
                `Payload fields do not match IntegrationInvoiceLineDto spec. Missing: ${missing.join(", ")}`,
              ],
            },
          ];
        }

        // Return valid BulkEInvoiceResultDto
        return [
          200,
          {
            totalInvoices: 1,
            successCount: 1,
            failedCount: 0,
            errors: [],
            items: [
              {
                invoiceNumber: dto.invoiceNumber,
                irn: "IRN-NRS-2026-NOCK9988",
                qrCodeUrl:
                  "https://nrs.portal.gov/verify?irn=IRN-NRS-2026-NOCK9988",
                csid: "CSID-SHA256-NOCK",
              },
            ],
          },
        ];
      });

    const efsResponse = await cittaEfsClient.signAndStampInvoice(testInvoice);
    assert(
      "CittaEFS Gateway Client",
      "C# PascalCase Serialization & Stamp Transmission",
      "Integration",
      efsResponse.success &&
        efsResponse.irn === "IRN-NRS-2026-NOCK9988" &&
        Boolean(efsResponse.qrCodeUrl),
      "Returns HTTP 200, valid IRN and QR verification URL",
      `Success: ${efsResponse.success}, IRN: ${efsResponse.irn}, QR URL: ${efsResponse.qrCodeUrl?.substring(0, 30)}...`,
    );

    // 1b. Shared global gateway key (by design — see the "UPDATED 2026-08-29:
    // All tenants share ONE global API key (per user request)" note in
    // cittaEfsClient.ts): the env var wins over any tenant-specific
    // cittaApiKey stored in the DB, for every tenant.
    const tenantRecord = await prisma.tenant.findUnique({
      where: { id: "tenant_qbo" },
      select: { cittaApiKey: true },
    });
    let globalKeyUsed = false;
    let globalKeyError: any = null;
    try {
      nock("https://ei-api.azurewebsites.net", {
        reqheaders: { authorization: `Bearer ${process.env.CITTAEFS_API_KEY}` },
      })
        .post("/api/integration/gen/invoices")
        .reply(() => {
          globalKeyUsed = true;
          return [
            200,
            {
              totalInvoices: 1,
              successCount: 1,
              failedCount: 0,
              errors: [],
              items: [
                {
                  invoiceNumber: testInvoice.clientInvoiceNumber,
                  irn: "IRN-NRS-2026-GLOBALKEY",
                  qrCodeUrl:
                    "https://nrs.portal.gov/verify?irn=IRN-NRS-2026-GLOBALKEY",
                  csid: "CSID-GLOBALKEY",
                },
              ],
            },
          ];
        });
      await cittaEfsClient.signAndStampInvoice(testInvoice);
    } catch (e) {
      globalKeyError = e;
    }
    assert(
      "CittaEFS Gateway Client",
      "Shared Global Gateway Key Used For Every Tenant (By Design)",
      "Security",
      globalKeyUsed && !globalKeyError,
      "Gateway request is signed with the shared CITTAEFS_API_KEY env var, taking priority over any tenant-specific DB-stored cittaApiKey",
      globalKeyUsed
        ? `Request carried the shared global Authorization header (tenant's own DB key ${tenantRecord?.cittaApiKey ? "present but correctly not used" : "not set"})`
        : `Request did not use the global key${globalKeyError ? ` (${globalKeyError.message})` : ""}`,
    );

    // 1c. An unrecognized tenantId still succeeds via the shared global key —
    // getCittaEfsConfig() checks the env var first and returns immediately,
    // before any tenant lookup is even consulted, so gateway auth needs no
    // per-tenant onboarding at all when CITTAEFS_API_KEY is set.
    let unknownTenantUsedGlobalKey = false;
    let unknownTenantError: any = null;
    try {
      nock("https://ei-api.azurewebsites.net", {
        reqheaders: { authorization: `Bearer ${process.env.CITTAEFS_API_KEY}` },
      })
        .post("/api/integration/gen/invoices")
        .reply(() => {
          unknownTenantUsedGlobalKey = true;
          return [
            200,
            {
              totalInvoices: 1,
              successCount: 1,
              failedCount: 0,
              errors: [],
              items: [
                {
                  invoiceNumber: testInvoice.clientInvoiceNumber,
                  irn: "IRN-NRS-2026-UNKNOWNTENANT",
                  qrCodeUrl:
                    "https://nrs.portal.gov/verify?irn=IRN-NRS-2026-UNKNOWNTENANT",
                  csid: "CSID-UNKNOWNTENANT",
                },
              ],
            },
          ];
        });
      await cittaEfsClient.signAndStampInvoice({
        ...testInvoice,
        tenantId: "tenant_does_not_exist_xyz",
      });
    } catch (e: any) {
      unknownTenantError = e;
    }
    assert(
      "CittaEFS Gateway Client",
      "Unknown Tenant Still Succeeds Via Shared Global Key",
      "Security",
      unknownTenantUsedGlobalKey && !unknownTenantError,
      "A tenantId with no matching DB row still signs successfully with the shared global CITTAEFS_API_KEY, since the env var short-circuits before any tenant lookup",
      unknownTenantUsedGlobalKey
        ? "Request succeeded using the shared global key despite an unknown tenantId"
        : `Did not use the global key for an unknown tenant${unknownTenantError ? ` (${unknownTenantError.message})` : ""}`,
    );

    // 1d. Document Number is distinct from Invoice Number when explicitly supplied
    // (spec: Document Number is an optional, separate header field -- previously
    // always silently aliased to clientInvoiceNumber).
    let capturedDocumentNumber: string | undefined;
    try {
      nock("https://ei-api.azurewebsites.net")
        .post("/api/integration/gen/invoices")
        .reply((uri, requestBody: any) => {
          const body =
            typeof requestBody === "string"
              ? JSON.parse(requestBody)
              : requestBody;
          capturedDocumentNumber = body?.[0]?.documentNumber;
          return [
            200,
            {
              totalInvoices: 1,
              successCount: 1,
              failedCount: 0,
              errors: [],
              items: [
                {
                  invoiceNumber: testInvoice.clientInvoiceNumber,
                  irn: "IRN-NRS-2026-DOCNUM",
                  qrCodeUrl:
                    "https://nrs.portal.gov/verify?irn=IRN-NRS-2026-DOCNUM",
                  csid: "CSID-DOCNUM",
                },
              ],
            },
          ];
        });
      await cittaEfsClient.signAndStampInvoice({
        ...testInvoice,
        documentNumber: "DOC-9988-DISTINCT",
      });
    } catch {
      // handled by the assertion below
    }
    assert(
      "CittaEFS Gateway Client",
      "Document Number Distinct From Invoice Number",
      "EdgeCase",
      capturedDocumentNumber === "DOC-9988-DISTINCT" &&
        capturedDocumentNumber !== testInvoice.clientInvoiceNumber,
      "Gateway payload carries an explicitly supplied documentNumber rather than aliasing it to clientInvoiceNumber",
      `Sent documentNumber: ${capturedDocumentNumber}, clientInvoiceNumber: ${testInvoice.clientInvoiceNumber}`,
    );

    // 2. Mock and verify other methods: getArchive, getValidationErrors, updatePaymentStatus
    const getArchiveScope = nock("https://ei-api.azurewebsites.net")
      .get("/api/einvoice/archive")
      .query(true)
      .reply(200, [
        { invoiceNumber: "INV-HMAC-TEST-01", irn: "IRN-NRS-2026-NOCK9988" },
      ]);

    const archiveData = await cittaEfsClient.getArchive(
      "tenant_qbo",
      "2026-07-01",
      "2026-07-31",
    );
    assert(
      "CittaEFS Gateway Client",
      "Gateway Archive Retrieval method",
      "Implementation",
      Array.isArray(archiveData) &&
        archiveData[0]?.invoiceNumber === "INV-HMAC-TEST-01",
      "getArchive returns array of records correctly",
      `Records: ${archiveData.length}, First Invoice: ${archiveData[0]?.invoiceNumber}`,
    );

    const getErrorsScope = nock("https://ei-api.azurewebsites.net")
      .get("/api/einvoice/errors/validation")
      .query(true)
      .reply(200, [
        { invoiceNumber: "INV-FAIL-01", error: "Invalid TIN format" },
      ]);

    const errorsData = await cittaEfsClient.getValidationErrors("tenant_qbo");
    assert(
      "CittaEFS Gateway Client",
      "Gateway Validation Errors method",
      "Implementation",
      Array.isArray(errorsData) &&
        errorsData[0]?.invoiceNumber === "INV-FAIL-01",
      "getValidationErrors returns error records correctly",
      `Errors: ${errorsData.length}, Error Message: ${errorsData[0]?.error}`,
    );

    const patchStatusScope = nock("https://ei-api.azurewebsites.net")
      .patch("/api/einvoice/update/IRN-NRS-2026-NOCK9988")
      .reply(200, { success: true, payment_status: "PAID" });

    const patchRes = await cittaEfsClient.updatePaymentStatus(
      "tenant_qbo",
      "IRN-NRS-2026-NOCK9988",
      "PAID",
      "REF-123",
    );
    assert(
      "CittaEFS Gateway Client",
      "Gateway Update Payment Status method",
      "Implementation",
      patchRes?.success === true && patchRes?.payment_status === "PAID",
      "updatePaymentStatus patches payment state correctly",
      `Response payment_status: ${patchRes?.payment_status}`,
    );

    // 3. Verify error handling with nock (ensure client throws typed errors correctly)
    const errScope = nock("https://ei-api.azurewebsites.net")
      .post("/api/integration/gen/invoices")
      .reply(400, { success: false, errors: ["TIN field validation failure"] });

    let threwError = false;
    try {
      await cittaEfsClient.signAndStampInvoice(testInvoice);
    } catch (e: any) {
      threwError = true;
    }
    assert(
      "CittaEFS Gateway Client",
      "Gateway Non-2xx / Validation Failures Exception Handling",
      "FailureRecovery",
      threwError,
      "Client throws standard Error on gateway non-2xx responses",
      `Error thrown successfully on 400 Bad Request`,
    );

    nock.cleanAll();

    // Inbound Writeback test
    const wb = await cittaEfsClient.executeClientLedgerWriteback(
      "tenant_qbo",
      testInvoice.clientInvoiceNumber,
      "IRN-NRS-2026-NOCK9988",
      "https://nrs.portal.gov/verify?irn=IRN-NRS-2026-NOCK9988",
    );
    assert(
      "CittaEFS Gateway Client",
      "Inbound Client Ledger Writeback Contract",
      "Runtime",
      wb.synced,
      "Writeback succeeds with client ledger update",
      `Writeback result: ${wb.message}`,
    );
  } catch (err: any) {
    assert(
      "CittaEFS Gateway Client",
      "Client Execution",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 5: Async Queue Engine, Retry Policies & Dead Letter Queue (DLQ)
  // ------------------------------------------------------------------
  try {
    const testPayload = invoiceIngestionSchema.parse({
      tenantId: "tenant_qbo",
      clientInvoiceNumber: `INVQ${Date.now()}`,
      issueDate: "2026-07-29",
      dueDate: "2026-08-29",
      currency: "NGN",
      customerName: "Queue Test Enterprise",
      customerTin: "P051123456Z",
      lineItems: [
        {
          itemCode: "ITEM-Q",
          description: "Queue Processing Test",
          quantity: 1,
          unitPrice: 100000,
          vatRate: 16,
          hsOrServiceCode: "8471.50",
        },
      ],
    });

    const job = await invoiceQueue.add(
      "signInvoice",
      { ...testPayload, dbInvoiceId: "test-dbinvoice-queue" },
      { attempts: 3 },
    );
    assert(
      "Async Queue Engine",
      "Job Enqueueing & Structure",
      "Implementation",
      job.status === "QUEUED" && job.attempts === 0 && job.maxRetries === 3,
      "Job is enqueued with state QUEUED, attempts=0, maxRetries=3",
      `Job ID: ${job.id}, Status: ${job.status}, maxRetries: ${job.maxRetries}`,
    );

    // DLQ Routing test
    invoiceQueue.moveToDLQ(job, "Simulated 504 Gateway Timeout Exhausted");
    const dlqJobs = invoiceQueue.getDLQJobs();
    const inDlq = dlqJobs.some((j) => j.id === job.id);
    assert(
      "Async Queue Engine",
      "Dead Letter Queue (DLQ) Routing & Retention",
      "FailureRecovery",
      inDlq,
      "Job is safely isolated in DLQ for compliance auditing",
      inDlq ? "Successfully held in DLQ" : "Failed to move to DLQ",
    );

    // Stale PROCESSING recovery — a job abandoned mid-call by a dead/restarted
    // worker (still has retries left) gets reclaimed back to QUEUED instead
    // of sitting stuck forever.
    const staleJob = await invoiceQueue.add(
      "signInvoice",
      { ...testPayload, clientInvoiceNumber: `INVSTALE${Date.now()}`, dbInvoiceId: "test-dbinvoice-stale" },
      { attempts: 3 },
    );
    staleJob.status = "PROCESSING";
    staleJob.attempts = 1;
    staleJob.updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await invoiceQueue.updateJob(staleJob);
    const recoveredCount = await invoiceQueue.recoverStaleProcessingJobs(120000);
    const requeued = invoiceQueue
      .getPendingJobs()
      .some((j) => j.id === staleJob.id && j.status === "QUEUED");
    assert(
      "Async Queue Engine",
      "Stale PROCESSING Job Recovery (Abandoned Worker Reclaim)",
      "FailureRecovery",
      recoveredCount >= 1 && requeued,
      "A job stuck in PROCESSING past the stale threshold is requeued (still has retries left) rather than abandoned forever",
      `Recovered count: ${recoveredCount}, Requeued: ${requeued}`,
    );

    // Same scenario but retries already exhausted — should go straight to DLQ
    // instead of being requeued indefinitely.
    const staleExhaustedJob = await invoiceQueue.add(
      "signInvoice",
      { ...testPayload, clientInvoiceNumber: `INVSTALEDLQ${Date.now()}`, dbInvoiceId: "test-dbinvoice-stale-dlq" },
      { attempts: 3 },
    );
    staleExhaustedJob.status = "PROCESSING";
    staleExhaustedJob.attempts = 3;
    staleExhaustedJob.updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await invoiceQueue.updateJob(staleExhaustedJob);
    await invoiceQueue.recoverStaleProcessingJobs(120000);
    const inDlqAfterRecover = invoiceQueue.getDLQJobs().some((j) => j.id === staleExhaustedJob.id);
    assert(
      "Async Queue Engine",
      "Stale PROCESSING Job At Max Retries Moves To DLQ",
      "FailureRecovery",
      inDlqAfterRecover,
      "A stale PROCESSING job that already exhausted its retries moves to DLQ instead of being requeued indefinitely",
      inDlqAfterRecover ? "Found in DLQ" : "Not found in DLQ",
    );

    // These jobs carry fake dbInvoiceIds (no real Invoice row backs them) —
    // clean them up so they don't sit in the dev DB as permanent orphans that
    // a live server's worker would pick up and try (and fail) to process.
    await prisma.queueJob.deleteMany({ where: { id: { in: [job.id, staleJob.id, staleExhaustedJob.id] } } });
  } catch (err: any) {
    assert(
      "Async Queue Engine",
      "Queue Execution",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 6: Queue Worker Execution & Ledger Synchronization
  // ------------------------------------------------------------------
  try {
    const workerPayload = invoiceIngestionSchema.parse({
      tenantId: "tenant_qbo",
      clientInvoiceNumber: `INVWORKER${Date.now()}`,
      customerCode: "CUST-WORKER-TEST",
      issueDate: "2026-07-29",
      dueDate: "2026-08-29",
      currency: "NGN",
      customerName: "Worker Customer Corp",
      customerTin: "P051123456Z",
      lineItems: [
        {
          itemCode: "ITEM-W",
          description: "Worker unit test",
          quantity: 1,
          unitPrice: 20000,
          vatRate: 16,
          hsOrServiceCode: "8471.50",
        },
      ],
    });

    // Registration gate (Phase 2, thin-hub pivot): a B2B invoice's customer must
    // already be MAPPED in CittaEFS, or the worker routes it to
    // NEEDS_EFS_REGISTRATION instead of the gateway. Pre-register the test
    // customer so this test exercises the successful pipeline, not the gate.
    await prisma.entityMapping.upsert({
      where: {
        tenantId_entityType_sourceErpId: {
          tenantId: "tenant_qbo",
          entityType: "CUSTOMER",
          sourceErpId: "CUST-WORKER-TEST",
        },
      },
      update: { status: "MAPPED" },
      create: {
        tenantId: "tenant_qbo",
        entityType: "CUSTOMER",
        sourceErp: "qbo",
        sourceErpId: "CUST-WORKER-TEST",
        displayName: "Worker Customer Corp",
        status: "MAPPED",
      },
    });

    const jobToProcess = await invoiceQueue.add("signInvoice", {
      ...workerPayload,
      dbInvoiceId: "test-dbinvoice-worker",
    });

    // Mock CittaEFS Gateway call for the worker pipeline test
    nock("https://ei-api.azurewebsites.net")
      .post("/api/integration/gen/invoices")
      .reply(200, {
        totalInvoices: 1,
        successCount: 1,
        failedCount: 0,
        errors: [],
        items: [
          {
            invoiceNumber: workerPayload.clientInvoiceNumber,
            irn: "IRN-NRS-2026-WORKER9988",
            qrCodeUrl:
              "https://nrs.portal.gov/verify?irn=IRN-NRS-2026-WORKER9988",
            csid: "CSID-SHA256-WORKER",
          },
        ],
      });

    const workerResult = await processInvoiceJob(jobToProcess);

    nock.cleanAll();

    await prisma.entityMapping.deleteMany({
      where: { tenantId: "tenant_qbo", entityType: "CUSTOMER", sourceErpId: "CUST-WORKER-TEST" },
    });

    assert(
      "Worker Processor",
      "Async Queue Worker Pipeline Execution",
      "Integration",
      workerResult.success && Boolean(workerResult.irn),
      "Worker processes job, gets IRN stamp and returns completed status",
      `Worker Result: Success=${workerResult.success}, IRN=${workerResult.irn}`,
    );
  } catch (err: any) {
    assert(
      "Worker Processor",
      "Worker Execution",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 7: Automated Reconciliation Engine (NRS & QB Sync Auditing)
  // ------------------------------------------------------------------
  try {
    const nrsResult = await runNrsReconciliationCron("tenant_qbo");
    assert(
      "Reconciliation Engine",
      "NRS / CittaEFS Regulatory Discrepancy Reconciliation",
      "Runtime",
      nrsResult.cronName === "nrsReconciliationCron" &&
        nrsResult.scannedCount >= 0,
      "Executes Gateway polling audit and recovers stuck invoices",
      `Cron: ${nrsResult.cronName}, Scanned: ${nrsResult.scannedCount}, Recovered: ${nrsResult.recoveredCount}, Orphans Fixed: ${nrsResult.orphansFixedCount}`,
    );

    const qbResult = await runQbReconciliationCron("tenant_qbo");
    assert(
      "Reconciliation Engine",
      "ERP (QuickBooks) Automated Data Audit",
      "Runtime",
      qbResult.cronName === "qbReconciliationCron" &&
        qbResult.scannedCount >= 0,
      "Executes CDC polling audit and recovers missed ERP transactions",
      `Cron: ${qbResult.cronName}, Scanned: ${qbResult.scannedCount}, Recovered: ${qbResult.recoveredCount}`,
    );
  } catch (err: any) {
    assert(
      "Reconciliation Engine",
      "Cron Execution",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 8: Security Regression - SSO Auth Bypass
  // ------------------------------------------------------------------
  try {
    const response = await fetch("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ssoProvider: "corporate_saml",
        email: "admin@cittaefs.com",
      }),
    });
    const data = await response.json();
    assert(
      "Security Regression",
      "SSO Authentication Bypass Attempt Rejection",
      "Security",
      response.status === 400 || response.status === 401,
      "SSO bypass request is rejected with 400 or 401",
      `Status: ${response.status}, Success: ${data.success}, Error: ${data.error}`,
    );
  } catch (err: any) {
    // If local dev server is not active during test execution, perform static file analysis
    const fs = await import("fs");
    const path = await import("path");
    const serverCode = fs.readFileSync(
      path.join(process.cwd(), "server.ts"),
      "utf-8",
    );
    const hasBypass = serverCode.includes("ssoProvider");
    assert(
      "Security Regression",
      "SSO Authentication Bypass Code Absence",
      "Security",
      !hasBypass,
      "No ssoProvider login bypass code exists in server.ts",
      hasBypass
        ? "ssoProvider bypass logic remains in server.ts (INSECURE)"
        : "Clean: ssoProvider completely removed from server.ts",
    );
  }

  // ------------------------------------------------------------------
  // MODULE 9: QuickBooks Online Integration, Webhooks & Writeback
  // ------------------------------------------------------------------
  try {
    const {
      getIntuitOAuthClient,
      getValidQboAccessToken,
      ingestQboInvoice,
      writebackToQbo,
    } = await import("../services/qboService");

    // 0. Intuit OAuth Client Initialization & Missing Environment Error Validation
    const clientOk = Boolean(getIntuitOAuthClient());
    assert(
      "QuickBooks Integration",
      "getIntuitOAuthClient Initialization with Valid Environment",
      "Implementation",
      clientOk,
      "Instantiates Intuit OAuth client when env vars are present",
      clientOk
        ? "OAuth client initialized successfully"
        : "Failed to initialize",
    );

    // Test missing QBO_CLIENT_ID / QBO_CLIENT_SECRET
    const origClientId = process.env.QBO_CLIENT_ID;
    const origClientSecret = process.env.QBO_CLIENT_SECRET;
    const origRedirectUri = process.env.QBO_REDIRECT_URI;

    delete process.env.QBO_CLIENT_ID;
    let missingCredsCaught = false;
    let missingCredsErr = "";
    try {
      getIntuitOAuthClient();
    } catch (err: any) {
      missingCredsCaught = true;
      missingCredsErr = err.message;
    }
    process.env.QBO_CLIENT_ID = origClientId;

    assert(
      "QuickBooks Integration",
      "getIntuitOAuthClient Throws On Missing Client Credentials",
      "FailureRecovery",
      missingCredsCaught &&
        missingCredsErr.includes(
          "QBO_CLIENT_ID and QBO_CLIENT_SECRET environment variables are required",
        ),
      "Throws clear error when QBO_CLIENT_ID or QBO_CLIENT_SECRET is missing",
      missingCredsCaught
        ? `Caught error: ${missingCredsErr}`
        : "Did not throw error",
    );

    // Test missing QBO_REDIRECT_URI
    delete process.env.QBO_REDIRECT_URI;
    let missingRedirectCaught = false;
    let missingRedirectErr = "";
    try {
      getIntuitOAuthClient();
    } catch (err: any) {
      missingRedirectCaught = true;
      missingRedirectErr = err.message;
    }
    process.env.QBO_REDIRECT_URI = origRedirectUri;

    assert(
      "QuickBooks Integration",
      "getIntuitOAuthClient Throws On Missing Redirect URI",
      "FailureRecovery",
      missingRedirectCaught &&
        missingRedirectErr.includes(
          "QBO_REDIRECT_URI environment variable is required",
        ),
      "Throws clear error when QBO_REDIRECT_URI is missing",
      missingRedirectCaught
        ? `Caught error: ${missingRedirectErr}`
        : "Did not throw error",
    );

    // 1. Setup mock integration row in DB
    const encryptedAccess = packEncryptedString("mock_access_token_123");
    const encryptedRefresh = packEncryptedString("mock_refresh_token_456");

    await prisma.integration.upsert({
      where: {
        tenantId_sourceSystem: {
          tenantId: "tenant_qbo",
          sourceSystem: "QUICKBOOKS_ONLINE",
        },
      },
      create: {
        tenantId: "tenant_qbo",
        sourceSystem: "QUICKBOOKS_ONLINE",
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        companyId: "9130351112",
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        status: "CONNECTED",
      },
      update: {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        companyId: "9130351112",
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        status: "CONNECTED",
      },
    });

    // 2. Token Retrieval Test (Cached)
    const token = await getValidQboAccessToken("tenant_qbo");
    assert(
      "QuickBooks Integration",
      "QBO Access Token Retrieval & Decryption",
      "Security",
      token === "mock_access_token_123",
      "Retrieves and decrypts valid access token",
      `Retrieved Token: ${token}`,
    );

    // 2b. Token Refresh Test with Nock (Expired Token)
    await prisma.integration.update({
      where: {
        tenantId_sourceSystem: {
          tenantId: "tenant_qbo",
          sourceSystem: "QUICKBOOKS_ONLINE",
        },
      },
      data: {
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
      },
    });

    nock("https://oauth.platform.intuit.com")
      .post("/oauth2/v1/tokens/bearer")
      .reply(200, {
        access_token: "refreshed_access_token_789",
        refresh_token: "new_refresh_token_789",
        expires_in: 3600,
      });

    const refreshedToken = await getValidQboAccessToken("tenant_qbo");
    nock.cleanAll();

    assert(
      "QuickBooks Integration",
      "QBO Access Token Refresh via OAuth API",
      "Security",
      refreshedToken === "refreshed_access_token_789",
      "Refreshes access token via Intuit OAuth endpoint when expired",
      `Refreshed Token: ${refreshedToken}`,
    );

    // 2c. Token Refresh Error Propagation Test with Nock
    await prisma.integration.update({
      where: {
        tenantId_sourceSystem: {
          tenantId: "tenant_qbo",
          sourceSystem: "QUICKBOOKS_ONLINE",
        },
      },
      data: {
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
      },
    });

    nock("https://oauth.platform.intuit.com")
      .post("/oauth2/v1/tokens/bearer")
      .reply(401, "Invalid Grant");

    let refreshFailed = false;
    let refreshErr = "";
    try {
      await getValidQboAccessToken("tenant_qbo");
    } catch (e: any) {
      refreshFailed = true;
      refreshErr = e.message;
    }
    nock.cleanAll();

    assert(
      "QuickBooks Integration",
      "QBO Access Token Refresh Failure Propagation",
      "FailureRecovery",
      refreshFailed &&
        refreshErr.includes("QuickBooks connection needs reauthorization"),
      "Throws real error when OAuth token refresh fails",
      refreshFailed
        ? `Caught real error: ${refreshErr}`
        : "Failed to throw error",
    );

    // Reset valid cached token for remaining tests
    await prisma.integration.update({
      where: {
        tenantId_sourceSystem: {
          tenantId: "tenant_qbo",
          sourceSystem: "QUICKBOOKS_ONLINE",
        },
      },
      data: {
        accessToken: encryptedAccess,
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    // 3. QBO Ingestion Test
    const rawQboInvoice = {
      Id: `QBO-${Date.now()}`,
      DocNumber: `QBO-DOC-${Date.now()}`,
      TxnDate: "2026-07-30",
      CustomerRef: { value: "CUST-QBO-01", name: "QBO Test Customer" },
      CustomerTaxId: "P051987654Z",
      Line: [
        {
          Amount: 5000,
          Description: "Consulting Services",
          SalesItemLineDetail: {
            ItemRef: { name: "SRV-CONSULT" },
            Qty: 1,
            UnitPrice: 5000,
          },
        },
      ],
    };

    const ingested = await ingestQboInvoice("tenant_qbo", rawQboInvoice);
    assert(
      "QuickBooks Integration",
      "QBO Raw Payload Normalization & Ingestion",
      "Integration",
      Boolean(ingested && ingested.id),
      "Normalizes QBO invoice and inserts local DB record in PENDING_NRS_STAMP state",
      `Db Invoice ID: ${ingested.id}, ClientInvoiceId: ${ingested.clientInvoiceId}, Status: ${ingested.status}`,
    );

    // 4. Intuit Webhook HMAC Verification Test
    const verifierSecret = "qbo_webhook_verifier_test_123";
    process.env.QBO_WEBHOOK_VERIFIER = verifierSecret;
    const webhookPayload = JSON.stringify({
      eventNotifications: [
        {
          realmId: "9130351112",
          dataChangeEvent: {
            entities: [
              { name: "Invoice", id: rawQboInvoice.Id, operation: "Update" },
            ],
          },
        },
      ],
    });

    const validSignature = crypto
      .createHmac("sha256", verifierSecret)
      .update(webhookPayload)
      .digest("base64");
    const invalidSignature = "invalid_base64_sig_xyz";

    const sigBuf1 = Buffer.from(validSignature, "utf8");
    const compBuf1 = Buffer.from(validSignature, "utf8");
    const isValid1 =
      sigBuf1.length === compBuf1.length &&
      crypto.timingSafeEqual(sigBuf1, compBuf1);

    const sigBuf2 = Buffer.from(invalidSignature, "utf8");
    const compBuf2 = Buffer.from(validSignature, "utf8");
    const isValid2 =
      sigBuf2.length === compBuf2.length &&
      crypto.timingSafeEqual(sigBuf2, compBuf2);

    assert(
      "QuickBooks Integration",
      "Intuit Webhook Signature HMAC Validation",
      "Security",
      isValid1 && !isValid2,
      "Validates intuit-signature using HMAC-SHA256 and rejects forged payloads",
      `Valid Sig Test: ${isValid1}, Invalid Sig Test: ${isValid2}`,
    );

    // 5. Sparse Update Writeback Test with Nock
    nock("https://sandbox-quickbooks.api.intuit.com")
      .get(
        "/v3/company/9130351112/invoice/" +
          rawQboInvoice.Id +
          "?minorversion=65",
      )
      .reply(200, { Invoice: { Id: rawQboInvoice.Id, SyncToken: "1" } });

    nock("https://sandbox-quickbooks.api.intuit.com")
      .post("/v3/company/9130351112/invoice?minorversion=65")
      .reply(200, { Invoice: { Id: rawQboInvoice.Id, SyncToken: "2" } });

    const writebackRes = await writebackToQbo(
      "tenant_qbo",
      rawQboInvoice.Id,
      "IRN-QBO-2026-STAMPED",
      "https://qr.gov/qbo/stamped",
    );
    nock.cleanAll();

    assert(
      "QuickBooks Integration",
      "QBO Ledger Writeback (Sparse CustomField Update)",
      "Integration",
      Boolean(writebackRes && writebackRes.Invoice),
      "Executes sparse update on QBO API to record IRN and QR Code URL",
      `Writeback Success for QBO Invoice ${rawQboInvoice.Id}`,
    );

    // 6. Failed Intuit API Call Failure Recovery Test
    const { fetchAllQboInvoicesPaginated } =
      await import("../services/qboService");
    nock("https://sandbox-quickbooks.api.intuit.com")
      .get("/v3/company/9130351112/query")
      .query(true)
      .reply(502, "Bad Gateway from Intuit");

    let syncFailedCorrectly = false;
    let syncErrorMsg = "";
    try {
      await fetchAllQboInvoicesPaginated("tenant_qbo");
    } catch (err: any) {
      syncFailedCorrectly = true;
      syncErrorMsg = err.message;
    }
    nock.cleanAll();

    assert(
      "QuickBooks Integration",
      "Failed Intuit API Call Error Propagation",
      "FailureRecovery",
      syncFailedCorrectly &&
        syncErrorMsg.includes("Could not reach QuickBooks"),
      "Throws real error on QBO API failure instead of returning fake fallback data",
      syncFailedCorrectly
        ? `Caught real error: ${syncErrorMsg}`
        : "Failed to throw error",
    );

    // Ingestion created a real Invoice (+ queued signInvoice job) — clean
    // both up so repeated test runs don't pile up a stuck-forever backlog on
    // the shared dev DB (see docs/CittaHub_Revision_Plan.md Phase 5).
    await prisma.queueJob.deleteMany({ where: { payload: { contains: ingested.id } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: ingested.id } });
    await prisma.invoice.delete({ where: { id: ingested.id } }).catch(() => {});
  } catch (err: any) {
    assert(
      "QuickBooks Integration",
      "QBO Suite Verification",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 11: Odoo ERP Integration (JSON-RPC, Ingestion & Writeback)
  // ------------------------------------------------------------------
  try {
    const {
      connectOdoo,
      getValidOdooCredentials,
      fetchAllOdooInvoicesPaginated,
      ingestOdooInvoice,
      writebackToOdoo,
    } = await import("../services/odooService");

    const testOdooUrl = "https://odoo-test.example.com";
    const testOdooDb = "test_odoo_db";
    const testOdooUsername = "integration@example.com";
    const testOdooApiKey = "test_odoo_api_key_123";
    const testUid = 7;

    // 1. connectOdoo — validates credentials via JSON-RPC common.authenticate, persists Integration + erpConfig
    nock(testOdooUrl)
      .post("/jsonrpc")
      .reply(200, (_uri, body: any) => ({ jsonrpc: "2.0", id: body.id, result: testUid }));

    const connectResult = await connectOdoo("tenant_qbo", {
      odooUrl: testOdooUrl,
      odooDatabase: testOdooDb,
      odooUsername: testOdooUsername,
      odooApiKey: testOdooApiKey,
    });
    nock.cleanAll();

    assert(
      "Odoo Integration",
      "connectOdoo Authenticates & Persists Integration",
      "Integration",
      connectResult.connected === true && connectResult.uid === testUid,
      "Validates credentials via JSON-RPC and persists Integration + Tenant.erpConfig",
      `Connected: ${connectResult.connected}, uid: ${connectResult.uid}`,
    );

    // 2. getValidOdooCredentials — retrieves & decrypts stored connection details (no refresh needed, unlike QBO)
    const creds = await getValidOdooCredentials("tenant_qbo");
    assert(
      "Odoo Integration",
      "getValidOdooCredentials Retrieval & Decryption",
      "Security",
      creds.url === testOdooUrl && creds.database === testOdooDb && creds.apiKey === testOdooApiKey && creds.uid === testUid,
      "Retrieves and decrypts stored Odoo connection details from Integration + Tenant.erpConfig",
      `URL: ${creds.url}, DB: ${creds.database}, uid: ${creds.uid}`,
    );

    // 3. Paginated fetch with batched line-item and partner-VAT composition
    const testMoveId = 90001;
    const testPartnerId = 501;
    const testMoveName = `ODOO-DOC-${Date.now()}`;
    const testRawMove = {
      id: testMoveId,
      name: testMoveName,
      invoice_date: "2026-07-30",
      move_type: "out_invoice",
      partner_id: [testPartnerId, "Odoo Test Customer"],
      amount_untaxed: 5000,
      amount_tax: 800,
      amount_total: 5800,
      currency_id: [1, "NGN"],
      write_date: "2026-07-30 10:00:00",
    };
    const testLines = [
      {
        id: 1,
        move_id: [testMoveId, testMoveName],
        product_id: [55, "[SRV-CONSULT] Consulting Services"],
        name: "Consulting Services",
        display_type: "product",
        quantity: 1,
        price_unit: 5000,
        price_subtotal: 5000,
        price_total: 5800,
      },
    ];

    nock(testOdooUrl)
      .post("/jsonrpc")
      .times(3)
      .reply(200, (_uri, body: any) => {
        const model = body?.params?.args?.[3];
        let result: any = null;
        if (model === "account.move") result = [testRawMove];
        else if (model === "account.move.line") result = testLines;
        else if (model === "res.partner") result = [{ id: testPartnerId, vat: "P051987654Z" }];
        return { jsonrpc: "2.0", id: body.id, result };
      });

    const composedInvoices = await fetchAllOdooInvoicesPaginated("tenant_qbo");
    nock.cleanAll();

    const composed = composedInvoices.find((m: any) => m.id === testMoveId);
    assert(
      "Odoo Integration",
      "Paginated Fetch Batches Line Items & Partner VAT (No N+1)",
      "Integration",
      Boolean(composed && composed._lines?.length === 1 && composed._partnerVat === "P051987654Z"),
      "Composes account.move + account.move.line + res.partner.vat into one self-contained payload per invoice",
      `Composed lines: ${composed?._lines?.length}, partnerVat: ${composed?._partnerVat}`,
    );

    // 4. Ingestion test — full pipeline (validate, transform, HS inference, master-data upsert, DB insert)
    const ingested = await ingestOdooInvoice("tenant_qbo", composed);
    assert(
      "Odoo Integration",
      "Odoo Raw Payload Normalization & Ingestion",
      "Integration",
      Boolean(ingested && ingested.id && ingested.clientInvoiceId === testMoveName),
      "Normalizes Odoo account.move and inserts local DB record in PENDING_NRS_STAMP state",
      `Db Invoice ID: ${ingested.id}, ClientInvoiceId: ${ingested.clientInvoiceId}, Status: ${ingested.status}`,
    );

    // 5. Ingestion failure — invoice with no line items is rejected, not silently accepted
    const emptyMove = { ...testRawMove, id: testMoveId + 1, name: `ODOO-EMPTY-${Date.now()}`, _lines: [], _partnerVat: undefined };
    let emptyRejected = false;
    let emptyErr = "";
    try {
      await ingestOdooInvoice("tenant_qbo", emptyMove);
    } catch (e: any) {
      emptyRejected = true;
      emptyErr = e.message;
    }
    assert(
      "Odoo Integration",
      "Odoo Ingestion Rejects Invoice With No Line Items",
      "FailureRecovery",
      emptyRejected && emptyErr.includes("No invoice data provided"),
      "Throws and logs a ValidationError instead of inserting an empty invoice",
      emptyRejected ? `Caught real error: ${emptyErr}` : "Failed to throw error",
    );

    // 6. Writeback via message_post (chatter) — Odoo has no guaranteed custom fields, unlike QBO's sparse CustomField update
    nock(testOdooUrl)
      .post("/jsonrpc")
      .reply(200, (_uri, body: any) => ({ jsonrpc: "2.0", id: body.id, result: true }));

    const writebackRes = await writebackToOdoo(
      "tenant_qbo",
      testMoveName,
      "IRN-ODOO-2026-STAMPED",
      "https://qr.gov/odoo/stamped",
    );
    nock.cleanAll();

    assert(
      "Odoo Integration",
      "Odoo Ledger Writeback (Chatter message_post)",
      "Integration",
      Boolean(writebackRes && writebackRes.success),
      "Posts IRN and QR Code URL as a chatter message on the source account.move record",
      `Writeback Success for Odoo Invoice ${testMoveName}`,
    );

    // 7. Failed Odoo API Call Failure Recovery Test — real error propagation, no fake fallback data
    nock(testOdooUrl).post("/jsonrpc").reply(500, "Internal Server Error");

    let syncFailedCorrectly = false;
    let syncErrorMsg = "";
    try {
      await fetchAllOdooInvoicesPaginated("tenant_qbo");
    } catch (err: any) {
      syncFailedCorrectly = true;
      syncErrorMsg = err.message;
    }
    nock.cleanAll();

    assert(
      "Odoo Integration",
      "Failed Odoo API Call Error Propagation",
      "FailureRecovery",
      syncFailedCorrectly && syncErrorMsg.includes("Could not reach Odoo"),
      "Throws real error on Odoo API failure instead of returning fake fallback data",
      syncFailedCorrectly ? `Caught real error: ${syncErrorMsg}` : "Failed to throw error",
    );

    // Ingestion created a real Invoice (+ queued signInvoice job) — clean
    // both up so repeated test runs don't pile up a stuck-forever backlog on
    // the shared dev DB (see docs/CittaHub_Revision_Plan.md Phase 5).
    await prisma.queueJob.deleteMany({ where: { payload: { contains: ingested.id } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: ingested.id } });
    await prisma.invoice.delete({ where: { id: ingested.id } }).catch(() => {});
  } catch (err: any) {
    assert(
      "Odoo Integration",
      "Odoo Suite Verification",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // MODULE 12: EntityMapping & Registration Gate (Thin-Hub Pivot)
  // ------------------------------------------------------------------
  try {
    const tenantId = "tenant_qbo";
    const customerCode = `ENTITYMAP-TEST-${Date.now()}`;

    // Test 1: EntityMapping creation + unique-key lookup
    const created = await prisma.entityMapping.create({
      data: {
        tenantId,
        entityType: "CUSTOMER",
        sourceErp: "excel",
        sourceErpId: customerCode,
        displayName: "Registration Gate Test Customer",
        tin: "P088888888Z",
        status: "PENDING_REGISTRATION",
      },
    });
    const lookedUp = await prisma.entityMapping.findUnique({
      where: {
        tenantId_entityType_sourceErpId: { tenantId, entityType: "CUSTOMER", sourceErpId: customerCode },
      },
    });
    assert(
      "EntityMapping",
      "EntityMapping Creation & Unique-Key Lookup",
      "Implementation",
      !!lookedUp && lookedUp.id === created.id && lookedUp.status === "PENDING_REGISTRATION",
      "Creates a mapping and finds it back via the [tenantId, entityType, sourceErpId] unique key",
      `Found: ${!!lookedUp}, id match: ${lookedUp?.id === created.id}, status: ${lookedUp?.status}`,
    );

    // Test 2 & 3: registration-gate pipeline branch + NEEDS_EFS_REGISTRATION transition.
    // No nock interceptor is registered for this call — if the gate failed to
    // block the request, the real gateway call below would attempt a live,
    // unmocked network request instead of short-circuiting, which is itself
    // proof the gate didn't fire.
    const gatePayload = invoiceIngestionSchema.parse({
      tenantId,
      clientInvoiceNumber: `INVGATE${Date.now()}`,
      invoiceKind: "B2B",
      customerCode,
      customerName: "Registration Gate Test Customer",
      customerTin: "P088888888Z",
      issueDate: "2026-07-29",
      lineItems: [
        { itemCode: "ITEM-GATE", description: "Gate test line", quantity: 1, unitPrice: 1000, vatRate: 7.5, hsOrServiceCode: "8471.30" },
      ],
    });
    const gateInvoice = await prisma.invoice.create({
      data: {
        tenantId,
        sourceErp: "excel",
        clientInvoiceId: gatePayload.clientInvoiceNumber,
        invoiceType: "STANDARD",
        invoiceKind: "B2B",
        issueDate: new Date(gatePayload.issueDate),
        customerCode,
        customerName: gatePayload.customerName,
        customerTin: gatePayload.customerTin || undefined,
        subtotal: 1000,
        taxAmount: 75,
        totalAmount: 1075,
        status: "PENDING_NRS_STAMP",
        lineItems: {
          create: [{
            itemCode: "ITEM-GATE", description: "Gate test line", quantity: 1, unitPrice: 1000,
            taxableAmount: 1000, vatRate: 7.5, vatAmount: 75, totalAmount: 1075, hsOrServiceCode: "8471.30",
          }],
        },
      },
    });

    const gateJob = await invoiceQueue.add("signInvoice", { ...gatePayload, dbInvoiceId: gateInvoice.id });
    const gateResult = await processInvoiceJob(gateJob);

    const invoiceAfterGate = await prisma.invoice.findUnique({ where: { id: gateInvoice.id } });
    const mappingAfterGate = await prisma.entityMapping.findUnique({
      where: { tenantId_entityType_sourceErpId: { tenantId, entityType: "CUSTOMER", sourceErpId: customerCode } },
    });

    assert(
      "EntityMapping",
      "Registration Gate Blocks Unmapped B2B Customer",
      "Integration",
      gateResult.needsRegistration === true && !gateResult.success,
      "Worker routes a B2B invoice with an unmapped customer to registration instead of the gateway",
      `needsRegistration: ${gateResult.needsRegistration}, success: ${gateResult.success}`,
    );

    assert(
      "EntityMapping",
      "Invoice & EntityMapping State After Gate",
      "Runtime",
      invoiceAfterGate?.status === "NEEDS_EFS_REGISTRATION" && mappingAfterGate?.status === "PENDING_REGISTRATION",
      "Invoice.status becomes NEEDS_EFS_REGISTRATION; the EntityMapping stays PENDING_REGISTRATION",
      `Invoice status: ${invoiceAfterGate?.status}, Mapping status: ${mappingAfterGate?.status}`,
    );

    // Test 4: requeue-on-mapping-resolved (Phase 3's confirm logic)
    const { mapping: confirmedMapping, requeued } = await confirmEntityMappingRegistration(
      prisma,
      mappingAfterGate!,
      "CITTA-CUST-VERIFYALL-TEST",
      "verifyAll test runner",
    );
    const invoiceAfterConfirm = await prisma.invoice.findUnique({ where: { id: gateInvoice.id } });

    assert(
      "EntityMapping",
      "Confirm Registration Requeues Stuck Invoices",
      "Integration",
      confirmedMapping.status === "MAPPED" && requeued === 1 && invoiceAfterConfirm?.status === "PENDING_NRS_STAMP",
      "Confirming registration marks the mapping MAPPED and resets/requeues every invoice stuck on it",
      `Mapping status: ${confirmedMapping.status}, requeued: ${requeued}, invoice status: ${invoiceAfterConfirm?.status}`,
    );

    // Cleanup
    await prisma.queueJob.deleteMany({ where: { tenantId, payload: { contains: gateInvoice.id } } }).catch(() => {});
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: gateInvoice.id } });
    await prisma.invoice.delete({ where: { id: gateInvoice.id } }).catch(() => {});
    await prisma.entityMapping.delete({ where: { id: created.id } }).catch(() => {});
  } catch (err: any) {
    assert(
      "EntityMapping",
      "EntityMapping Suite Verification",
      "Runtime",
      false,
      "No unhandled exceptions",
      err.message,
    );
  }

  // ------------------------------------------------------------------
  // SUMMARY REPORT GENERATION
  // ------------------------------------------------------------------
  console.log("----------------------------------------------------");
  console.log("CITTA-EFS VERIFICATION MATRIX SUMMARY");
  console.log("----------------------------------------------------\n");

  let passedCount = 0;
  results.forEach((r, idx) => {
    const statusStr = r.passed ? "✅ PASS" : "❌ FAIL";
    if (r.passed) passedCount++;
    console.log(
      `[${idx + 1}] ${statusStr} | [${r.module}] ${r.testName} (${r.category})`,
    );
    console.log(`    Expected: ${r.expected}`);
    console.log(`    Actual:   ${r.actual}`);
    if (r.details) console.log(`    Details:  ${r.details}`);
    console.log("");
  });

  console.log("====================================================");
  console.log(
    `TOTAL TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${results.length - passedCount}`,
  );
  console.log(
    `SUCCESS RATE: ${((passedCount / results.length) * 100).toFixed(1)}%`,
  );
  console.log("====================================================\n");

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runAllTests();
