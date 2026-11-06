/**
 * Turns a raw CittaEFS gateway failure into something a merchant can act on.
 *
 * The gateway answers a refused invoice with whatever its ASP.NET/SQL layer
 * produced — CHECK constraint names, table names, JSON envelopes. That text is
 * useful to an engineer and meaningless to the person whose invoice is stuck,
 * so the readable sentence becomes the stored `errorMessage` and the raw reply
 * is kept verbatim after `TECHNICAL_DETAIL_MARKER`.
 *
 * Pure module: imported by both the worker (write time) and the Validation tab
 * (read time, so rows stored before this existed also render readably).
 */

export const TECHNICAL_DETAIL_MARKER = "\n\nTechnical detail:\n";

export interface GatewayErrorContext {
  invoiceType?: string;
  invoiceTypeCode?: string;
}

export interface DescribedGatewayError {
  summary: string;
  /** The gateway's own text, or null when there is nothing technical to show. */
  technical: string | null;
}

const RETRY_PREFIX = /^CittaEFS gateway rejected after \d+ retries:\s*/i;
const GATEWAY_PRODUCED =
  /Gateway error \(\d{3}\)|CittaEFS gateway|gateway rejected|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|insert statement conflicted|check constraint|already posted|invoice number already/i;

function submittedType(context: GatewayErrorContext): string {
  if (context.invoiceTypeCode) return `invoiceTypeCode ${context.invoiceTypeCode}`;
  if (context.invoiceType) return `invoice type ${context.invoiceType}`;
  return "the invoice type it submitted";
}

function httpStatusOf(message: string): string | undefined {
  return /Gateway error \((\d{3})\)/i.exec(message)?.[1];
}

/** Pulls `message` (or the first `errors[]` entry) out of a gateway JSON body. */
function readGatewayMessage(message: string): string | null {
  const start = message.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(message.slice(start));
    const candidate =
      parsed?.message ??
      parsed?.errors?.[0]?.message ??
      parsed?.errors?.[0]?.error;
    return typeof candidate === "string" && candidate.trim()
      ? candidate.trim()
      : null;
  } catch {
    return null;
  }
}

