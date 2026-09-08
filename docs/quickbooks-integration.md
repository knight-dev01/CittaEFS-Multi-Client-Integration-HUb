# QuickBooks Online Integration

How the Hub authorizes access to a client's QuickBooks Online company via OAuth2, pulls invoices (by poll and by real‑time webhook), maps them onto CittaEFS's invoice model, routes them through validation and NRS stamping, and writes the resulting IRN back to QuickBooks — and what an operator actually does to run it.

`OAuth2 · REST (v3/company)` · `Auto-refreshing tokens` · `Poll sync + Intuit CDC webhook` · `Writeback via sparse Custom Fields`

## Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Invoice lifecycle](#invoice-lifecycle)
- [Field mapping](#field-mapping)
- [HS / service code rules](#hs--service-code-rules)
- [Connecting QuickBooks](#connecting-quickbooks)
- [Day-to-day use](#day-to-day-use)
- [Roles & permissions](#roles--permissions)
- [Troubleshooting](#troubleshooting)
- [API reference](#api-reference)

## Overview

QuickBooks Online is the Hub's primary ERP adapter and the only one backed by a central OAuth app — one Intuit app registration (`QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`) serves every tenant, and each client individually authorizes the Hub against their own company (realm) through Intuit's consent screen. That's the opposite shape from the [Odoo integration](./odoo-integration.md), where every client supplies their own static API key.

> **In one sentence:** The Hub authorizes against a client's QuickBooks company over OAuth2, pulls invoices either on a schedule or the moment Intuit's CDC webhook says one changed, converts each into a CittaEFS invoice, and — once it's been stamped by the CittaEFS Gateway — sparse‑updates two custom fields on the original QuickBooks invoice with the IRN and QR code.

## Architecture

```
Client's QuickBooks         CittaEFS Hub                   CittaEFS Gateway
Online company      ──────▶ qboService.ts        ──────▶  NRS stamping
/v3/company/{realm}   pull  validate · map codes   valid    returns IRN + QR
OAuth2, auto-refreshed      upsert master data     &queued
access/refresh tokens       Postgres: Invoice,
                             Integration
      ▲                                                        │
      └── sparse update: CustomField 1 = IRN, CustomField 2 ◀───┘
                          = QR_CODE_URL
```

Unlike Odoo's stateless per-call auth, QuickBooks issues a short-lived **access token** plus a longer-lived **refresh token** at connect time. `getValidQboAccessToken()` checks expiry on every call and silently exchanges the refresh token for a new pair when fewer than 5 minutes remain — callers never see a raw expired-token error, only a `reauthorization` error if the refresh token itself has been revoked or expired.

A second, independent path feeds the same pipeline: Intuit can push a **Change Data Capture (CDC) webhook** the moment an invoice is created or updated in the client's company, so a new invoice can reach the Hub within seconds instead of waiting for the next scheduled sync.

## Invoice lifecycle

What happens to one invoice, from being saved in QuickBooks to landing back there with a stamp.

1. **Saved in QuickBooks** — Any `Invoice` object is eligible; `TxnType: CreditMemo` is treated as a credit note, everything else as standard.
2. **Reaches the Hub one of two ways**
   - **Poll** — `Sync Now` runs `SELECT * FROM Invoice` against the QBO API, paginated 1,000 records at a time on the first run, or filtered to `MetaData.LastUpdatedTime >` the last sync on later runs.
   - **Push** — Intuit's CDC webhook posts to `/api/webhooks/qbo` on Create/Update; the Hub fetches that one invoice by id and ingests it immediately.
3. **Deduplicated** — Matched by QuickBooks' `DocNumber` against `clientInvoiceId` for the tenant (falling back to a legacy match on the internal numeric `Id` for older rows). An invoice already on file is skipped, backfilling `qboInvoiceId`/`documentNumber` if either was missing.
4. **Validated & transformed** — Rejected if the invoice has no `DocNumber` or no `CustomerRef`. Otherwise mapped into the CittaEFS shape — see [Field mapping](#field-mapping) — and every line's HS/service code is checked against the reference list.
5. **Master data upserted** — First sighting of a customer or SKU auto-creates a Customer / Item record so later invoices resolve VAT rate and code from the Item Dictionary instead of the raw guess.
6. **Routed** — If the tenant's *auto-enqueue* setting is on, the invoice goes straight to the signing queue. Otherwise it lands in the Import tab's preview inbox as `PENDING_NRS_STAMP` for an operator to review.
7. **Stamped by the Gateway** — CittaEFS returns an IRN and a QR code URL for the invoice.
8. **Written back to QuickBooks** — `writebackToQbo()` re-fetches the invoice for its current `SyncToken`, then issues a **sparse update** setting two Custom Fields — `DefinitionId 1` (`IRN`) and `DefinitionId 2` (`QR_CODE_URL`) — and the Hub's copy is marked `ledgerWritebackStatus: SYNCED`.

> **Why a sparse update, and why those two fields specifically:** QuickBooks requires a `SyncToken` on every write to prevent clobbering concurrent edits, so the writeback always re-reads it first. Unlike Odoo (which has a universal message log), the IRN/QR values are written into **Custom Fields that must already exist** on the client's company — see the setup note under [Connecting QuickBooks](#connecting-quickbooks).

## Field mapping

How a raw QuickBooks `Invoice` object becomes a CittaEFS invoice.

| QuickBooks field | CittaEFS field | Notes |
|---|---|---|
| `DocNumber` | `clientInvoiceId` / `documentNumber` | Business key — every sync's dedup check runs against this. |
| `Id` | `qboInvoiceId` | Internal numeric id, preserved for lookups and the writeback's `SyncToken` refetch. |
| `CustomerRef.value` | `customerCode` | Synthesized as `CUST{value}` unless already `CUST`-prefixed. |
| `CustomerRef.name` | `customerName` | — |
| `CustomerTaxId` | `customerTin` | Presence classifies the invoice B2B; absence → B2C. |
| `TxnDate` | `issueDate` | — |
| `TxnType = CreditMemo` | `invoiceType` | → `CREDIT_NOTE`, otherwise `STANDARD`. |
| `Line[].SalesItemLineDetail.ItemRef.name` | `clientSku` | Only lines with `DetailType: SalesItemLineDetail` are used. |
| `Line[].Description` | `description` | — |
| `SalesItemLineDetail.Qty` / `UnitPrice` | `quantity` / `unitPrice` | — |
| `LineDiscount` | `discountAmount` | Subtracted before VAT is calculated. |
| — | `currency` | Always stored as `NGN` — QuickBooks' own `CurrencyRef` is not read. |

## HS / service code rules

QuickBooks has no field equivalent to an HS or service code either, so the same keyword-based guess applies — with one extra layer, since a QBO line can already carry a code from a prior partial mapping.

1. **A specific code already on the line wins** — If the incoming line's `hsOrServiceCode` isn't one of the generic placeholders (`UNMAPPED`, `SERV-DEFAULT`, `HS-8471.30`), it's used as-is.
2. **Otherwise, the Item Dictionary mapping wins** — If the SKU has a specific (non-generic) code on file from a prior sync, that's used next.
3. **Otherwise, keyword inference** — SKU + description are scanned for `gardening, sod, rocks, fountain, pump, sprinkler, design, service, labor/labour, installation, maintenance, repair`, or a SKU prefixed `SRV` → `SRV-7212.10`; `laptop, computer, router, switch, server` → `HS-8471.30`; everything else also falls back to `HS-8471.30`.
4. **Checked against the reference list** — Every line's final code must appear in CittaEFS's HS/service reference list. An unrecognized code raises a `MISSING_HS_CODE` validation error and blocks the whole invoice from ingesting.

> **This is a starting guess, not a classification.** For a client with real product variety, map SKUs to their correct HS/service codes in the Item Dictionary early — every future invoice for that SKU then skips the guess entirely.

## Connecting QuickBooks

Unlike Odoo, there's nothing for an operator to type in per client — the whole flow is an OAuth popup. There is, however, one piece of one-time setup on the platform side and one piece on the client's QuickBooks company.

### One-time platform setup

The Hub needs a single Intuit app registration shared by every tenant:

- `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` — from the Intuit Developer app
- `QBO_REDIRECT_URI` — must exactly match the redirect URI configured in that Intuit app
- `QBO_ENVIRONMENT` — `sandbox` or `production`

If any of these are missing, the connect flow fails immediately with a clear error rather than silently misbehaving.

### What the client needs to do first

**Enable two Custom Fields** on their QuickBooks company (Sales forms → Custom Fields): one named `IRN`, one named `QR_CODE_URL`, matching `DefinitionId` 1 and 2. Without these, invoices will sync and stamp normally, but the writeback step will fail — see [Troubleshooting](#troubleshooting).

### Connecting — new client or existing tenant

1. **Click "Connect QuickBooks Online"** — from the Onboard Client wizard's step 2, or the Connectors tab if adding/reconnecting QuickBooks on an existing tenant.
2. **A popup opens Intuit's consent screen** — the client logs into QuickBooks, picks the company (realm) to authorize, and approves the `com.intuit.quickbooks.accounting` scope.
3. **The popup closes itself and hands control back** — the callback exchanges the authorization code for tokens, stores them encrypted, and marks the tenant's integration `CONNECTED` with the realm id. The original tab picks this up via a postMessage/localStorage bridge (with a status‑polling fallback if the popup's message doesn't arrive) and closes the popup automatically.
4. **The first sync runs automatically** — pulling every invoice and reporting totals: found, newly ingested, already on file.

## Day-to-day use

### Reading the status card

The Connectors tab's QuickBooks card shows:

| Status | Meaning |
|---|---|
| `CONNECTED` | Tokens on file and valid (or successfully auto-refreshed on last use). |
| `DISCONNECTED` | Refresh token expired, was revoked in Intuit, or decryption failed — needs reconnecting. |
| `NOT_CONNECTED` | No QuickBooks integration has ever been set up for this tenant. |

It also shows the connected company (realm) id and a "last synced" timestamp.

### Sync Now

Runs a full historical pull (`STARTPOSITION`/`MAXRESULTS` paginated, 1,000 per page) on the very first run, or an incremental pull filtered to invoices updated since the last sync afterward. Reports how many invoices were found, how many were new, and how many were already on file. Safe to click repeatedly — dedup makes every sync idempotent.

### Real-time updates (webhook)

Once Intuit's app is configured to send Change Data Capture notifications for Invoice create/update, new or edited invoices arrive at `/api/webhooks/qbo` and are ingested individually within moments — no manual sync needed, though `Sync Now` remains available as a catch-all.

### Test (Live)

A lightweight connectivity check — reads the connected company's name and country from QuickBooks and reports round-trip latency. Doesn't touch invoice data; use it to confirm the connection is healthy without running a full sync.

### Reviewing pulled invoices

Where a synced invoice lands depends on the tenant's **auto-enqueue** setting (Admin → tenant's ERP settings):

- **Off (default)** — invoices sit in the Import tab's preview inbox as `PENDING_NRS_STAMP` until an operator reviews and sends them on.
- **On** — valid invoices are queued for NRS stamping automatically, with no manual step.

An invoice with an unrecognized HS/service code never reaches either queue — it's logged as an open validation error instead. Fix the SKU's mapping in the Item Dictionary (Items tab) or correct the code directly in the Validation tab, then re-sync or retry.

### Confirming the writeback

Once an invoice is stamped, open the corresponding invoice in QuickBooks and check its **IRN** and **QR_CODE_URL** custom fields — populated values confirm the round trip completed.

## Roles & permissions

Enforced server-side on every QuickBooks endpoint, not just hidden in the UI.

| Action | Allowed roles |
|---|---|
| Connect / reconnect (start OAuth) | `ADMIN`, `INTEGRATION_MANAGER` |
| Run a sync | `ADMIN`, `INTEGRATION_MANAGER`, `OPERATOR` — non-admins are restricted to their own tenant |
| View status / test connection | Any authenticated user with access to the tenant |
| OAuth callback / CDC webhook | Not user-gated — verified instead by Intuit's signed `state` JWT (callback) or `intuit-signature` HMAC (webhook) |

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| "QBO_CLIENT_ID and QBO_REDIRECT_URI environment variables are required" | Platform-level Intuit app isn't configured. | Set `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` on the server — this is an ops task, not per-client. |
| "Invalid or expired state parameter" | The signed OAuth `state` token (15-minute expiry) expired or was tampered with. | Restart the connect flow from the Hub — don't reuse an old popup link. |
| "QBO OAuth token exchange failed" | Intuit rejected the authorization code — reused, expired, or the redirect URI doesn't exactly match the Intuit app config. | Restart the connect flow; verify `QBO_REDIRECT_URI` matches the Intuit app's registered redirect URI exactly. |
| "QuickBooks connection needs reauthorization" (sync/refresh returns 401/400) | The refresh token was revoked in Intuit, or expired from prolonged inactivity. | Reconnect via the OAuth popup again. |
| "Could not reach QuickBooks, please try again" | Transient network or API error during a sync call. | Retry; check Intuit status if it persists. |
| "QBO Ledger Writeback sparse update failed" | The client's company is missing the `IRN` / `QR_CODE_URL` Custom Fields (Definition Id 1 / 2), or the `SyncToken` was stale from a concurrent edit. | Have the client add both Custom Fields under Sales form settings; retry the writeback. |
| "Invalid Product Code — must be valid HS Code or Service Code (found …)" | Neither the line's own code, the Item Dictionary mapping, nor the keyword guess resolved to a code CittaEFS recognizes. | Map the SKU to a valid code in the Item Dictionary, then retry the invoice. |
| "No invoice data provided — … has no SalesItemLineDetail lines" | The invoice has no lines of the expected detail type (e.g. only discount/subtotal lines). | Check the invoice in QuickBooks has at least one real sales item line. |
| "Invalid intuit-signature" on `/api/webhooks/qbo` | The webhook payload's HMAC doesn't match `QBO_WEBHOOK_VERIFIER` (falls back to `QBO_CLIENT_SECRET` if unset). | Confirm the verifier token configured in the Intuit app's webhook settings matches the server's env var. |

## API reference

For anyone scripting against the Hub directly rather than using the UI.

| Endpoint | Purpose | Body / query |
|---|---|---|
| `GET /api/integrations/qbo/connect` | Start OAuth — redirects to Intuit, or returns `{ url }` if called with `Accept: application/json`. | `?tenantId=` |
| `GET /api/integrations/qbo/callback` | OAuth redirect target — not called directly. | `code, state, realmId` (from Intuit) |
| `GET /api/integrations/qbo/status` | Current connection state. | `?tenantId=` |
| `POST /api/integrations/qbo/sync` | Historical (first run) or incremental invoice pull. | `tenantId` |
| `POST /api/connectors/qbo/test-live` | Real connectivity check — no data pull. | `tenantId` |
| `POST /api/webhooks/qbo` | Intuit CDC webhook receiver — signature-verified, not for manual calls. | Intuit's `eventNotifications` payload |

```bash
# example: trigger a sync
curl -X POST https://hub.example.com/api/integrations/qbo/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"tenantId":"tenant_acme"}'
```

---

Reflects the connector as implemented in `src/services/qboService.ts`, `src/routes/qbo.ts`, `src/routes/webhooks.ts`, and `src/adapters/connectorAdapters.ts` (`QuickBooksAdapter`).
