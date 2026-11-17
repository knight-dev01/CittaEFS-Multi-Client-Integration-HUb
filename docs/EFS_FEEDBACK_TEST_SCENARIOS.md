# EFS feedback email — test scenarios (QuickBooks Online & Odoo)

Goal: create invoices in each ERP, let the hub send them to CittaEFS, and confirm
(1) the ERP gets the writeback and (2) the client's email gets the right feedback.

## 0. Setup (once)

1. Server env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` set. Optionally `MAIL_BCC` to your own inbox so you see every email.
2. For quick testing, shorten the timers: `ERROR_DIGEST_INTERVAL_MS=60000`, `APPROVAL_DIGEST_INTERVAL_MS=120000` (or use **Send pending feedback now** in Settings).
3. Tenant on **test** CittaEFS mode (Settings → CittaEFS gateway) so nothing hits live NRS.
4. Set the ERP company email to an inbox you can read:
   - QBO: ⚙ → Account and settings → Company → Contact info → *Company email*.
   - Odoo: Settings → Companies → (your company) → *Email*.
5. Hub Settings → **CittaEFS feedback emails**: "Currently sending to" should show that address *via the company email in the connected ERP*, marked **looks real**. Click **Send test email** and confirm it arrives (check spam).

## 1. Recipient checks

| # | Do this | Expect |
|---|---------|--------|
| R1 | Leave override empty | Sends to the ERP company email (source: ERP) |
| R2 | Override = `finance@yourco.ng` and save | Saved; source switches to *the override* |
| R3 | Override = `ops@gmial.com` (misspelt) | Save refused: "has no mail server" |
| R4 | Override = `test@example.com` | Save refused: placeholder domain |
| R5 | Override = `abc` | Save refused: not a valid address |
| R6 | Clear override; set ERP company email to `noreply@example.com` | Re-check shows ERP: **not real**; source falls back to hub users |
| R7 | Remove the ERP company email and the override, tenant with no hub users | Source: *nobody*; server log warns "no recipients"; errors stay queued and go out once an email is added |
| R8 | Override with two addresses `a@yourco.ng, b@yourco.ng` | Both receive the emails |

## 2. Invoice scenarios — QuickBooks Online

The hub pulls **Invoices** from QBO (Sales → Invoices). It does **not** pull QBO *Credit memos* yet (see Known gaps).

| # | Create in QBO | Expected hub/EFS result | Expected email | Expected QBO writeback |
|---|---------------|-------------------------|----------------|------------------------|
| Q1 | **Happy path B2C**: customer with no TIN, 1 line, product mapped to a valid HS code in Items, VAT 7.5% | Approved, IRN issued | Hourly **"invoices approved by NRS"** listing invoice, customer, amount, IRN | IRN in custom field, QR attached |
| Q2 | **Happy path B2B**: customer with valid TIN (10–14 letters/digits) | Approved | Approval email | IRN + QR |
| Q3 | **Service line**: item whose SKU starts `SRV`, or mapped to a service code | Approved | Approval email | IRN + QR |
| Q4 | **Multi-line, mixed goods + service**, one line discounted | Approved; totals match QBO | Approval email | IRN + QR |
| Q5 | **Unmapped product**: new item with no HS code mapping | Validation error `MISSING_HS_CODE`; not sent to EFS | **Error email within minutes**: "Missing or invalid HS / service code" + what to do | Problem note on the invoice |
| Q6 | **Bad TIN**: B2B customer TIN `123` | `INVALID_TIN_FORMAT` | Error email: "Invalid customer TIN" | Problem note |
| Q7 | **EFS/NRS rejects it** (e.g. a TIN that's well-formed but unknown to NRS, or a VAT rate EFS rejects) | `GATEWAY_REJECTED` (inline or via webhook) | Error email: "Rejected by CittaEFS / NRS" with EFS's reason | Problem note |
| Q8 | **Fix and resend**: correct Q5/Q6 in QBO and save | Picked up again; approved | Approval email for the fixed invoice (the old error is not re-sent) | IRN + QR |
| Q9 | **Bulk**: create 10 invoices quickly, 3 with unmapped items | 7 approved, 3 errors | **One** error email listing all 3 (not 3 emails); one approval email listing 7 | Per invoice |
| Q10 | **Foreign currency** (USD customer) | Check it's approved with currency USD | Approval email shows `$` amount | IRN + QR |
| Q11 | **Zero-rated / exempt line** (VAT 0%) | Approved, or a clear EFS rejection | Matching email | Matching writeback |
| Q12 | **Invoice number with a dash** (`INV-1001`, QBO default style) | Confirm the hub accepts it (the template rule is caps + numbers only) — if rejected, the error email must say why | Error or approval | — |

## 3. Invoice scenarios — Odoo

The hub pulls customer invoices (`out_invoice`) and credit notes (`out_refund`).

| # | Create in Odoo (Invoicing → Customers) | Expected hub/EFS result | Expected email | Expected Odoo writeback |
|---|-----------------------------------------|-------------------------|----------------|-------------------------|
| O1 | **Happy path B2C**: partner without VAT/TIN, mapped product, *Confirm* the invoice | Approved | Approval email | IRN + QR attachment |
| O2 | **Happy path B2B**: partner with *Tax ID* (`vat`) set to a valid TIN | Approved | Approval email | IRN + QR |
| O3 | **Multi-line with service product** | Approved | Approval email | IRN + QR |
| O4 | **Credit note linked to an approved invoice**: open O1 → *Credit Note* → reverse | Sent as type 380 with the original IRN as billing reference; approved | Approval email for the credit note | IRN + QR on the credit note |
| O5 | **Credit note whose original was never approved** (reverse an invoice that failed) | Error: 380 requires a billing reference IRN | Error email | Problem note |
| O6 | **Unmapped product** | `MISSING_HS_CODE` | Error email within minutes | Problem note |
| O7 | **Bad partner Tax ID** (`123`) | `INVALID_TIN_FORMAT` | Error email | Problem note |
| O8 | **EFS/NRS rejection** | `GATEWAY_REJECTED` | Error email with EFS reason | Problem note |
| O9 | **Draft invoice** (not confirmed) | Not picked up | No email | None |
| O10 | **Fix and resend** O6/O7 | Approved | Approval email | IRN + QR |
| O11 | **Odoo-style number** (`INV/2026/00012`) | Confirm accepted (slashes vs the caps+numbers rule) | Error or approval | — |

## 4. Email behaviour checks

| # | Check | Expect |
|---|-------|--------|
| E1 | Error arrives → time to inbox | ≤ ERROR_DIGEST_INTERVAL_MS (2 min default) |
| E2 | Approval arrives → time to inbox | ≤ 1 hour (default) |
| E3 | Same error is not emailed twice | Second run sends nothing for it |
| E4 | Webhook replays the same rejection | Only one error row / one email line |
| E5 | SMTP down (wrong `SMTP_PASS`) during a run | Nothing marked as sent; emails go out on the next run after fixing it |
| E6 | Two tenants, both with errors | Each gets their own email; no cross-tenant data |
| E7 | Customer name with `<b>` / `&` in it | Shows as text in the email, not formatting |
| E8 | First deploy with existing history | No flood: old errors/approvals are pre-marked as sent by the migrations |
| E9 | Reply to a feedback email | Email says not monitored; auto-replies suppressed |

## Known gaps found while writing this

- **QBO credit memos are not synced** — the QBO pull only queries `Invoice`. QBO credit notes need a `CreditMemo` query before Q-series credit-note tests are possible.
- **Keyword HS-code guessing still exists in `src/adapters/connectorAdapters.ts`** (`inferServiceCode`) even though the worker no longer guesses. Q5/O6 may be auto-classified instead of erroring until that's removed.
- **Invoice-number rule** (`INVOICE_NUMBER_PATTERN`: caps + digits only) may reject default QBO (`INV-1001`) and Odoo (`INV/2026/00012`) numbers — Q12/O11 will tell you.
