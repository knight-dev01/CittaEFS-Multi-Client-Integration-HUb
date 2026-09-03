import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { generateSha256, safeAuditLogCreate } from "../lib/serverHelpers";
import { logger } from "../lib/logger";
import { fetchAndIngestSpecificQboInvoice } from "../services/qboService";

const router = Router();

async function handleCittaEfsWebhook(req: any, res: any) {
  try {
    const signature = (req.headers["x-webhook-signature"] as string) || (req.headers["X-Webhook-Signature"] as string);
    const webhookSecret =
      process.env.CITTAEFS_WEBHOOK_SECRET || process.env.CITTA_WEBHOOK_SECRET || "CF35DF20-9309-4506-BCC8-5D17D1DA209A";
    const raw = (req as any).rawBody ? (req as any).rawBody.toString("utf8") : JSON.stringify(req.body);
    const payloadString = raw;
    const hmacHex = crypto.createHmac("sha256", webhookSecret).update(payloadString).digest("hex");
    const hmacB64 = crypto.createHmac("sha256", webhookSecret).update(payloadString).digest("base64");
    const expectedHex = `sha256=${hmacHex}`;
    const expectedB64 = `sha256=${hmacB64}`;
    const isValid = signature === hmacHex || signature === hmacB64 || signature === expectedHex || signature === expectedB64;
    if (!signature) {
      return res.status(401).json({ success: false, error: "Webhook signature missing" });
    }
    if (!isValid) {
      logger.warn(`[Webhook] Invalid signature`, { received: signature?.slice(0, 20), expectedB64: expectedB64.slice(0, 20) }, { requestId: (req as any).requestId });
      if (process.env.NODE_ENV === "production") {
        return res.status(401).json({ success: false, error: "Invalid webhook signature" });
      }
      logger.warn(`[Webhook] Dev mode — accepting despite invalid signature`);
    }
    logger.info(`[Webhook] CittaEFS event received`, { event: req.body?.event || req.body?.eventType, invoiceNumber: req.body?.data?.invoiceNumber || req.body?.invoiceNumber, irn: req.body?.data?.irn || req.body?.irn }, { requestId: (req as any).requestId });

    const event = req.body?.event || req.body?.eventType || req.body?.data?.eventType;
    const data = req.body?.data || req.body;
    const invoiceNumber = data?.invoiceNumber || req.body?.invoiceNumber || req.body?.clientInvoiceNumber;
    const irn = data?.irn || req.body?.irn;
    const status = data?.status || req.body?.status;
    const qrCode = data?.qrCode || data?.qr_code;
    const paymentStatus = data?.paymentStatus || data?.payment_status;
    const paymentReference = data?.paymentReference || data?.payment_reference;
    const errorMessage = data?.errorMessage || req.body?.errorMessage;
    const transmittedAt = data?.transmittedAt || data?.signedAt;

    const inv = await prisma.invoice.findFirst({
      where: {
        OR: [
          irn ? { irn } : {},
          invoiceNumber ? { clientInvoiceId: invoiceNumber } : {},
        ],
      },
    });

    if (inv) {
      const updateData: any = {};
      if (event === "invoice.signed" || status === "SIGNED") { updateData.status = "APPROVED"; if (irn) updateData.irn = irn; if (qrCode) updateData.qrCodeUrl = `data:image/png;base64,${qrCode}`; if (transmittedAt) updateData.updatedAt = new Date(transmittedAt); }
      else if (event === "invoice.transmitted" || status === "TRANSMITTED") { updateData.status = "APPROVED"; if (irn) updateData.irn = irn; if (qrCode) updateData.qrCodeUrl = `data:image/png;base64,${qrCode}`; updateData.ledgerWritebackStatus = "SYNCED"; }
      else if (event === "invoice.validation.failed" || status === "REJECTED" || errorMessage) { updateData.status = "REJECTED"; }
      else if (event === "invoice.payment.updated" || paymentStatus) {
        logger.info(`[Webhook] Payment update`, { invoiceNumber, irn, paymentStatus, paymentReference }, { requestId: (req as any).requestId });
      }
      else if (status) { updateData.status = status; }
      if (irn && !updateData.irn) updateData.irn = irn;
      if (qrCode && !updateData.qrCodeUrl) updateData.qrCodeUrl = qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`;
      if (Object.keys(updateData).length) {
        if (updateData.status) updateData.ledgerWritebackStatus = "SYNCED";
        await prisma.invoice.update({ where: { id: inv.id }, data: updateData });
      }

      await safeAuditLogCreate(prisma, {
        tenantId: inv.tenantId,
        action: "WEBHOOK_RECEIVED",
        entityType: "INVOICE",
        entityRef: inv.clientInvoiceId,
        details: `Webhook event [${event || "invoice.payment_updated"}] processed. IRN: ${inv.irn}.`,
        sha256PayloadHash: generateSha256(JSON.stringify(req.body)),
        performedBy: "CittaEFS Gateway Webhook Listener",
        rawJson: req.body,
      });
    }

    res.json({ status: "ACCEPTED", eventProcessed: true });
  } catch (e: any) {
    logger.error(`[Webhook] CittaEFS handler error`, { error: e.message }, { requestId: (req as any).requestId });
    res.status(500).json({ error: e.message });
  }
}

router.post("/api/webhooks/cittaefs", handleCittaEfsWebhook);
router.post("/pay2/einvoicehookweb", handleCittaEfsWebhook);

router.post("/api/webhooks/qbo", async (req, res) => {
  try {
    const signature = req.headers["intuit-signature"] as string;
    if (!signature) {
      return res
        .status(401)
        .json({ success: false, error: "intuit-signature header missing" });
    }

    const verifierToken =
      process.env.QBO_WEBHOOK_VERIFIER ||
      process.env.QBO_CLIENT_SECRET ||
      "verifier_token_test";
    const rawBody =
      (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
    const computedBase64 = crypto
      .createHmac("sha256", verifierToken)
      .update(rawBody)
      .digest("base64");

    const sigBuf = Buffer.from(signature, "utf8");
    const compBuf = Buffer.from(computedBase64, "utf8");
    const isValid =
      sigBuf.length === compBuf.length &&
      crypto.timingSafeEqual(sigBuf, compBuf);

    if (!isValid) {
      console.warn(`[QBO Webhook] Invalid signature. Received: ${signature}`);
      return res
        .status(401)
        .json({ success: false, error: "Invalid intuit-signature" });
    }

    const notifications = req.body?.eventNotifications || [];
    for (const notification of notifications) {
      const realmId = notification.realmId;
      const integration = await prisma.integration.findFirst({
        where: { companyId: realmId, sourceSystem: "QUICKBOOKS_ONLINE" },
      });

      if (integration) {
        const entities = notification.dataChangeEvent?.entities || [];
        for (const entity of entities) {
          if (
            entity.name === "Invoice" &&
            (entity.operation === "Create" || entity.operation === "Update")
          ) {
            try {
              await fetchAndIngestSpecificQboInvoice(
                integration.tenantId,
                entity.id,
              );
            } catch (err: any) {
              console.error(
                `[QBO Webhook] Ingest error for invoice ${entity.id}:`,
                err.message,
              );
            }
          }
        }
      }
    }

    res.status(200).json({ status: "ACCEPTED" });
  } catch (e: any) {
    console.error("[QBO Webhook Error]:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
