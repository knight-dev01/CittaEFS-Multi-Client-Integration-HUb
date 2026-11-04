# Odoo ERP Adapter Contract

**Status:** Live

## 1. Auth Method
Static API Key per user. `xmlrpc/2/common` authenticate with `db`, `username`, `api_key`; returns uid which is stored in `Tenant.erpConfig`. No refresh.

## 2. API Type
JSON-RPC over `xmlrpc/2/object` via `execute_kw`. URL + database are tenant-specific.

## 3. Core Object Names
`res.partner` → customer, `account.move` with `move_type = 'out_invoice'` / `out_refund` → invoice, `account.move.line` → line items. Writeback via `message_post` chatter note with IRN/QR.

## 4. Hard Quirks
- No OAuth; API key must be generated under Settings → Users → API Keys.
- Pagination via `offset`/`limit`, standard 100 per page.
- `write_date` is the reliable incremental cursor, not `create_date`.
- Taxes and products must exist before invoice creation; hub does not create Odoo items.
- Online instances may block some modules; self-hosted needs correct port / reverse proxy.

## 5. What to Test First
1. Authenticate: call `common.authenticate` → uid.
2. Read one partner by `vat` or name.
3. Fetch one posted `account.move` with `state = 'posted'`.

## 6. What NOT to do
- Do not use password authentication; use API Key.
- Do not create invoices without mapping products and taxes first.
- Do not assume `name` is unique; dedupe on `name` + tenant.

## Notes for this build
`OdooAdapter.transform()` is implemented; network calls live in `src/services/odooService.ts`. Writeback uses chatter, not custom fields.
