# 1. OBJECTIVE

**Build a production-grade CittaEFS Multi-ERP Integration Hub that connects QuickBooks Online, Sage ERP, and Excel file drops to the CittaEFS E-Invoicing Gateway API.**

### Core Requirements (from System Prompt):

1. **Canonical Normalization:**
   - All incoming data (QBO, Sage, Excel) MUST be normalized to `EFS Template.xlsx` standard
   - Use `IntegrationInvoiceLineDto` format before sending to CittaEFS

2. **Asynchronous Processing with BullMQ + Redis:**
   - `ingest-queue`: Raw payloads → Normalized
   - `citta-transmit-queue`: Normalized → CittaEFS API
   - `erp-writeback-queue`: CittaEFS responses → ERP writeback

3. **Multi-Tenant Architecture:**
   - Organization-based tenant isolation
   - Encrypted ERP credentials (OAuth tokens)
   - HMAC-SHA256 webhook signature verification

4. **Data Integrity:**
   - Tax calculation: `taxableAmount = unitPrice × quantity - lineDiscount`
   - Full audit trail with raw payload storage
   - Retry policies with exponential backoff

5. **Supported Source Systems:**
   - QuickBooks Online (OAuth2 REST API)
   - Sage ERP (Intacct + Business Cloud)
   - EFS Template Excel (Bulk file drops)
   - Generic API (future extensibility)

### What We're Building:

| Component | Description |
|-----------|-------------|
| **QBO Adapter** | OAuth2, Invoice extraction, Line items, IRN writeback |
| **Sage Adapter** | XML/REST, Invoice extraction, Tax code mapping |
| **Excel Parser** | Multi-sheet detection, Column validation, Batch queue |
| **CittaEFS Client** | POST invoices, Archive fetch, Payment updates |
| **Webhook Receiver** | HMAC-SHA256 verification, Event handling |
| **BullMQ Workers** | 3 queues with retry/backoff policies |

### What We're Preserving (UI):
- ✅ All React components with animations
- ✅ Tailwind CSS styling
- ✅ Framer Motion transitions
- ✅ WebSocket real-time updates

---

# 2. CONTEXT SUMMARY

### Current System
The existing codebase has a well-designed UI with:
- React frontend with Framer Motion animations
- Tailwind CSS styling
- Express backend with WebSocket support
- Prisma ORM with PostgreSQL
- SheetJS for Excel parsing
- QuickBooks Online OAuth2 integration

### Target Architecture (from System Prompt)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │ QuickBooks   │   │ Sage ERP     │   │ Excel/CSV   │   │ Future APIs │ │
│  │ Online OAuth2│   │ Intacct/Cloud│   │ File Drops  │   │ Generic     │ │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘ │
└──────────┼─────────────────┼─────────────────┼─────────────────┼──────────┘
           │                 │                 │                 │
           ▼                 ▼                 ▼                 │
