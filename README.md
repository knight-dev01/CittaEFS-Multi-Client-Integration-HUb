# CittaEFS ERP Gateway — QBO & Odoo to NRS E-Invoicing

![CI](https://github.com/knight-dev01/CittaEFS-Multi-Client-Integration-HUb/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React_19-20232A?style=flat&logo=react&logoColor=61DAFB)
![Express](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma_ORM-2D3748?style=flat&logo=prisma&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![WebSockets](https://img.shields.io/badge/WebSockets-Live_Telemetry-brightgreen)

**ERP Gateway, not Client Hub.** CittaEFS is the NRS extension — the hub holds one implicit tenant for `citta_efs_key` (`Tenant.cittaApiKey` `prisma/schema.prisma:10`) and onboarded **ERPs** (QBO, Odoo), not clients. Every narrative, onboarding, processing and message is ERP-scoped from onset: the options you see are exactly the ERPs you onboarded.

Invoices remain the fiscal unit pushed to EFS/NRS — `clientInvoiceNumber` (`DocNumber` QBO / `name` Odoo), `issueDate`, `customerCode|Name|Tin 10-14`, `lineItems {itemCode, hsOrServiceCode bare 8130|8471.30, vatRate 7.5, quantity, unitPrice}`, `invoiceTypeCode 388`, `headerCharges|Discount` — normalized per-ERP via `QuickBooksAdapter|OdooAdapter` `src/adapters/connectorAdapters.ts:23`.

---

## 🌟 Key Architecture — Gateway-Tailored

### 1. ERP-Centric Onboarding (Not Client)
* **Onboard ERP, not Client:** `OnboardClientModal` → **Onboard ERP** (`src/components/OnboardClientModal.tsx`) offers `QuickBooks Online` (OAuth2) and `Odoo ERP` (JSON-RPC API key) only — Excel removed, `CsvAdapter` deleted. Pick ERP → `POST /api/tenants/onboard` creates implicit `Tenant` + `TenantErp {erpId qbo|odoo, companyId realmId|database, displayName editable, status ACTIVE, autoEnqueue true}` `prisma/schema.prisma:43` (`@@unique[tenantId,erpId,companyId]` independent, no 5 cap).
* **Immediate ERP Scope:** From creation, `Navbar` groups by ERP `src/config/erpRegistry.ts` (`QBO`, `Odoo`), `ErpWorkspace` renders only ERP's tabs, processing queues and messages are filtered `?sourceErp=qbo|odoo` + `companyId`. No client abstraction.
* **Implicit Citta Tenant:** Single hub tenant holds `cittaApiKey` / `cittaGatewayUrl` / `cittaWritebackTarget BOTH` (`HUB|CITTAEFS|BOTH`); per-ERP `Integration {tenantId, sourceSystem, companyId, accessToken AES-GCM, status CONNECTED}` `prisma/schema.prisma:226` (`@@unique[tenantId,sourceSystem,companyId]` independent).

### 2. Independent ERP Connections
* **QBO:** OAuth2 `GET /api/integrations/qbo/connect` `state JWT tenantId` → `callback` `POST oauth.platform.intuit.com/oauth2/v1/tokens/bearer` `packEncryptedString` `companyId=realmId` `src/routes/qbo.ts:178` `tenantId_sourceSystem_companyId`. `GET /api/integrations/qbo/status`, `POST /api/integrations/qbo/sync` `fetchAllQboPaginated 1000` `STARTPOSITION` `src/services/qboService.ts:400`, webhook `POST /api/webhooks/qbo` `intuit-signature HMAC` `src/routes/webhooks.ts:92` set in **Intuit Developer Portal** `https://<hub>/api/webhooks/qbo` `QBO_WEBHOOK_VERIFIER`.
* **Odoo:** `POST /api/integrations/odoo/connect {odooUrl,database,username,apiKey}` `src/routes/odoo.ts:16` `callOdoo jsonrpc common.authenticate` `companyId=database` `STATIC_KEY_SENTINEL 2099`, `GET /status`, `POST /sync` `fetchAllPaginated 100 offset` / `fetchOdooInvoicesSince write_date` `src/services/odooService.ts:279`. No webhook — `60s` poll.
* **Independent:** Same `tenantId` can have `qbo realm 123 + 456` and `odoo db prod_us|prod_eu` — each `companyId` distinct, `displayName` editable, `lastSyncAt` per connection, `Open in QBO txnId` / `Odoo web#id=` deep link.

### 3. Gateway Listens — ERP Owns Edits
* **Read-Only Hub Buffer:** `Customer` `prisma/schema.prisma:63` `clientSystemCustId`, `Item` `:92` `clientSku hsOrServiceCode bare`, `Invoice` `:113` `sourceErp qbo|odoo qboInvoiceId|odooInvoiceId` — hub stores after `upsertQboMasterData :580` / `upsertOdooMasterData :354` but `PUT /api/invoices/:id :79` `PUT /customers :106` `PUT /items :152` `POST /customers|items` → `403` “ERP-sourced immutable — edit in ERP, hub re-ingests via sync/webhook”. Only `POST /api/validation-errors/resolve :40` patches `hsOrServiceCode` → `8130` `normalizeCittaCode` `src/data/referenceData.ts:22` for `Invalid Product Code`.
* **Excel Removed:** `CsvAdapter` `src/adapters/connectorAdapters.ts:359`, `ImportTab`, `ExcelDocumentViewer` deleted; `POST /api/integration/gen/invoices` restricted `sourceErp ∈ {qbo,odoo}` `403` `src/routes/invoices.ts:145`.

### 4. CittaEFS = Hub Extension
* **Not a Client:** `CittaGateway = hub` `https://ei-api.azurewebsites.net` `src/services/cittaEfsClient.ts:32` `POST gen/invoices dtoArray hSorServiceCode bare` `:276` `GET archive :364` `GET errors/validation|sign|transmit :392` `Bearer sk_live citta_efs_key` via `getCittaEfsConfig()`. `CittaGatewayTab` per-ERP is gone — global `cittaApiKey` implicit.
* **Pending Until Verified:** `PENDING_NRS_STAMP` `prisma Invoice.status` after `invoiceQueue.add signInvoice idempotency tenant:DocNumber` `src/queues/invoiceQueue.ts:426` `5s runWorkerBatch` `src/workers/invoiceWorker.ts:30` `5 retries [5s,30s,2m,10m,30m]` `DLQ → REJECTED` `ValidationError OPEN` until `runNrsReconciliationCron :98` `GET archive 200 pending` `60s` `src/crons/reconciliation.ts` → `APPROVED irn|csid|qrCodeUrl ledgerWriteback PENDING→SYNCED|FAILED :141` `60s QBO LastUpdatedTime` `60s Odoo write_date` `300s NRS` `server.ts:140`.

### 5. Writeback + Throw Errors Back + Open ERP
* **Success:** `executeClientLedgerWriteback :548` `writebackToQbo :889` `POST /v3/company/{realm}/invoice?minorversion=65 sparse CustomField IRN|QR_CODE_URL` verify `GET invoice`, `writebackToOdoo :579` `message_post IRN QR` chatter dedup `5x` `FAILED` surfaces. `GET /api/metrics byErp` `src/routes/validation.ts:154` `byErp[{qbo,odoo total|approved|pending|rejected}]` `timeseries 30d daily` `erpHealth lag`.
* **Errors Back to ERP:** `Citta Gateway error 400 hSorServiceCode HS-` / `Invalid Product Code` → `ValidationError MISSING_HS_CODE` → `erp-error-queue` memo `QBO memo` / `Odoo chatter` “Citta Rejected [category] — fix in ERP → resync” + hub `Open in ERP` deep link per `qboInvoiceId`/`odooInvoiceId`. `GET /api/validation-errors?sourceErp=qbo` + `GET /api/integrations/{qbo,odoo}/status?companyId` per connection.

### 6. Normalization & Validation (Remains)
* **4-Stage:** `1 Webhook|poll` → `2 Normalize clientInvoiceNumber|customerTin|hsCode|vatRate|currency` → `3 Validate B2B TIN 10-14, hs bare 8130, INVOICE_NUMBER_PATTERN ^[A-Z0-9]+$, INVOICE_TYPE_REQUIRES_IRN 380|384|393, 7.5%` → `4 NRS Gateway SHA-256 IRN/QR`.
* **Queue:** `prisma QueueJob` `hydrate+recoverOrphans PENDING after restart` `recoverStale 2m`, `BullMQ optional REDIS_URL` else DB-memory, `WebSockets Live Telemetry` `type:update` WS primary SSE fallback 30s `src/lib/store.tsx`.

---

## 🗺️ System Architecture — ERP Gateway

```
+-----------------------------------------------------------------------------------+
|                          SOURCE ERPs (Onboarded)                                  |
|   +-------------------+   +-------------------+                                     |
|   | QuickBooks Online |   | Odoo ERP (JSON-RPC)|                                    |
|   | OAuth2 + Webhook |   | API key + Poll     |                                    |
|   +---------+---------+   +---------+----------+                                    |
+-------------|-----------------------|-------------------+
              |                       |
              v                       v  (hub listens — 60s QBO/60s Odoo poll + QBO webhook)
+-----------------------------------------------------------------------------------+
|                        CITTAEFS ERP GATEWAY (SERVER)                              |
|  +-----------------------------------------------------------------------------+  |
|  | Express + WS + Vite (prod static dist) | JWT | rate-limit 300/min CORS      |  |
|  +-------------------------------------+---------------------------------------+  |
|                                        |                                          |
|  +-------------------------------------v---------------------------------------+  |
|  | Normalize per-ERP (QBO DocNumber→clientInvoiceNumber, Odoo product_id       |  |
|  | "[REF] Name"→sku) → Immutable snapshot Invoice|Item|Customer (read-only)    |  |
|  | Validate TIN 10-14, hs bare 8130, 7.5% VAT → Queue PENDING_NRS_STAMP        |  |
|  | queueJob DB + BullMQ 5s worker 5 retries → cittaEfsClient dtoArray          |  |
|  +-------------------------------------+---------------------------------------+  |
|                                        |                                          |
|  +-------------------------------------v---------------------------------------+  |
|  | Prisma PostgreSQL (Neon) Tenant(implicit citta) + TenantErp(companyId)     |  |
|  | + Integration(companyId) + Invoice(companyId,tenantErpId) + QueueJob       |  |
|  | + ValidationError + AuditLog + User                                          |  |
|  +-----------------------------------------------------------------------------+  |
+----------------------------------------|------------------------------------------+
                                         |
                                         v  (POST gen/invoices bare, GET archive/errors)
+-----------------------------------------------------------------------------------+
|              CITTAEFS GATEWAY EXTENSION — https://ei-api.azurewebsites.net        |
|         (hub's NRS extension, Bearer citta_efs_key, single implicit tenant)       |
+----------------------------------------|------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                         FIRS NRS TAX AUTHORITY PORTAL (NIGERIA)                   |
|      (Stamp IRN|csid|qrCodeUrl, archive 200 pending, errors validation)           |
+-----------------------------------------------------------------------------------+
                                         |
                                         v  (SYNCED|FAILED writeback)
+-----------------------------------------------------------------------------------+
|                 ERP LEDGER WRITEBACK (Open in ERP)                                |
|   QBO sparse CustomField IRN|QR — Odoo chatter message_post IRN QR — memo errors   |
+-----------------------------------------------------------------------------------+
```

---

## 🖥️ Dashboard Modules — ERP-Scoped From Onset

Onboarding an ERP immediately creates its workspace, queue and messages — no client selection:

| Tab Module | Key Capabilities | ERP Scope |
| :--- | :--- | :--- |
| 📊 **Overview** | Health, `byErp[qbo,odoo]` `total|approved|pending|rejected` `successRate` `timeseries 30d`, `erpHealth lastSyncAt lag`, `cittaGatewayStatus` | Per ERP `companyId` |
| 🔌 **Integrations** | QBO OAuth connect/sync + test-live, Odoo form + test-live, per-connection `displayName` editable, `status CONNECTED` `lastSyncAt`, `Open ERP Dashboard` | QBO / Odoo per `companyId` |
| 📄 **Invoices** | `PENDING_NRS_STAMP → APPROVED|SIGNED|REJECTED` `irn|qrCodeUrl`, `ledgerWriteback SYNCED|FAILED`, `Open in QBO txnId` `Odoo web#id=` | All ERPs filter `sourceErp` |
| 👥 **Customers** | Read-only directory from ERP `qbo CustomerRef` `odoo res.partner vat` `B2B TIN` — `403` on hub edit | All |
| 📑 **Items** | Read-only HS/Service `bare 8130` `UOM EA` `defaultVatRate 7.5` — `403` except `Validation resolve` | All |
| ⚠️ **Validation** | `MISSING_HS_CODE 8130` `INVALID_TIN` `GATEWAY_REJECTED` `TRANSMIT_FAILED` `OPEN→RESOLVED` `Fix|Bulk Fix` → `PENDING` → thrown back `memo` | Per ERP `sourceErp` |
| ⚙️ **Settings** | Global `VAT 7.5` `retry 5s|30s|2m|10m|30m` `cittaApiKey` implicit | ADMIN |
| 🔍 **Audit Log** | `PAYLOAD_GENERATED|CODE_MAPPED|CONNECTOR_AUTHENTICATED|QBO_SYNC|ODOO_SYNC|WEBHOOK_RECEIVED` | Per ERP |
| 🌐 **Citta Gateway (implicit)** | Global `cittaApiKey` `cittaGatewayUrl` `cittaWritebackTarget BOTH` — no per-tenant tab | — |

---

## 🛠️ Tech Stack

* **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS v4, Motion, Lucide React
* **Backend**: Express 4, TypeScript (`tsx`), Prisma 5 PostgreSQL Neon, `ws` WS+SSe, Zod `invoiceIngestionSchema`, `httpsRequest` to Citta
* **ERP**: QBO fetch OAuth2 `qboService.ts` + Odoo JSON-RPC `odooService.ts`, independent `companyId` uniques, `60s` polls + QBO webhook, `300s` NRS poll
* **Queue**: `prisma QueueJob` `recoverOrphans` `recoverStale 2m` + `BullMQ ioredis` optional `REDIS_URL`
* **Tests**: Vitest 3 `jsdom` + `nock` + `coverage-v8` (`src/test/unit/*`, `gateway.test.ts`) + `src/test/verifyAll.ts` full audit

## ✅ Tests & CI — Beyond Audit Logs

Audit logs show *what happened*; tests + CI show *what and what fails and when*:

| Suite | File | What it Guards | When it Fails |
| :--- | :--- | :--- | :--- |
| **HS bare** `unit/referenceData.test.ts` | `isValidCittaCode HS-8471.30 → bare`, `normalizeCittaCode`, `getCittaCodeType` | `HS-` prefix regress → `Citta 400 Invalid Product Code` | PR or local `npm run test:unit` |
| **Invoice schema** `invoiceSchema.test.ts` | `B2B→B2C TIN strip`, `^[A-Z0-9]+$`, `8130` | B2B misclass → NRS reject | CI `unit` |
| **Adapters** `adapters.test.ts` | `QBO Gardening/Pest →8130`, `Odoo Trimming→8130`, `Laptop→8471.30` | Infer regression → `messages.txt HS-8471.30` | CI `unit` |
| **Immutability** `immutable.test.ts` | `PUT 403 invoices|customers|items`, `POST qbo|odoo only` | Hub edit regress → ERP drift | CI `unit` |
| **Gateway** `gateway.test.ts` | `normalize before POST`, `60s|300s intervals`, `byErp metrics`, `companyId uniques`, `HS-` vs `8130` mock `nock` `400→200` | Writeback `FAILED` not handled, intervals missing | CI `verify-all` |
| **Full audit** `verifyAll.ts` | `invoiceQueue 5 retries`, `QBO OAuth decrypt`, `reconciliation orphans`, `cittaEfsClient 15s` | Queue DLQ, token refresh, NRS `archive 200 pending` | CI `verify-all` + `test:all` |

**GitHub Actions** `.github/workflows/ci.yml` (push `main`/`PR`): `lint → checkNoFallbacks → tsc → vitest unit --coverage → postgres:16 verifyAll + gateway.test → build → deploy-gate` (Render auto-deploy). On-demand `.github/workflows/test.yml` `workflow_dispatch` `all|unit|verifyAll|gateway`. Coverage `coverage/` artifact + badge `CI` above.
* **Security**: AES-256-GCM `packEncryptedString` `Integration companyId`, `JWT 8h/7d` `cookie`, `HMAC intuit-signature|CF35DF20 citta` `CORS * .vercel.app` `rate-limit 300/min`

---

## 🚀 Getting Started

### 1. Prerequisites
* Node.js v18+ , npm v9+

### 2. Install
```bash
git clone https://github.com/knight-dev01/CittaEFS-Multi-Client-Integration-HUb.git
cd CittaEFS-Multi-Client-Integration-HUb
npm install
cp .env.example .env
# set DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, CITTAEFS_API_KEY, CITTAEFS_GATEWAY_URL=https://ei-api.azurewebsites.net, QBO_CLIENT_ID|SECRET, QBO_WEBHOOK_VERIFIER
```

### 3. DB & Seed
```bash
npx prisma generate
npx prisma migrate deploy # applies 20260910000000_erp_independent companyId uniques
npm run seed # ADMIN + implicit citta tenant + demo QBO|Odoo TenantErp if demo
```

### 4. Dev
```bash
npm run dev # Express + Vite :3000, WS /api/ws-events, SSE /api/events
# http://localhost:3000 → Login ADMIN → Onboard ERP → QBO OAuth / Odoo API key → auto sync fetchAll 1000|100 → PENDING → 5s worker → Citta
```

### 5. Verify
```bash
node scripts/checkNoFallbacks.js
npm run test # verifyAll.ts POST gen/invoices 388 bare 8130
curl -H "Authorization: Bearer <CITTAEFS_API_KEY>" https://ei-api.azurewebsites.net/api/einvoice/archive?fromDate=2026-01-01
```

---

## ☁️ Production Build (Render)

* **Build:** `(npm run db:migrate || echo advisory lock) && node scripts/checkNoFallbacks.js && prisma generate && vite build && esbuild server.ts --bundle --packages=external`
* **Start:** `node start.cjs` loads `dist/server.cjs` `PORT 10000`
* **Env:** `NODE_ENV=production DATABASE_URL JWT_SECRET ENCRYPTION_KEY CITTAEFS_API_KEY CITTAEFS_GATEWAY_URL QBO_CLIENT_ID QBO_CLIENT_SECRET QBO_WEBHOOK_VERIFIER REDIS_URL?`
* **Intuit Portal:** Webhooks `https://<hub>.onrender.com/api/webhooks/qbo` `intuit-signature` `QBO_WEBHOOK_VERIFIER`
* **Citta Webhook:** `POST /api/einvoice/webhook` `https://<hub>/api/webhooks/cittaefs|/pay2/einvoicehookweb` `CF35DF20`

---

## 📁 Repository Structure

```
.
├── prisma/
│   ├── schema.prisma               # Tenant(implicit citta) + TenantErp(companyId erpId displayName autoEnqueue) + Integration(companyId) + Invoice(companyId tenantErpId) + QueueJob + Validation + Audit
│   ├── migrations/20260910000000_erp_independent/migration.sql
│   └── seed.ts
├── scripts/checkNoFallbacks.js
├── src/
│   ├── adapters/connectorAdapters.ts    # QuickBooksAdapter + OdooAdapter (CsvAdapter frozen)
│   ├── components/erp/ErpWorkspace.tsx # ERP-scoped router (Overview|Invoices|Customers|Items|Validation|Connectors)
│   ├── components/OnboardClientModal.tsx # Onboard ERP (QBO|Odoo) not Client
│   ├── config/erpRegistry.ts         # ERP_REGISTRY qbo|odoo active
│   ├── crons/reconciliation.ts       # runQbReconciliationCron runNrsReconciliationCron recoverOrphans/Stale
│   ├── queues/invoiceQueue.ts        # DB + BullMQ 5 retries
│   ├── workers/invoiceWorker.ts      # normalize 8130 bare → cittaEfsClient
│   ├── services/cittaEfsClient.ts    # POST gen/invoices dtoArray bare, GET archive/errors, writeback SYNCED|FAILED
│   ├── services/qboService.ts        # OAuth + fetch + ingest + sparse IRN|QR writeback
│   ├── services/odooService.ts       # JSON-RPC + message_post
│   ├── routes/tenants.ts             # ERP create tenantId,erpId,companyId independent
│   ├── routes/qbo.ts|odoo.ts|webhooks.ts|invoices.ts|validation.ts|system.ts
│   └── data/referenceData.ts         # HS 5600+ Service 400+ bare + normalizeCittaCode
├── server.ts                       # Express + WS + 5s worker + 60s QBO|Odoo + 300s NRS intervals
└── README.md
```

---

## 🔒 Security & Compliance

* **Citta Key:** Single `CITTAEFS_API_KEY` `Tenant.cittaApiKey` implicit — no per-tenant key fan-out.
* **ERP Secrets:** `Integration companyId realmId|database` `accessToken AES-256-GCM` `packEncryptedString` `ENCRYPTION_KEY`.
* **FIRS/NRS:** `defaultVatRate 7.5` `B2B TIN 10-14` `hs bare` `headerDiscount|Charges` `SHA-256` `X-Hub-Api-Key` hub external `POST /api/hub/v1/invoices` `X-Hub-Api-Key` + `tenantId` override.
* **Isolation:** ERP-scoped `sourceErp|companyId|tenantErpId` not `tenantId` client; `getScopedTenantWhere` now ERP `companyId` where needed.

---

## 📄 License

Proprietary Enterprise Software • All Rights Reserved CittaEFS Systems.
