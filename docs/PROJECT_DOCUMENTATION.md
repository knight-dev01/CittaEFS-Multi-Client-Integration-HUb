# CittaEFS Multi-Client Integration Hub — Project Documentation

> Generated from a full codebase analysis on 2026-09-12. Reflects the state of branch `feat/odoo-erp-integration` at commit `7890daf`.

## 1. Overview

The **CittaEFS Multi-Client Integration Hub** is a multi-tenant middleware application that connects client ERP systems (QuickBooks Online, Odoo, Excel/CSV, with SAP, NetSuite, and Custom-SQL planned) to Nigeria's **FIRS NRS** (National Revenue Service) e-invoicing regime via the **CittaEFS Gateway**.

Its core job is to:

1. **Ingest** invoices from a client's ERP (pull via polling or push via webhook/CDC).
2. **Normalize** heterogeneous invoice data into a canonical schema.
3. **Validate & classify** invoices against tax rules (VAT, B2B/B2C/B2G classification, HS/service tax codes).
4. **Submit** invoices to the CittaEFS Gateway for cryptographic stamping (IRN — Invoice Reference Number — plus a QR code).
5. **Write back** the stamp (IRN/QR) into the source ERP so the client's own books carry a fiscally valid, government-recognized invoice.

It is proprietary enterprise software for "CittaEFS Systems."

---

## 2. Tech Stack

### Frontend
- **React 19** + **TypeScript** (~5.8)
- **Vite 6** as the build tool
- **Tailwind CSS v4** (via `@tailwindcss/vite`)
- **Framer Motion** (`motion`) for animation
- **lucide-react** for icons
- **xlsx** (SheetJS) for spreadsheet/CSV ingestion
- Native **WebSocket** client for live telemetry, with **SSE** fallback and a hidden-tab-aware polling backup

### Backend
- **Express 4** + TypeScript, run via `tsx` in development
- **Prisma ORM 5.22** targeting **PostgreSQL** exclusively (a stray `prisma/dev.db` SQLite file exists in the repo but is not the configured provider)
- **ws** for the WebSocket server
- **bcryptjs**, **jsonwebtoken**, **cookie-parser** for authentication
- **zod 4** for request/schema validation
- `@google/genai` (Gemini) is a declared dependency with a corresponding `GEMINI_API_KEY` env var, but no confirmed usage was found in routes/services — likely reserved for future use

### Queueing
Dual-mode design:
- **Default**: a custom **DB-backed queue** (`src/queues/invoiceQueue.ts`) using the Prisma `QueueJob` table as the durable source of truth, with an in-memory hot cache and a `setInterval` drain loop every 5s in `server.ts`.
- **Optional, horizontally scalable**: **BullMQ** + **ioredis**, activated automatically when `REDIS_URL` is set. Jobs are mirrored into a BullMQ `Queue`, and `server.ts` starts a matching `Worker` (concurrency via `BULLMQ_CONCURRENCY`, default 5) that delegates to the same job-processing function.

### Build & Deployment
- `npm run build`: `prisma migrate deploy` → `checkNoFallbacks.js` guardrail → `prisma generate` → `vite build` (frontend) → `esbuild` bundle of `server.ts` into `dist/server.cjs`.
- `start.cjs` runs the bundled server.
- **Split-host deployment**: Vercel hosts the static Vite frontend (SPA rewrite only — no API proxy), Render.com hosts the Express backend + managed Postgres. Documented fully in `docs/DEPLOYMENT.md`.
- `docker-compose.yml` provides a local Postgres 16 container for development only.

### Testing
- No Jest/Vitest/Mocha. `npm test` runs `checkNoFallbacks.js` followed by a **1,624-line hand-rolled verification harness** at `src/test/verifyAll.ts`, executed via `tsx`, using a custom `assert()` helper and `nock` for HTTP mocking. Confirmed coverage includes AES-256-GCM encryption (roundtrip, IV uniqueness, tamper detection) and Zod invoice-schema validation (valid parsing, B2C auto-downgrade, B2G acceptance); its size suggests broader coverage of the queue/worker/HS-catalog/QBO/Odoo logic as well.

---

## 3. Data Model (PostgreSQL via Prisma)

Key models in `prisma/schema.prisma`:

