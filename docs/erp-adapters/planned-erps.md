# Planned ERP adapters

These ERPs have a definition in `src/config/erpRegistry.ts` and a card on the
**Connections** tab, but **no connector is built**. They are listed so the
contract and the mapping shape are settled before anyone writes code, and so
the UI never pretends a connection exists.

Planned adapters are rejected by `POST /api/tenants/:id/erps`
(`isErpAvailable()` returns false), never probed by the health cron, and have no
entry in `LIVE_ERPS`. Live connectors are QuickBooks Online and Odoo ERP only.

## The six-field contract

Every adapter, live or planned, describes the same six things:

| Field | Meaning |
| --- | --- |
| `authMethod` | How the connection proves who it is |
| `apiStyle` | Wire protocol and hard rate limits |
| `coreObjects` | The records that must exist on both sides |
| `spec` / `matching` | Which ERP field maps to which hub field |
| `quirks` | What breaks in practice and how it is handled |
| `smokeTest` | The shortest real call that proves the connection works |
| `doNot` | Traps that have already cost someone a day |

## Xero

- **Auth:** OAuth 2.0 with PKCE. Every call needs `Xero-tenant-id`; one grant can
  carry several tenants, so the tenant id is part of the connection, not the token.
- **API:** REST JSON, roughly 60 requests/minute per tenant. Plan for 429 with
  `Retry-After` from day one.
- **Objects:** `Contact`, `Invoice`, `Payment`.
- **Matching:** `InvoiceNumber` ↔ `clientInvoiceNumber`, `Contact.ContactID` ↔
  `customerCode`, `LineItem.ItemCode` ↔ `clientSku`.
- **Quirks:** Tax is a code (`OUTPUT2`, `NONE`, `ZERORATEDOUTPUT`), not a
  percentage. The hub's VAT rate must be mapped to a Xero tax type before any
  invoice is pushed.
- **Smoke test:** list one Contact, then create a draft Invoice.
- **Do not:** forget the tenant header, or assume `TaxType` is a number.

## Zoho Books

- **Auth:** OAuth 2.0 with an `organization_id` parameter on every call. Data
  centre matters: `com`, `eu`, `in`, `com.au`, `jp` are different hosts.
- **API:** REST JSON. Rate limits are tighter than QBO; assume throttling.
- **Objects:** `Customer`, `Invoice`, `Customer Payment`.
- **Matching:** `invoice_number` ↔ `clientInvoiceNumber`, `customer_id` ↔
  `customerCode`, `item_id` ↔ `clientSku`.
- **Quirks:** Items must exist with an id; an item *name* is not enough.
- **Smoke test:** list Customers for the organisation, then create an Invoice
  with an existing Item.
- **Do not:** create items on the fly from the hub, or guess the data centre.

## Sage Business Cloud

- **Auth:** Business Cloud uses OAuth 2.0. Sage 50 Desktop is SData or a file
  export — it has no dependable real-time API.
- **API:** Business Cloud REST; Desktop file/SData.
- **Objects:** `Customer`, `Sales Invoice`, `Receipt`.
- **Matching:** `invoice_number` ↔ `clientInvoiceNumber`, `contact_id` ↔
  `customerCode`.
- **Quirks:** Field names and versions differ per country. Desktop must be an
  honest scheduled file sync, not a pretend live connection.
- **Smoke test:** Cloud: list customers. Desktop: CSV export/import round trip.
- **Do not:** promise real-time sync for Sage 50 Desktop.

## Tally Prime

- **Auth:** None. Tally exposes XML over HTTP on port 9000 on the machine where
  it is installed.
- **API:** XML request/response over `POST`. No REST, no JSON.
- **Objects:** `Ledger`, `Sales Voucher`.
- **Matching:** `Voucher Number` ↔ `clientInvoiceNumber`, `Ledger Name` ↔
  `customerCode`.
- **Quirks:** The local Tally process must be running with the port open. The
  company name must match exactly. XML is brittle and versioned.
- **Smoke test:** create one Sales Voucher in a test company.
- **Do not:** describe it as a cloud multi-tenant connector.

## SAP Business One

- **Auth:** Service Layer session with Basic Auth or OAuth, against a specific
  company database.
- **API:** OData / REST Service Layer. Needs B1i/DI setup before anything works.
- **Objects:** `BusinessPartner`, `Invoices (OINV)`, `IncomingPayments`.
- **Matching:** `DocNum` ↔ `clientInvoiceNumber`, `CardCode` ↔ `customerCode`,
  `ItemCode` ↔ `clientSku`.
- **Quirks:** Heavy auth, complex tax and business-partner mapping, expensive to
  test. Build it after the simpler ERPs.
- **Smoke test:** log in and get a session, then read one BusinessPartner.
- **Do not:** start with SAP S/4 when the client runs B1.

## Custom ERP

- **Auth:** Database credentials or the client's own REST API key.
- **API:** Direct SQL or bespoke REST; no standard shape.
- **Objects:** `customers`, `invoices`, `invoice_items` (names discovered per client).
- **Matching:** discovered during onboarding — schema first, mapping second.
- **Quirks:** No documentation, schema changes break the mapping, no webhooks.
- **Smoke test:** read-only — list tables, find the invoice table, map columns.
- **Do not:** write directly without a mapping table and a backup, or skip a
  staging table.

## What "planned" means in the UI and API

- The Connections tab shows each planned ERP with a neutral **Not yet
  integrated** badge, its auth method and API style. Nothing is clickable.
- `GET /api/tenants/:id/erps` may return a stored row for a planned platform,
  formatted with `availability: "planned"`; such a row is never probed.
- `POST /api/tenants/:id/erps` returns `400` for a planned platform with the
  live connector list in the message.
- The health service skips anything whose `erpId` is not `qbo` or `odoo`.
