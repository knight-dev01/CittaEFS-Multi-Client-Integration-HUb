import { z } from "zod";
import crypto from "crypto";

// Line Item Schema
export const invoiceLineItemSchema = z.object({
  itemCode: z.string().min(1, "Item SKU / Code is required"),
  description: z.string().min(1, "Item description is required"),
  quantity: z.number().positive("Quantity must be greater than 0").default(1),
  unitPrice: z.number().min(0, "Unit price cannot be negative"),
  discountAmount: z.number().min(0).default(0),
  hsOrServiceCode: z.string().optional().default("SERV-DEFAULT"),
  codeType: z
    .enum(["HS_CODE", "SERVICE_CODE", "UNMAPPED"])
    .optional()
    .default("SERVICE_CODE"),
  vatRate: z.number().min(0).max(100).default(7.5),
});

// Full Invoice Validation Schema
export const invoiceIngestionSchema = z
  .object({
    tenantId: z.string().min(1, "Tenant ID is required"),
    clientInvoiceNumber: z.string().min(1, "Client Invoice Number is required"),
    invoiceType: z
      .enum(["STANDARD", "CREDIT_NOTE", "DEBIT_NOTE", "CANCELLATION"])
      .default("STANDARD"),
    invoiceKind: z.enum(["B2B", "B2C", "B2G", "EXPORT"]).default("B2B"),
    issueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Issue date must be YYYY-MM-DD"),
    dueDate: z.string().optional(),
    customerCode: z.string().default("CUST-OTC-GENERIC"),
    customerName: z.string().min(1, "Customer Name is required"),
    customerTin: z.string().nullable().optional(),
    customerAddress: z.string().optional(),
    currency: z.string().default("NGN"),
    originalIrn: z.string().optional(), // For Credit/Debit notes
    lineItems: z
      .array(invoiceLineItemSchema)
      .min(1, "At least one line item is required"),
  })
  .transform((data) => {
    // CRITICAL BUSINESS RULE 1: Auto-downgrade tax classification to B2C if tax_id / customerTin is missing/empty
    // B2G behaves as B2B for this customer-registration gate (same TIN requirement).
    let effectiveKind = data.invoiceKind;
    if (
      (effectiveKind === "B2B" || effectiveKind === "B2G") &&
      (!data.customerTin || data.customerTin.trim().length === 0)
    ) {
      effectiveKind = "B2C";
    }

    // CRITICAL BUSINESS RULE 2: Compute line item amounts & default classification codes
    const transformedLineItems = data.lineItems.map((item) => {
      const qty = item.quantity;
      const price = item.unitPrice;
      const discount = item.discountAmount;
      const taxableAmount = Math.max(0, qty * price - discount);
      const vatRate = item.vatRate;
      const vatAmount = (taxableAmount * vatRate) / 100;
      const totalAmount = taxableAmount + vatAmount;

      // SKU Code default: If code is unmapped or missing, assign SERV-DEFAULT code
      let hsCode = item.hsOrServiceCode;
      if (!hsCode || hsCode === "UNMAPPED" || hsCode.trim().length === 0) {
        hsCode = "SERV-DEFAULT";
      }

      return {
        ...item,
        hsOrServiceCode: hsCode,
        quantity: qty,
        unitPrice: price,
        taxableAmount: Number(taxableAmount.toFixed(2)),
        vatAmount: Number(vatAmount.toFixed(2)),
        totalAmount: Number(totalAmount.toFixed(2)),
      };
    });

    const subtotal = Number(
      transformedLineItems
        .reduce((acc, item) => acc + item.taxableAmount, 0)
        .toFixed(2),
    );
    const totalVat = Number(
      transformedLineItems
        .reduce((acc, item) => acc + item.vatAmount, 0)
        .toFixed(2),
    );
    const grandTotal = Number((subtotal + totalVat).toFixed(2));

    // Compute SHA-256 payload hash for audit logs
    const payloadJson = JSON.stringify({
      tenantId: data.tenantId,
      clientInvoiceNumber: data.clientInvoiceNumber,
      grandTotal,
      lineItemsCount: transformedLineItems.length,
    });
    const rawPayloadHash = crypto
      .createHash("sha256")
      .update(payloadJson)
      .digest("hex");

    return {
      ...data,
      invoiceKind: effectiveKind,
      lineItems: transformedLineItems,
      subtotal,
      totalVat,
      grandTotal,
      rawPayloadHash,
    };
  });

export type ValidatedInvoiceIngestion = z.infer<typeof invoiceIngestionSchema>;