| Model | Purpose | Notable fields |
|---|---|---|
| **Tenant** | A client organization | `name`, `TIN`, `marketTier`, `cittaApiKey`/`cittaGatewayUrl`, `cittaWritebackTarget` (`HUB`\|`CITTAEFS`\|`BOTH`, default `BOTH`), `defaultVatRate` (default 7.5), `erpConfig` JSON, `monthlyAllowance`/`monthlyUsed` |
| **TenantErp** | One row per ERP connected to a tenant (multi-ERP support) | `erpId`, `platformType`, `config` JSON, `autoEnqueueQbo`, `status` (`ACTIVE`/`INACTIVE`/`NEEDS_REAUTH`), unique on `[tenantId, platformType]` |
| **Customer** | End customer on an invoice | `taxClassification` (B2B/B2C), `taxId`, `postcode`, `ccEmail`, Nigeria geo codes (`countryCode`/`stateCode`/`localGovernmentCode`) |
| **Item** | Product/service catalog entry | `hsOrServiceCode`, `categoryType` (GOODS/SERVICES via `isService`), `taxCategoryCode`, per-item `defaultVatRate` |
| **Invoice** | Canonical invoice record | `sourceErp`, `qboInvoiceId`/`odooInvoiceId` (immutable source keys), `clientInvoiceId` (business key, unique per tenant), `status` (default `PENDING_NRS_STAMP`), `irn` (unique), `csid`, `qrCodeUrl`, `headerDiscount`/`headerCharges`, `ledgerWritebackStatus` |
| **InvoiceLineItem** | Line items on an invoice | — |
| **ValidationError** | Failed validation records | `category`, `field`, `message`, raw sample, status |
| **AuditLog** | Immutable audit trail | SHA-256 payload hash chain |
| **User** | App user | `role` (`ADMIN`/`INTEGRATION_MANAGER`/`OPERATOR`/`AUDITOR`) |
| **Integration** | OAuth token storage | one row per `[tenantId, sourceSystem]` (e.g. `QUICKBOOKS_ONLINE`) |
| **QueueJob** | DB-backed job queue | `status` (`QUEUED`/`PROCESSING`/`COMPLETED`/`DLQ`), `maxRetries` (default 5), `nextAttemptAt` |

**Migration history** (9 migrations since 2026-07-29) shows iterative hardening: multi-ERP support, nullable tenant on `User`, an `Integration` table, VAT rate defaults, an address→street rename, invoice document numbers, NRS/gateway fields, and — most recently — Odoo invoice IDs (`20260907120000`).

---

## 4. ERP Integrations

### QuickBooks Online (`src/services/qboService.ts`, `src/routes/qbo.ts`)
- OAuth-based, single shared Intuit app (`QBO_CLIENT_ID`/`SECRET`/`REDIRECT_URI`) serving all tenants.
- Access tokens auto-refresh under 5 minutes before expiry.
- **Ingestion**: manual "Sync Now" poll (paginated, `STARTPOSITION`/`MAXRESULTS` 1000/page, or incremental via `MetaData.LastUpdatedTime`) or push via Intuit's CDC webhook (`/api/webhooks/qbo`, HMAC `intuit-signature` verified with `crypto.timingSafeEqual`).
- Deduplicated on `DocNumber`.
- HS/service code inference: 4-tier — existing line code → Item Dictionary lookup → keyword regex → generic fallback.
- **Writeback**: a sparse update of two pre-created QBO Custom Fields (`DefinitionId 1 = IRN`, `2 = QR_CODE_URL`).
- Full endpoint/error reference: `docs/quickbooks-integration.md`.

### Odoo ERP (`src/services/odooService.ts`, `src/routes/odoo.ts`) — added in commit `96ea247`
- Stateless JSON-RPC (`execute_kw`) — auth per call via URL + database + username + API key; no OAuth, no token refresh.
- **Ingestion**: polls `account.move` (`out_invoice`/`out_refund`, `state=posted`), paginated 100/page, incremental via `write_date`.
- Deduplicated on Odoo's `name` field.
- **Writeback**: a chatter note (`message_post`) rather than a custom field — chosen because Odoo instances have no guaranteed custom-field schema.
- Same tiered HS/code inference as QBO, minus the "existing code" tier (Odoo has none natively).
- Full reference: `docs/odoo-integration.md`.

