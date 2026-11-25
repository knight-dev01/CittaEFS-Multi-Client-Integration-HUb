import { useState, type ReactNode } from 'react';
import { getApiBaseUrl } from '../lib/api';
import { BookOpen, Copy, Check } from 'lucide-react';

/**
 * Public developer documentation at /docs. Rendered before the login gate in
 * App.tsx, so it needs no account. Describes the hub's external API.
 */

const SECTIONS = [
  { id: 'overview', title: 'Overview' },
  { id: 'auth', title: 'Authentication' },
  { id: 'submit', title: 'Submit an invoice' },
  { id: 'status', title: 'Invoice status' },
  { id: 'normalisation', title: 'Normalisation' },
  { id: 'codes', title: 'HS and service codes' },
  { id: 'webhooks', title: 'Webhooks' },
  { id: 'errors', title: 'Errors' },
  { id: 'erps', title: 'ERP connectors' },
];

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="relative my-3">
      <pre className="overflow-x-auto rounded-lg border border-line bg-panel-muted p-4 pr-12 font-mono text-xs leading-relaxed text-ink">{children}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="absolute right-2 top-2 cursor-pointer rounded-md p-1.5 text-ink-faint hover:bg-panel hover:text-ink"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-b border-line py-8 last:border-b-0">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

function Endpoint({ method, path }: { method: string; path: string }) {
  const tone = method === 'GET' ? 'bg-slate-200 text-ink' : 'bg-accent text-white';
  return (
    <p className="flex flex-wrap items-center gap-2 font-mono text-sm">
      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{method}</span>
      <span className="break-all text-ink">{path}</span>
    </p>
  );
}

function FieldTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-line bg-panel-muted text-ink-soft">
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Required</th>
            <th className="px-3 py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([field, req, notes]) => (
            <tr key={field}>
              <td className="px-3 py-2 font-mono text-ink">{field}</td>
              <td className="px-3 py-2 text-ink-soft">{req}</td>
              <td className="px-3 py-2 text-ink-soft">{notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ApiDocsPage() {
  const base = getApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : '');

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-accent" />
            <span className="font-semibold tracking-tight">CittaEFS Hub · Developer docs</span>
          </div>
          <a href="/" className="text-sm font-medium text-accent hover:underline">Sign in to the hub</a>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-4 sm:px-6">
        <nav className="sticky top-0 hidden h-screen w-52 shrink-0 overflow-y-auto py-8 md:block" aria-label="Sections">
          <ul className="space-y-1 text-sm">
            {SECTIONS.map(s => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded-md px-2 py-1.5 text-ink-soft hover:bg-panel-muted hover:text-ink">{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 pb-16">
          <Section id="overview" title="Overview">
            <p>
              The hub turns invoices from an ERP or your own system into NRS-stamped e-invoices through the CittaEFS gateway, and hands
              back the <strong className="text-ink">IRN</strong> and <strong className="text-ink">QR code</strong>. You send an invoice
              in your own format; the hub normalises it to the CittaEFS format, validates it, submits it, and reports the result.
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li><strong className="text-ink">Receive</strong> the invoice (API call, ERP webhook or ERP sync).</li>
              <li><strong className="text-ink">Normalise</strong> it to the CittaEFS format and fix what can be fixed safely.</li>
              <li><strong className="text-ink">Classify</strong> every line with an HS or service code (remembered per item).</li>
              <li><strong className="text-ink">Submit</strong> to CittaEFS, which stamps it with NRS.</li>
              <li><strong className="text-ink">Return</strong> the IRN and QR code through status polling, your webhook, and the source ERP.</li>
            </ol>
            <p>Base URL:</p>
            <CodeBlock>{base}</CodeBlock>
          </Section>

          <Section id="auth" title="Authentication">
            <p>
              Every API call needs your workspace API key, issued by the hub administrator. Send it in the{' '}
              <code className="font-mono text-ink">X-Hub-Api-Key</code> header (an{' '}
              <code className="font-mono text-ink">Authorization: Bearer</code> header is also accepted). Keys are secret: call the API
              from your server, never from a browser or mobile app.
            </p>
            <CodeBlock>{`curl ${base}/api/hub/v1/health \\\n  -H "X-Hub-Api-Key: $CITTA_HUB_KEY"`}</CodeBlock>
          </Section>

          <Section id="submit" title="Submit an invoice">
            <Endpoint method="POST" path="/api/hub/v1/invoices" />
            <p>
              Queues one invoice for stamping and returns <code className="font-mono text-ink">202 Accepted</code> straight away.
              The stamp arrives asynchronously, usually within seconds.
            </p>
            <FieldTable
              rows={[
                ['invoiceNumber', 'Yes', 'Your invoice number. Symbols are removed for CittaEFS (INV-1001 is sent as INV1001); your original is kept as documentNumber.'],
                ['issueDate', 'Yes', 'YYYY-MM-DD preferred. DD/MM/YYYY and "28 Jul 2026" are converted.'],
                ['customerName', 'Yes', 'Buyer name.'],
                ['customerCode', 'No', 'Buyer code registered in CittaEFS.'],
                ['customerTin', 'B2B / B2G', 'Buyer TIN. Without one the invoice is treated as B2C.'],
                ['invoiceKind', 'No', 'B2B (default), B2C, B2G or EXPORT.'],
                ['invoiceType', 'No', 'STANDARD (default), CREDIT_NOTE or DEBIT_NOTE.'],
                ['billingReferenceIrns', 'Credit / debit notes', 'IRN(s) of the original invoice. Required for CittaEFS types 380, 384 and 393.'],
                ['lineItems[].itemCode', 'Yes', 'Your SKU or item code.'],
                ['lineItems[].description', 'Yes', 'Item description. Used to classify the item.'],
                ['lineItems[].quantity', 'Yes', 'Greater than 0.'],
                ['lineItems[].unitPrice', 'Yes', 'Greater than 0.'],
                ['lineItems[].discountAmount', 'No', 'Line discount, 0 or more.'],
                ['lineItems[].vatRate', 'No', 'Percent, default 7.5.'],
                ['lineItems[].hsOrServiceCode', 'No', 'If you know it. Otherwise the hub uses the code remembered for the item, or asks an operator once.'],
              ]}
            />
            <CodeBlock>{`curl -X POST ${base}/api/hub/v1/invoices \\
  -H "X-Hub-Api-Key: $CITTA_HUB_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "invoiceNumber": "INV-2026-0042",
    "issueDate": "2026-11-23",
    "customerName": "ABC Limited",
    "customerCode": "CUST001",
    "customerTin": "12345678-0001",
    "lineItems": [
      {
        "itemCode": "LPT-01",
        "description": "Laptop Pro 15-inch, 16GB RAM",
        "quantity": 2,
        "unitPrice": 1500000,
        "discountAmount": 100000,
        "vatRate": 7.5
      }
    ]
  }'`}</CodeBlock>
            <p>Response:</p>
            <CodeBlock>{`HTTP/1.1 202 Accepted
{
  "success": true,
  "status": "PENDING_NRS_STAMP",
  "invoice": { "clientInvoiceNumber": "INV20260042", "status": "PENDING_NRS_STAMP", ... },
  "message": "Queued via Hub external API. Poll GET /api/hub/v1/tenants/:id/invoices/:number for IRN."
}`}</CodeBlock>
          </Section>

          <Section id="status" title="Invoice status">
            <Endpoint method="GET" path="/api/hub/v1/tenants/{tenantId}/invoices/{invoiceNumber}" />
            <Endpoint method="GET" path="/api/hub/v1/tenants/{tenantId}/invoices?status=APPROVED&page=1&limit=20" />
            <p>
              Use the CittaEFS form of the number (for example <code className="font-mono text-ink">INV20260042</code>).
            </p>
            <FieldTable
              rows={[
                ['PENDING_NRS_STAMP', '—', 'Queued or awaiting the NRS stamp.'],
                ['APPROVED / SIGNED', '—', 'Stamped. irn, csid and qrCodeUrl are set.'],
                ['NEEDS_EFS_REGISTRATION', '—', 'API / Excel invoices only: the B2B buyer is not registered in CittaEFS yet. Sent automatically once registered. QuickBooks and Odoo buyers are sent with their details inline instead.'],
                ['REJECTED', '—', 'Held by the hub\'s pre-flight check or refused by CittaEFS. See Errors.'],
              ]}
            />
          </Section>

          <Section id="normalisation" title="Normalisation">
            <p>
              Before anything reaches CittaEFS, the hub checks the invoice against the CittaEFS API rules and the code lists configured for
              your company. Safe corrections are applied automatically and recorded in the audit log:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Invoice number reduced to A-Z and 0-9; your original kept as documentNumber.</li>
              <li>Dates converted to YYYY-MM-DD; currencies to ISO codes (₦ becomes NGN).</li>
              <li>Money parsed from text ("1,500,000.00") and rounded to 2 decimals.</li>
              <li>Taxable amount = quantity × unit price − line discount, and tax = taxable × VAT rate, aligned when they differ only by rounding.</li>
              <li>Invoice type, tax category, unit code and line numbers filled in where missing.</li>
            </ul>
            <p>
              Anything that cannot be corrected safely (a credit note with no original IRN, a price of zero, a future date, amounts that do
              not add up) is held with a specific message instead of being sent and rejected. These rules are deterministic and keep
              working when no AI model is available.
            </p>
          </Section>

          <Section id="codes" title="HS and service codes">
            <p>Every line needs a code CittaEFS has configured. The hub resolves it in this order:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>The code you send, if CittaEFS lists it.</li>
              <li>The code already confirmed for that item code, or for an item with the same description.</li>
              <li>Otherwise suggestions are prepared automatically (search over the CittaEFS code list and confirmed history, optionally ranked by an AI model) and an operator confirms one with a click. It is remembered, so the next invoice with that item goes through untouched.</li>
            </ol>
            <p>CittaEFS publishes its code lists without authentication:</p>
            <CodeBlock>{`GET https://ei-api.azurewebsites.net/api/resources/hs-codes
GET https://ei-api.azurewebsites.net/api/resources/service-codes
GET https://ei-api.azurewebsites.net/api/resources/tax-categories
GET https://ei-api.azurewebsites.net/api/resources/invoice-types`}</CodeBlock>
          </Section>

          <Section id="webhooks" title="Webhooks">
            <p>Register a URL to be told when an invoice is stamped or rejected, instead of polling.</p>
            <Endpoint method="POST" path="/api/v1/merchants/{tenantId}/webhook" />
            <CodeBlock>{`curl -X POST ${base}/api/v1/merchants/$TENANT_ID/webhook \\
  -H "X-Hub-Api-Key: $CITTA_HUB_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "callbackUrl": "https://your-app.example/hooks/citta", "webhookSecret": "choose-a-long-secret" }'`}</CodeBlock>
            <p>
              Events: <code className="font-mono text-ink">invoice.authorized</code> and <code className="font-mono text-ink">invoice.rejected</code>.
              Each request carries <code className="font-mono text-ink">X-Citta-Event</code>, <code className="font-mono text-ink">X-Citta-Timestamp</code> and{' '}
              <code className="font-mono text-ink">X-Citta-Signature</code>: a lowercase hex HMAC-SHA256 of the raw body with your webhook secret
              (your API key if you set none). Verify it before trusting the body.
            </p>
            <CodeBlock>{`{
  "event": "invoice.authorized",
  "merchantCode": "<tenantId>",
  "transactionRef": "INV20260042",
  "status": "APPROVED",
  "ResponseCode": "00",
  "irn": "IRN12345678901234567890",
  "qrCodeUrl": "https://...",
  "ledgerWritebackStatus": "SYNCED",
  "timestamp": "2026-11-23T10:30:00.000Z"
}`}</CodeBlock>
            <CodeBlock>{`// Node.js: verify the signature on the raw body
const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.header("X-Citta-Signature") || ""));`}</CodeBlock>
          </Section>

          <Section id="errors" title="Errors">
            <FieldTable
              rows={[
                ['400', 'Request', 'Body failed validation. details lists each field.'],
                ['401', 'Request', 'Missing or invalid X-Hub-Api-Key.'],
                ['409', 'Request', 'An invoice with this number already exists in the workspace.'],
                ['MISSING_HS_CODE', 'Invoice', 'A line has no confirmed HS or service code yet. Suggestions are waiting for an operator.'],
                ['EFS_FORMAT', 'Invoice', 'Data CittaEFS cannot accept (no original IRN on a credit note, zero price, code not configured...).'],
                ['TAX_MISMATCH', 'Invoice', 'Taxable or tax amount does not match quantity, price, discount and VAT rate.'],
                ['INVALID_DATE', 'Invoice', 'Issue date is not a real date or is in the future.'],
                ['GATEWAY_REJECTED', 'Invoice', 'CittaEFS refused the invoice; its reason is included.'],
              ]}
            />
            <p>Invoice-level problems are also emailed to the company contact and, for ERP invoices, written back onto the invoice in the ERP.</p>
          </Section>

          <Section id="erps" title="ERP connectors">
            <p>
              Companies on a supported ERP do not need the API: once connected, the hub picks up new invoices itself and writes the IRN and QR
              code back onto the original invoice, so staff never leave their ERP.
            </p>
            <FieldTable
              rows={[
                ['QuickBooks Online', 'Live', 'OAuth connection, webhook plus a 60-second poll. IRN and QR written to custom fields, QR attached as an image. Credit memos sync as credit notes.'],
                ['Odoo', 'Live', 'API key over JSON-RPC, 60-second poll. IRN and QR posted to the invoice chatter.'],
                ['Xero, Zoho Books, Sage, Tally Prime, SAP Business One', 'Planned', 'Use the API above until a connector is available.'],
              ]}
            />
          </Section>
        </main>
      </div>
    </div>
  );
}
