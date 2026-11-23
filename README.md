# CittaEFS ERP Gateway — QuickBooks & Odoo to NRS E-Invoicing

![CI](https://github.com/knight-dev01/CittaEFS-Multi-Client-Integration-HUb/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React_19-20232A?style=flat&logo=react&logoColor=61DAFB)
![Express](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma_ORM-2D3748?style=flat&logo=prisma&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)

An **internal** gateway that pulls invoices from client ERPs (QuickBooks Online, Odoo), normalises and validates them, submits them to the **CittaEFS gateway** for NRS (FIRS) stamping, and writes the IRN and QR code back to the source ERP.

The hub is a thin pipe, not a system of record:

* **Internal-only.** Only our own team logs in (`ADMIN`, `OPERATOR`). Client companies never see the hub.
* **The ERP owns the data.** Invoices, customers and items are read-only snapshots. Fixes happen in the ERP and come back through a sync or webhook. Hub edits return `403`.
* **CittaEFS owns registration.** CittaEFS has no API for registering customers or items. The hub only keeps a reference (`EntityMapping`) once a customer is registered in CittaEFS. See [`docs/CittaHub_Revision_Plan.md`](docs/CittaHub_Revision_Plan.md).
* **One CittaEFS key for every workspace.** All workspaces share a single gateway key, see [CittaEFS gateway key](#cittaefs-gateway-key).

---

## Architecture

```
  QuickBooks Online                 Odoo
  OAuth2 + webhook + 60s poll       JSON-RPC API key + 1s poll  
            \                         /
             v                       v
  +-----------------------------------------------------------+
  |  CittaEFS ERP Gateway (Express + Vite, Postgres/Prisma)   |
  |                                                           |
  |  1 Ingest      ERP adapters -> read-only Invoice snapshot |
  |  2 Normalise   invoice no. A-Z/0-9, TIN, HS/service code, |
  |                VAT 7.5%, currency, credit notes           |
  |  3 Validate    B2B TIN, codes, invoice type, totals       |
  |    Gate        B2B/B2G buyer registered in CittaEFS?      |
  |                no -> NEEDS_EFS_REGISTRATION               |
  |  4 Submit      queue (DB or BullMQ), 5 retries -> DLQ     |
  +-----------------------------------------------------------+
             |                                   ^
             v  POST gen/invoices                | webhook / 5m archive poll
  +-----------------------------------------------------------+
  |  CittaEFS gateway  ->  NRS: IRN, CSID, QR code            |
  +-----------------------------------------------------------+
             |
             v
  ERP writeback: IRN + QR (QBO custom fields + QR attachment,
  Odoo chatter); rejections posted back to the ERP; feedback
  emails to the ERP company contact
```

### Pipeline

1. **Ingest.** QuickBooks: OAuth2 connect, a webhook at `POST /api/webhooks/qbo` (HMAC `intuit-signature`), plus a 60-second `LastUpdatedTime` poll. Odoo: JSON-RPC with an API key, polled every second (`ODOO_POLL_INTERVAL_MS`) on `write_date`, using Odoo's own clock as the cursor. New invoices go to the worker immediately. Adapters are in `src/adapters/connectorAdapters.ts`, `src/services/qboService.ts` and `src/services/odooService.ts`. QuickBooks credit memos sync as credit notes.
2. **Normalise.** The ERP's own invoice number is kept everywhere (UI, writeback, emails). CittaEFS only accepts `A-Z0-9`, so it receives a stripped form (`INV-1001` becomes `INV1001`), and the original goes as `documentNumber` (`src/lib/efsInvoiceNumber.ts`). HS and service codes are sent bare (`8471.30`, not `HS-8471.30`). There is no keyword guessing of HS codes: a line without a mapped code is a validation error.
3. **Validate and gate.** B2B buyers need a 10–14 digit TIN, VAT is 7.5%, invoice-type rules apply. Before submission, B2B/B2G invoices whose customer has no `MAPPED` `EntityMapping` are parked as `NEEDS_EFS_REGISTRATION`. They are requeued automatically once the customer is confirmed registered (`/api/entity-mappings`, `src/services/entityMappingService.ts`).
4. **Submit.** `src/queues/invoiceQueue.ts` with a 5-second worker (`src/workers/invoiceWorker.ts`). There are 5 retries with backoff `[5s, 30s, 2m, 10m, 30m]`, then the invoice goes to the DLQ and is marked `REJECTED`. A gateway **4xx** is terminal and goes straight to `REJECTED` with the gateway's message. Only 5xx, 408 and 429 are retried. The queue is persisted in `QueueJob` and recovered after a restart. BullMQ is used when `REDIS_URL` is set.
5. **Verify and write back.** Invoices stay `PENDING_NRS_STAMP` until CittaEFS confirms, either by webhook (`/api/webhooks/cittaefs`) or by the 5-minute archive poll. Then they become `APPROVED`/`SIGNED` with `irn`, `csid` and `qrCodeUrl`, and are written back:
   * **QuickBooks:** sparse update of the IRN / QR custom fields (30-character cap), addressed by QBO `Id`, plus the QR image as an attachment.
   * **Odoo:** `message_post` to the invoice chatter, deduplicated.
   * **Rejections** are posted back to the ERP (QBO memo / Odoo chatter) with an "Open in ERP" deep link in the hub.
6. **Feedback emails.** One packaged email per workspace goes to the ERP's company email, or to the Settings override. Errors go out every 2 minutes and approvals hourly (`src/crons/errorDigest.ts`). Mail is sent over SMTP, or over Brevo's HTTPS API when `BREVO_API_KEY` is set (Render blocks outbound SMTP).

### CittaEFS pre-flight (normalisation)

Before any invoice is sent, `src/lib/efsPreflight.ts` checks it against the CittaEFS API guide (`docs/CittaEFS_API_Documentation.pdf`) and CittaEFS's own configured code lists (`GET /api/resources/*`, loaded by `src/services/efsResources.ts`, with the bundled lists used when CittaEFS is unreachable). It is deterministic and needs no AI model.

* **Fixed automatically and logged** as `EFS_PREFLIGHT_NORMALISED` in the audit log: A-Z/0-9 invoice number (the original kept as `documentNumber`), `YYYY-MM-DD` dates (day-first slashes, "28 Jul 2026"), ISO currency (₦ → NGN), money parsed from text and rounded to 2 decimals, taxable = qty × price − discount and tax = taxable × rate when they differ only by rounding, invoice type / tax category / unit code / line numbers, cleaned text.
* **Held with a specific error** instead of a gateway rejection: a credit/debit note without the original IRN, a self-billed invoice without a real TIN, zero quantity or price, future or impossible dates, amounts that do not add up, codes or types CittaEFS has not configured. These become `EFS_FORMAT`, `TAX_MISMATCH` or `INVALID_DATE` validation errors, are written back to the ERP and included in the feedback email.

### Code intelligence (HS / service codes)

1. **Memory, applied automatically:** the code confirmed for the same SKU, or for an item with the same normalised description (only when all such confirmations agree) — `src/lib/codeMemory.ts`.
2. **Local search:** BM25 over CittaEFS's code list plus confirmed history, with everyday-wording synonyms (`src/lib/codeRetrieval.ts`). No network.
3. **AI ranking (optional):** `src/services/aiCodeRanker.ts` re-ranks the local candidates and gives a confidence and reason. It may only pick codes the search returned. Gemini is the default when `GEMINI_API_KEY` is set; Claude only with `AI_PROVIDER=anthropic`; `AI_PROVIDER=none` turns it off. If the model fails or is not configured, local suggestions are used.

Suggestions are computed in the background every minute for each open `MISSING_HS_CODE` error (`src/services/codeIntelligence.ts`, stored in `CodeSuggestion`). On the Validation tab the operator clicks one; it is saved to the Item dictionary with the item's real description, and the invoice is re-queued. A new code is always a human decision; after that the same item is classified automatically.

### Connectivity and uptime

Every 60 seconds (`ERP_HEALTH_INTERVAL_MS`) the hub probes:

* each live ERP connection: QuickBooks `companyinfo`, or an authenticated Odoo `res.company` read. Connections without a `CONNECTED` integration are skipped, not marked down.
* the CittaEFS gateway: an authenticated read-only archive query for today.

Each probe is stored in `ConnectivityProbe` (kept for 30 days). The Connections tab's **Test** button records a probe too. `GET /api/metrics/uptime?tenantId=&hours=24|168` returns uptime %, current state, average latency and a per-hour history for each target. The **Overview** tab shows this as a live card that refreshes when a probe round finishes.

Only auth-class failures move a connection to `NEEDS_REAUTH`. Timeouts and 5xx keep the status and record the error (`src/services/erpHealthService.ts`).

### Developer API and docs

Public documentation, no login: **`/docs`** (`src/components/ApiDocsPage.tsx`). It covers authentication (`X-Hub-Api-Key`), `POST /api/hub/v1/invoices`, status polling, normalisation, codes, signed webhooks (`invoice.authorized` / `invoice.rejected`) and errors. API submissions get the same invoice-number and date normalisation as ERP invoices.

---

## Dashboard

Rendered by `src/components/erp/ErpWorkspace.tsx`:

| Tab | What it does |
| :--- | :--- |
| **Overview** | Invoices processed, stamp success rate, queue latency, open validation errors, **connectivity uptime** for each ERP and for CittaEFS, 30-day approved-stamp chart, per-ERP totals, sync lag per connection. |
| **Connections** | QuickBooks OAuth connect / sync / sandbox–production switch, Odoo connect form, per-connection **Test**, tax and product mapping, recent gateway runs. The planned ERPs (Xero, Zoho Books, Sage, Tally Prime, SAP B1, Custom) are shown as *Not yet integrated*. |
| **Invoices** | Status, IRN, QR and writeback state, line-item drill-down, per-invoice and bulk **Retry** for `REJECTED`/`FAILED`, and the EFS bulk-upload export as CSV, Excel or JSON (`GET /api/invoices/export`). |
| **Validation** | Suggested HS / service codes (one click to confirm), inline fixes for `MISSING_HS_CODE`, `INVALID_TIN_FORMAT` and `MISSING_B2B_TIN` re-queue the invoice. Other categories can only be dismissed. Gateway errors show a plain-English summary with the raw reply behind *Technical detail*. |
| **Directories** | Read-only, searchable customer and item lists. |
| **Settings** | Workspace name, TIN, default VAT rate, notification email, the shared CittaEFS key, URL and writeback target. |
| **Audit log** | Tenant-scoped, filterable, with SHA-256 payload hashes. `rawJson` is never returned. |

Confirmations use the app's own dialog (`src/components/ui/ConfirmDialog.tsx`) and errors use toasts. Native browser `alert` / `confirm` / `prompt` are not used.

---

## CittaEFS gateway key

There is one key for all workspaces (`src/services/cittaEfsClient.ts`). It is resolved in this order:

1. `CITTAEFS_API_KEY` (or `CITTA_EFS_API_KEY`) environment variable
2. the workspace's own `Tenant.cittaApiKey`
3. the first workspace that has a key set

If none of these exist, submission fails with a clear error. The gateway URL comes from `CITTAEFS_GATEWAY_URL`, otherwise the workspace setting, otherwise `https://ei-api.azurewebsites.net`. Only `cittaWritebackTarget` (`HUB` | `CITTAEFS` | `BOTH`) is per workspace.

> `docs/COMPLIANCE_AUDIT_SECTION_E.md` still describes per-tenant keys as the fix from 2026-08-26. That changed on 2026-08-29: the shared key above is the current behaviour.

---

## Getting started

Requires Node.js 18+ and PostgreSQL.

```bash
npm install
cp .env.example .env        # fill in the values below
npx prisma migrate deploy
npm run seed                # admin user from DEFAULT_ADMIN_*
npm run dev                 # http://localhost:3000 (Express + Vite)
```

### Environment

| Variable | Purpose |
| :--- | :--- |
| `AI_PROVIDER` *(optional)* | `gemini` (default when a Gemini key is set), `anthropic`, or `none` |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `GEMINI_MODEL` *(optional)* | Gemini ranking of code suggestions (default model `gemini-3.5-flash`) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` *(optional)* | Claude ranking, only with `AI_PROVIDER=anthropic` (default model `claude-opus-5-5`) |
| `CODE_SUGGESTION_INTERVAL_MS` *(optional, default 60000)* | Background suggestion sweep |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Session tokens |
| `ENCRYPTION_KEY` | AES-256-GCM for stored ERP credentials |
| `CITTAEFS_API_KEY`, `CITTAEFS_GATEWAY_URL` | Shared CittaEFS gateway key and URL |
| `CITTAEFS_WEBHOOK_URL`, `CITTAEFS_WEBHOOK_SECRET` | CittaEFS webhook registration and HMAC check |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT` | QuickBooks OAuth app |
| `QBO_WEBHOOK_VERIFIER` | Intuit webhook signature token |
| `APP_URL`, `ALLOWED_ORIGINS` | Public URL and extra CORS origins (e.g. the Vercel frontend) |
| `BREVO_API_KEY` *or* `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`, plus `MAIL_FROM` | Feedback email transport |
| `REDIS_URL` *(optional)* | Use BullMQ instead of the DB-backed queue |
| `ERP_HEALTH_INTERVAL_MS` *(optional, default 60000)* | Connectivity probe interval |
| `ODOO_POLL_INTERVAL_MS` *(optional, default 1000)* | How often each connected Odoo is checked for new posted invoices |
| `ERROR_DIGEST_INTERVAL_MS`, `APPROVAL_DIGEST_INTERVAL_MS` *(optional)* | Feedback email cadence (default 2 min / 1 h) |
| `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD`, `DEFAULT_ADMIN_NAME`, `DEFAULT_ADMIN_ORG` | Seeded admin |

---

## Tests and CI

```bash
npm run lint                     # tsc --noEmit
node scripts/checkNoFallbacks.js # guardrail, see below
npm run test:unit                # vitest unit suites (src/test/unit)
npm test                         # guardrail + full audit (src/test/verifyAll.ts, needs a database)
```

**Guardrail:** `scripts/checkNoFallbacks.js` fails the build if `src/` contains runtime fallback / placeholder / mock / dummy data patterns. Keep those words out of `src/`, including comments.

Unit suites cover reference-data normalisation, the invoice schema, ERP adapters, the immutability rules, gateway error summaries, the CittaEFS response parser, invoice-number conversion, QBO credit memos, EFS export, feedback emails and connectivity uptime. `gatewayV1.test.ts` and `verifyAll.ts` need `DATABASE_URL`.

GitHub Actions (`.github/workflows/ci.yml`, on push to `main` and on PRs): lint and guardrail, then unit tests with coverage, then a Postgres 16 service running `verifyAll` and the gateway suites, then the production build. `.github/workflows/test.yml` runs any suite on demand.

---

## Production (Render)

* **Build:** `npm run build` runs migrations (continuing on advisory-lock timeout), the guardrail, `prisma generate`, `vite build` and the esbuild server bundle.
* **Start:** `npm start` (`node start.cjs` loads `dist/server.cjs`).
* **Intuit portal:** webhook URL `https://<hub>/api/webhooks/qbo`.
* **CittaEFS webhook:** `https://<hub>/api/webhooks/cittaefs`.
* The frontend may be deployed separately on Vercel. Add its origin to `ALLOWED_ORIGINS`.

---

## Repository layout

```
prisma/schema.prisma          Tenant, TenantErp, Integration, Invoice, EntityMapping,
                              QueueJob, ValidationError, AuditLog, ConnectivityProbe, ...
                              (Customer / Item are deprecated, pending removal)
server.ts                     Express, WS/SSE, worker and cron schedule
src/adapters/                 QuickBooks and Odoo adapters
src/components/               React UI (erp/ErpWorkspace.tsx is the tab router)
src/components/ui/            Button, Card, Toast, ConfirmDialog, ...
src/config/erpRegistry.ts     Live and planned ERPs
src/crons/                    reconciliation, erpHealth (connectivity), errorDigest
src/lib/                      efsExport, efsInvoiceNumber, gatewayErrors, uptimeSummary, ...
src/queues/, src/workers/     Submission queue and worker
src/routes/                   REST API
src/services/                 cittaEfsClient, qboService, odooService, erpHealthService,
                              connectivityService, entityMappingService, mailer
docs/                         Revision plan, compliance audit, ERP adapter notes
scripts/                      Build helpers and maintenance scripts
```

---

## Open items

From `docs/CittaHub_Revision_Plan.md`, these need ops or team-lead input:

* Back up the staging and prod databases before the next migration.
* Confirm who handles CittaEFS customer registration.
* Run the migrations against a copy of prod and check for orphaned records.
* Test the full ERP → CittaEFS → writeback loop end to end on staging.
* Roll out to prod, keep the old `Customer`/`Item` tables for one release, then drop them.

---

## License

Proprietary. All rights reserved, CittaEFS Systems.
