import { PrismaClient } from "@prisma/client";
import { generateSha256, safeAuditLogCreate } from "../lib/serverHelpers";
import { invoiceQueue } from "../queues/invoiceQueue";
import { buildQueuePayloadFromInvoice } from "../lib/invoiceQueuePayload";

// Thin-hub pivot (docs/CittaHub_Revision_Plan.md Phase 3): registration
// confirmation is its own service function, separate from the Express route
// in src/routes/entityMappings.ts, so it's directly testable (Phase 5) without
// bootstrapping HTTP/auth. The route stays responsible for the HTTP-facing
// concerns (looking the mapping up, tenant-access check, status codes).
export async function confirmEntityMappingRegistration(
  prisma: PrismaClient,
  mapping: { id: string; tenantId: string; entityType: string; sourceErpId: string },
  cittaReferenceCode: string,
  performedBy: string
): Promise<{ mapping: any; requeued: number }> {
  const refCode = cittaReferenceCode.trim();
  if (!refCode) throw new Error("cittaReferenceCode is required");

  const updated = await prisma.entityMapping.update({
    where: { id: mapping.id },
    data: { status: "MAPPED", cittaReferenceCode: refCode },
  });

  let requeued = 0;
  // Item mappings aren't gated (Phase 2) — nothing to requeue for them.
  if (mapping.entityType === "CUSTOMER") {
    const stuck = await prisma.invoice.findMany({
      where: { tenantId: mapping.tenantId, customerCode: mapping.sourceErpId, status: "NEEDS_EFS_REGISTRATION" },
      include: { lineItems: true },
    });
    for (const inv of stuck) {
      try {
        await prisma.invoice.update({ where: { id: inv.id }, data: { status: "PENDING_NRS_STAMP" } });
        const validated = buildQueuePayloadFromInvoice(inv);
        await invoiceQueue.clearInvoiceJobs(inv.id);
        await invoiceQueue.add(
          "signInvoice",
          { ...validated, dbInvoiceId: inv.id },
          { idempotencyKey: `${inv.tenantId}:${inv.clientInvoiceId}:registered:${Date.now()}` }
        );
        requeued++;
      } catch (e: any) {
        console.error(`[EntityMapping Confirm] Failed to requeue invoice ${inv.id}:`, e.message);
      }
    }
  }

  await safeAuditLogCreate(prisma, {
    tenantId: mapping.tenantId,
    action: "ENTITY_REGISTERED",
    entityType: mapping.entityType,
    entityRef: mapping.sourceErpId,
    details: `Confirmed CittaEFS registration for ${mapping.entityType.toLowerCase()} ${mapping.sourceErpId} (reference ${refCode}). Requeued ${requeued} invoice(s).`,
    sha256PayloadHash: generateSha256(`${mapping.id}:${refCode}`),
    performedBy,
  });

  return { mapping: updated, requeued };
}
