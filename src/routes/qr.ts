import { Router } from "express";
import { prisma } from "../lib/prisma";
import { invoiceIdFromQrToken } from "../lib/qrLink";

/**
 * Public QR pages for stamped invoices, linked from the QuickBooks note and
 * the Odoo chatter (see lib/qrLink). No login: the signed token is the
 * credential. Only the details printed on an invoice anyway are shown
 * (number, date, IRN, QR); no amounts or customer data.
 */
const router = Router();

const STAMPED = ["APPROVED", "SIGNED"];

async function stampedInvoice(token: string) {
  const id = invoiceIdFromQrToken(token);
  if (!id) return null;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { clientInvoiceId: true, issueDate: true, irn: true, qrCodeUrl: true, status: true },
  });
  return invoice && invoice.irn && STAMPED.includes(invoice.status) ? invoice : null;
}

function pngFrom(qrCodeUrl: string | null): Buffer | null {
  if (!qrCodeUrl?.startsWith("data:image/")) return null;
  return Buffer.from(qrCodeUrl.slice(qrCodeUrl.indexOf(",") + 1), "base64");
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

router.get("/qr/:token/qr.png", async (req, res) => {
  try {
    const invoice = await stampedInvoice(String(req.params.token));
    const png = pngFrom(invoice?.qrCodeUrl ?? null);
    if (!invoice || !png) return res.status(404).type("text/plain").send("QR code not found");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Content-Disposition", `inline; filename="NRS-QR-${invoice.clientInvoiceId.replace(/[^A-Za-z0-9_-]/g, "")}.png"`);
    res.type("png").send(png);
  } catch {
    res.status(500).type("text/plain").send("Could not load the QR code");
  }
});

router.get("/qr/:token", async (req, res) => {
  try {
    const token = String(req.params.token);
    const invoice = await stampedInvoice(token);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    if (!invoice) {
      return res.status(404).type("html").send(page("QR code not found", `<p>This link is not valid, or the invoice has not been stamped by NRS yet.</p>`));
    }
    const hasImage = Boolean(pngFrom(invoice.qrCodeUrl));
    const imgSrc = `/qr/${encodeURIComponent(token)}/qr.png`;
    const verifyUrl = invoice.qrCodeUrl && /^https?:\/\//i.test(invoice.qrCodeUrl) ? invoice.qrCodeUrl : null;
    const body = `
      <p class="label">Invoice</p><p class="value">${escapeHtml(invoice.clientInvoiceId)}</p>
      <p class="label">Issue date</p><p class="value">${escapeHtml(invoice.issueDate.toISOString().slice(0, 10))}</p>
      <p class="label">IRN</p><p class="value mono">${escapeHtml(invoice.irn!)}</p>
      ${hasImage
        ? `<img src="${imgSrc}" alt="NRS QR code for invoice ${escapeHtml(invoice.clientInvoiceId)}" width="240" height="240">
           <p class="actions"><a href="${imgSrc}" download>Download QR code (PNG)</a></p>`
        : verifyUrl
          ? `<p class="actions"><a href="${escapeHtml(verifyUrl)}" rel="noopener noreferrer">Open the NRS verification link</a></p>`
          : `<p>CittaEFS did not send a QR image for this invoice.</p>`}`;
    res.type("html").send(page(`NRS QR code · ${invoice.clientInvoiceId}`, body));
  } catch {
    res.status(500).type("text/plain").send("Could not load the QR code");
  }
});

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;background:#f6f7f9;color:#14171f;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  main{max-width:420px;margin:32px auto;padding:24px;background:#fff;border:1px solid #e3e6eb;border-radius:12px}
  h1{font-size:17px;margin:0 0 16px}
  .label{margin:12px 0 0;font-size:12px;color:#5b6472}.value{margin:0;font-weight:600;word-break:break-all}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:500}
  img{display:block;margin:20px auto 8px;image-rendering:pixelated}
  .actions{text-align:center}a{color:#0b5fff}
  @media print{body{background:#fff}main{border:0;margin:0}.actions{display:none}}
</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

export default router;
