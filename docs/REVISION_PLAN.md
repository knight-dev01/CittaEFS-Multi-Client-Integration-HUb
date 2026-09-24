> **Superseded.** The open questions below were answered by the team leads via `CittaHub_Revision_Plan.md`, `CittaEFS_User_Manual_v2.pdf`, and `CittaHub_Section_E_Spec-5.xlsx` (all in this folder). **`CittaHub_Revision_Plan.md` is the plan of record going forward.** This document is kept for its evidence trail (§2) and is no longer the active plan.

# CittaEFS Hub — Revision Plan (Pass-Through Model)

**Trigger:** Team-lead review feedback (week of 2026-09-08) that the current build does not match the intended project model.
**Status:** Phase 0 — Discovery & Gap Analysis (this document). No code changed yet.

---

## 1. What the team leads actually said (reconstructed)

Based on the feedback relayed:

1. The Hub is **not** supposed to be a system of record. It is a **pass-through / transit layer**: pull invoices from a client's ERP → normalize → send to the CittaEFS Gateway → CittaEFS forwards to NRS → stamp (IRN/QR) flows back to the ERP.
2. **CittaEFS already owns customer and product/item master data.** The Hub should not be maintaining its own independent customer/item catalog as a source of truth.
3. When the Hub encounters a customer or product it hasn't seen before, it should **register it with CittaEFS** (create-if-new). If CittaEFS already has that customer/product, the Hub should **not** try to recreate it — it should recognize the existing record and just reference it (e.g. by a CittaEFS-issued ID).
4. Credit notes, debit notes, and "other invoicing terms" were raised as things the Hub needs to handle correctly — implying the current handling is incomplete or not aligned with what NRS/CittaEFS expects.

This is a **data-ownership correction**, not just a UI or feature request: today the Hub's Postgres database is being treated as the master store for tenants, customers, items, and invoices. The corrected model treats CittaEFS as the master for customer/product data, and treats invoices as something the Hub **relays**, keeping only what it needs for retry, audit, and reconciliation — not as a parallel permanent ledger.

---

## 2. What the current codebase actually does (evidence)

### 2.1 Customers and Items are stored and managed entirely locally

- `src/routes/customers.ts` — `POST /api/customers` writes directly to `prisma.customer.create(...)` (`customers.ts:41-95`). There is **no outbound call to CittaEFS** anywhere in this file. Same for `PUT`/`DELETE`.
- `src/routes/items.ts` — same pattern: local CRUD only, no gateway registration call.
- `prisma/schema.prisma` — `Customer.cittaCustomerId` exists as a column, but nothing in the codebase ever populates it. It is written once, at record creation, as `null`, and never updated.
- This is not a new discovery — it was already flagged internally in `docs/COMPLIANCE_AUDIT_SECTION_E.md` (2026-08-24), Customer row #7: *"No live registration endpoint exists yet to populate it... it reads null until one does."* That gap was never closed; it's the same gap the team leads are now raising from the business side.

### 2.2 Invoice submission embeds customer/item data inline — it doesn't reference a registered record

- `src/services/cittaEfsClient.ts` (`signAndStampInvoice`) builds a DTO per invoice that includes `customerCode`, `customerName`, `customerTin`, and per-line `itemName`/`itemDescription`/`hsOrServiceCode` **inline in the invoice payload** (`cittaEfsClient.ts:104-268`). There is no separate "get or create customer" / "get or create item" call before this — customer and item identity is asserted fresh on every invoice, rather than resolved against a CittaEFS-side master record.

### 2.3 No CittaEFS customer/product API is referenced anywhere in this repo

