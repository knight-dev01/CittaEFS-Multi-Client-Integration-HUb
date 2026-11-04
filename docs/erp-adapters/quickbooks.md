# QuickBooks Online Adapter Contract

**Status:** Live

## 1. Auth Method
OAuth 2.0 Authorization Code Grant with auto-refresh. Tokens stored per tenant in `Integration.accessToken`/`refreshToken`. Realm ID is per-company.

## 2. API Type
REST JSON, `https://sandbox-quickbooks.api.intuit.com/v3` or production `https://quickbooks.api.intuit.com/v3`. CDC webhooks for real-time push.

## 3. Core Object Names
`Customer` → `qbo.Customer` (`CustomerRef`). `Invoice` → `qbo.Invoice` (`DocNumber` is business key). `Item` → `qbo.Item` / `qbo.Line.ItemRef`. Writeback targets Invoice custom fields `IRN` and `QR_CODE_URL`.

## 4. Hard Quirks
- Rate limit 500 req/min per realm. Intuit returns `429` with `Retry-After` — must be honoured.
- `realmId` is required for every URL and sandbox vs production realm IDs differ — never hardcode.
- TaxCode is optional unless Automated Sales Tax is enabled; VAT is handled via hub calculation.
- Paging for invoice queries uses `STARTPOSITION` / `MAXRESULTS` up to 1000.
- CDC webhook signature must be HMAC `intuit-signature`.

## 5. What to Test First
1. `GET /v3/company/{realmId}/companyinfo/{realmId}` — connectivity + token health.
2. Query one invoice with `SELECT * FROM Invoice WHERE DocNumber = '...'` — confirms read path.
3. Verify writeback: update invoice custom fields with IRN/QR.

## 6. What NOT to do
- Do not hardcode `realmId` or environment.
- Do not match customers by name. Use `CustomerRef` / `customerCode`.
- Do not assume line tax codes; infer HS/service code in hub, not QBO.
- Do not create new items in QBO from hub; map to existing `ItemRef`.

## Notes for this build
Adapter `QuickBooksAdapter.transform()` is implemented; fetching lives in `src/services/qboService.ts`. The registry entry tracks only realmId/environment config. Token refresh runs 5 min before expiry.
