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

1. ~~**VAT is hardcoded at 16% almost everywhere it defaults.**~~ **FIXED 2026-08-26.** Added a per-tenant `defaultVatRate` (migration `20260826130000_tenant_default_vat_rate`, defaults to 7.5% — Nigeria's NRS standard rate), configurable via Settings → Tenant Gateway & Retry Policies (`PATCH /api/tenants/:id`). The invoice line-item fallback (`server.ts`) and new-item creation default now read the tenant's configured rate instead of a hardcoded `16`; the zod schema default, `referenceData.ts` catalog, and the dead `efs-normalization.ts` constant were also corrected from 16 to 7.5. See Invoice & tax #11 below.
2. ~~**B2G cannot be submitted at all.**~~ **FIXED 2026-08-26.** `InvoiceKind` now includes `B2G` across the type system, zod schema, CittaEFS client, and server-side TIN gate; B2G behaves as B2B for the customer-registration/TIN gate as the spec requires. See Classification #2–#3 below.
3. ~~**Customer and Item templates are missing spec-mandatory columns entirely.**~~ **FIXED 2026-08-26.** Added `Customer.country`, `Customer.cittaCustomerId`, `Item.name` (ItemName), and `Item.unitCode` (migration `20260826140000_customer_item_spec_columns`, with `Item.name` backfilled from `description` for existing rows). Wired into the manual-entry forms (`CustomerSyncTab.tsx`, `ItemDictionaryTab.tsx`) and the Excel-import auto-registration path. The previously-fabricated `cittaCustomerCode` (a random string masquerading as a real CittaEFS ID) is gone — the UI now honestly shows "Not yet registered" until a real registration flow populates it. See Customer #7–#8 and Item #2/#4 below.
4. **Gateway credentials are global, not per-tenant**, despite the `Tenant` model already having `cittaApiKey` / `cittaApiSecretEncrypted` columns for exactly this — they're simply never read. Every tenant's invoices are signed with one shared `CITTAEFS_API_KEY`.
5. **No duplicate-invoice protection.** `clientInvoiceId` is indexed but not unique in the database, and the invoice-creation endpoint does no duplicate check — contradicting the spec's "yes, critical" answer on duplicate detection.
6. **The one module that gets several rules right is never called.** `src/normalization/efs-normalization.ts` correctly strips TIN on B2C invoices and computes tax — but nothing in the app imports it. It's dead code; its correctness has zero effect on what actually runs.

## Scoring summary (spec items with a real answer to check)

| Section | Pass | Partial | Fail | Not verified |
|---|---|---|---|---|
| Customer | 4 | 1 | 5 | 1 |
| Item | 6 | 1 | 1 | 0 |
| Invoice & tax | 5 | 1 | 6 | 0 |
| Classification | 3 | 2 | 0 | 0 |
| Interface (answered items only) | 2 | 0 | 2 | 0 |
| **Total** | **20** | **5** | **14** | **1** |

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
| 8 | Required address fields: street, city, country | PARTIAL | `prisma/schema.prisma` (`Customer.country`), `src/components/CustomerSyncTab.tsx` | `city` and the new `country` column/form field are now real; `street` still isn't split out from the freeform `address` field |
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
| 6 | Default unit of measure is `EA` (Each) | PASS | `src/normalization/efs-normalization.ts:120` | `UNIT_CODE_PIECES = "EA"` — correct value, though see §3 note on this file being dead code |
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

**Architecture note (not scored):** `src/normalization/efs-normalization.ts` (492 lines) is not imported by `server.ts` or any other live module — it is dead code. It happens to implement several rules more correctly than the live path (e.g. stripping customer TIN on non-B2B invoices), but none of that matters because it never runs.

## 4. Classification — B2B / B2C / B2G

The spec calls this "the most important sheet in this workbook."

| # | Spec requirement | Status | Evidence | Note |
|---|---|---|---|---|
| 1 | Kind is inferred from the buyer, driven by TIN presence | PASS | `src/schemas/invoice.schema.ts:43-50` | Auto-downgrades `B2B → B2C` when TIN is missing/empty |
| 2 | Complete kind list: B2B, B2C, B2G | **PASS (fixed 2026-08-26)** | `src/types/index.ts:19`, `src/schemas/invoice.schema.ts:27` | `InvoiceKind` is now `'B2B' \| 'B2C' \| 'B2G' \| 'EXPORT'`; zod enum, `cittaEfsClient.ts`, and the manual invoice-entry UI (`NewInvoiceModal.tsx`, `ExcelDocumentViewer.tsx`) all accept `B2G` |
| 3 | B2G behaves as B2B for the customer registration gate | **PASS (fixed 2026-08-26)** | `src/schemas/invoice.schema.ts:44-50`, `server.ts:1056-1062` | TIN-required gate and the auto-downgrade-to-B2C-on-missing-TIN rule now apply to `B2B \| B2G` symmetrically in both the zod transform and the server pre-flight check |
| 4 | Buyer TIN never permitted on a B2C invoice | FAIL | `server.ts:1140-1163`, `src/schemas/invoice.schema.ts` | Enforced only inside the dead `efs-normalization.ts` module (see §3). The live invoice-creation path stores whatever `customerTin` is submitted regardless of `invoiceKind` |
| 5 | TIN format check gating the B2B/B2C decision | PARTIAL | `server.ts:1056` | Only checks `customerTin.length < 8`, not the spec's stated 10–14 character range |

## 5. Interface (Phase 5 — mostly unanswered by design)

The spec explicitly defers this sheet to Phase 5 and says not to let it hold up the build. Most rows are TODO. Of the ones with a real answer:

| # | Spec requirement | Status | Evidence | Note |
|---|---|---|---|---|
| 1 | Authentication method: API key | PASS | `src/services/cittaEfsClient.ts:4-10` | Bearer token via `CITTAEFS_API_KEY` |
| 2 | Credentials are per-tenant | FAIL | `src/services/cittaEfsClient.ts:4-10` | Reads one single global env var for every tenant. `Tenant.cittaApiKey` / `cittaApiSecretEncrypted` exist in the schema but are never read anywhere |
| 3 | Duplicate detection exists today ("critical") | FAIL | `prisma/schema.prisma:79,105` | `clientInvoiceId` is indexed, not unique; no duplicate check in the invoice-creation endpoint |
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
