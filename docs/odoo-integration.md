# Odoo ERP Integration

How the Hub pulls posted invoices out of a client's Odoo instance over JSON-RPC, maps them onto CittaEFS's invoice model, routes them through validation and NRS stamping, and writes the resulting IRN back to Odoo — and what an operator actually does to run it.

`JSON-RPC · execute_kw` · `Static API key (no OAuth refresh)` · `Poll-based sync` · `Writeback via chatter note`

## Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Invoice lifecycle](#invoice-lifecycle)
- [Field mapping](#field-mapping)
- [HS / service code rules](#hs--service-code-rules)
- [Connecting Odoo](#connecting-odoo)
- [Day-to-day use](#day-to-day-use)
- [Roles & permissions](#roles--permissions)
- [Troubleshooting](#troubleshooting)
- [API reference](#api-reference)

## Overview

Odoo is one of five ERP adapters registered in the Hub (alongside QuickBooks Online, Excel/CSV, and two not-yet-live adapters for SAP and NetSuite). Unlike QuickBooks, Odoo has no central OAuth app registry — every client hosts their own instance, so the connector authenticates with a per-client URL, database name, username and API key instead of an OAuth redirect.

> **In one sentence:** The Hub polls a client's `account.move` table for posted customer invoices and credit notes, converts each one into a CittaEFS invoice, and — once it's been stamped by the CittaEFS Gateway — leaves a note with the IRN and QR code on the original Odoo record.

## Architecture

Four systems are involved. The Hub never holds a live session with Odoo — every JSON-RPC call re-sends the database name, uid, and API key, so there's nothing to expire or refresh.

```
Client's Odoo          CittaEFS Hub                CittaEFS Gateway
account.move    ──────▶ odooService.ts     ──────▶ NRS stamping
/jsonrpc         pull   validate/map codes  valid    returns IRN + QR
                posted  upsert master data  &queued
                        Postgres: Invoice,
                        Integration
      ▲                                                  │
      └──────────── message_post(IRN + QR) ◀──────────────┘
             written as an Odoo chatter note
```

Every call to Odoo carries the database, uid and API key with it — there is no session to keep alive or token to refresh.

## Invoice lifecycle

What happens to one invoice, from being posted in Odoo to landing back there with a stamp.

1. **Posted in Odoo** — Only invoices with `move_type` in `out_invoice`/`out_refund` and `state = posted` are visible to the Hub. Drafts are ignored until posted.
2. **Pulled by a sync** — Historical sync paginates `account.move.search_read` 100 records at a time; incremental sync adds a `write_date >` filter using the last successful sync timestamp. Line items and the customer's VAT/TIN are fetched in two batched calls, not per-invoice.
3. **Deduplicated** — Matched by Odoo's `name` field against `clientInvoiceId` for the tenant. An invoice already on file is skipped (its `odooInvoiceId` is backfilled if missing) rather than re-ingested.
4. **Validated & transformed** — Rejected if the invoice has no name or no partner. Otherwise mapped into the CittaEFS shape (see [Field mapping](#field-mapping)), and every line's HS/service code is checked against the reference list.
5. **Master data upserted** — First sighting of a customer or SKU auto-creates a Customer / Item record so later invoices resolve VAT rate and code from the Item Dictionary instead of the raw Odoo guess.
6. **Routed** — If the tenant's *auto-enqueue* setting is on, the invoice goes straight to the signing queue. Otherwise it lands in the Import tab's preview inbox as `PENDING_NRS_STAMP` for an operator to review.
7. **Stamped by the Gateway** — CittaEFS returns an IRN and a QR code URL for the invoice.
8. **Written back to Odoo** — `writebackToOdoo()` posts `CittaEFS Compliance Stamp — IRN: … | QR Code: …` to the invoice's chatter via `message_post`, and the Hub's copy is marked `ledgerWritebackStatus: SYNCED`.

> **Why chatter, not a custom field?** QBO's adapter writes IRN/QR into custom fields it knows exist on every company's invoice object. Odoo has no such guarantee — a client's instance may not have any custom fields defined — so the integration uses the one API every Odoo instance has: the invoice's message log.

## Field mapping

How raw `account.move` / `account.move.line` data becomes a CittaEFS invoice.

| Odoo field | CittaEFS field | Notes |
|---|---|---|
| `name` | `clientInvoiceId` / `documentNumber` | Business key — every sync's dedup check runs against this. |
| `id` | `odooInvoiceId` | Internal numeric id, stored once and used as the writeback target. |
| `partner_id [id, name]` | `customerCode`, `customerName` | Code is synthesized as `CUST{id}`; a Customer record is auto-created on first sight. |
| `res.partner.vat` | `customerTin` | A VAT/TIN present on the partner classifies the invoice B2B; absent → B2C. |
| product_id display name | `clientSku`, `description` | Parsed from Odoo's `[internal ref] Product name` convention. |
| `price_unit` / `quantity` | `unitPrice` / `quantity` | — |
| `price_subtotal` | `taxableAmount` | — |
| `price_total − price_subtotal` | `vatAmount` | `vatRate` is derived from the two. |
| `move_type` | `invoiceType` | `out_refund` → `CREDIT_NOTE`, otherwise `STANDARD`. |
| `currency_id [id, code]` | `currency` | Falls back to `NGN` when unset. |
| `write_date` | — | Drives the incremental sync's `>` filter; not stored on the invoice. |

## HS / service code rules

Odoo has no field equivalent to an HS or service code, so the adapter has to guess — and the Hub always prefers a real answer over that guess when one exists.

1. **Item Dictionary mapping wins first** — If the SKU already has a specific (non-generic) code on file in the tenant's Item Dictionary — from a prior QBO, Excel, or Odoo sync — that mapping is used instead of Odoo's guess.
2. **Otherwise, keyword inference** — SKU + description are scanned for `gardening, sod, rocks, fountain, pump, sprinkler, design, service, labor/labour, installation, maintenance, repair`, or a SKU prefixed `SRV` → `SRV-7212.10`. Everything else falls back to `HS-8471.30`.
3. **Checked against the reference list** — Every line's final code must appear in CittaEFS's HS/service reference list. An unrecognized code raises a `MISSING_HS_CODE` validation error and blocks the whole invoice from ingesting.

> **This is a starting guess, not a classification.** Both fallback codes are generic placeholders. For a client with real product variety, map SKUs to their correct HS/service codes in the Item Dictionary early — every future invoice for that SKU then skips the guess entirely.

## Connecting Odoo

There are two places to do this: onboarding a brand-new client, or adding/reconnecting Odoo on an existing one. Both use the same form and the same connect-then-sync flow underneath.

### What you need from the client first

1. **Generate an API key in their Odoo instance** — In Odoo: `Settings → Users → API Keys`. Use a dedicated integration user if possible, rather than a personal login.
2. **Collect four values** — The instance URL (e.g. `https://client.odoo.com`), the database name, the username/email tied to the API key, and the key itself.

### New client — Onboard Client wizard

1. **Step 2 of the wizard: choose "Odoo ERP"** — alongside QuickBooks Online and Excel & CSV Import as the connection method for this client.
2. **Fill in the four fields and submit** — Odoo URL, Database, Username / Email, API Key. Submitting authenticates immediately — a bad URL, database, username or key fails right here with a clear error.
3. **The wizard runs the first sync automatically** — Once connected, it pulls every posted invoice and reports totals: found, newly ingested, already on file. This can take a moment on a client with years of invoice history.

### Existing client — Connectors tab

Open the tenant's workspace → **Connectors** tab. If Odoo isn't connected yet, use **Add New Connector** and pick Odoo ERP from the same form. If it's already connected, the Odoo card shows its live status and two actions: **Sync Now** and **Test (Live)** — see the next section.

> **No OAuth screen, no redirect.** Because Odoo authenticates with a static API key rather than OAuth, connecting never leaves the Hub — there's no external login page to bounce through, and nothing to re-consent to later.

## Day-to-day use

### Reading the status card

The Connectors tab's Odoo card shows:

| Status | Meaning |
|---|---|
| `CONNECTED` | Credentials on file, last authenticated successfully. |
| `DISCONNECTED` | Was connected once, but needs reconnecting — see [Troubleshooting](#troubleshooting). |
| `NOT_CONNECTED` | No Odoo integration has ever been set up for this tenant. |

It also shows the connected database name and a "last synced" timestamp.

### Sync Now

Runs an incremental sync if the tenant has synced before (invoices updated since `lastSyncAt`), or a full historical pull on the very first run. Reports how many invoices were found, how many were new, and how many were already on file. Safe to click repeatedly — dedup makes every sync idempotent.

### Test (Live)

A lightweight connectivity check — reads the connected company's name and currency from Odoo and reports round-trip latency. Doesn't touch invoice data; use it to confirm the connection is healthy without running a full sync.

### Reviewing pulled invoices

Where a synced invoice lands depends on the tenant's **auto-enqueue** setting (Admin → tenant's ERP settings):

- **Off (default)** — invoices sit in the Import tab's preview inbox as `PENDING_NRS_STAMP` until an operator reviews and sends them on.
- **On** — valid invoices are queued for NRS stamping automatically, with no manual step.

An invoice with an unrecognized HS/service code never reaches either queue — it's logged as an open validation error instead. Fix the SKU's mapping in the Item Dictionary (Items tab) or correct the code directly in the Validation tab, then re-sync or retry.

### Confirming the writeback

Once an invoice is stamped, open the corresponding record in Odoo and check its chatter (the message log on the right side of the form view) — a note reading `CittaEFS Compliance Stamp — IRN: … | QR Code: …` confirms the round trip completed.

## Roles & permissions

Enforced server-side on every Odoo endpoint, not just hidden in the UI.

| Action | Allowed roles |
|---|---|
| Connect / reconnect | `ADMIN`, `INTEGRATION_MANAGER` |
| Run a sync | `ADMIN`, `INTEGRATION_MANAGER`, `OPERATOR` — non-admins are restricted to their own tenant |
| View status / test connection | Any authenticated user with access to the tenant |

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| "Odoo authentication failed — check URL, database name, username, and API key." | One of the four connect fields is wrong. | Re-verify each value in Odoo; the API key must still be active under `Settings → Users → API Keys`. |
| "Odoo connection needs reauthorization…" / sync returns `401 reauthRequired` | Tenant's stored connection details are incomplete, or the saved API key failed to decrypt. | Reconnect from the Connectors tab — re-enter all four fields. |
| "Invalid Product Code — must be valid HS Code or Service Code (found …)" | Neither the Item Dictionary mapping nor the keyword guess resolved to a code CittaEFS recognizes. | Map the SKU to a valid code in the Item Dictionary, then retry the invoice. |
| "No invoice data provided — … has no line items" | Every line on the posted invoice is a section/note line or excluded from the invoice tab. | Check the invoice in Odoo has at least one real product line. |
| "Missing partner_id" / "Missing Odoo invoice name" (validation error) | The `account.move` record is incomplete on the Odoo side. | Fix the record in Odoo; it will be picked up on the next sync. |
| "Could not reach Odoo, please try again" | Network or timeout error calling the client's `/jsonrpc` endpoint. | Confirm the instance is reachable and not behind a firewall blocking the Hub's IP, then retry. |

## API reference

For anyone scripting against the Hub directly rather than using the UI.

| Endpoint | Purpose | Body / query |
|---|---|---|
| `POST /api/integrations/odoo/connect` | Authenticate and store connection details for a tenant. | `tenantId, odooUrl, odooDatabase, odooUsername, odooApiKey` |
| `GET /api/integrations/odoo/status` | Current connection state. | `?tenantId=` |
| `POST /api/integrations/odoo/sync` | Historical (first run) or incremental invoice pull. | `tenantId` |
| `POST /api/connectors/odoo/test-live` | Real connectivity check — no data pull. | `tenantId` |

```bash
# example: trigger a sync
curl -X POST https://hub.example.com/api/integrations/odoo/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"tenantId":"tenant_acme"}'
```

---

Reflects the connector as implemented in `src/services/odooService.ts`, `src/routes/odoo.ts`, and `src/adapters/connectorAdapters.ts` (`OdooAdapter`).
