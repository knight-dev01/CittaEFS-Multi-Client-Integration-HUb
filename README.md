# CittaEFS Multi-Tenant Integration Hub & NRS E-Invoicing Gateway

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React_19-20232A?style=flat&logo=react&logoColor=61DAFB)
![Express](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma_ORM-2D3748?style=flat&logo=prisma&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![WebSockets](https://img.shields.io/badge/WebSockets-Live_Telemetry-brightgreen)

A high-performance enterprise integration platform and middleware built for multi-tenant ERP connectivity, automated fiscal normalization, and national tax authority (**FIRS NRS — Nigeria**) e-invoicing compliance.

CittaEFS normalizes heterogeneous ERP data—from live REST APIs and database staging views to native Excel/CSV spreadsheet drops—into a standardized fiscal matrix for real-time validation, cryptographic Internal Reference Number (IRN) generation, QR code generation, and direct tax authority submission.

---

## 🌟 Key Architecture & Enterprise Highlights

### 1. ERP-Isolated Multi-Tenant Workspace (Per-ERP Dedicated UI)
* **Tenant-Aware Sidebar**: Tenants grouped by ERP in `Navbar` (`src/config/erpRegistry.ts`) — each `platformType` (`QuickBooks Online`, `Excel & CSV Import`, `SAP S/4HANA`…) renders as an isolated workspace with its own short label (`QBO`, `Excel`, `SAP`) and mode banner. Switching workspace preserves state; bloom removed wrapper `ExcelSpreadsheetEditor.tsx` and 214 lines frozen adapters.
* **Per-ERP Dedicated UI & Tabs**: `src/components/erp/ErpWorkspace.tsx` routes `Overview / Invoices / Import / Customers / Items / Validation / Connectors / Field Mapping / CittaEFS Gateway` per ERP (`erp.tabs`). QBO tenants show OAuth2 connect/sync, Excel tenants show drag-drop grid + normalization, future ERPs (SAP/NetSuite/Odoo/SQL) render `comingSoon` config + mapping skeleton — add one entry to `ERP_REGISTRY` to onboard a new ERP.
* **Tenant-Scoped Config**: `Tenant.erpConfig` (JSON) stores per-ERP connection fields and `Field Mapping` rules (`source ↔ target`) via `PATCH /api/tenants/:id/erp-config`; `Tenant.cittaGatewayUrl / cittaWritebackTarget` stores CittaEFS-provided credentials per tenant (see below).

### 2. Multi-Tenant ERP Connector Architecture
* **QuickBooks Online (QBO) [ACTIVE & LIVE]**: Native REST API integration featuring OAuth2 token exchange, automatic token refresh, webhook CDC ingestion, sparse writeback of IRN/QR to QBO custom fields, and per-tenant `realmId` config (`src/adapters/connectorAdapters.ts` — only `QuickBooksAdapter` + `CsvAdapter` active, frozen adapters removed).
* **Excel & CSV [ACTIVE]**: SheetJS drag-drop, multi-item grouping, preview before gateway (see below), sheet-name warning for `Customer/Item/Invoice Template`.
* **Extensible Enterprise Adapters** (registry `comingSoon`): `SAP S/4HANA` (OData `API_INVOICE_SRV` + CSRF), `NetSuite SuiteTalk` (TBA HMAC-SHA256), `Odoo` (JSON-RPC), `Custom SQL` (`vw_pending_invoices`). Enable by adding to `ERP_REGISTRY`.

### 3. Intelligent Spreadsheet Ingestion Engine (.xlsx / .xls / .csv) + Mandatory Preview
* **Preview Before Gateway**: `src/components/InvoicePreview.tsx` renders normalized totals (`taxable/VAT/grandTotal`), HS badges (`UNMAPPED` warning, `B2C TIN stripped`), expected IRN/QR, and raw JSON. `NewInvoiceModal` and `ExcelDocumentViewer` group by `clientInvoiceNumber` and show a modal of all invoices — nothing hits `POST /api/integration/gen/invoices` or `POST /api/hub/v1/invoices` until confirmed.
* **SheetJS + Grouping + Normalization**: Preview includes auto-filled HS, 7.5% default VAT, and validation warnings.

### 4. Role-Based Access Control (RBAC) System
Pre-middleware authentication gate providing isolated interfaces and permissions across four enterprise user roles:
* 👑 **Administrator (`ADMIN`)**: Full access across all multi-tenant configurations, client onboarding, security policies, and system purges.
* ⚙️ **Integration Manager (`INTEGRATION_MANAGER`)**: Manages connector API keys, OAuth credentials, field mapping rules, and webhook streams.
* 📋 **Ingestion Operator (`OPERATOR`)**: Oversees day-to-day invoice creation, batch spreadsheet uploads, and customer directory management.
* 🔍 **Compliance Auditor (`AUDITOR`)**: Read-only access to cryptographic audit logs, FIRS NRS submission statuses, and tax reconciliation metrics.

### 5. CittaEFS Gateway Credentials & Writeback (Per-Tenant)
* **CittaEFS-Provided Credentials**: `CittaGatewayTab` (`src/components/erp/CittaGatewayTab.tsx`) lets CittaEFS (or ADMIN) paste per-tenant `cittaGatewayUrl` and `cittaApiKey` (AES-256-GCM `encryptedSecret`); stored in `Tenant.cittaGatewayUrl / cittaApiKey / cittaWritebackTarget`. Test button `POST /api/tenants/:id/citta-config/test` hits `/api/einvoice/archive` with Bearer key.
* **Writeback to CittaEFS and/or Hub**: `PATCH /api/tenants/:id/citta-config` sets `cittaWritebackTarget = HUB | CITTAEFS | BOTH`. `src/services/cittaEfsClient.ts` reads per-tenant `gatewayUrl` via `getCittaEfsConfig()` for every `signAndStampInvoice`/`getArchive` etc, then `executeClientLedgerWriteback` posts IRN/QR to `cittaGatewayUrl` when `CITTAEFS/BOTH` and to QBO sparse-update when `HUB/BOTH`. External CittaEFS systems integrate via `POST /api/hub/v1/invoices` with `X-Hub-Api-Key: <cittaApiKey>`.

### 6. 4-Stage Fiscal Data Normalization Pipeline
1. **Stage 01 — Source Extraction**: Ingestion via live Webhook, API pull, SQL staging poller, or Excel drop — per-ERP UI.
2. **Stage 02 — EFS Excel Matrix**: Normalization of source fields into standardized schema columns (`clientInvoiceNumber`, `customerTin`, `hsCode`, `vatRate`, `currency`) using per-tenant `erpConfig` rules.
3. **Stage 03 — Taxonomy & Rule Verification**: Real-time validation against FIRS/NRS Nigeria rules, including B2B TIN lookup, 8-digit HS code verification, and 7.5% VAT auto-calculation (Nigeria NRS standard, per-tenant `defaultVatRate`).
4. **Stage 04 — NRS Gateway Transmission**: Per-tenant gateway URL submission with SHA-256 hashing (`crypto.createHash`), IRN assignment, and QR generation.

### 7. Asynchronous Queue & Live Telemetry Engine
* **Database-Backed Job Queue**: `prisma QueueJob` (`src/queues/invoiceQueue.ts`) with hydrate + `recoverOrphans()` for `PENDING_NRS_STAMP` after restart, exponential backoff `5s/30s/2m/10m/30m`, DLQ → `REJECTED`. `src/workers/invoiceWorker.ts` and `src/crons/reconciliation.ts` share recovery.
* **Reconciliation**: `runQbReconciliationCron` polls QBO CDC per connected `Integration`; `runNrsReconciliationCron` polls per-tenant `cittaGatewayUrl /api/einvoice/archive` and reconciles stuck IRNs. `WebSockets Live Telemetry` fans `type:"update"` to WS primary, SSE after 2 WS fails, 30s hidden-aware backup poll (`src/lib/store.tsx`).

---

## 🗺️ System Architecture & Data Flow

```
+-----------------------------------------------------------------------------------+
|                                 SOURCE ERP DATA                                   |
|   +-------------------+   +--------------------+   +--------------------------+   |
|   | QuickBooks REST   |   | Custom SQL Staging |   | Excel / CSV Drops (.xlsx)|   |
|   +---------+---------+   +---------+----------+   +------------+-------------+   |
+-------------|-----------------------|---------------------------|-----------------+
              |                       |                           |
              v                       v                           v
+-----------------------------------------------------------------------------------+
|                        CITTAEFS INTEGRATION HUB (SERVER)                          |
|  +-----------------------------------------------------------------------------+  |
|  | Express REST API & WebSockets Telemetry Server                              |  |
|  | - Authentication Gate & JWT RBAC Validation                                 |  |
|  | - Zod Schema Ingestion Validation (`invoiceIngestionSchema`)                |  |
|  +-------------------------------------+---------------------------------------+  |
|                                        |                                          |
|  +-------------------------------------v---------------------------------------+  |
|  | 4-Stage Fiscal Engine & Queue Worker Pool (`invoiceQueue`)                  |  |
|  | - Tax Rules & 16% VAT Calculation Engine                                    |  |
|  | - Cryptographic SHA-256 Hashes & IRN Generator                               |  |
|  | - Encrypted Credential Manager (`packEncryptedString`)                       |  |
|  +-------------------------------------+---------------------------------------+  |
|                                        |                                          |
|  +-------------------------------------v---------------------------------------+  |
|  | Prisma ORM Persistence Layer (SQLite / PostgreSQL)                          |  |
|  +-----------------------------------------------------------------------------+  |
+----------------------------------------|------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                         FIRS NRS TAX AUTHORITY PORTAL (NIGERIA)                    |
|      (Cryptographic Stamp Verification, IRN Validation & Tax Certification)       |
+-----------------------------------------------------------------------------------+
```

---

## 🖥️ Dashboard View Modules (ERP-Isolated)

The frontend provides a tenant-aware, per-ERP isolated interface. `Navbar` groups workspaces by ERP (`All ERPs` → `QBO`, `Excel`, …) and `ErpWorkspace` renders only the tabs for the active tenant's `platformType` (`getErpForTenant`):

| Tab Module | Key Capabilities | ERP Scope |
| :--- | :--- | :--- |
| 📊 **System Overview** | Health dashboard, invoice throughput, submission success rate, workspace banner (`QBO`/`Excel` mode). | All |
| 🔌 **ERP Connectors** | QBO OAuth2 connect/sync + test-live; Excel import grid. Locked with `Switch workspace` hint when tenant ERP mismatches. | QBO / Excel (per-tenant) |
| 📥 **Batch Ingestion** | SheetJS drag-drop, grouped preview (`InvoicePreview`) before `POST /api/integration/gen/invoices` or `POST /api/hub/v1/invoices`. | QBO / Excel |
| 🗺️ **Field Mapping** (`mapping`) | Per-tenant matching rules stored in `Tenant.erpConfig` JSON (`source ↔ target`), resolved during normalization. | Per-ERP |
| 🔑 **CittaEFS Gateway** (`gateway`) | CittaEFS-provided `cittaGatewayUrl` + `cittaApiKey` (encrypted), `Test` against `/api/einvoice/archive`, `Writeback Target` (`HUB | CITTAEFS | BOTH`). Endpoints `PATCH /api/tenants/:id/citta-config` / `POST .../citta-config/test` / `PATCH .../erp-config` (ADMIN). | Per-tenant |
| 📄 **Fiscal Invoices** | Registry with pagination (`?page&limit`), status filter, IRN/QR (`PENDING_NRS_STAMP → APPROVED`), preview totals. | All |
| 📑 **Item Dictionary** | HS/Service code, UOM, per-tenant `defaultVatRate` (7.5% NRS standard). | All |
| 👥 **Customer Directory** | B2B TIN 10-14 alphanum + `postcode` required for B2B, `ccEmail` semicolon list, `cittaCustomerId` is null until real registration. | All |
| ⚠️ **Validation Errors** | Taxonomy inspector with auto-fix; backed by `ValidationError` table, paginated. | All |
| ⚙️ **Settings** | Tenant VAT, retry policy (`BullMQ 5 retries: 5s/30s/2m/10m/30m`), gateway (global view of per-tenant overrides). | ADMIN |

---

## 🛠️ Tech Stack & Key Libraries

### Core Architecture
* **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS v4, Motion (Framer Motion), Lucide React Icons
* **Backend**: Express 4, TypeScript (`tsx`), Prisma ORM 5, WebSockets (`ws`), Zod Schema Validation
* **Spreadsheet Processing**: SheetJS (`xlsx`)
* **Visualizations & Charts**: Recharts
* **Integration Services**: Custom zero-dependency fetch-backed QuickBooks Online OAuth2 client, `@google/genai`

---

## 🚀 Local Development & Getting Started

### 1. Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher

### 2. Installation & Setup

```bash
# 1. Clone the repository
git clone https://github.com/cittaefs/citta-efs-hub.git
cd citta-efs-hub

# 2. Install dependencies
npm install

# 3. Configure environment variables (.env)
cp .env.example .env
```

### 3. Database Initialization & Seeding

```bash
# Generate Prisma Client & Push Database Schema
npx prisma generate
npx prisma db push

# Seed default multi-tenant sample data and RBAC users
npm run seed
```

### 4. Run Development Server

```bash
# Starts Express backend and Vite development server on port 3000
npm run dev
```

Navigate to `http://localhost:3000` in your web browser.

### 5. Run Verification & Test Suite

```bash
# Runs code verification checks and automated integration tests
npm run test
```

---

## ☁️ Production Build & Deployment

### Build Scripts
This application uses `esbuild` to compile `server.ts` into a self-contained CommonJS bundle in `dist/server.cjs` while maintaining Vite static asset builds:

```bash
# Production Build Command
npm run build

# Start Production Server
npm run start
```

### Deployment Configuration (Render.com / Cloud Run)
When deploying to cloud platforms such as **Render.com** or **Cloud Run**:

1. **Environment Variables**: Set `NODE_ENV=production`, `PORT=3000`, `DATABASE_URL`, `JWT_SECRET`, and `ENCRYPTION_KEY`.
2. **Package Manager**: Use `npm install` for dependency resolution. Ensure no lingering `bun.lock` exists in the repo root so cloud builders execute standard `npm install` from `package.json` (installing all dependencies like `intuit-oauth`, `express`, `prisma`, `ws`).
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `npm run start` (Executes `node start.cjs` which loads `dist/server.cjs`).
5. **Bundling & External Resolution**: The server build bundles `server.ts` into CommonJS format using `esbuild` with `--packages=external`, deferring external package resolution to standard `node_modules`.

---

## 📁 Repository Structure

```
.
├── prisma/
│   ├── schema.prisma               # Multi-tenant DB (Tenant.cittaGatewayUrl, cittaWritebackTarget, erpConfig, QueueJob, Customer.postcode/ccEmail)
│   └── seed.ts                     # Seed ADMIN + tenants
├── scripts/
│   └── checkNoFallbacks.js          # Guardrail: forbids fallback/placeholder/demo data in prod code
├── src/
│   ├── adapters/
│   │   └── connectorAdapters.ts    # Only QuickBooksAdapter + CsvAdapter (frozen adapters removed)
│   ├── components/
│   │   ├── erp/
│   │   │   ├── ErpWorkspace.tsx    # Per-ERP isolated workspace router (qbo/excel/generic comingSoon)
│   │   │   ├── ErpMappingTab.tsx   # Per-tenant field mapping (tenant.erpConfig JSON)
│   │   │   └── CittaGatewayTab.tsx # CittaEFS credentials (cittaGatewayUrl/cittaApiKey/writebackTarget) + Test
│   │   ├── InvoicePreview.tsx      # Shared preview (totals, HS badges, IRN/QR expectation, raw JSON) — mandatory before gateway
│   │   ├── ConnectorsTab.tsx       # QBO connect/sync (per-ERP)
│   │   ├── ImportTab.tsx           # Tenant-aware QBO/Excel toggle (locked when ERP mismatches)
│   │   ├── ExcelDocumentViewer.tsx # SheetJS grid + grouped preview modal (Preview & Submit)
│   │   ├── InvoicesTab.tsx         # Registry with pagination + IRN/QR + credit note
│   │   ├── CustomerSyncTab.tsx     # With postcode/ccEmail
│   │   ├── ItemDictionaryTab.tsx
│   │   ├── Navbar.tsx              # Grouped by ERP (groupTenantsByErp), per-ERP tabs (erp.tabs), CittaEFS Gateway + Mapping
│   │   ├── OverviewTab.tsx
│   │   ├── ValidationErrorsTab.tsx
│   │   ├── SettingsTab.tsx         # Global VAT/retry + link to per-tenant Gateway tabs
│   │   ├── NewInvoiceModal.tsx     # Preview → Confirm & Send (2-step)
│   │   ├── OnboardClientModal.tsx  # Creates tenant with platformType → enrolls in ERP workspace
│   │   └── LoginScreen.tsx
│   ├── config/
│   │   ├── erpRegistry.ts          # ERP_REGISTRY (qbo, excel, sap, netsuite, odoo, custom_sql) + getErpForTenant()
│   │   ├── encryption.ts           # AES-256-GCM (ENCRYPTION_KEY hex or scrypt)
│   │   └── dbConfig.ts
│   ├── crons/reconciliation.ts     # Real QBO CDC + per-tenant gateway archive polling
│   ├── queues/invoiceQueue.ts      # DB-backed QueueJob + recoverOrphans
│   ├── workers/invoiceWorker.ts    # Calls cittaEfsClient + writeback with writebackTarget
│   ├── services/
│   │   ├── cittaEfsClient.ts       # Per-tenant gatewayUrl/apiKey via getCittaEfsConfig(), writeback HUB/CITTAEFS/BOTH
│   │   └── qboService.ts           # QBO OAuth + fetch + ingest + sparse writeback
│   ├── schemas/invoice.schema.ts   # headerDiscount/headerCharges, 7.5% VAT, B2G, B2C TIN strip
│   ├── types/                      # Tenant extended with cittaGatewayUrl, cittaWritebackTarget, erpConfig
│   ├── App.tsx                     # Now renders ErpWorkspace
│   └── index.css
├── server.ts                       # Express + WS, rate-limit/CORS, JWT, pagination, tenant/erp/citta endpoints, hub external API
├── start.cjs
├── vite.config.ts
├── package.json
└── README.md
```

### Hub External API (for an existing CittaEFS system)

Existing CittaEFS instances push normalized or raw invoices through the hub without a browser session:

* **Auth**: `X-Hub-Api-Key: <Tenant.cittaApiKey>` (per-tenant, `X-Api-Key` or `Authorization: Bearer <key>` also accepted) + optional `tenantId` override for dev.
* `GET /api/hub/v1/health` — liveness.
* `POST /api/hub/v1/invoices` — body `{ invoiceNumber|clientInvoiceNumber, issueDate, customerName/Tin, items|lineItems[] {sku|itemCode, desc, qty, price|unitPrice, hsCode, vatRate}, invoiceKind/Type }` → validates via `invoiceIngestionSchema`, duplicate 409, creates `PENDING_NRS_STAMP` invoice, enqueues `signInvoice` job, `202 { status: "PENDING_NRS_STAMP", invoice }`. Poll `GET /api/hub/v1/tenants/:tenantId/invoices/:clientInvoiceNumber` for `irn/qrCodeUrl` when `APPROVED`.
* `GET /api/hub/v1/tenants/:tenantId/invoices?page&limit&status` — paginated list.
* Internal `POST /api/integration/gen/invoices` remains for dashboard; hub external reuses same `invoiceQueue` + worker.

After stamping, hub persists `irn/csid/qrCodeUrl` (`APPROVED`, `ledgerWritebackStatus=SYNCED`) and writes back per `cittaWritebackTarget`: `HUB` (hub ledger only), `CITTAEFS` (POST to `cittaGatewayUrl`/`cittaWritebackUrl` with Bearer key), `BOTH` (both).


---

## 🔒 Security & Compliance Standards

* **Credential Encryption**: Per-tenant `cittaApiKey` and `cittaGatewayUrl` are encrypted with AES-256-GCM (`ENCRYPTION_KEY` hex or `ENCRYPTION_SECRET` scrypt) before storage; `Tenant.erpConfig` JSON is tenant-isolated. No defaults in production (`JWT_SECRET`/`ENCRYPTION_KEY` fail-closed).
* **FIRS/NRS Nigeria Tax Standard Alignment**: Per-tenant `defaultVatRate` (7.5% NRS standard, Nigeria), mandatory B2B TIN 10-14 alphanum + `postcode` for B2B, 8-digit HS validation, `headerDiscount/Charges`, and real `SHA-256` (`crypto.createHash`) IRN/QR with writeback per `cittaWritebackTarget`.
* **Tenant Data Boundary Isolation**: Multi-tenant schema enforces `where: { tenantId }` isolation; ERP workspaces are UI- and data-isolated (QBO vs Excel vs future ERPs via `ERP_REGISTRY`).
* **Network**: `CORS` allowlist (`ALLOWED_ORIGINS`/`APP_URL` + `*.vercel.app`), security headers (`X-Content-Type-Options`, `X-Frame-Options`, `HSTS`), rate-limit 120/min (15/min auth), health `GET /api/health`.

---

## 📄 License

Proprietary Enterprise Software • All Rights Reserved CittaEFS Systems.
