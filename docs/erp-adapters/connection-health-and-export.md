# Connection health, mapping and EFS export

Two per-connection features that sit around the live QBO/Odoo adapters. Neither
adds a second code path per ERP: the health probe calls the same service the
sync uses, and the export reads the canonical `Invoice` model.

## Connection health

- `POST /api/tenants/:id/erps/:erpId/test` runs the first smoke step defined for
  the connection: `companyinfo` for QuickBooks Online, an authenticated
  `res.company` read for Odoo. It returns:

  ```json
  {
    "success": true,
    "connected": true,
    "platformLabel": "QuickBooks Online",
    "status": "ACTIVE",
    "latencyMs": 184,
    "companyName": "Acme Ltd",
    "message": "Connected to Acme Ltd in 184 ms.",
    "checkedAt": "2026-11-04T09:12:00.000Z"
  }
  ```

- A connection is only probed when its `Integration` row is `CONNECTED` with the
  matching `sourceSystem` (`QUICKBOOKS_ONLINE` / `ODOO`). A platform nobody has
  authorised yet is reported as not connected, not broken.
- Only authentication-class failures flip `TenantErp.status` to `NEEDS_REAUTH`.
  Timeouts and 5xx keep the previous status and record `config.health.lastError`
  with `consecutiveFailures`. `message` is the merchant-facing sentence;
  `technicalDetail` is engineering evidence and is rendered behind a
  `Technical detail` toggle.
- The same check runs every 15 minutes from `src/crons/erpHealth.ts`
  (`ERP_HEALTH_INTERVAL_MS`), wired in `server.ts`. Planned ERPs are skipped.

Health lives inside `TenantErp.config` as a JSON block:

```json
{
  "health": {
    "lastCheckedAt": "2026-11-04T09:12:00.000Z",
    "lastSuccessAt": "2026-11-04T09:12:00.000Z",
    "latencyMs": 184,
    "companyName": "Acme Ltd",
    "authStatus": "AUTHENTICATED",
    "consecutiveFailures": 0
  }
}
```

No migration was needed; every read/write goes through
`src/lib/erpConnectionConfig.ts`.

## Mapping config

`GET` / `PATCH /api/tenants/:id/erps/:erpId/mapping` read and write the
`mapping_config` key in the same JSON column:

```json
{
  "mapping_config": {
    "taxRates": { "7.5": "STANDARD_VAT", "0": "ZERO_VAT" },
    "products": { "SKU-001": "QBO-ITEM-42" }
  }
}
```

- Keys are the hub value (VAT rate, client SKU); values are the ERP code.
- `PATCH` merges by default; send `{ "replace": true }` to swap the whole map
  (which is what the panel does).
- The GET response also returns the tenant's items and the valid
  `TAX_CATEGORIES`, so the panel offers real choices instead of free text.
- Mapping changes are written to the audit log as `ERP_MAPPING_UPDATED`.

## Per-connection runs

`GET /api/tenants/:id/erps/:erpId/runs` returns the ten most recent gateway jobs
tagged with that connection, plus invoice count and last invoice time. Queueing
stays shared; this is observability, not a separate queue. Jobs carry
`tenantErpId` in their JSON payload, which is how they are selected.

## EFS export

`GET /api/invoices/export` produces a normalised file for CittaEFS bulk upload.

| Query | Values |
| --- | --- |
| `format` | `csv` (default), `xlsx`, `json` |
| `tenantId` | scopes the export; non-admin users are pinned to their tenant |
| `status` | optional invoice status filter |
| `erpId` | optional `TenantErp.id` filter |

- One row per invoice line, using the exact headers from
  `INVOICE_TEMPLATE_COLUMNS` (`src/data/invoiceTemplateReference.ts`).
- The Excel workbook contains one sheet named `InvoiceTemplate`.
- Amounts are numeric and rounded to two decimals; quantity keeps four.
- Invoice type becomes the EFS code: `381` standard, `380` credit note, `384`
  debit note, `395` credit note request. An explicit three-digit code on the
  invoice wins.
- Invoices with no line items are skipped and listed in the `X-Export-Skipped`
  response header, rather than emitting a row EFS would reject.
- CSV is UTF-8 with a BOM and CRLF line endings so Excel opens it cleanly.
- Response headers: `Content-Disposition` (filename), `X-Export-Rows`,
  `X-Export-Invoices`, `X-Export-Skipped`. These are exposed through CORS for
  the Vercel → Render split.

The builder and writers live in `src/lib/efsExport.ts`; the route is declared
before `/api/invoices/:id` so `export` is never parsed as an id.
