// OpenAPI 3.0 contract for the Interswitch-style v1 merchant gateway.
// Served at GET /api/v1/openapi.json. Additive — hub/v1 routes are unchanged.

export const openApiV1Spec = {
  openapi: "3.0.3",
  info: {
    version: "1.0.0",
    title: "CittaEFS Merchant Gateway (v1)",
    description:
      "Interswitch-style merchant gateway for e-invoicing: onboard merchants, issue Bearer tokens, initialize fiscal transactions, poll authorization status, register signed webhooks. All transactions run the internal standard invoice validation before queueing to CittaEFS/NRS.",
  },
  servers: [{ url: "/api/v1", description: "Merchant gateway v1" }],
  security: [{ bearerAuth: [] }, { hubApiKey: [] }],
  tags: [
    { name: "health", description: "Service status" },
    { name: "channels", description: "Source ERP channels" },
    { name: "auth", description: "Merchant tokens" },
    { name: "merchants", description: "Onboarding and webhook registration" },
    { name: "transactions", description: "Fiscal transaction lifecycle" },
    { name: "webhooks", description: "Signed callbacks and dev tools" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["health"],
        summary: "Gateway health",
        security: [],
        responses: { "200": { description: "Service status" } },
      },
    },
    "/channels": {
      get: {
        tags: ["channels"],
        summary: "List source channels (qbo, odoo, api, file)",
        responses: { "200": { description: "Channel list" } },
      },
    },
    "/auth/token": {
      post: {
        tags: ["auth"],
        summary: "Issue merchant Bearer token",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["clientId", "clientSecret"],
                properties: {
                  clientId: { type: "string", description: "merchantCode (tenant id)" },
                  clientSecret: { type: "string", description: "merchant API key" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "access_token, merchantCode, mode test|live" } },
      },
    },
    "/merchants/onboard": {
      post: {
        tags: ["merchants"],
        summary: "Onboard merchant (test mode)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["businessName"],
                properties: {
                  businessName: { type: "string" },
                  tin: { type: "string", description: "Tax ID, 10-14 chars for B2B" },
                  platformType: { type: "string", default: "QuickBooks Online" },
                  marketTier: { type: "string", default: "Enterprise" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "merchantCode, payItemId, testApiKey" } },
      },
    },
    "/transactions/initialize": {
      post: {
        tags: ["transactions"],
        summary: "Initialize fiscal transaction (202 pending)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/InitializeRequest" },
            },
          },
        },
        responses: { "202": { description: "ResponseCode 09, transactionRef, paymentId" } },
      },
    },
    "/transactions/status/{transactionRef}": {
      get: {
        tags: ["transactions"],
        summary: "Poll authorization status",
        parameters: [
          { name: "transactionRef", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "ResponseCode 00|09|11 with IRN and QR" } },
      },
    },
    "/merchants/{merchantCode}/transactions": {
      get: {
        tags: ["transactions"],
        summary: "Paged merchant transactions",
        parameters: [
          { name: "merchantCode", in: "path", required: true, schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: { "200": { description: "Transaction page" } },
      },
    },
    "/transactions/refund": {
      post: {
        tags: ["transactions"],
        summary: "Raise credit note against an authorized IRN",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["transactionRef"],
                properties: {
                  transactionRef: { type: "string", description: "Original number or IRN" },
                },
              },
            },
          },
        },
        responses: { "202": { description: "Refund accepted, pending authorization" } },
      },
    },
    "/merchants/{merchantCode}/webhook": {
      post: {
        tags: ["merchants"],
        summary: "Register default signed-callback URL",
        parameters: [
          { name: "merchantCode", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["callbackUrl"],
                properties: {
                  callbackUrl: { type: "string", format: "uri" },
                  webhookSecret: { type: "string", description: "Optional; defaults to merchant API key" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Webhook registered" } },
      },
      get: {
        tags: ["merchants"],
        summary: "View webhook registration (secret never exposed)",
        parameters: [
          { name: "merchantCode", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "callbackUrl and signing algorithm" } },
      },
    },
    "/webhooks/retry/{transactionRef}": {
      post: {
        tags: ["webhooks"],
        summary: "Re-fire signed callback for a transaction",
        parameters: [
          { name: "transactionRef", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Delivery result" } },
      },
    },
    "/webhooks/verify": {
      post: {
        tags: ["webhooks"],
        summary: "Verify a webhook signature (dev helper)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["payload", "signature"],
                properties: {
                  payload: { description: "Raw JSON body (object or string)" },
                  signature: { type: "string", description: "Value of X-Citta-Signature" },
                  secret: { type: "string" },
                  merchantCode: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "{ valid: boolean }" } },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["health"],
        summary: "This contract",
        security: [],
        responses: { "200": { description: "OpenAPI document" } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      hubApiKey: { type: "apiKey", in: "header", name: "X-Hub-Api-Key" },
    },
    schemas: {
      InitializeRequest: {
        type: "object",
        required: ["clientInvoiceNumber", "issueDate", "customerName", "lineItems"],
        properties: {
          clientInvoiceNumber: { type: "string", pattern: "^[A-Z0-9]+$", description: "Caps A-Z + numbers only" },
          order_id: { type: "string", description: "Alias of clientInvoiceNumber" },
          txn_ref: { type: "string", description: "Alias of clientInvoiceNumber" },
          issueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          customerCode: { type: "string", default: "CUST-EXTERNAL" },
          customerName: { type: "string" },
          customerTin: { type: "string", description: "10-14 chars; absent downgrades B2B to B2C" },
          invoiceType: { type: "string", enum: ["STANDARD", "CREDIT_NOTE", "DEBIT_NOTE", "CANCELLATION"], default: "STANDARD" },
          invoiceKind: { type: "string", enum: ["B2B", "B2C", "B2G", "EXPORT"], default: "B2B" },
          headerDiscount: { type: "number", default: 0 },
          headerCharges: { type: "number", default: 0 },
          callbackUrl: { type: "string", format: "uri", description: "Per-transaction signed-callback URL" },
          webhookUrl: { type: "string", format: "uri", description: "Alias of callbackUrl" },
          lineItems: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["itemCode", "description", "quantity", "unitPrice"],
              properties: {
                itemCode: { type: "string" },
                description: { type: "string" },
                quantity: { type: "number" },
                unitPrice: { type: "number" },
                hsOrServiceCode: { type: "string", description: "Bare code, e.g. 8130" },
                vatRate: { type: "number", default: 7.5 },
              },
            },
          },
        },
      },
      WebhookDelivery: {
        type: "object",
        description: "Signed callback posted to callbackUrl with X-Citta-Signature (HMAC-SHA256 of raw body).",
        properties: {
          event: { type: "string", enum: ["invoice.authorized", "invoice.rejected"] },
          merchantCode: { type: "string" },
          transactionRef: { type: "string" },
          paymentId: { type: "string" },
          status: { type: "string" },
          ResponseCode: { type: "string", enum: ["00", "11"] },
          irn: { type: "string", nullable: true },
          qrCodeUrl: { type: "string", nullable: true },
          ledgerWritebackStatus: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
    },
  },
};
