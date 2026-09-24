import { PrismaClient } from "@prisma/client";
import { generateSha256, safeAuditLogCreate } from "../lib/serverHelpers";
import { invoiceIngestionSchema } from "../schemas/invoice.schema";
import { invoiceQueue } from "../queues/invoiceQueue";
import { getCittaCodeType } from "../data/referenceData";

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
        const validated = invoiceIngestionSchema.parse({
          tenantId: inv.tenantId,
          clientInvoiceNumber: inv.clientInvoiceId,
          documentNumber: inv.documentNumber || undefined,
          invoiceType: inv.invoiceType as any,
          invoiceKind: inv.invoiceKind as any,
          issueDate: inv.issueDate.toISOString().substring(0, 10),
          customerCode: inv.customerCode,
          customerName: inv.customerName,
          customerTin: inv.customerTin || undefined,
          lineItems: inv.lineItems.map((li: any) => ({
            itemCode: li.itemCode,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountAmount: 0,
            hsOrServiceCode: li.hsOrServiceCode,
            codeType: getCittaCodeType(li.hsOrServiceCode) || "SERVICE_CODE",
            vatRate: li.vatRate,
          })),
        });
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