Searched `docs/odoo-integration.md`, `docs/quickbooks-integration.md`, `.agents_tmp/PLAN.md`, and all `src/services/*.ts` files: the only documented/implemented CittaEFS Gateway endpoints are invoice-lifecycle ones:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/integration/gen/invoices` | Submit invoice(s) |
| GET | `/api/einvoice/archive` | Fetch archived invoices |
| GET | `/api/einvoice/errors/{validation,transmit,sign}` | Error lookups |
| PATCH | `/api/einvoice/update/{irn}` | Update payment status |
| PATCH | `/api/einvoice/bulk/update` | Bulk payment update |

**There is no known customer-registration or product-registration endpoint documented anywhere in this codebase.** This is the single biggest blocker to Phase 1 (see open questions below) — either that endpoint exists and was never given to whoever built this, or it doesn't exist yet and needs to be requested from CittaEFS.

### 2.4 Credit/debit note support exists, but only partially

Found in: `src/schemas/invoice.schema.ts`, `src/services/cittaEfsClient.ts`, `src/components/InvoicesTab.tsx`, `NewInvoiceModal.tsx`, `SuccessfulTab.tsx`, `connectorAdapters.ts`, `qboService.ts`.

- `invoiceTypeCode` mapping exists: `380`/`393` → `CREDIT_NOTE`, `384` → `DEBIT_NOTE` (per the earlier full documentation pass).
- `docs/COMPLIANCE_AUDIT_SECTION_E.md` (Invoice & tax #3) already flagged: the code uses `388` for a standard commercial invoice where the spec workbook says it should be `380` — **this is backwards from the credit-note mapping above and needs reconciling against whatever the real NRS code table says**, since `380` cannot simultaneously mean "commercial invoice" and "credit note" in two different parts of the same codebase.
- `Billing Reference IRNs` (the field a credit/debit note uses to reference the original invoice's IRN) is implemented (`cittaEfsClient.ts:155`, `originalIrn` → `billingReferenceIrns`).
- No end-to-end trace has yet been done of the actual UI flow for issuing a credit/debit note (`InvoicesTab.tsx`'s `cnAmount`/`cnReason` fields) against what CittaEFS/NRS require as a full document — that needs its own pass in Phase 3 below.

---

## 3. Open questions — need team-lead or CittaEFS answers before Phase 1 can start

These are blocking, not stylistic. Guessing at any of them risks building the wrong integration a second time.

1. **Does CittaEFS expose a customer/product registration API today?** If yes: endpoint(s), request/response shape, auth, and the "already exists" behavior (does it return the existing ID, an error, or silently no-op?). If no: is invoice submission itself expected to implicitly register a customer/product on first use (i.e., does the invoice-submit response return a `cittaCustomerId`/`cittaProductId` the Hub should then store as the reference)?
2. **What uniquely identifies a customer/product to CittaEFS across repeated submissions?** TIN for customers? A code/SKU for products? This determines what the Hub sends to ask "does this already exist."
3. **Once a customer/product is "known" to CittaEFS, what should the Hub retain locally, if anything?** Full continued local storage seems to conflict with the "pass-through" instruction — most likely answer is: keep just enough of a local reference table to avoid re-registering the same customer/product on every sync (mapping `clientCustomerCode` → `cittaCustomerId`), and stop treating the local `Customer`/`Item` tables as an editable master catalog with their own CRUD UI.
4. **What should happen to the existing standalone Customer/Item management UI** (`CustomerSyncTab.tsx`, `ItemDictionaryTab.tsx`, manual add/edit/delete)? Should manual customer/item creation be removed entirely (since CittaEFS is now the source of truth), or kept only as a local reference cache that's read-only once synced?
5. **Credit/debit note code table** — what are the actual NRS/CittaEFS numeric type codes for: standard invoice, credit note, debit note, and any other document type the team leads meant by "other invoicing terms" (e.g. proforma invoice, self-billed invoice)? The current `380` vs `388` inconsistency (§2.4) needs a definitive answer.
6. **Invoice persistence**: is the Hub allowed to keep a local `Invoice` row at all (needed practically for retry/backoff, audit trail, and reconciliation with the gateway), or should even that be minimized to an in-flight/transient record that's purged once CittaEFS confirms receipt? "Pass-through" almost certainly still allows a short-lived staging record — full removal of invoice persistence would break the existing retry/DLQ/reconciliation design (`invoiceQueue.ts`, `reconciliation.ts`) which depends on a durable local row to know what to retry.

---

## 4. Proposed phased plan

| Phase | Goal | Depends on |
|---|---|---|
| **Phase 0** (this doc) | Discovery & gap analysis; produce the open-questions list above | — |
| **Phase 1** | Get answers to §3 from team leads / CittaEFS API docs; write a short design note translating answers into a concrete data-flow diagram (what's sent to CittaEFS, what's cached locally, when) | Phase 0 |
| **Phase 2** | Implement customer/product "resolve-or-register" against CittaEFS: on ingestion, look up (or create) the customer/product via the real CittaEFS API instead of local-only CRUD; store only the returned `cittaCustomerId`/`cittaProductId` reference locally | Phase 1 answers |
| **Phase 3** | Retire or repurpose the standalone Customer/Item management tabs per the Phase 1 decision (§3 Q4); update onboarding/import flows so customers/items are always resolved through CittaEFS, never invented locally | Phase 2 |
| **Phase 4** | Fix credit/debit note type-code mapping using the confirmed NRS code table; add support for any additional document types identified in §3 Q5; verify `Billing Reference IRNs` end-to-end for a real credit note against a real original invoice | Phase 1 answers |
| **Phase 5** | Reconcile invoice persistence scope: keep only what retry/audit/reconciliation genuinely need locally, per the Phase 1 answer to §3 Q6; update `docs/PROJECT_DOCUMENTATION.md` and `README.md` to reflect the corrected architecture | Phase 1 answers |
| **Phase 6** | Regression pass: re-run `docs/COMPLIANCE_AUDIT_SECTION_E.md`-style audit against the revised implementation; update that audit doc | Phases 2–5 |

---

## 5. Immediate recommendation

Before writing any code, take the six questions in §3 back to the team leads (or whoever holds the CittaEFS integration/API spec — the same source that produced `CittaHub_Section_E_Spec-5.xlsx`, referenced in the compliance audit). In particular, question 1 (does a customer/product registration API exist) determines almost everything else in Phases 2–3, and building against a guessed API shape would very likely need to be redone.
