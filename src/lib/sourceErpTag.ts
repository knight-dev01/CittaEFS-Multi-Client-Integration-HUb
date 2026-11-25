/**
 * Tags an invoice sent to CittaEFS with where it came from, so the CittaEFS
 * team can tell a QuickBooks invoice from an Odoo one. The tag rides in
 * CittaEFS's free-form metadata and custom fields, never in the invoice
 * number: that number is registered with NRS and must match the one printed
 * on the customer's invoice. Nothing is changed in the ERP, so there is
 * nothing to strip on writeback.
 *
 * CittaEFS echoes metadata back in its webhooks; HubInvoiceId lets the hub
 * match a stamp to its own invoice row exactly.
 */

const SOURCE_LABELS: Record<string, { system: string; code: string }> = {
  qbo: { system: "QuickBooks Online", code: "QBO" },
  odoo: { system: "Odoo", code: "ODOO" },
  excel: { system: "Excel import", code: "EXCEL" },
  manual: { system: "Hub (manual entry)", code: "MANUAL" },
};

export function sourceErpLabel(sourceErp: string | null | undefined): { system: string; code: string } {
  const key = String(sourceErp || "").trim().toLowerCase();
  if (!key) return { system: "Hub API", code: "API" };
  return SOURCE_LABELS[key] ?? { system: key, code: key.toUpperCase() };
}

export interface SourceTagInput {
  hubInvoiceId: string;
  sourceErp: string | null | undefined;
  /** The ERP's own invoice number, exactly as the ERP shows it. */
  sourceInvoiceNumber: string;
}

/** Adds the source tag to whatever metadata / custom fields the invoice already carries. */
export function withSourceTag(
  existing: { metadata?: Record<string, unknown>; customFields?: Record<string, unknown> },
  tag: SourceTagInput,
): { metadata: Record<string, unknown>; customFields: Record<string, unknown> } {
  const { system, code } = sourceErpLabel(tag.sourceErp);
  return {
    metadata: {
      ...(existing.metadata || {}),
      SourceSystem: system,
      SourceInvoiceNumber: tag.sourceInvoiceNumber,
      HubInvoiceId: tag.hubInvoiceId,
    },
    customFields: {
      ...(existing.customFields || {}),
      SourceErp: code,
    },
  };
}

/** The hub invoice id CittaEFS echoed back in an event's or archive record's metadata. */
export function hubInvoiceIdFrom(record: any): string | null {
  const metadata = record?.metadata ?? record?.Metadata;
  if (!metadata || typeof metadata !== "object") return null;
  for (const [key, value] of Object.entries(metadata)) {
    if (key.toLowerCase() === "hubinvoiceid" && typeof value === "string" && value) return value;
  }
  return null;
}
