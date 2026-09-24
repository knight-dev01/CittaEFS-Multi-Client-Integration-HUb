# CittaHub Revision Plan

**Progress (updated 2026-09-14, branch `refactor/thin-hub-pivot`):** Phases 0–5 implemented and verified (52/52 tests, `checkNoFallbacks` guardrail, `tsc --noEmit`, `vite build`). See per-phase notes below for what's done, what's deliberately deviated from the plan (with rationale), and what still needs a human (team-lead confirmation, staging access, prod DB backup). Phase 6 (rollout) not started. Several bugs found and fixed along the way that weren't in the original plan: a mis-dated migration folder that would break fresh deployments, three CittaEFS invoice-type codes sent backwards (`380`/`381`/`384`), an Express route-ordering bug that 404'd every `/api/entity-mappings` call, and an orphaned-queue-job edge case in the new registration gate.

**Scope:** Revise the existing CittaEFS Multi-Tenant Integration Hub codebase to match the actual project intent — an internal-only tool that pulls invoices from client ERPs and submits them to the CittaEFS Gateway, without owning Customer/Item business data as a managed catalog.

**Approach:** Incremental revision of the existing codebase, not a rebuild. Adapters, queue/worker, auth, encryption, webhooks, and reconciliation crons are already correctly shaped and stay untouched. Only the Customer/Item data model and the tabs built on top of it change.

---

## Guiding principles (keep these visible throughout the work)

1. **EFS is the source of truth for customer/item registration — the hub is not.** There is no API to create/register a customer or item in EFS today. Registration happens only through EFS's own Excel bulk-upload templates, in the EFS product itself.
2. **The invoice API rejects unregistered B2B/B2G buyers.** No auto-create-on-submit exists. B2C invoices may carry an embedded, unregistered buyer.
3. **The hub is internal-only.** Client companies never log in and don't know the hub exists. Your own team (Admin / Integration Manager / Operator / Auditor) are the only users. This validates keeping the existing RBAC, audit log, queue monitor, and reconciliation UI — none of that needs to be removed.
4. **The one thing the hub must persist about a customer/item is a reference, not a record:** the `CittaEFS_Customer_ID` (and equivalent item code) once EFS returns it, so future invoices can use it. Everything else about that customer/item belongs to EFS.
5. **Credit/debit notes already work correctly** in the existing schema (`invoiceTypeCode` 380/393 → CREDIT_NOTE, 384 → DEBIT_NOTE, billing reference IRNs) — no change needed there.

---

## Phase 0 — Prep ✅ mostly done

