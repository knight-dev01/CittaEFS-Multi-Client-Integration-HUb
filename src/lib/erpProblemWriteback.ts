import { describeGatewayFailure, type GatewayErrorContext } from "./gatewayErrors";

export interface ErpProblemInvoice {
  tenantId: string;
  sourceErp?: string | null;
  clientInvoiceId?: string | null;
  qboInvoiceId?: string | null;
  odooInvoiceId?: string | null;
}

/**
 * Mirrors a validation/ingest problem into the ERP the invoice came from, so
 * the client sees the reason on the record they actually work in instead of
 * having to open the Hub to find it.
 *
 * This is best-effort by design: the problem is already recorded in the Hub,
 * and a dead ERP connection must not change the caller's outcome. The ERP
 * service functions set `ledgerWritebackStatus` themselves — SYNCED once the
 * note lands, FAILED when delivery fails.
 */
export async function writeProblemBackToSourceErp(
  invoice: ErpProblemInvoice,
  rawMessage: string,
  context: GatewayErrorContext = {},
): Promise<boolean> {
  if (!invoice.sourceErp) return false;

  const { summary } = describeGatewayFailure(rawMessage, context);

  try {
    if (invoice.sourceErp === "odoo") {
      const { writebackProblemToOdoo } = await import("../services/odooService");
      await writebackProblemToOdoo(
        invoice.tenantId,
        String(invoice.odooInvoiceId || invoice.clientInvoiceId || ""),
        summary,
      );
      return true;
    }

    if (invoice.sourceErp === "qbo") {
      const { writebackProblemToQbo } = await import("../services/qboService");
      await writebackProblemToQbo(
        invoice.tenantId,
        String(invoice.qboInvoiceId || invoice.clientInvoiceId || ""),
        summary,
      );
      return true;
    }
  } catch (e: any) {
    console.warn(
      `[ERP Writeback] Could not write problem back for invoice ${invoice.clientInvoiceId || "(unknown)"} (non-blocking):`,
      e?.message || String(e),
    );
  }

  return false;
}
