# CittaEFS Multi-Tenant Integration Hub & NRS E-Invoicing Gateway

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React_19-20232A?style=flat&logo=react&logoColor=61DAFB)
![Express](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma_ORM-2D3748?style=flat&logo=prisma&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![WebSockets](https://img.shields.io/badge/WebSockets-Live_Telemetry-brightgreen)

A high-performance enterprise integration platform and middleware built for multi-tenant ERP connectivity, automated fiscal normalization, and national tax authority (**KRA NRS**) e-invoicing compliance.

CittaEFS normalizes heterogeneous ERP data—from live REST APIs and database staging views to native Excel/CSV spreadsheet drops—into a standardized fiscal matrix for real-time validation, cryptographic Internal Reference Number (IRN) generation, QR code generation, and direct tax authority submission.

---

## 🌟 Key Architecture & Enterprise Highlights

### 1. Multi-Tenant ERP Connector Architecture
* **QuickBooks Online (QBO) [ACTIVE & LIVE]**: Native REST API integration featuring OAuth2 token exchange, automatic token refresh, webhook CDC (Change Data Capture) ingestion, and direct writeback of assigned IRNs/QR codes to QBO invoice notes.
* **Extensible Enterprise Adapters**:
  * **SAP S/4HANA**: OData REST API (`API_INVOICE_SRV`) integration with CSRF handshake support.
  * **NetSuite SuiteTalk**: RESTlets with Token-Based Authentication (TBA / HMAC-SHA256).
  * **Odoo ERP**: JSON-RPC context endpoint connector.
  * **Custom SQL DB Staging**: PostgreSQL and SQL Server staging table poller (`vw_pending_invoices`).
  * **S3 CSV Direct Drops**: Asynchronous AWS S3 bucket watcher for bulk invoice ingestion.

### 2. Intelligent Spreadsheet Ingestion Engine (.xlsx / .xls / .csv)
* **SheetJS Integration**: Drag-and-drop client and server spreadsheet parser supporting multi-sheet Excel files.
* **Automatic Multi-Item Line Grouping**: Automatically groups individual spreadsheet rows sharing the same `clientInvoiceNumber` into multi-line item invoice payloads.
* **Dry-Run Validation & Downloadable Fiscal Templates**: Pre-validates spreadsheet fields before submission and provides downloadable `.xlsx` templates pre-configured with required fiscal columns.

### 3. Role-Based Access Control (RBAC) System
Pre-middleware authentication gate providing isolated interfaces and permissions across four enterprise user roles:
* 👑 **Administrator (`ADMIN`)**: Full access across all multi-tenant configurations, client onboarding, security policies, and system purges.
* ⚙️ **Integration Manager (`INTEGRATION_MANAGER`)**: Manages connector API keys, OAuth credentials, field mapping rules, and webhook streams.
* 📋 **Ingestion Operator (`OPERATOR`)**: Oversees day-to-day invoice creation, batch spreadsheet uploads, and customer directory management.
* 🔍 **Compliance Auditor (`AUDITOR`)**: Read-only access to cryptographic audit logs, KRA NRS submission statuses, and tax reconciliation metrics.

### 4. 4-Stage Fiscal Data Normalization Pipeline
1. **Stage 01 — Source Extraction**: Ingestion via live Webhook, API pull, SQL staging poller, or Excel drop.
2. **Stage 02 — EFS Excel Matrix**: Normalization of source fields into standardized schema columns (`clientInvoiceNumber`, `customerTin`, `hsCode`, `vatRate`, `currency`).
3. **Stage 03 — Taxonomy & Rule Verification**: Real-time validation against KRA NRS rules, including B2B TIN lookup, 8-digit HS code verification, and 16% VAT auto-calculation.
4. **Stage 04 — NRS Gateway Transmission**: Submission to NRS portal with SHA-256 cryptographic hashing, IRN assignment, and official QR code generation.

### 5. Asynchronous Queue & Live Telemetry Engine
* **In-Memory / Database Job Queue**: Non-blocking asynchronous job processor with configurable worker concurrency, retry backoff, and dead-letter queueing.
* **WebSockets Live Telemetry**: Real-time WS channel pushing processing state changes, queue depth updates, and incoming webhook payloads directly to the frontend.

---

## 🗺️ System Architecture & Data Flow

```
+-----------------------------------------------------------------------------------+
|                                 SOURCE ERP DATA                                   |
|   +-------------------+   +--------------------+   +--------------------------+   |
|   | QuickBooks REST   |   | Custom SQL Staging |   | Excel / CSV Drops (.xlsx)|   |
|   +---------+---------+   +---------+----------+   +------------+-------------+   |
+-------------|-----------------------|---------------------------|-----------------+
              |                       |                           |
              v                       v                           v
+-----------------------------------------------------------------------------------+
|                        CITTAEFS INTEGRATION HUB (SERVER)                          |
|  +-----------------------------------------------------------------------------+  |
|  | Express REST API & WebSockets Telemetry Server                              |  |
|  | - Authentication Gate & JWT RBAC Validation                                 |  |
|  | - Zod Schema Ingestion Validation (`invoiceIngestionSchema`)                |  |
|  +-------------------------------------+---------------------------------------+  |
|                                        |                                          |
|  +-------------------------------------v---------------------------------------+  |
|  | 4-Stage Fiscal Engine & Queue Worker Pool (`invoiceQueue`)                  |  |
|  | - Tax Rules & 16% VAT Calculation Engine                                    |  |
|  | - Cryptographic SHA-256 Hashes & IRN Generator                               |  |
|  | - Encrypted Credential Manager (`packEncryptedString`)                       |  |
|  +-------------------------------------+---------------------------------------+  |
|                                        |                                          |
|  +-------------------------------------v---------------------------------------+  |
|  | Prisma ORM Persistence Layer (SQLite / PostgreSQL)                          |  |
|  +-----------------------------------------------------------------------------+  |
+----------------------------------------|------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                            KRA NRS TAX AUTHORITY PORTAL                           |
|      (Cryptographic Stamp Verification, IRN Validation & Tax Certification)       |
+-----------------------------------------------------------------------------------+
```

---

## 🖥️ Dashboard View Modules

The frontend provides a modular enterprise interface accessible via the top navigation bar:

| Tab Module | Key Capabilities |
| :--- | :--- |
| 📊 **System Overview** | System health dashboard, live invoice throughput charts, submission success rates, and active connector health status. |
| 🔌 **ERP Connectors** | Live QBO REST API connector management, client credential testing, and coming-soon adapter indicators. |
| 📥 **Batch Ingestion** | Drag-and-drop SheetJS Excel/CSV parsing, preview table, dry-run schema validation, and template generator. |
| 🗺️ **Field Mapping** | Interactive 4-stage pipeline visualization showing raw source ERP fields mapping to standardized EFS matrix targets. |
| 📄 **Fiscal Invoices** | Complete invoice registry with status filters (Pending, Processed, Rejected), cryptographic IRN display, and QR code inspection. |
| 📑 **Item Dictionary** | Product master catalog, 8-digit HS Tariff code mapping, unit of measure (UOM) normalization, and VAT rate configuration. |
| 👥 **Customer Directory** | B2B/B2C customer registry with TIN validation, address normalization, and exempt tax flags. |
| ⚖️ **Reconciliation** | Automated batch reconciliation matrix matching client ERP totals against EFS matrix records and NRS portal balances. |
| 🔄 **Queue Monitor** | Real-time worker pool monitor displaying active jobs, processing latency, retry counts, and dead-letter jobs. |
| ⚠️ **Validation Errors** | Real-time taxonomy and schema error inspector with suggested auto-fixes and row-level correction tools. |
| 🔍 **Webhook Inspector**| Live streaming WebSockets log viewer for inspecting raw incoming webhook payloads and headers. |
| 🔒 **Audit Trail** | Immutable audit log recording all user logins, credential updates, schema changes, and fiscal submissions. |
| 🏛️ **Client Portal** | Multi-tenant client view allowing self-service connector testing, invoice status tracking, and tax certificate exports. |
| ⚙️ **Settings** | Tenant isolation configuration, NRS API environment toggles (Sandbox/Production), and master encryption keys. |

---

## 🛠️ Tech Stack & Key Libraries

### Core Architecture
* **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS v4, Motion (Framer Motion), Lucide React Icons
* **Backend**: Express 4, TypeScript (`tsx`), Prisma ORM 5, WebSockets (`ws`), Zod Schema Validation
* **Spreadsheet Processing**: SheetJS (`xlsx`)
* **Visualizations & Charts**: Recharts
* **Integration Services**: `intuit-oauth` (QuickBooks REST API client), `@google/genai`

---

## 🚀 Local Development & Getting Started

### 1. Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher

### 2. Installation & Setup

```bash
# 1. Clone the repository
git clone https://github.com/cittaefs/citta-efs-hub.git
cd citta-efs-hub

# 2. Install dependencies
npm install

# 3. Configure environment variables (.env)
cp .env.example .env
```

### 3. Database Initialization & Seeding

```bash
# Generate Prisma Client & Push Database Schema
npx prisma generate
npx prisma db push

# Seed default multi-tenant sample data and RBAC users
npm run seed
```

### 4. Run Development Server

```bash
# Starts Express backend and Vite development server on port 3000
npm run dev
```

Navigate to `http://localhost:3000` in your web browser.

### 5. Run Verification & Test Suite

```bash
# Runs code verification checks and automated integration tests
npm run test
```

---

## ☁️ Production Build & Deployment

### Build Scripts
This application uses `esbuild` to compile `server.ts` into a self-contained CommonJS bundle in `dist/server.cjs` while maintaining Vite static asset builds:

```bash
# Production Build Command
npm run build

# Start Production Server
npm run start
```

### Deployment Configuration (Render.com / Cloud Run)
When deploying to cloud platforms such as **Render.com** or **Cloud Run**:

1. **Environment Variables**: Set `NODE_ENV=production`, `PORT=3000`, `DATABASE_URL`, `JWT_SECRET`, and `ENCRYPTION_KEY`.
2. **Build Command**: `npm install && npm run build`
3. **Start Command**: `npm run start` (Executes `node start.cjs` which loads `dist/server.cjs`).
4. **Bundling Optimization**: The server build bundles pure JavaScript dependencies (such as `intuit-oauth`, `express`, `jsonwebtoken`, `ws`) directly into `dist/server.cjs` while keeping `@prisma/client` external, ensuring zero missing runtime module errors on cloud deployment platforms.

---

## 📁 Repository Structure

```
.
├── prisma/
│   ├── dev.db                      # Local SQLite database instance
│   ├── schema.prisma               # Multi-tenant database schema
│   └── seed.ts                     # Database seed script
├── scripts/
│   └── checkNoFallbacks.js          # Pre-build verification script
├── src/
│   ├── adapters/
│   │   └── connectorAdapters.ts    # ERP adapter interface & implementation
│   ├── components/                 # React UI Dashboard Modules
│   │   ├── AuditTrailTab.tsx
│   │   ├── ClientPortalTab.tsx
│   │   ├── ConnectorsTab.tsx
│   │   ├── CsvAndConnectorsTab.tsx
│   │   ├── CustomerSyncTab.tsx
│   │   ├── FieldMappingTab.tsx
│   │   ├── ImportTab.tsx
│   │   ├── InvoicesTab.tsx
│   │   ├── ItemDictionaryTab.tsx
│   │   ├── LoginScreen.tsx
│   │   ├── Navbar.tsx
│   │   ├── OverviewTab.tsx
│   │   ├── QueueMonitorTab.tsx
│   │   ├── ReconciliationTab.tsx
│   │   ├── SettingsTab.tsx
│   │   ├── SystemToEfsExcelMapper.tsx
│   │   ├── ValidationErrorsTab.tsx
│   │   └── WebhookInspectorTab.tsx
│   ├── config/                     # Database & encryption configurations
│   ├── crons/                      # Automated background reconciliation crons
│   ├── queues/                     # Async invoice processing queue definitions
│   ├── schemas/                    # Zod validation schemas
│   ├── services/                   # QBO & CittaEFS API client services
│   ├── test/                       # Verification test suite
│   ├── types/                      # TypeScript type definitions
│   ├── workers/                    # Queue worker handlers
│   ├── App.tsx                     # Main layout & router control
│   ├── main.tsx                    # Vite entry point
│   └── index.css                   # Tailwind CSS styling entry point
├── server.ts                       # Express + WebSockets server entry point
├── start.cjs                       # Production startup script
├── vite.config.ts                  # Vite build configuration
├── package.json
└── README.md
```

---

## 🔒 Security & Compliance Standards

* **Credential Encryption**: Client secret keys and database connection strings are encrypted using AES-256 GCM before persistent storage.
* **KRA NRS Tax Standard Alignment**: Enforces 16% VAT auto-calculation, mandatory B2B TIN verification, 8-digit HS Tariff code validation, and cryptographic IRN/QR generation.
* **Tenant Data Boundary Isolation**: Multi-tenant database schema enforces strict query-level isolation per client tenant ID.

---

## 📄 License

Proprietary Enterprise Software • All Rights Reserved CittaEFS Systems.
