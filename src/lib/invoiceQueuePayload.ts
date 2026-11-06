/**
 * Rebuilds the queue payload from a stored invoice row.
 *
 * Retries and operator corrections (billing reference, TIN, approval) must send
 * what is stored now — not the payload from the first attempt. Keeping the
 * mapping in one place stops a retry path from silently dropping fields such as
 * billingReferenceIrns.
 */
import { invoiceIngestionSchema } from "../schemas/invoice.schema";
import { getCittaCodeType } from "../data/referenceData";

export function parseBillingReferenceIrns(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const list = raw.map((v) => String(v ?? "").trim()).filter(Boolean);
  return list.length ? list : undefined;
}

/**
 * Database rows sometimes hold the numeric EFS code (380/384/393) in the
 * invoiceType column. The ingestion schema only accepts the enum, so translate
 * it back and pass the original code through invoiceTypeCode.
 */
function queueInvoiceType(value: unknown): { invoiceType: any; invoiceTypeCode?: string } {
  const raw = String(value ?? "").trim().toUpperCase();
  if (/^\d{3}$/.test(raw)) {
    const mapped =
      raw === "380" || raw === "393"
        ? "CREDIT_NOTE"
        : raw === "384"
          ? "DEBIT_NOTE"
          : raw === "381"
            ? "STANDARD"
            : undefined;
    return { invoiceType: mapped || "STANDARD", invoiceTypeCode: raw };
  }
  return {
    invoiceType: ["CREDIT_NOTE", "DEBIT_NOTE", "CANCELLATION"].includes(raw) ? raw : "STANDARD",
  };
}

export function buildQueuePayloadFromInvoice(invoice: any) {
  const billingReferenceIrns = parseBillingReferenceIrns(invoice.billingReferenceIrns);
  const type = queueInvoiceType(invoice.invoiceType);
  return invoiceIngestionSchema.parse({
    tenantId: invoice.tenantId,
    clientInvoiceNumber: invoice.clientInvoiceId,
    documentNumber: invoice.documentNumber || undefined,
    invoiceType: type.invoiceType,
    invoiceTypeCode: type.invoiceTypeCode,
    invoiceKind: invoice.invoiceKind as any,
    issueDate: invoice.issueDate.toISOString().substring(0, 10),
    customerCode: invoice.customerCode,
    customerName: invoice.customerName,
    customerTin: invoice.customerTin || undefined,
    originalIrn: billingReferenceIrns?.[0],
    billingReferenceIrns,
    headerCharges: invoice.headerCharges ?? 0,
    headerDiscount: invoice.headerDiscount ?? 0,
    currency: invoice.currency || "NGN",
    lineItems: invoice.lineItems.map((li: any) => ({
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
}
