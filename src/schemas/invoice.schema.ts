import { z } from "zod";
import crypto from "crypto";

// Line Item Schema — extended for gold template (Linenumber, UnitCode, TaxCategory, explicit amounts)
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
  // Gold template passthroughs
  lineNum: z.number().int().positive().optional(),
  unitCode: z.string().optional().default("EA"),
  taxCategoryId: z.string().optional().default("STANDARD_VAT"),
  // When template provides explicit taxable/tax amounts, we validate vs computed (tolerance 0.02)
  taxableAmount: z.number().optional(),
  vatAmount: z.number().optional(),
});

// Full Invoice Validation Schema
export const invoiceIngestionSchema = z
  .object({
    tenantId: z.string().min(1, "Tenant ID is required"),
    clientInvoiceNumber: z.string().min(1, "Client Invoice Number is required"),
    documentNumber: z.string().optional(), // spec: distinct from Invoice Number, optional
    invoiceType: z
      .enum(["STANDARD", "CREDIT_NOTE", "DEBIT_NOTE", "CANCELLATION"])
      .default("STANDARD"),
    invoiceTypeCode: z.string().optional(), // Gold: 380,381,384... passthrough, maps to invoiceType
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
    billingReferenceIrns: z.array(z.string()).optional(), // Gold: comma-split IRNs for 380/384/393
    headerDiscount: z.number().min(0).default(0),
    headerCharges: z.number().min(0).default(0),
    customFields: z.record(z.string(), z.any()).optional(), // Gold: User defined1-10 / Days…Division
    metadata: z.record(z.string(), z.any()).optional(),
    lineItems: z
      .array(invoiceLineItemSchema)
      .min(1, "At least one line item is required"),
  })
  .transform((data) => {
    // Gold: InvoiceTypeCode passthrough (380,381,384...) maps to invoiceType; 380/381->CREDIT, 384->DEBIT etc.
    let effectiveInvoiceType = data.invoiceType;
    if ((data as any).invoiceTypeCode) {
      const code = String((data as any).invoiceTypeCode).trim();
      if (["380","381"].includes(code)) effectiveInvoiceType = "CREDIT_NOTE" as any;
      else if (["384","383"].includes(code)) effectiveInvoiceType = "DEBIT_NOTE" as any;
      else if (["388"].includes(code)) effectiveInvoiceType = "STANDARD" as any;
      // Keep original code for gateway via customFields
    }
    // Gold: BillingReferenceIrns comma-split -> originalIrn alternative
    let effectiveOriginalIrn = data.originalIrn;
    if (!effectiveOriginalIrn && (data as any).billingReferenceIrns && Array.isArray((data as any).billingReferenceIrns) && (data as any).billingReferenceIrns.length) {
      effectiveOriginalIrn = (data as any).billingReferenceIrns[0];
    }
    // CRITICAL BUSINESS RULE 1: Auto-downgrade tax classification to B2C if tax_id / customerTin is missing/empty
    // B2G behaves as B2B for this customer-registration gate (same TIN requirement).
    let effectiveKind = data.invoiceKind;
    if (
      (effectiveKind === "B2B" || effectiveKind === "B2G") &&
      (!data.customerTin || data.customerTin.trim().length === 0)
    ) {
      effectiveKind = "B2C";
    }

    // CRITICAL BUSINESS RULE 1b: A buyer TIN is never permitted on a B2C invoice
    // (spec: it would weaken the B2B/B2C misclassification alert). Strip it
    // regardless of whether B2C was submitted directly or reached via the
    // downgrade above.
    const effectiveCustomerTin =
      effectiveKind === "B2C" ? undefined : data.customerTin;

    // CRITICAL BUSINESS RULE 2: Compute line item amounts & default classification codes (gold: respect explicit taxable/vat if within tolerance)
    const transformedLineItems = data.lineItems.map((item, idx) => {
      const qty = item.quantity;
      const price = item.unitPrice;
      const discount = item.discountAmount;
      const computedTaxable = Math.max(0, qty * price - discount);
      const vatRate = item.vatRate;
      const computedVat = (computedTaxable * vatRate) / 100;
      // If template provided explicit amounts, use them when close to computed (tolerance 0.05) to avoid NRS mismatch
      let taxableAmount = computedTaxable;
      let vatAmount = computedVat;
      if ((item as any).taxableAmount !== undefined && Math.abs(Number((item as any).taxableAmount) - computedTaxable) < 0.06) taxableAmount = Number((item as any).taxableAmount);
      if ((item as any).vatAmount !== undefined && Math.abs(Number((item as any).vatAmount) - computedVat) < 0.06) vatAmount = Number((item as any).vatAmount);
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
        lineNum: (item as any).lineNum || idx + 1,
        unitCode: (item as any).unitCode || "EA",
        taxCategoryId: (item as any).taxCategoryId || "STANDARD_VAT",
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
    const headerDiscount = Number((data.headerDiscount || 0).toFixed(2));
    const headerCharges = Number((data.headerCharges || 0).toFixed(2));
    const grandTotal = Number((subtotal + totalVat - headerDiscount + headerCharges).toFixed(2));

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
      invoiceType: effectiveInvoiceType as any,
      invoiceKind: effectiveKind,
      customerTin: effectiveCustomerTin,
      originalIrn: effectiveOriginalIrn,
      lineItems: transformedLineItems,
      subtotal,
      totalVat,
      grandTotal,
      rawPayloadHash,
    };
  });

export type ValidatedInvoiceIngestion = z.infer<typeof invoiceIngestionSchema>;
