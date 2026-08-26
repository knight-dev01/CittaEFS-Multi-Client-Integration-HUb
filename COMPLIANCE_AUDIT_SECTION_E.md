# CittaHub — Section E Compliance Audit

**Spec source:** `CittaHub_Section_E_Spec-5.xlsx` (workbook self-reports 8 of 11 sheets "Done" as of this read; Validation Rules and Interface are "In progress", Samples is "Not started")
**Audited against:** working tree on branch `dprof`, commit `2673c93`
**Date:** 2026-08-24

## How to read this

Every row below is one spec answer checked against the code that is supposed to implement it. Status is one of:

- **PASS** — behavior matches the spec answer, with evidence.
- **PARTIAL** — implemented, but not to the letter of the spec (narrower, stricter, or looser than specified).
- **FAIL** — implemented differently than specified, or not implemented at all.
- **NOT VERIFIED** — not traced far enough in this pass to score; flagged rather than guessed.
- **SPEC INCOMPLETE** — the workbook itself has no real answer to check against (blank, TODO, or an unedited example row), so no verdict is possible. This is a gap in the spec, not a claim about the app.

Evidence cites `file:line` in the repository. Every FAIL below is one you can reproduce by opening the cited line.

## Top risks

1. ~~**VAT is hardcoded at 16% almost everywhere it defaults.**~~ **FIXED 2026-08-26.** Added a per-tenant `defaultVatRate` (migration `20260826130000_tenant_default_vat_rate`, defaults to 7.5% — Nigeria's NRS standard rate), configurable via Settings → Tenant Gateway & Retry Policies (`PATCH /api/tenants/:id`). The invoice line-item fallback (`server.ts`) and new-item creation default now read the tenant's configured rate instead of a hardcoded `16`; the zod schema default and the `referenceData.ts` catalog were also corrected from 16 to 7.5 (the dead `efs-normalization.ts` constant this originally referenced is gone — see #6 below). See Invoice & tax #11 below.
2. ~~**B2G cannot be submitted at all.**~~ **FIXED 2026-08-26.** `InvoiceKind` now includes `B2G` across the type system, zod schema, CittaEFS client, and server-side TIN gate; B2G behaves as B2B for the customer-registration/TIN gate as the spec requires. See Classification #2–#3 below.
3. ~~**Customer and Item templates are missing spec-mandatory columns entirely.**~~ **FIXED 2026-08-26.** Added `Customer.country`, `Customer.cittaCustomerId`, `Item.name` (ItemName), and `Item.unitCode` (migration `20260826140000_customer_item_spec_columns`, with `Item.name` backfilled from `description` for existing rows), and renamed the generic `Customer.address` column to `street` (migration `20260826150000_customer_address_to_street`) so street/city/country are three real, distinct fields matching the spec's column grid. Wired into the manual-entry forms (`CustomerSyncTab.tsx`, `ItemDictionaryTab.tsx`) and the Excel-import auto-registration path. The previously-fabricated `cittaCustomerCode` (a random string masquerading as a real CittaEFS ID) is gone — the UI now honestly shows "Not yet registered" until a real registration flow populates it. See Customer #7–#8 and Item #2/#4 below.
4. ~~**Gateway credentials are global, not per-tenant.**~~ **FIXED 2026-08-26.** `cittaEfsClient.ts` now resolves each tenant's own `Tenant.cittaApiKey` from the database (every method already took `tenantId` as a parameter — it just never used it) instead of the shared `CITTAEFS_API_KEY` env var. A tenant with no configured key throws a clear error rather than silently falling back to a shared credential. `Tenant.cittaApiSecretEncrypted` (`encryptedSecret`) remains unused — there's no documented gateway auth flow beyond a single Bearer token to wire it into (the spec's own Interface sheet leaves auth details as TODO beyond "API key"), so using it would mean inventing a protocol the gateway doesn't ask for. See Interface #2 below.
5. ~~**No duplicate-invoice protection.**~~ **FIXED 2026-08-26.** `(tenantId, clientInvoiceId)` is now a real unique constraint (migration `20260826160000_invoice_client_id_unique`, replacing the plain non-unique index), and `POST /api/integration/gen/invoices` pre-flight-checks for an existing invoice with the same number and rejects with a clear 409 before ever touching the gateway. A P2002 safety net catches the rare concurrent-request race the pre-flight check can't. Along the way, fixed two frontend bugs this surfaced in manual testing: `parseJsonResponse` was discarding the specific `errors` array in favor of a generic top-level message, and `NewInvoiceModal`'s submit handler had no try/catch, so any rejection (not just duplicates) left the "Transmitting…" button stuck forever with no visible error. See Interface #3 below.
6. ~~**The one module that gets several rules right is never called.**~~ **FIXED 2026-08-26.** Deleted `src/normalization/efs-normalization.ts` (492 lines, zero imports anywhere). It wasn't just unused — it was also stale relative to the live path after fixes #1–#5 (hardcoded module-level VAT constant instead of per-tenant, no B2G, no duplicate protection), so reusing it wholesale would have been a regression, not a win. Ported the one rule it got right that the live path didn't — buyer TIN never permitted on a B2C invoice — directly into the live path (`invoice.schema.ts`'s transform and `server.ts`'s `POST /api/integration/gen/invoices`), verified live that a B2C submission with a TIN attached now has it stripped (`customerTin: null`) rather than stored. See Classification #4 below.

## Scoring summary (spec items with a real answer to check)

| Section | Pass | Partial | Fail | Not verified |
|---|---|---|---|---|
| Customer | 5 | 0 | 5 | 1 |
| Item | 6 | 1 | 1 | 0 |
| Invoice & tax | 5 | 1 | 6 | 0 |
| Classification | 4 | 1 | 0 | 0 |
| Interface (answered items only) | 4 | 0 | 0 | 0 |
| **Total** | **24** | **3** | **12** | **1** |

Validation Rules and Samples contribute zero scored items — both sheets are effectively unfilled in the spec (see those sections below). Most of Interface is also unfilled (Phase 5, marked "not needed to start the build").

---

## 1. Customer template

| # | Spec requirement | Status | Evidence | Note |
|---|---|---|---|---|
| 1 | File format .xlsx / .xls / .csv accepted | PASS | `src/components/ExcelDocumentViewer.tsx:252-269` | Uses the `xlsx` package for both string and binary buffers |
| 2 | Sheet name must be exact, case-sensitive `Customer Template` | FAIL | `src/components/ExcelDocumentViewer.tsx:253,268` | Always reads `workbook.SheetNames[0]` — never checks the sheet's actual name |
| 3 | Header row 1, first data row 2 | PASS | same file | Default `sheet_to_json` behavior |
| 4 | TIN format: 10–14 alphanumeric characters | FAIL | `server.ts:1877-1909` (`POST /api/customers`) | No length or format check on `tin` anywhere in customer creation |
| 5 | TIN mandatory for B2B, optional for B2C | FAIL | `server.ts:1900` | When `isB2B` is true and no TIN is supplied, the code fabricates a placeholder TIN (`"P000000000X"`) instead of rejecting the record |
| 6 | Customer code uniquely identifies a customer | PASS | `prisma/schema.prisma:40,53` | `clientSystemCustId` indexed per tenant |
| 7 | CittaEFS-issued `CittaEFS_Customer_ID` must be stored after registration | **PASS (fixed 2026-08-26)** | `prisma/schema.prisma` (`Customer.cittaCustomerId`), `server.ts` (`formatCustomer`) | Column now exists; `formatCustomer` returns the real value (or null) instead of fabricating a fake `CITTA-CUST-xxxxxx` string. No live registration endpoint exists yet to populate it (see Interface #3), so it reads null until one does |
| 8 | Required address fields: street, city, country | **PASS (fixed 2026-08-26)** | `prisma/schema.prisma` (`Customer.street`, `.city`, `.country`), `src/components/CustomerSyncTab.tsx` | The generic `address` column was renamed to `street` (migration `20260826150000_customer_address_to_street`) and `country` added; all three are now real, distinct fields exposed in the Add Customer form |
| 9 | Postcode required for B2B | FAIL | `prisma/schema.prisma:37-55` | No postcode field anywhere in the model |
| 10 | `CCEmail` optional, semicolon-separated secondary recipients | FAIL | `server.ts:1879-1888` | Field isn't in the request body destructuring or the DB model — silently dropped if present in an upload |
| 11 | Update semantics: all fields but customer code mutable | NOT VERIFIED | — | No dedicated customer update/PUT endpoint was located in this pass |

## 2. Item template

| # | Spec requirement | Status | Evidence | Note |
|---|---|---|---|---|
| 1 | `ItemCode` column | PASS | `prisma/schema.prisma:60` | `clientSku` |
| 2 | `ItemName` column | **PASS (fixed 2026-08-26)** | `prisma/schema.prisma` (`Item.name`), `src/components/ItemDictionaryTab.tsx` | `name` column added (backfilled from `description` for existing rows) and exposed as a distinct required field in the Add Item form |
| 3 | `ItemDescription` column | PASS | `prisma/schema.prisma` (`Item.description`) | Now genuinely distinct from `name` — both are separate fields and separate form inputs |
| 4 | `Unit Code` column, mandatory (UN/ECE Rec 20) | **PASS (fixed 2026-08-26)** | `prisma/schema.prisma` (`Item.unitCode`, default `"EA"`), `src/components/ItemDictionaryTab.tsx` | Column added with the spec's own stated default (EA = Each); exposed as a required field in the Add Item form |
| 5 | `HsorServiceCode`, mandatory, "no catch-all code" | PARTIAL | `src/components/ExcelDocumentViewer.tsx:321` | Field exists, but a missing code is silently defaulted to `'HS-8471.30'` (a real laptop HS code) rather than rejected — the opposite of "no catch-all" |
| 6 | Default unit of measure is `EA` (Each) | PASS | `prisma/schema.prisma` (`Item.unitCode @default("EA")`) | Correct value, now a real DB default rather than a constant in the dead `efs-normalization.ts` module (deleted — see §3) |
| 7 | Price lives on the invoice line, not the item | FAIL | `prisma/schema.prisma:62` | `Item.unitPrice` exists directly on the item record, contradicting the spec answer |
| 8 | Currency is not carried on the item | PASS | `prisma/schema.prisma:57-67` | No currency field on `Item` |

## 3. Invoice template, tax & totals

| # | Spec requirement | Status | Evidence | Note |
|---|---|---|---|---|
| 1 | File format .xlsx, header row 1, data row 2 | PASS | `src/components/ExcelDocumentViewer.tsx` | — |
| 2 | `Document Number` distinct from `Invoice Number` | FAIL | `src/schemas/invoice.schema.ts`, `prisma/schema.prisma:76-108` | No distinct column anywhere; `cittaEfsClient.ts:153-154` just aliases it to `clientInvoiceNumber` when absent |
| 3 | `Invoice Type` numeric codes (380 commercial / 381 credit / 383 debit) | PARTIAL | `src/services/cittaEfsClient.ts:142-149` | Correctly branches per type, but uses `388` rather than the spec's `380` for a standard invoice — worth confirming which code NRS actually expects |
| 4 | `Header Charges`, `Header Discount`, `Line Discount` columns | FAIL | `prisma/schema.prisma:76-108` | No header-level charge/discount columns exist at all; only a per-line `discountAmount` |
| 5 | `Currency Code` column | PASS | `prisma/schema.prisma:87` | Defaults `"NGN"`, overridable |
| 6 | `Billing Reference IRNs` (credit/debit note reference) | PASS | `src/services/cittaEfsClient.ts:155` | `originalIrn` threaded through to `billingReferenceIrns` |
| 7 | `Days` / `Group Code` columns | FAIL | (repo-wide) | Optional in the spec, but entirely unsupported — silently dropped if uploaded |
| 8 | IRN format: 8–10 digits | FAIL | `src/services/cittaEfsClient.ts:232-238` | The fallback-generated IRN (used whenever the gateway response doesn't include one) is shaped `IRN-NRS-2026-123456` — not 8–10 digits |
| 9 | QR payload should be base64 | FAIL | `src/services/cittaEfsClient.ts:242-244` | Returns a verification **URL string** (`https://nrs.portal.gov/verify?...`), not a base64 payload |
| 10 | Rounding to 2 decimal places | PASS | `src/schemas/invoice.schema.ts:73-75` | Consistent `.toFixed(2)` |
| 11 | VAT rate default | **PASS (fixed 2026-08-26)** | `prisma/schema.prisma` (`Tenant.defaultVatRate`, `Item.defaultVatRate`), `server.ts` (invoice line-item fallback + item creation), `src/schemas/invoice.schema.ts:16`, `src/components/SettingsTab.tsx` | Default is now 7.5% (Nigeria's NRS standard, matching the spec's `Item Code Lists` example row `VAT-STD … 7.5%`) and configurable per-tenant via Settings, rather than a hardcoded 16% left over from a Kenyan build |
| 12 | Exempt/zero-rated items distinct from standard-rate | FAIL | `prisma/schema.prisma:65` | Only a flat numeric `defaultVatRate` — no semantic tax-category field, so "0% because exempt" and "0% because zero-rated" are indistinguishable |

**Architecture note (resolved 2026-08-26):** `src/normalization/efs-normalization.ts` has been deleted — it was dead (zero imports) and, by this point, also stale relative to the live path. The one rule it got right that the live path didn't (stripping TIN on B2C invoices) was ported directly into `invoice.schema.ts` and `server.ts` — see Classification #4.

## 4. Classification — B2B / B2C / B2G

The spec calls this "the most important sheet in this workbook."

| # | Spec requirement | Status | Evidence | Note |
|---|---|---|---|---|
| 1 | Kind is inferred from the buyer, driven by TIN presence | PASS | `src/schemas/invoice.schema.ts:43-50` | Auto-downgrades `B2B → B2C` when TIN is missing/empty |
| 2 | Complete kind list: B2B, B2C, B2G | **PASS (fixed 2026-08-26)** | `src/types/index.ts:19`, `src/schemas/invoice.schema.ts:27` | `InvoiceKind` is now `'B2B' \| 'B2C' \| 'B2G' \| 'EXPORT'`; zod enum, `cittaEfsClient.ts`, and the manual invoice-entry UI (`NewInvoiceModal.tsx`, `ExcelDocumentViewer.tsx`) all accept `B2G` |
| 3 | B2G behaves as B2B for the customer registration gate | **PASS (fixed 2026-08-26)** | `src/schemas/invoice.schema.ts:44-50`, `server.ts:1056-1062` | TIN-required gate and the auto-downgrade-to-B2C-on-missing-TIN rule now apply to `B2B \| B2G` symmetrically in both the zod transform and the server pre-flight check |
| 4 | Buyer TIN never permitted on a B2C invoice | **PASS (fixed 2026-08-26)** | `src/schemas/invoice.schema.ts` (transform), `server.ts` (`POST /api/integration/gen/invoices`) | `customerTin` is now stripped whenever the effective `invoiceKind` is B2C, in both the zod schema and the live endpoint (previously only the dead `efs-normalization.ts` module did this — see §3). Verified live: a B2C submission with a TIN attached now stores `customerTin: null` |
| 5 | TIN format check gating the B2B/B2C decision | PARTIAL | `server.ts:1056` | Only checks `customerTin.length < 8`, not the spec's stated 10–14 character range |

## 5. Interface (Phase 5 — mostly unanswered by design)

The spec explicitly defers this sheet to Phase 5 and says not to let it hold up the build. Most rows are TODO. Of the ones with a real answer:

| # | Spec requirement | Status | Evidence | Note |
|---|---|---|---|---|
| 1 | Authentication method: API key | PASS | `src/services/cittaEfsClient.ts` | Bearer token, now resolved per-tenant (see #2) |
| 2 | Credentials are per-tenant | **PASS (fixed 2026-08-26)** | `src/services/cittaEfsClient.ts` (`getCittaEfsApiKey`) | Every gateway call now looks up the calling tenant's own `Tenant.cittaApiKey` (generated uniquely per tenant at onboarding) instead of the shared `CITTAEFS_API_KEY` env var; a tenant with no key throws instead of silently reusing a shared credential |
| 3 | Duplicate detection exists today ("critical") | **PASS (fixed 2026-08-26)** | `prisma/schema.prisma` (`@@unique([tenantId, clientInvoiceId])`), `server.ts` (`POST /api/integration/gen/invoices` pre-flight check) | CittaHub now enforces its own duplicate protection (DB unique constraint + pre-flight rejection) rather than relying solely on the Gateway's own detection |
| 4 | Submission is per-tenant; multiple files in flight per tenant | PASS | (repo-wide) | `tenantId` scoping present throughout the ingestion path |
| — | Registration endpoints, idempotency, error/retry taxonomy, callback vs. polling, master-data confirmations, sandbox mode | **SPEC INCOMPLETE** | — | Left TODO/blank in the workbook — nothing to audit against |

## 6. Validation Rules

**SPEC INCOMPLETE.** The sheet contains exactly one row, explicitly marked `EXAMPLE ROW — overwrite or delete`. There is no real rule catalogue to check the app's validation messages against. (For reference, the app does raise validation errors with categories like `MISSING_HS_CODE` and `INVALID_TIN_FORMAT` — see `server.ts:1103-1128` — but whether the wording matches what NRS/CittaEFS actually rejects on is unanswerable until this sheet is filled in.)

## 7. Samples

**SPEC INCOMPLETE.** Every row in the checklist is `TODO` — no anonymised sample files or paired known-good outputs have been collected. There is nothing to use as golden fixtures, and no `cittahub/spec/` directory exists yet in this repository (the workbook's own closing instructions say completing it should produce four markdown files there).

## Other spec gaps worth flagging back to whoever owns the workbook

- **Item Code Lists** is unfilled — every data row after the one example is the literal placeholder text `(ALL CODE LIST GOTTEN FROM NRS)`, repeated ~90 times. No real NRS tax-category, unit-of-measure, or state/LGA code lists have been pasted in.
- The **Invoice** sheet's File Conventions section states the date format as `YYYYDDMM`, while the **Invoice Columns** grid states `YYYY-MM-DD` for the same field, and the Customer sheet also uses `YYYY-MM-DD`. These contradict each other; the app follows `YYYY-MM-DD`, which matches the more specific column-grid answer and the rest of the workbook.

---

*Methodology: every FAIL/PARTIAL line above was traced to a specific file and line in the working tree, not inferred from naming or intent. Items marked NOT VERIFIED were left unscored rather than guessed at. This audit does not (yet) run the application or exercise upload flows end-to-end — it is a static trace of spec answer → implementing code.*