┌─────────────────────────────────────────────────────────────────────────────┐
│                          INGESTION QUEUE (BullMQ + Redis)                    │
│  ingest-queue: Raw payloads → Normalize → Validate → Zod Schema Check      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NORMALIZATION ENGINE (EFS Template Standard)               │
│                                                                              │
│  NormalizedEFSInvoiceLine {                                                 │
│    invoiceNumber, issueDate, customerCode, itemName, itemDescription,        │
│    quantity, unitPrice, taxAmount, taxableAmount, hsOrServiceCode,          │
│    lineNum, unitCode, taxCategoryId, currencyCode, ...                      │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CITTAEFS TRANSMISSION QUEUE                             │
│  citta-transmit-queue: Batch by invoiceNumber → POST /api/integration/gen   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           ▼                          ▼                          ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────────┐
│ CittaEFS Gateway │   │  Webhook Handler  │   │  ERP Writeback Queue     │
│ ei-api.azurewebs │   │  invoice.signed   │   │  erp-writeback-queue    │
│ - POST invoices  │   │  invoice.paid    │   │  - QBO IRN writeback    │
│ - GET archive    │   │  X-HMAC-SHA256  │   │  - Sage status update   │
│ - PATCH payment │   │                  │   │                         │
└──────────────────┘   └──────────────────┘   └──────────────────────────┘
```

### Database Schema (Prisma)

**New Models Required:**
| Model | Purpose |
|-------|---------|
| `Organization` | Multi-tenant organization with CittaEFS API key (encrypted) |
| `ErpCredential` | Encrypted OAuth tokens for QBO/Sage |
| `Invoice` | Full invoice with raw payload and normalized data |
| `InvoiceLine` | Line items with tax calculations |

### API Endpoints (CittaEFS Gateway)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/integration/gen/invoices` | Submit e-invoices |
| GET | `/api/einvoice/archive` | Fetch archived invoices |
| GET | `/api/einvoice/errors/validation` | Validation errors |
| GET | `/api/einvoice/errors/transmit` | Transmission errors |
| GET | `/api/einvoice/errors/sign` | Signing errors |
| PATCH | `/api/einvoice/update/{irn}` | Update payment status |
| PATCH | `/api/einvoice/bulk/update` | Bulk payment update |

### BullMQ Queue Workers

| Queue | Input | Output |
|-------|-------|--------|
| `ingest-queue` | Raw ERP payloads, Excel files | Normalized Invoice records |
| `citta-transmit-queue` | Normalized records | CittaEFS API response |
| `erp-writeback-queue` | CittaEFS webhook events | ERP status updates |

### UI Preservation
- ✅ Keep all existing React components
- ✅ Keep Framer Motion animations
- ✅ Keep Tailwind CSS styling
- ✅ Add WebSocket progress updates for queue processing

---

# 3. APPROACH OVERVIEW

### Key Principle
Build a **production-grade integration middleware** that normalizes all ERP data to the EFS Template standard before sending to CittaEFS.

### Core Data Flow

```
1. ERP Data Ingestion (QBO/Sage/Excel)
         ↓
2. BullMQ ingest-queue (Normalize + Validate)
         ↓
3. Normalized EFS Template Format
         ↓
4. BullMQ citta-transmit-queue
         ↓
5. CittaEFS Gateway API (IRN Returned)
         ↓
6. BullMQ erp-writeback-queue
         ↓
7. ERP Update (QBO IRN Writeback / Sage Status)
```

### Normalized EFS Invoice Line Schema

```typescript
export interface NormalizedEFSInvoiceLine {
  invoiceNumber: string;        // Required
  issueDate: string;           // YYYY-MM-DD
  customerCode: string;        // Required
  itemName: string;           // Required
  itemDescription?: string;
  quantity: number;           // Required
  unitPrice: number;          // Required
  taxAmount: number;          // Required
  taxableAmount: number;      // Required: unitPrice × quantity - discount
  hsOrServiceCode: string;    // Required
  lineNum: string;           // "1", "2", etc.
  unitCode?: string;         // Default "EA"
  taxCategoryId?: string;    // Default "STANDARD VAT"
  currencyCode?: string;      // Default "NGN"
  invoiceTypeCode?: string;   // Default "381"
  headerDiscount?: number;
  headerCharges?: number;
  lineDiscount?: number;
  metadata?: {
    SourceSystem: 'QUICKBOOKS_ONLINE' | 'SAGE_INTACCT' | 'EFS_TEMPLATE_EXCEL';
    UserID?: string;
    BranchCode?: string;
  };
}
```

### Tax Calculation Rule
```
taxableAmount = unitPrice × quantity - lineDiscount
taxAmount = taxableAmount × vatRate / 100
```

### BullMQ Queue Configuration

| Queue | Concurrency | Retry Backoff | Max Attempts |
|-------|-------------|--------------|--------------|
| `ingest-queue` | 5 | Exponential (1s, 2s, 4s...) | 5 |
| `citta-transmit-queue` | 3 | Exponential (2s, 4s, 8s...) | 3 |
| `erp-writeback-queue` | 2 | Exponential (5s, 10s...) | 3 |

### Architecture
```
┌─────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCES                               │
│  ┌─────────────────┐     ┌─────────────────┐     ┌──────────────┐  │
│  │  QuickBooks     │     │  Excel/CSV      │     │  Future     │  │
│  │  Online OAuth2  │     │  Multi-Sheet   │     │  Adapters   │  │
│  └────────┬────────┘     └────────┬────────┘     └──────┬───────┘  │
└───────────│───────────────────────│──────────────────────│──────────┘
            │                       │                      │
            ▼                       ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SHEETJS PARSER (Multi-Sheet)                      │
│  - Detect sheets: Invoices, Customers, Items                       │
│  - Parse headers and rows                                           │
│  - Validate required columns                                        │
│  - WebSocket progress updates (real-time)                          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              ENCRYPTED MAPPING CONFIGURATION                         │
│  - Field mappings stored in database (AES-256-GCM encrypted)       │
│  - QuickBooks → EFS Excel column mapping                           │
│  - Excel native → EFS Excel column mapping                          │
│  - Transformation rules: TRIM, VALIDATE_TIN, DATE_FORMAT, etc.     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NORMALIZATION ENGINE                              │
│  - Apply field transformations using mapping rules                  │
│  - Calculate VAT (16% default)                                      │
│  - Group invoice line items                                         │
│  - Validate TIN format                                              │
│  - Motion animations for progress feedback                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CITTA EFS API CLIENT                              │
│  - POST invoices to https://ei-api.azurewebsites.net               │
│  - Receive IRN, CSID, QR Code URL                                   │
│  - WebSocket real-time status updates                              │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    RESULTS & INVOICES TAB                            │
│  - Display all processed invoices                                   │
│  - Show IRN, status, QR code                                       │
│  - Filter by status (PENDING, SENT, APPROVED, REJECTED)             │
└─────────────────────────────────────────────────────────────────────┘
```

### Multi-Sheet Excel Format
The user uploads ONE file with multiple sheets (detected automatically):

**Sheet 1: "Invoices"** (required)
| InvoiceNumber | Date | CustomerCode | CustomerName | CustomerTIN | LineItemCode | Description | Quantity | UnitPrice | HSCode | VATRate |
|--------------|------|-------------|-------------|------------|-------------|-------------|---------|-----------|--------|---------|
| INV-001 | 2026-01-15 | CUST-001 | Acme Corp | A123456789 | ITEM-001 | Widget A | 10 | 100 | 8471.30.00 | 16 |
| INV-001 | 2026-01-15 | CUST-001 | Acme Corp | A123456789 | ITEM-002 | Widget B | 5 | 50 | 8471.40.00 | 16 |

**Sheet 2: "Customers"** (optional - can be embedded in invoices)
| CustomerCode | CompanyName | TaxID | Email | Address | City | Classification |
|--------------|------------|-------|-------|---------|------|----------------|
| CUST-001 | Acme Corporation | A123456789 | billing@acme.com | 123 Main St | Nairobi | B2B |
| CUST-002 | John Doe | NULL | john@example.com | NULL | NULL | B2C |

**Sheet 3: "Items"** (optional - can be embedded in invoices)
| ItemCode | Description | UnitPrice | HSCode | Category | VATRate |
|----------|-------------|-----------|--------|---------|---------|
| ITEM-001 | Widget A | 100 | 8471.30.00 | GOODS | 16 |
| ITEM-002 | Consulting Service | 500 | SERV-DEFAULT | SERVICES | 16 |

### Encrypted Mapping Storage
Mapping configurations are sensitive business logic and will be:
1. **Stored in database** with `MappingConfig` table
2. **Encrypted using AES-256-GCM** before storage (using existing `src/config/encryption.ts`)
3. **Decrypted at runtime** when processing files
4. **Admin-only access** to view/edit mappings

---

# 4. IMPLEMENTATION STEPS

> **IMPORTANT:** All frontend components, animations, and styling remain UNCHANGED. Only backend logic is enhanced/built.

---

## Phase 1: Project Setup & Dependencies

**Goal:** Set up BullMQ, Redis, and install required packages.

### Step 1.1: Install New Dependencies
```bash
npm install bullmq ioredis axios zod exceljs
npm install -D @types/bullmq @types/ioredis
```

### Step 1.2: Set Up Redis Connection
Create `src/config/redis.ts`:
```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export default redis;
```

---

## Phase 2: Database Schema (Prisma)

**Goal:** Implement multi-tenant schema with Organization, ErpCredential, Invoice, and InvoiceLine.

### Step 2.1: Update `prisma/schema.prisma`
```prisma
enum SourceSystem {
  QUICKBOOKS_ONLINE
  SAGE_INTACCT
  SAGE_BUSINESS_CLOUD
  EFS_TEMPLATE_EXCEL
  GENERIC_API
}

enum ProcessingStatus {
  PENDING
  VALIDATED
  VALIDATION_FAILED
  TRANSMITTED
  TRANSMISSION_FAILED
  SIGNED
  SIGN_FAILED
}

enum PaymentStatus {
  UNPAID
  PENDING
  PARTIAL
  PAID
  REJECTED
}

model Organization {
  id              String         @id @default(uuid())
  name            String
  cittaApiKey     String         // Encrypted
  webhookSecret   String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  erpCredentials  ErpCredential[]
  invoices        Invoice[]
}

model ErpCredential {
  id             String       @id @default(uuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  sourceSystem   SourceSystem
  accessToken    String       // Encrypted
  refreshToken   String?      // Encrypted
  realmId        String?       // QBO Realm ID or Sage Company ID
  expiresAt      DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}

model Invoice {
  id               String           @id @default(uuid())
  organizationId   String
  organization     Organization     @relation(fields: [organizationId], references: [id])
  sourceSystem     SourceSystem
  sourceInvoiceId  String           // ERP Invoice ID
  invoiceNumber    String
  irn              String?          @unique
  issueDate        DateTime
  customerCode     String
  customerName     String?
  totalAmount      Decimal          @db.Decimal(18, 2)
  taxAmount        Decimal          @db.Decimal(18, 2)
  taxableAmount    Decimal          @db.Decimal(18, 2)
  currency         String           @default("NGN")
  status           ProcessingStatus @default(PENDING)
  paymentStatus    PaymentStatus    @default(UNPAID)
  paymentReference String?
  qrCode           String?
  errorMessage     String?
  rawSourcePayload Json
  normalizedPayload Json
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
  lines            InvoiceLine[]

  @@index([organizationId, sourceSystem, invoiceNumber])
}

model InvoiceLine {
  id              String  @id @default(uuid())
  invoiceId       String
  invoice         Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  lineNum         Int
  itemName        String
  itemDescription String?
  quantity        Decimal @db.Decimal(12, 4)
  unitPrice       Decimal @db.Decimal(18, 2)
  taxAmount       Decimal @db.Decimal(18, 2)
  taxableAmount   Decimal @db.Decimal(18, 2)
  hsOrServiceCode String
  unitCode        String  @default("EA")
  taxCategoryId   String  @default("STANDARD VAT")
}
```

### Step 2.2: Run Migration
```bash
npx prisma migrate dev --name add_multi_tenant_schema
```

---

## Phase 3: BullMQ Queue Workers

**Goal:** Implement 3 core processing queues with retry/backoff policies.

### Step 3.1: Create `src/queues/ingestQueue.ts`
```typescript
import { Queue, Worker } from 'bullmq';
import redis from '../config/redis';
import { normalizePayload } from '../services/normalizer';
import { validateEFSInvoice } from '../services/validator';

export const ingestQueue = new Queue('ingest-queue', { connection: redis });

export const ingestWorker = new Worker('ingest-queue', async (job) => {
  const { sourceSystem, rawPayload, organizationId } = job.data;
  
  // Normalize to EFS Template format
  const normalized = normalizePayload(sourceSystem, rawPayload);
  
  // Validate with Zod
  const validation = validateEFSInvoice(normalized);
  if (!validation.success) {
    throw new Error(`Validation failed: ${validation.error.message}`);
  }
  
  // Add to citta-transmit-queue
  await cittaTransmitQueue.add('transmit', {
    organizationId,
    normalizedPayload: normalized
  });
  
  return { normalized: true };
}, {
  connection: redis,
  concurrency: 5,
  retryStrategy: (attempts) => Math.min(attempts * 1000, 10000)
});
```

### Step 3.2: Create `src/queues/cittaTransmitQueue.ts`
```typescript
import { Queue, Worker } from 'bullmq';
import redis from '../config/redis';
import { cittaEfsClient } from '../services/cittaEfsClient';

export const cittaTransmitQueue = new Queue('citta-transmit-queue', { connection: redis });

export const cittaTransmitWorker = new Worker('citta-transmit-queue', async (job) => {
  const { organizationId, normalizedPayload } = job.data;
  
  // Send to CittaEFS Gateway
  const result = await cittaEfsClient.submitInvoice(normalizedPayload);
  
  // Add to erp-writeback-queue for IRN writeback
  await erpWritebackQueue.add('writeback', {
    organizationId,
    sourceInvoiceId: normalizedPayload.invoiceNumber,
    irn: result.irn
  });
  
  return result;
}, {
  connection: redis,
  concurrency: 3,
  retryStrategy: (attempts) => Math.min(attempts * 2000, 30000)
});
```

### Step 3.3: Create `src/queues/erpWritebackQueue.ts`
```typescript
import { Queue, Worker } from 'bullmq';
import redis from '../config/redis';
import { qboAdapter } from '../adapters/qbo.adapter';
import { sageAdapter } from '../adapters/sage.adapter';

export const erpWritebackQueue = new Queue('erp-writeback-queue', { connection: redis });

export const erpWritebackWorker = new Worker('erp-writeback-queue', async (job) => {
  const { organizationId, sourceSystem, sourceInvoiceId, irn } = job.data;
  
  if (sourceSystem === 'QUICKBOOKS_ONLINE') {
    await qboAdapter.writebackIRN(organizationId, sourceInvoiceId, irn);
  } else if (sourceSystem.startsWith('SAGE_')) {
    await sageAdapter.writebackStatus(organizationId, sourceInvoiceId, 'SIGNED');
  }
  
  return { writeback: true };
}, {
  connection: redis,
  concurrency: 2,
  retryStrategy: (attempts) => Math.min(attempts * 5000, 60000)
});
```

---

## Phase 4: Normalization Engine

**Goal:** Transform all ERP payloads to the canonical EFS Template format.

### Step 4.1: Create `src/services/normalizer.ts`
```typescript
import { qboAdapter } from '../adapters/qbo.adapter';
import { sageAdapter } from '../adapters/sage.adapter';
import { excelAdapter } from '../adapters/excel.adapter';

export function normalizePayload(sourceSystem: string, rawPayload: any): NormalizedEFSInvoiceLine[] {
  switch (sourceSystem) {
    case 'QUICKBOOKS_ONLINE':
      return qboAdapter.normalize(rawPayload);
    case 'SAGE_INTACCT':
    case 'SAGE_BUSINESS_CLOUD':
      return sageAdapter.normalize(rawPayload);
    case 'EFS_TEMPLATE_EXCEL':
      return excelAdapter.normalize(rawPayload);
    default:
      throw new Error(`Unknown source system: ${sourceSystem}`);
  }
}
```

### Step 4.2: Create `src/adapters/qbo.adapter.ts`
```typescript
export function normalize(qboInvoice: QBOInvoice): NormalizedEFSInvoiceLine[] {
  return qboInvoice.Line.map((line, index) => {
    const taxableAmount = (line.SalesItemLineDetail?.Qty || 1) * 
                          (line.SalesItemLineDetail?.UnitPrice || 0) - 
                          (line.DiscountAmt || 0);
    const taxAmount = taxableAmount * 0.075; // 7.5% VAT
    
    return {
      invoiceNumber: qboInvoice.DocNumber,
      issueDate: qboInvoice.TxnDate,
      customerCode: qboInvoice.CustomerRef?.value,
      itemName: line.SalesItemLineDetail?.ItemRef?.name || 'Unknown Item',
      itemDescription: line.Description,
      quantity: line.SalesItemLineDetail?.Qty || 1,
      unitPrice: line.SalesItemLineDetail?.UnitPrice || 0,
      taxAmount,
      taxableAmount,
      hsOrServiceCode: 'SERV-DEFAULT', // Map from QBO item classification
      lineNum: String(index + 1),
      currencyCode: qboInvoice.CurrencyRef?.value || 'NGN',
      metadata: { SourceSystem: 'QUICKBOOKS_ONLINE' }
    };
  });
}
```

---

## Phase 5: CittaEFS Gateway Client

**Goal:** Implement API client for all CittaEFS endpoints.

### Step 5.1: Update `src/services/cittaEfsClient.ts`
```typescript
export class CittaEfsClient {
  private baseUrl = 'https://ei-api.azurewebsites.net';
  
  async submitInvoice(payload: NormalizedEFSInvoiceLine[]): Promise<CittaResult> {
    const response = await axios.post(
      `${this.baseUrl}/api/integration/gen/invoices`,
      payload,
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );
    return response.data;
  }
  
  async getArchive(fromDate: string, toDate: string): Promise<any[]> {
    const response = await axios.get(
      `${this.baseUrl}/api/einvoice/archive`,
      { params: { fromDate, toDate }, headers: this.headers }
    );
    return response.data;
  }
  
  async updatePaymentStatus(irn: string, status: string, reference?: string) {
    await axios.patch(
      `${this.baseUrl}/api/einvoice/update/${irn}`,
      { payment_status: status, reference },
      { headers: this.headers }
    );
  }
}
```

---

## Phase 6: Webhook Receiver

**Goal:** Implement HMAC-SHA256 verified webhook endpoint.

### Step 6.1: Create `src/webhooks/citta.webhook.ts`
```typescript
import crypto from 'crypto';

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const computedHash = hmac.update(rawBody).digest('base64');
  const expectedSignature = `sha256=${computedHash}`;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function handleCittaWebhook(req: Request) {
  const signature = req.headers['x-webhook-signature'];
  const rawBody = req.rawBody;
  
  // Get organization webhook secret from database
  const secret = await getOrganizationWebhookSecret(req.body.TenantId);
  
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return { status: 401, error: 'Invalid signature' };
  }
  
  const { event, data } = req.body;
  
  if (event === 'invoice.signed') {
    await updateInvoiceWithIRN(data.Irn, data.QrCodeUrl);
  } else if (event === 'invoice.payment.updated') {
    await erpWritebackQueue.add('payment-update', {
      organizationId: req.body.TenantId,
      irn: data.Irn,
      paymentStatus: data.payment_status
    });
  }
  
  return { status: 200 };
}
```

---

## Phase 7: Zod Validation

**Goal:** Implement strict validation with tax calculation checks.

### Step 7.1: Create `src/services/validator.ts`
```typescript
import { z } from 'zod';

const NormalizedEFSInvoiceLineSchema = z.object({
  invoiceNumber: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerCode: z.string().min(1),
  itemName: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxAmount: z.number().nonnegative(),
  taxableAmount: z.number().nonnegative(),
  hsOrServiceCode: z.string().min(1),
  lineNum: z.string()
});

export function validateEFSInvoice(payload: NormalizedEFSInvoiceLine[]) {
  // Verify tax calculation: taxableAmount = unitPrice × quantity - discount
  for (const line of payload) {
    const expectedTaxable = line.unitPrice * line.quantity;
    if (Math.abs(line.taxableAmount - expectedTaxable) > 0.01) {
      return { 
        success: false, 
        error: `Tax calculation mismatch for ${line.invoiceNumber}, line ${line.lineNum}` 
      };
    }
  }
  
  return { success: true, data: payload };
}
```

---

## Phase 8: UI Integration

**Goal:** Connect existing UI to new backend services.

### Step 8.1: Add WebSocket Progress Updates
```typescript
// In server.ts - emit queue progress to WebSocket clients
ingestWorker.on('progress', (job) => {
  broadcastEvent({ type: 'queue_progress', queue: 'ingest', progress: job.progress });
});

cittaTransmitWorker.on('completed', (job) => {
  broadcastEvent({ type: 'invoice_transmitted', data: job.returnvalue });
});
```

### Step 8.2: Update Frontend Progress Display
```tsx
// In ImportTab.tsx
useEffect(() => {
  const ws = new WebSocket('ws://localhost:3000/api/ws-events');
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'queue_progress') {
      setProgress(data.progress);
    }
  };
}, []);
```

---

## Phase 9: Testing & Validation

### Step 9.1: Unit Tests
```bash
npm test
# Test normalization for QBO, Sage, Excel
# Test tax calculation validation
# Test HMAC signature verification
```

### Step 9.2: Integration Tests
- Test BullMQ queue processing
- Test CittaEFS API submission
- Test webhook signature verification

---

# 5. TESTING AND VALIDATION

### Success Criteria

#### Backend (BullMQ + Redis)
| Test | Expected Result |
|------|----------------|
| Redis connection established | ✅ `redis.connected = true` |
| `ingest-queue` processes jobs | ✅ Jobs complete with retry |
| `citta-transmit-queue` sends to API | ✅ HTTP 200 response |
| `erp-writeback-queue` updates QBO | ✅ IRN written to invoice |
| Exponential backoff works | ✅ Failed jobs retry with delay |

#### Normalization
| Test | Expected Result |
|------|----------------|
| QBO Invoice → EFS format | ✅ All fields mapped correctly |
| Sage XML → EFS format | ✅ Tax codes translated |
| Excel rows → EFS format | ✅ Multi-sheet detected |
| Tax calculation validation | ✅ `taxableAmount = unitPrice × qty - discount` |

#### CittaEFS Gateway
| Test | Expected Result |
|------|----------------|
| POST /api/integration/gen/invoices | ✅ IRN returned |
| GET /api/einvoice/archive | ✅ Historical data returned |
| PATCH /api/einvoice/update/{irn} | ✅ Payment status updated |

#### Webhook Security
| Test | Expected Result |
|------|----------------|
| Valid HMAC signature | ✅ Request processed |
| Invalid HMAC signature | ✅ 401 Unauthorized |
| Timing-safe comparison | ✅ No timing attacks |

#### UI Preservation
| Test | Expected Result |
|------|----------------|
| All pages load | ✅ No crashes |
| Framer Motion animations | ✅ Smooth transitions |
| Tailwind CSS styling | ✅ Colors/fonts correct |
| WebSocket progress updates | ✅ Real-time display |

### Validation Commands

```bash
# Start Redis
redis-server

# Build the project
npm run build

# Start the server
npm run start

# Run tests
npm test
```

### Expected API Flow Test

```bash
# 1. Upload Excel file
curl -X POST http://localhost:3000/api/upload/excel \
  -F "file=@sample.xlsx"

# 2. Check queue status
curl http://localhost:3000/api/queue/status

# 3. Verify invoice created with IRN
curl http://localhost:3000/api/invoices

# 4. Check WebSocket events
# (Open browser DevTools → Network → WS)