function asSentence(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Maps one gateway reply to a plain-English summary.
 * Order matters: the most specific diagnosis wins.
 */
export function describeGatewayFailure(
  rawMessage: string,
  context: GatewayErrorContext = {},
): DescribedGatewayError {
  const withoutPrefix = (rawMessage || "").replace(RETRY_PREFIX, "").trim();

  if (!withoutPrefix) {
    return {
      summary: "CittaEFS refused this invoice without giving a reason.",
      technical: null,
    };
  }

  // Not a gateway reply at all (e.g. a local validation message). Leave it as-is.
  if (!GATEWAY_PRODUCED.test(withoutPrefix)) {
    return { summary: withoutPrefix, technical: null };
  }

  const inspected = withoutPrefix.toLowerCase();
  const status = httpStatusOf(withoutPrefix);
  const statusSuffix = status ? ` (HTTP ${status})` : "";
  const type = submittedType(context);

  // 1. The constraint the gateway actually hit: WM_001_INV_REP_PTR.Type.
  //    This is the CittaEFS-side defect behind "rejected after 5 retries".
  if (
    inspected.includes("ck_wm_001_inv_rep_ptr_type") ||
    (inspected.includes("wm_001_inv_rep_ptr") &&
      inspected.includes("check constraint"))
  ) {
    return {
      summary:
        `CittaEFS's own database rejected this invoice while saving it: the value in column ` +
        `\`Type\` of table \`WM_001_INV_REP_PTR\` does not satisfy check constraint ` +
        `\`CK_WM_001_INV_REP_PTR_Type\`. The hub only sends ${type} over the API and cannot ` +
        `change that column, so retrying the identical request fails the same way. CittaEFS ` +
        `needs to confirm which \`Type\` values the constraint allows for this company.`,
      technical: withoutPrefix,
    };
  }

  // 2. Any other SQL CHECK constraint — same conclusion, generic wording.
  const constraint =
    /check constraint "([^"]+)"/i.exec(withoutPrefix)?.[1] ?? null;
  if (constraint || /insert statement conflicted/i.test(inspected)) {
    const table = /table "([^"]+)"/i.exec(withoutPrefix)?.[1] ?? null;
    const column = /column '([^']+)'/i.exec(withoutPrefix)?.[1] ?? null;
    const location =
      column && table
        ? `column \`${column}\` of table \`${table}\``
        : table
          ? `table \`${table}\``
          : "one of its tables";
    return {
      summary:
        `CittaEFS's database rejected this invoice while saving it: ${location} violates` +
        `${constraint ? ` check constraint \`${constraint}\`` : " a database constraint"}. ` +
        `The failure happens inside CittaEFS, not in the hub, so retrying the same payload ` +
        `cannot fix it. Send CittaEFS the technical detail and ask which values that column accepts.`,
      technical: withoutPrefix,
    };
  }

  // 3. Duplicate invoice number against the archive table.
  if (
    /already posted|already been posted|duplicate invoice|invoice number already|wm_001_ei_ar/i.test(
      withoutPrefix,
    )
  ) {
    return {
      summary:
        `CittaEFS already has an invoice with this number in its archive. Invoice numbers must ` +
        `be unique per company, so this one was not stamped again. If this is genuinely a new ` +
        `document, give it a new invoice number; otherwise use the stamp already issued.`,
      technical: withoutPrefix,
    };
  }

  // 4. Credentials and permissions.
  if (
    status === "401" ||
    status === "403" ||
    /unauthori[sz]ed|forbidden|invalid (api )?key|invalid token|bearer/i.test(inspected)
  ) {
    return {
      summary:
        `CittaEFS rejected the hub's credentials${statusSuffix}. The gateway key is missing, ` +
        `expired, or lacks permission for invoice submission. An administrator needs to update ` +
        `\`CITTAEFS_API_KEY\`; retrying will not help until the key is fixed.`,
      technical: withoutPrefix,
    };
  }

  // 5. Rate limiting.
  if (status === "429" || /rate limit|too many requests/i.test(inspected)) {
    return {
      summary:
        `CittaEFS is rate-limiting this account${statusSuffix}. The invoice was not processed and ` +
        `the hub has used its automatic retries. Wait a few minutes, then retry it from Invoices.`,
      technical: withoutPrefix,
    };
  }

  // 6. Invoice type not configured for the company.
  if (
    /invoice ?type.*(not configured|invalid|required|must be)|valid configured invoice type/i.test(
      withoutPrefix,
    )
  ) {
    return {
      summary:
        `CittaEFS does not accept this invoice type for your company. Please ask your CittaEFS administrator to enable the correct invoice type, then retry.`,
      technical: withoutPrefix,
    };
  }

  // 7. Credit/debit notes without the original invoice reference.
  if (/billing reference|billingreference|original irn|original invoice/i.test(inspected)) {
    return {
      summary:
        `CittaEFS requires a billing reference for this invoice type. Types 380, 384 and 393 ` +
        `must point at the original invoice's IRN. Add that IRN, then retry.`,
      technical: withoutPrefix,
    };
  }

  // 8. Customer TIN, including self-billed types.
  if (/self[- ]billed|customer tin|\btin\b.*(invalid|required|missing)/i.test(inspected)) {
    return {
      summary:
        `CittaEFS requires a valid customer TIN for this invoice type. Add the customer's TIN to ` +
        `their record, then retry.`,
      technical: withoutPrefix,
    };
  }

  // 9. HS / service code rejected on a line.
  if (
    /hsorservice|hs code|service code|invalid product code|product code/i.test(inspected)
  ) {
    return {
      summary:
        `CittaEFS rejected the HS or service code on one or more lines. Map each item to a code ` +
        `returned by \`GET /api/resources/hs-codes\`, then retry.`,
      technical: withoutPrefix,
    };
  }

  // 10. Transport failures and 5xx — the request may not have been recorded.
  if (
    /econnrefused|econnreset|etimedout|enotfound|socket hang up|network error|timeout/i.test(
      inspected,
    ) ||
    (status !== undefined && Number(status) >= 500)
  ) {
    return {
      summary:
        `CittaEFS could not be reached or failed while processing this invoice${statusSuffix}. The ` +
        `request may not have been recorded. Wait and retry; if it keeps failing, give CittaEFS ` +
        `the technical detail.`,
      technical: withoutPrefix,
    };
  }

  // 11. A readable message inside the JSON envelope.
  const gatewayMessage = readGatewayMessage(withoutPrefix);
  if (gatewayMessage && !/insert statement|check constraint|syntax error/i.test(gatewayMessage)) {
    return {
      summary: `CittaEFS refused this invoice${statusSuffix}: ${asSentence(gatewayMessage)}`,
      technical: withoutPrefix,
    };
  }

  // 12. Unknown shape — keep the raw reply reachable, say plainly that it is unknown.
  return {
    summary:
      `CittaEFS refused this invoice${statusSuffix}. The gateway's own message is in the technical ` +
      `detail below; the hub could not turn it into a specific fix.`,
    technical: withoutPrefix,
  };
}

/** Composes the value stored in `ValidationError.errorMessage`. */
export function formatGatewayErrorMessage(
  rawMessage: string,
  context: GatewayErrorContext = {},
): string {
  const { summary, technical } = describeGatewayFailure(rawMessage, context);
  return technical ? `${summary}${TECHNICAL_DETAIL_MARKER}${technical}` : summary;
}

/**
 * Splits a stored `errorMessage` into its readable summary and raw detail.
 * Rows written before the marker existed are translated on the fly.
 */
export function splitGatewayErrorMessage(message: string): DescribedGatewayError {
  const index = message.indexOf(TECHNICAL_DETAIL_MARKER);
  if (index !== -1) {
    return {
      summary: message.slice(0, index),
      technical: message.slice(index + TECHNICAL_DETAIL_MARKER.length) || null,
    };
  }
  return describeGatewayFailure(message);
}