### Excel/CSV (`src/adapters/connectorAdapters.ts` — `CsvAdapter`)
- Drag-drop ingestion via SheetJS, grouped by `clientInvoiceNumber`, with a mandatory preview step (`InvoicePreview.tsx`) before submission.

### CittaEFS Gateway Client (`src/services/cittaEfsClient.ts`)
- As of 2026-08-29, the system moved from a **per-tenant gateway key** model to a **single shared `CITTAEFS_API_KEY`** for all tenants (env var takes priority over the first tenant's DB-stored key; saving the key in the UI propagates it to all tenants). This is a deliberate, documented change — **`README.md`'s "per-tenant" description of this is stale** and should be disregarded in favor of `.env.example`/`src/routes/system.ts`.
- `signAndStampInvoice()`: posts a DTO array to `POST {gateway}/api/integration/gen/invoices` (bulk endpoint, Bearer auth); response shape `{ successCount, failedCount, errors, items: [{ irn, qrCodeUrl, csid }] }`.
- `executeClientLedgerWriteback()`: writes IRN/QR back to the source ERP and/or the CittaEFS gateway, depending on the tenant's `cittaWritebackTarget`.
- `getArchive()`: used by the reconciliation cron to recover invoices stuck mid-flight.

### Webhooks (`src/routes/webhooks.ts`)
- `POST /api/webhooks/cittaefs` (alias `/pay2/einvoicehookweb`): verifies `x-webhook-signature` (HMAC-SHA256, hex or base64) against `CITTAEFS_WEBHOOK_SECRET`; rejects invalid/missing signatures in production, logs-and-continues in dev. Handles `invoice.signed`, `invoice.transmitted`, `validation.failed`, `payment.updated` events.
- `POST /api/webhooks/qbo`: verifies Intuit's HMAC signature, then ingests the specific invoice referenced.

### Extensibility — ERP Registry (`src/config/erpRegistry.ts`)
`ERP_REGISTRY` declaratively maps a `platformType` to `{ id, tabs, configFields, matching }`. SAP (OData + CSRF), NetSuite (TBA/HMAC), and Custom SQL (`vw_pending_invoices` view) are already defined here as `comingSoon: true` placeholders — adding a new ERP is meant to be primarily declarative.

---

## 5. Backend API (Express, `server.ts` mounts 9 routers)

| Router | Responsibilities |
|---|---|
| `auth.ts` | Login/refresh/logout/me; admin-only user list/create. JWT access (8h) + refresh (7d) via httpOnly cookies, bcrypt password hashing. |
| `tenants.ts` | Tenant CRUD, onboarding wizard, per-tenant multi-ERP management (`/erps`), QBO staging-inbox approval, CittaEFS gateway config + test, global system config, ERP field mapping. |
| `invoices.ts` (largest route file) | List/get/update/delete, single & bulk ingestion (`/api/integration/gen/invoices[/bulk]`), cancel, retry (single & bulk), staging summary, queue stats, and an **external Hub API** (`/api/hub/v1/*` — health, list, get-by-number, create) gated by `X-Hub-Api-Key`. |
| `customers.ts` | Customer CRUD. |
| `items.ts` | Item/code mapping CRUD plus a bulk `/auto-map` endpoint. |
| `validation.ts` | List/resolve/bulk-resolve validation errors, audit logs, `/api/metrics`. |
| `qbo.ts` | OAuth connect/callback/status/sync, live connection test, connector status. |
| `odoo.ts` | Connect/status/sync, live connection test. |
| `webhooks.ts` | Inbound CittaEFS and QBO CDC webhooks. |
| `system.ts` | Health check, global CittaEFS config read/test, demo-data purge, catch-all 404. |

**Cross-cutting concerns in `server.ts`** (172 lines, post-refactor): JSON body parsing with raw-body capture (for HMAC verification), security headers (nosniff/DENY/HSTS in prod), a custom sliding-window rate limiter (300 req/min general, 30/min for auth) keyed by IP, a CORS allowlist (`ALLOWED_ORIGINS`/`APP_URL` plus a `*.vercel.app` wildcard), an SSE endpoint (`/api/events`), a global broadcaster that fires on any successful mutating request, a JWT gate on `/api/*` (bearer or cookie, with an allowlist for auth/health/webhooks/events/qbo-callback/connectors/cron), Vite dev middleware vs. static `dist` serving in prod, the 5s queue-drain interval, and an optional BullMQ worker when Redis is configured.

---

## 6. Frontend

### Composition
`App.tsx`: `ToastProvider` → `ToastBridge` → `HubProvider` (global context) → `HubMainContent`. Gates rendering on auth state, enforces `allowedTabs` per role (ADMIN sees the full tab set; other roles see a subset), persists active tab and sidebar-collapsed state to `localStorage`, and force-opens the onboarding modal for a logged-in user with zero tenants.

### Tabs / Pages (`src/components/`)
`OverviewTab`, `InvoicesTab`, `CustomerSyncTab`, `ItemDictionaryTab`, `ValidationErrorsTab`, `ConnectorsTab`, `CsvAndConnectorsTab`, `ImportTab`, `StagingTab`, `SuccessfulTab`, `QueueMonitorTab`, `ReconciliationTab`, `AuditTrailTab`, `AdminTenantsTab`, `SettingsTab`, `WebhookInspectorTab`, `FieldMappingTab`, `QboStagingInbox`.

### Modals
`NewInvoiceModal` (2-step preview → confirm), `NewConnectorModal`, `OnboardClientModal` (multi-step: company → ERP channel selection → connect/sync).

### Shared components
`Navbar` (ERP-grouped, hover-expand sidebar), `LoginScreen`, `InvoicePreview` (shared normalized-totals/HS-badge preview used by both Excel and modal ingestion flows), `ExcelDocumentViewer`, `SystemToEfsExcelMapper`.

### ERP-specific UI (`src/components/erp/`)
`ErpWorkspace.tsx` (per-ERP tab router keyed off the ERP registry's `tabs`), `ErpMappingTab.tsx`, `CittaGatewayTab.tsx`.

### UI primitives (`src/components/ui/`)
`OverlaySelect.tsx` (searchable HS/code picker, needed once the catalog grew past 6,000 entries), `Toast.tsx` (global toast singleton).

---

## 7. State Management & Core Libraries

- **`src/lib/store.tsx`** — a single React Context (`HubProvider`/`useHub`), no Redux/Zustand. Holds all tenants/invoices/customers/items/validation errors/audit logs/metrics plus ~20 action methods (`transmitInvoice`, `retryBulkInvoices`, `onboardTenant`, `addTenantErp`, etc.), all wrapping an authenticated fetch helper.
- **`src/lib/api.ts`** — resolves the API base URL: same-origin in dev, `VITE_API_BASE_URL` if set, otherwise a hardcoded fallback to the Render URL when hosted on `*.vercel.app`. Explicitly avoids routing `/api` through a Vercel rewrite because that would break the WebSocket upgrade.
- **`src/config/encryption.ts`** — AES-256-GCM via `ENCRYPTION_KEY` (32-byte hex) or `ENCRYPTION_SECRET` (scrypt-derived). ⚠️ In production with no key configured, it generates and caches an **ephemeral key for the process lifetime** rather than failing closed — encrypted data will not survive a restart if the operator never sets a real key. Worth treating as an operational/compliance risk.
- **`src/lib/invoiceValidation.ts`**, **`src/lib/gatewaySettings.ts`** — invoice- and gateway-level validation helpers.
- **`src/lib/serverHelpers.ts`** — JWT/auth config, `generateSha256`, `safeAuditLogCreate` (swallows audit-log write failures so they never break the primary flow).
- **`src/lib/logger.ts`** — structured logger with header/body redaction (`sanitizeHeaders`/`sanitizeBody`) and an `anomaly()` level for 4xx/5xx responses.
- **`src/lib/eventBus.ts`** — server-side event broadcaster feeding the WebSocket/SSE live-update channel.

---

## 8. Reference Data / Tax Code Catalogs

Commit `96ea247` (2026-09-08) replaced an **entirely fictional** HS/service code catalog (invented codes the real CittaEFS gateway silently rejected) with the **real CittaEFS/NRS catalog**:

- `src/data/hsCodes.json` — 5,612 numeric HS tariff codes (e.g. `8471.30`)
- `src/data/serviceCodes.json` — 419 four-digit ISIC Rev.4 service codes (e.g. `6209`, `8130`)

Both extracted from CittaEFS's own bulk-upload template.

`src/data/referenceData.ts` exposes:
- `isValidCittaCode()`
- `getCittaCodeType()` — classifies by **set membership** (not string prefix), since both catalogs are bare numeric and otherwise indistinguishable
- `searchCittaCodes()` — backed by a hand-built `SEARCH_ALIASES` map (e.g. laptop → `8471.30`) because official ISIC/customs names don't match how people actually search

`src/data/invoiceTemplateReference.ts` and `src/data/seedData.json` support the Excel gold-template ingestion path and dev seeding respectively.

---

## 9. Background Jobs / Async Pipeline

Two-tier queue design:

- **`src/queues/invoiceQueue.ts`** — class-based, DB-backed (Prisma `QueueJob` as durable store, in-memory array as hot cache). Features idempotency keys, `recoverOrphans()` (re-enqueues `PENDING_NRS_STAMP` invoices missing a queue row, with a 5s skip-window to avoid double-enqueue races), and `recoverStaleProcessingJobs()` (reclaims jobs stuck >120s in `PROCESSING` — explicitly single-instance-only per an in-code comment, since there's no distributed lock).
- When `REDIS_URL` is set, jobs are mirrored into a **BullMQ** queue for horizontal scaling, consumed by a `Worker` in `server.ts`.
- **`src/workers/invoiceWorker.ts`** — `processInvoiceJob()` re-normalizes HS/service codes at send time (a second, independent inference pass against the live Item Dictionary), calls `cittaEfsClient.signAndStampInvoice()`, and on success persists `APPROVED` status + IRN/QR and triggers ledger writeback. On failure: invalid product codes and missing gateway config short-circuit straight to the DLQ plus a `ValidationError` row; transient errors instead retry through an exponential backoff ladder (5s / 30s / 2m / 10m / 30m) before landing in the DLQ.
- **`src/crons/reconciliation.ts`**:
  - `runQbReconciliationCron()` — re-pulls QBO invoices per connected `Integration` and ingests any missing from the DB.
  - `runNrsReconciliationCron()` — polls the CittaEFS gateway's invoice archive per tenant to recover invoices stuck in `PENDING_NRS_STAMP`, flags invoices older than 30 minutes with no gateway trace as orphans, and triggers `invoiceQueue.recoverOrphans()`.

---

## 10. Authentication & Multi-Tenancy

- JWT-based: access token (8h) + refresh token (7d), both as httpOnly cookies with bearer-header support.
- Roles: `ADMIN`, `INTEGRATION_MANAGER`, `OPERATOR`, `AUDITOR` — enforced **server-side per endpoint**, not just hidden in the UI.
- Every domain model carries a `tenantId`; the JWT payload includes `tenantId`.
- `server.ts`'s auth gate falls back to a hardcoded default tenant for unauthenticated GET requests — a permissive-by-default pattern on read paths.
- A tenant can run **multiple ERPs simultaneously** via `TenantErp`, each independently authenticated (OAuth or API key) and independently toggleable (e.g. `autoEnqueueQbo`).

---

## 11. Validation Rules (`src/schemas/invoice.schema.ts`, Zod)

Notable business rules encoded directly in the schema:

1. `clientInvoiceNumber` must match `^[A-Z0-9]+$` (uppercase letters and digits only).
2. A B2B/B2G invoice automatically downgrades to **B2C** if `customerTin` is blank.
3. A TIN is forcibly stripped from any B2C invoice, even if one was submitted, to preserve the B2B/B2C classification signal.
4. Line totals are computed server-side (`qty × price − discount`; VAT = `taxable × rate / 100`), but a source-provided `taxableAmount`/`vatAmount` is honored if within a 0.06 tolerance of the computed value, to absorb rounding differences against the NRS gateway.
5. `invoiceTypeCode` (`380`/`381`/`384`/`388`/`389`/`390`/`392`/`393`) maps to `invoiceType`; `380`/`393` → `CREDIT_NOTE`, `384` → `DEBIT_NOTE`.
6. Missing or `UNMAPPED` HS codes default to `SERV-DEFAULT` at the schema layer; a second, stricter gate later blocks genuinely unrecognized codes at worker time via `isValidCittaCode`.
7. A SHA-256 hash of a payload summary is computed here for audit-log linkage.

---

## 12. Scripts

- **`scripts/checkNoFallbacks.js`** — a static guardrail run before every test/build. Walks all `src/**/*.{ts,tsx}` and `server.ts`, case-insensitively flags `fallback|demo data|demo mode|sample data|mock|dummy|placeholder` (excluding literal JSX `placeholder="..."` attributes), and fails if any unauthorized match is found outside a two-file allowlist (`src/test/verifyAll.ts`, `src/data/referenceData.ts`). This is a strict anti-mock-data policy — appropriate given that this is fiscal/tax compliance software where silent fallback to fake data would be a serious defect.
- **`scripts/create-admin.cjs`** — CLI to seed/reset the default admin user from `DEFAULT_ADMIN_*` env vars.
- **`prisma/seed.ts`** — seeds an ADMIN user and sample tenant(s) via `npm run seed`.

---

## 13. Environment Variables (keys only — see `.env.example`)

| Category | Variables |
|---|---|
| Core | `NODE_ENV`, `PORT`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` (or `ENCRYPTION_SECRET`), `DATABASE_URL`, `APP_URL` |
| AI (reserved) | `GEMINI_API_KEY` |
| CittaEFS Gateway | `CITTAEFS_API_KEY`, `CITTAEFS_GATEWAY_URL`, `CITTA_WEBHOOK_URL`, `CITTAEFS_WEBHOOK_URL`, `CITTAEFS_WEBHOOK_SECRET` (alt names `CITTA_EFS_API_KEY`/`CITTA_GATEWAY_URL` also referenced in code) |
| QuickBooks Online | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`, `QBO_WEBHOOK_VERIFIER` |
| Admin seed | `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD`, `DEFAULT_ADMIN_NAME`, `DEFAULT_ADMIN_ORG` (commented: `DEFAULT_OPERATOR_*`) |
| Queue (optional) | `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `BULLMQ_CONCURRENCY`, `BULLMQ_LIMIT_MAX` |
| Frontend / CORS | `ALLOWED_ORIGINS`, `VITE_API_BASE_URL` |
| Logging | `LOG_VERBOSE`, `LOG_LEVEL` |
| Legacy (unused, commented out) | `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD` (old Google Cloud SQL config) |

---

## 14. Development Trajectory (recent history)

Very high commit frequency on a single trunk-based branch (`feat/odoo-erp-integration`, off `main`), commit messages self-versioned up to **v2.29**. Major arcs, newest first:

1. **Channel integration retry** (`7890daf`, latest) — touches onboarding/connectors.
2. **VAT bug fix** (`963d035`) — across adapters, queue, and worker.
3. **Odoo adapter + real HS/code catalog swap** (`96ea247`) — the pivotal recent change: 40 files, +27.7k/-932 lines, mostly the two new JSON code catalogs. This fixed invoices being silently rejected by the live gateway due to previously invented HS/service codes.
4. A long tail of UI/UX iteration (v2.8–v2.29): repeated rewrites of sidebar hover behavior, mobile-first card layouts for Invoices/Customers/Items, a dedicated "Staging" module distinct from post-failure "Validation," explicit exponential-backoff retry UI (single + bulk), a "Successful" tab, and unification of HS/service code handling across Validation/Invoice-edit/QBO paths.
5. An earlier structural refactor (`6ef7b42`, `d336ebe`) that split a former `server.ts` monolith into the current 9 route modules plus shared `auth`/`prisma`/`eventBus`/`serverHelpers` libraries.

**Known documentation inconsistency**: `README.md`'s "CittaEFS Gateway Credentials & Writeback (Per-Tenant)" section describes a per-tenant gateway key model that predates the 2026-08-29 change to a single shared API key (env var > first-tenant DB row, propagated to all tenants on save). Treat `.env.example` and `src/routes/system.ts` as the source of truth over the README for this topic until the README is updated.

---

## 15. Known Risks / Follow-ups Worth Tracking

- **Encryption key fallback**: production deployments without `ENCRYPTION_KEY`/`ENCRYPTION_SECRET` set will generate an ephemeral key per process, silently losing access to encrypted data on restart (`src/config/encryption.ts`).
- **Single-instance assumption**: `recoverStaleProcessingJobs()` in the DB-backed queue has no distributed lock and is documented as single-instance-only — a concern if the backend is ever scaled horizontally without Redis/BullMQ.
- **README drift**: the CittaEFS gateway credential model described in `README.md` is out of date relative to the actual single-shared-key implementation.
- **Git author inconsistency**: some commits are attributed to a placeholder `Your Name <you@example.com>` identity rather than the primary contributor, suggesting local git config gaps during part of the v2.x work.