- [x] Create a dedicated branch off current trunk (e.g. `refactor/thin-hub-pivot`) — do not do this work on `feat/odoo-erp-integration` directly. *Branched off `feat/odoo-erp-integration` (not `main`) so the Odoo adapter/VAT fix/retry work already there is preserved, per this doc's own "out of scope, keep as-is" list.*
- [ ] Take a full backup of the current Postgres schema/data (staging and prod) before any migration work begins — this touches core tables. **Not done — needs you/ops; no staging/prod DB access from this session.**
- [x] Grep the codebase for the previously flagged `16%` / `0.16` VAT rate inconsistency (diagram said 16%, everywhere else says 7.5%) and confirm whether it's live anywhere. Fix if found. *Confirmed no live bug — every real calculation path already uses 7.5% with an explicit comment. Only 3 cosmetic leftovers remain (a dropdown label, a code comment, a UI description string) — not fixed, low priority.*
- [ ] Re-confirm with your team lead: who is expected to handle EFS registration when the hub detects a new customer/item. **Not done — needs you.** (Phase 3 was still built per this doc's own assumption — internal staff via the generated EFS upload file — since that's what's written here; worth a real confirmation regardless.)

---

## Phase 1 — Schema migration (foundation for everything else) ✅ done

**Goal:** Replace the owned `Customer`/`Item` business-data model with a lean mapping/registration-status table. Repurpose `Invoice` as an internal submission/audit record rather than a client-facing invoice book.

- [x] Design a new `EntityMapping` model:
  - `tenantId`
  - `entityType` (`CUSTOMER` | `ITEM`)
  - `sourceErpId` (the ID/code as it exists in the client's ERP)
  - `cittaReferenceCode` (nullable — the `CittaEFS_Customer_ID` or item code once registered)
  - `status` (`MAPPED` | `PENDING_REGISTRATION`)
  - Minimal display fields needed only to show a human what they're registering (name, TIN if present, etc.) — not a full business-object schema.
  - *Also added `sourceErp` and `detailsJson` beyond the plan's field list, and a unique constraint on `[tenantId, entityType, sourceErpId]` — needed for the gate's lookup and Phase 3's export.*
- [x] Write the Prisma migration. Do not drop the old `Customer`/`Item` tables in the same migration — deprecate first (see Phase 4), drop later once the new flow is verified in production. *Both models marked `@deprecated` with doc comments in `schema.prisma`; not dropped.*
- [x] Decide and document `Invoice`'s new role explicitly. *Doc comment added above the `Invoice` model; no functional change.*
- [x] Update all foreign keys / relations currently pointing at `Customer`/`Item` to point at `EntityMapping` instead. *Turned out to be a non-issue: `Invoice`/`InvoiceLineItem` already store `customerCode`/`itemCode`/`hsOrServiceCode` as plain denormalized strings, not foreign keys — nothing to repoint.*
- [ ] Run the migration against a copy of production data (not prod itself) and verify no orphaned records. **Not done — no access to a prod data copy. Migration was applied and smoke-tested against the local dev DB only.**

**Acceptance criteria:** ✅ met locally — new schema in place, old Customer/Item tables present but no longer written to by new code, full test suite passes.

*Separately found and fixed while touching migrations: `20250901170000_citta_writeback_both_default` was mis-dated (2025 instead of 2026), sorting it before `postgres_init` — would break `prisma migrate deploy` on any fresh database. Renamed; anyone with this migration already applied under the old name needs to run `UPDATE _prisma_migrations SET migration_name = '20260901170000_citta_writeback_both_default' WHERE migration_name = '20250901170000_citta_writeback_both_default';` before deploying this branch there.*

---

## Phase 2 — Registration-gate pipeline stage ✅ done (customers only — see note)

**Goal:** Before submitting an invoice to EFS, verify every customer/item it references has a `MAPPED` entry. If not, route to a new pending state instead of attempting submission.

- [x] Add a pipeline step (between Stage 03 "Taxonomy & Rule Verification" and Stage 04 "NRS Gateway Transmission" in the existing 4-stage pipeline) that checks `EntityMapping` for every customer/item on the invoice. *Implemented in `invoiceWorker.ts`, exactly at that boundary. Gates **customers only** for B2B/B2G invoices — see deviation note below.*
- [x] Add a new invoice status: `NEEDS_EFS_REGISTRATION`.
- [x] On missing mapping: set invoice to `NEEDS_EFS_REGISTRATION`, create/update the relevant `EntityMapping` row with `status: PENDING_REGISTRATION`, and do **not** enqueue the invoice for EFS submission yet.
- [x] On successful mapping resolution (see Phase 3), automatically re-evaluate and requeue any invoices stuck in `NEEDS_EFS_REGISTRATION` for the now-mapped entity.
- [x] Update the queue/worker (`invoiceWorker.ts`) to treat `NEEDS_EFS_REGISTRATION` as a distinct terminal-for-now state. *Added a new `QueueJob` status, `NEEDS_REGISTRATION`, distinct from `COMPLETED` (success) and `DLQ` (permanent failure needing manual replay) — reusing either would have misrepresented what happened in the Queue Monitor.*

**Acceptance criteria:** ✅ met — verified with dedicated tests (Phase 5).

**Deviation — item registration is deliberately NOT gated.** The Section E spec's own answers conflict: the Interface sheet says items must be registered for both B2B and B2C, but the Item sheet's dedicated B2C answer says *"item is not registered for integration — full item details are required"* (no pre-registration for the API path). `EntityMapping` already supports `entityType: ITEM` for whenever this is resolved, but building a hard gate against contradictory evidence risked blocking every invoice on a queue that might not actually need to exist. Needs a direct answer from the CittaEFS engineer before extending the gate to items.

**Bug found and fixed post-implementation:** the gate didn't check whether `dbInvoiceId` corresponded to a real `Invoice` row before acting — an orphaned/stale queue job (no backing invoice) would error repeatedly and pollute `EntityMapping` with a mapping for a customer with no real invoice. Fixed: orphaned jobs now route straight to DLQ instead.

---

## Phase 3 — EFS registration assist ✅ done

**Goal:** Give internal staff a fast path to register a pending customer/item in EFS, since no API exists to do it programmatically.

- [x] Build an export function that generates the exact EFS Excel bulk-upload template format (per the Section E spec: exact sheet name, header row, column order, date/decimal formatting) pre-filled with data for all `PENDING_REGISTRATION` entities for a tenant. *`GET /api/entity-mappings/:tenantId/export` — sheet name `"Customer Template"` (case-sensitive, per spec), backfills email/address fields from the deprecated `Customer`/`Item` tables when available since the invoice payload alone doesn't carry full address data. Built for both `CUSTOMER` and `ITEM` structurally, though only customer rows exist today (Phase 2 doesn't gate items).*
- [x] Add a "Download EFS Registration File" action in the internal UI — *done as part of Phase 4's `CustomerSyncTab` rework.*
- [x] Document the manual step clearly in-app. *A "How registration works" expandable section in `CustomerSyncTab`.*
- [x] Add a manual "Confirm Registered" action. *`POST /api/entity-mappings/:id/confirm`, logic extracted into `src/services/entityMappingService.ts` for testability; marks the mapping `MAPPED` and requeues every invoice stuck in `NEEDS_EFS_REGISTRATION` for that customer.*
- [ ] (Optional, lower priority) automate the confirmation step if EFS ever exposes a lookup endpoint — still not available per the spec; correctly left undone.

**Acceptance criteria:** ✅ met — smoke-tested end-to-end against the local dev DB (export round-tripped through a real xlsx encode/decode; confirm correctly reset a stuck invoice back to `PENDING_NRS_STAMP`).

---

## Phase 4 — UI rework ✅ done (customers) — items deliberately skipped, see note

**Goal:** Repurpose the existing Customer/Item UI surfaces from "manage our business data" into "manage pending EFS registrations."

- [x] `CustomerSyncTab` → rename/reframe as a "Customer Registrations" view: list `EntityMapping` rows filtered to `entityType: CUSTOMER`, grouped by status (`MAPPED` / `PENDING_REGISTRATION`), with the Phase 3 export/confirm actions surfaced here. *Fully rewritten around `EntityMapping`; old add/edit/delete customer CRUD removed entirely.*
- [ ] `ItemDictionaryTab` → same treatment for items. **Deliberately not done.** This tab manages the client-SKU → HS/service-code dictionary used for tax-code inference during ingestion (still read by `invoiceWorker.ts`'s Stage 03 normalization) — a Hub-owned lookup, not CittaEFS item registration. Since Phase 2 never gates or creates `ITEM` `EntityMapping` rows, reframing this tab as a registration queue would show a permanently empty, misleading list and remove a feature still genuinely needed. Added a one-line caption clarifying the distinction instead.
- [x] Update `Navbar`/tab labels accordingly. *"Customers" → "Customer Registrations". "Items" label left as-is, consistent with the above.*
- [x] Remove any remaining "add/edit customer" ... forms. *Done for customers. Item mapping's add/edit form kept — see note above, it's not the same kind of "business data ownership" the plan is targeting.*
- [x] Update `InvoicePreview.tsx` if it references old `Customer`/`Item` models directly. *Checked — no direct references found, nothing to change.*

**Acceptance criteria:** ✅ met for customers. Items intentionally out of scope for this phase per the note above.

---

## Phase 5 — Testing & validation ✅ mostly done

- [x] Update `src/test/verifyAll.ts` to cover: `EntityMapping` creation/lookup, the registration-gate pipeline branch, the `NEEDS_EFS_REGISTRATION` state transition, and the requeue-on-mapping-resolved logic. *4 new tests added (Module 12). Suite now 52/52. Confirm/requeue logic extracted into `entityMappingService.ts` specifically so it could be tested without bootstrapping HTTP/auth.*
- [ ] Manually test the full loop end-to-end on staging. **Not done — needs you; no staging/connected-ERP access from this session.**
- [x] Confirm `scripts/checkNoFallbacks.js` still passes. *Re-verified repeatedly through every phase.*
- [x] Spot-check that existing QBO and Odoo ingestion still work unchanged. *Covered implicitly — Modules 9 and 11 (QBO/Odoo tests) still pass unchanged.*

**Side effects of this phase, not in the original plan:**
- Found the dev DB had accumulated ~105 test-generated invoices/queue jobs plus 48 truly orphaned queue rows from pre-existing tests (Async Queue Engine, QBO, Odoo, duplicate-detection) that never cleaned up after themselves — the new registration gate made this visible for the first time by giving it a status trail. Cleaned up the dev DB and added teardown to those four pre-existing test blocks so it won't reaccumulate. (Verified: ran the full suite twice in a row, `entity_mappings` count stayed at 0 afterward.) Note: a handful of harmless terminal `COMPLETED`/`DLQ` queue rows from *other*, untouched tests still remain — inert, never reprocessed, not chased further.
- Found and fixed a route-ordering bug: `entityMappingsRouter` was registered *after* `systemRouter` in `server.ts`, and `system.ts` has a catch-all `router.use("/api/*", ...)` 404 handler — every `/api/entity-mappings` call was being swallowed before reaching the real route. Reordered.

---

## Phase 6 — Rollout ⏳ not started

- [ ] Deploy schema migration to production during a low-traffic window; monitor for orphaned invoice references.
- [ ] Run both old and new Customer/Item tables in parallel for one release cycle before dropping the old tables, in case of rollback need.
- [ ] Once confident, drop the deprecated `Customer`/`Item` tables in a follow-up migration.
- [ ] Update `README.md` and `docs/` to reflect the corrected architecture (this also fixes the previously-noted stale "per-tenant gateway key" documentation drift while you're in there).

---

## Unplanned fixes made alongside this revision (not in the original scope, found along the way)

- **`380`/`381`/`384` invoice type codes were sent backwards.** Confirmed against CittaEFS's own "VALID CODES FROM SYSTEM" list embedded in its bulk-upload template: `380` = Credit Note, `381` = Commercial Invoice, `384` = Debit Note. The live code had `381`→Commercial (should be `380`→Credit Note) and vice versa, plus `383` for debit notes (not a valid CittaEFS code at all). Fixed in `cittaEfsClient.ts` and `ExcelDocumentViewer.tsx` — the credit-note case was serious: credit notes were being submitted to NRS indistinguishable from ordinary invoices.
- **A hardcoded live-looking secret in `prisma/schema.prisma`** (`cittaApiKey` column default) and **a GitHub PAT embedded in the git remote URL** — both flagged as urgent, separate from this revision; rotation is on you/your GitHub admin, not something fixed in code.

---

## Explicitly out of scope for this revision (do not touch)

- ERP adapters (QuickBooks, Odoo) — working, keep as-is.
- Queue/worker system, exponential backoff, DLQ, orphan recovery.
- RBAC, JWT auth, AES-256-GCM credential encryption.
- Webhooks (CittaEFS inbound, QBO CDC).
- Reconciliation crons.
- HS/service code reference catalog (`hsCodes.json`, `serviceCodes.json`) — this is compliance reference data, not owned business data, and is correctly modeled already.

## Tracked separately (future phases, not part of this revision)

- SAP Business One / S/4HANA adapter build-out.
- NetSuite and Custom SQL adapters.
- Revisiting EFS registration automation if/when a real registration API ships (currently "Phase 5" per the client's own spec workbook, unrelated to the phase numbering in this document).
