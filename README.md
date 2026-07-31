# CittaEFS Multi-Tenant Integration Hub & NRS E-Invoicing Gateway

A high-performance enterprise integration platform and middleware built for multi-tenant ERP connectivity and national tax authority (**KRA NRS**) e-invoicing compliance. 

CittaEFS normalizes heterogeneous ERP data—from live APIs and database staging views to native Excel spreadsheet drops—into a standardized fiscal matrix for real-time validation, cryptographic Internal Reference Number (IRN) generation, and tax submission.

---

## 🌟 Key Architecture & System Highlights

### 1. Active vs. Coming Soon Adapters
* **QuickBooks Online (QBO) [ACTIVE & LIVE]**: Full native REST API and webhook integration for real-time CDC invoice ingestion, live API credential testing, and direct transmission to the CittaEFS gateway.
* **Coming Soon Enterprise Adapters**:
  * **SAP S/4HANA**: OData REST API (`API_INVOICE_SRV`) with CSRF token handshakes.
  * **NetSuite SuiteTalk**: RESTlets with TBA HMAC-SHA256 authentication.
  * **Odoo ERP**: Lightweight JSON-RPC context endpoint.
  * **Custom SQL DB Staging**: PostgreSQL / SQL Server view poller (`vw_pending_invoices`).
  * **S3 CSV Direct Drops**: Automated S3 bucket watcher for async file drops.

### 2. Native Excel (.xlsx / .xls) & CSV Ingestion Engine
* **SheetJS Integration**: Drag-and-drop parser for `.xlsx`, `.xls`, and `.csv` files.
* **Automatic Multi-Item Grouping**: Aggregates separate invoice rows into grouped multi-line items by `clientInvoiceNumber`.
* **Downloadable Fiscal Template**: Generates pre-formatted `.xlsx` batch templates directly from the browser.

### 3. Role-Based Access Control (RBAC) Authentication Gate
Pre-middleware authentication gate allowing instant testing across four core enterprise roles:
* 👑 **Administrator (`ADMIN`)**: Unrestricted access across all tenant settings, onboardings, and system purges.
* ⚙️ **Integration Manager (`INTEGRATION_MANAGER`)**: Focuses on connector credentials, QBO live API tests, and field mappings.
* 📋 **Ingestion Operator (`OPERATOR`)**: Manages daily invoice generation, Excel spreadsheet drops, and customer directory sync.
* 🔍 **Compliance Auditor (`AUDITOR`)**: Read-only access to NRS cryptographic IRNs, audit logs, and reconciliation status.

### 4. System-to-EFS Excel Field Mapping Matrix & 4-Stage Pipeline
Interactive visual pipeline illustrating how raw ERP payloads map to the standardized EFS Matrix and NRS Target Fields:
1. **Stage 01 — Source Extraction**: API Webhook, SQL view poller, or Excel drop.
2. **Stage 02 — EFS Excel Matrix**: Column normalization (`InvoiceNumber`, `CustomerTIN`, `HsOrServiceCode`, `VatRate`).
3. **Stage 03 — Taxonomy & Rule Verification**: TIN validation, 16% VAT auto-calculation, and HS code lookup.
4. **Stage 04 — NRS Gateway Transmission**: Cryptographic hash & QR stamp generation.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher

### Installation & Local Setup

```bash
# Clone repository
git clone https://github.com/cittaefs/citta-efs-hub.git
cd citta-efs-hub

# Install dependencies
npm install

# Start local development server (Port 3000)
npm run dev
```

The application runs on `http://localhost:3000`.

---

## ☁️ Deployment on Render.com
When deploying this full-stack application on Render.com, ensure that the build step installs dependencies and builds correctly:

1. **Build Command:** `npm install && npm run build`
2. **Start Command:** `npm run start`

**Important Fixes Implemented for Render:**
* **Vite Chunking:** Increased `chunkSizeWarningLimit` and added `manualChunks` in `vite.config.ts` to properly split the vendor code (UI, React, Excel parsers).
* **Missing Module (intuit-oauth):** The build process now uses `--packages=external` in the `esbuild` configuration to ensure all Node modules (including `intuit-oauth`) are kept external and properly loaded from `node_modules`. 
* **If you still get "Cannot find module 'intuit-oauth'":** Clear your Render build cache (Settings -> Clear build cache) and trigger a manual redeploy. The `npm install` command will now successfully fetch `intuit-oauth` from the updated `dependencies`.

---

## 🛠️ Tech Stack & Dependencies

* **Frontend Framework**: React 18 with Vite
* **Styling**: Tailwind CSS with custom high-contrast industrial typography
* **Icons**: Lucide React
* **Spreadsheet Parsing**: SheetJS (`xlsx`)
* **Charts & Analytics**: Recharts
* **State Management**: React Context & Hooks with LocalStorage persistence

---

## 📁 Repository Structure

```
├── src/
│   ├── components/
│   │   ├── LoginScreen.tsx          # RBAC authentication & role selector
│   │   ├── Navbar.tsx               # Top banner, tenant picker, and user badge
│   │   ├── ConnectorsTab.tsx        # Active QBO API & Coming Soon connector hub
│   │   ├── CsvAndConnectorsTab.tsx  # Excel (.xlsx) drop parser & SheetJS engine
│   │   ├── SystemToEfsExcelMapper.tsx # Visual field mapping matrix & 4-stage pipeline
│   │   ├── NewConnectorModal.tsx    # Connector configuration modal with eye secrets
│   │   ├── InvoicesTab.tsx          # Fiscal invoices registry & QR/IRN stamps
│   │   ├── ReconciliationTab.tsx   # Tax batch reconciliation engine
│   │   └── CustomerSyncTab.tsx     # B2B & B2C customer directory with TIN checks
│   ├── lib/
│   │   └── store.tsx                # Central Hub State Provider with RBAC user session
│   ├── types/
│   │   └── index.ts                 # TypeScript interfaces & UserRole definitions
│   ├── App.tsx                      # Main application entry point & RBAC guard
│   └── main.tsx                     # Vite mounting point
├── package.json
└── README.md
```

---

## 🔒 Security & Compliance
* **Token Storage**: Encrypted secret masks with toggleable visibility controls (`Eye` / `EyeOff`).
* **Tax Compliance**: Aligned with KRA NRS e-invoicing standards (16% VAT, B2B TIN verification, 8-digit HS Tariff taxonomy).
* **Isolation**: Strict multi-tenant data boundaries enforced per tenant context.

---

## 📄 License
Commercial Enterprise License • Proprietary to CittaEFS Integration Systems.
