/**
 * CittaEFS pre-flight: brings an invoice into the exact shape CittaEFS accepts
 * before it is sent, so format problems are fixed or caught locally instead of
 * coming back as gateway rejections.
 *
 * Deterministic only (no network, no model): every rule is a fixed transform.
 *   - fixes:  safe, value-preserving corrections, applied automatically and logged
 *   - issues: problems no rule can repair; the invoice is held with a specific
 *             validation error instead of being rejected by the gateway
 *
 * Rules come from the CittaEFS bulk-upload template (invoice_template.xlsx,
 * src/data/invoiceTemplateReference.ts) and the gateway rejections the hub has seen
 * (src/lib/gatewayErrors.ts). HS / service codes are handled by the code-intelligence
 * stage, not here.
 */
import {
  CURRENCY_CODES,
  INVOICE_TYPE_CODES,
  INVOICE_TYPE_REQUIRES_IRN,
  TAX_CATEGORIES,
} from "../data/invoiceTemplateReference";
import { toEfsInvoiceNumber } from "./efsInvoiceNumber";

export interface PreflightFix {
  field: string;
  from: string;
  to: string;
  rule: string;
}

export type PreflightCategory = "INVALID_DATE" | "TAX_MISMATCH" | "EFS_FORMAT";

export interface PreflightIssue {
  category: PreflightCategory;
  field: string;
  message: string;
}

/** CittaEFS's configured code lists (GET /api/resources/*). */
export interface EfsCatalog {
  invoiceTypes: Set<string>;
  taxCategories: Map<string, number | null>; // code -> percent
  codes: Set<string>; // HS and service codes
}

export interface PreflightResult<T> {
  data: T;
  fixes: PreflightFix[];
  issues: PreflightIssue[];
}

const CURRENCIES = new Set<string>(CURRENCY_CODES);
const TYPE_CODES = new Set(INVOICE_TYPE_CODES.map(t => t.code));
const TAX_CATEGORY_CODES = new Set<string>(TAX_CATEGORIES.map(t => t.code));
const CURRENCY_ALIASES: Record<string, string> = {
  "₦": "NGN", N: "NGN", NAIRA: "NGN", "NG N": "NGN",
  $: "USD", US$: "USD", DOLLAR: "USD", DOLLARS: "USD",
  "£": "GBP", POUND: "GBP", POUNDS: "GBP",
  "€": "EUR", EURO: "EUR", EUROS: "EUR",
};
const TAX_CATEGORY_ALIASES: Record<string, string> = {
  VAT: "STANDARD_VAT", STANDARD: "STANDARD_VAT", "STANDARD VAT": "STANDARD_VAT", S: "STANDARD_VAT",
  EXEMPT: "EXEMPTED", "VAT EXEMPT": "EXEMPTED", E: "EXEMPTED",
  ZERO: "ZERO_VAT", "ZERO RATED": "ZERO_VAT", ZERO_RATED: "ZERO_VAT", Z: "ZERO_VAT",
};
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Numbers as ERPs send them: "1,250.00", " 12 ", "₦5,000", null. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[₦$£€,\s]/g, "").replace(/^NGN/i, "");
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Dates to CittaEFS's YYYY-MM-DD. Slash/dot/dash dates without a year first are
 * read day-first (Nigerian convention), unless the first number cannot be a day.
 */
export function toEfsDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const s = String(value ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    return a > 12 ? validYmd(y, b, a) : b > 12 ? validYmd(y, a, b) : validYmd(y, b, a);
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return validYmd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return validYmd(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return validYmd(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));
  return null;
}

/** Plain, single-line text without control characters, capped in length. */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function typeCodeFor(invoiceType: string | undefined): string {
  if (invoiceType === "CREDIT_NOTE") return "380";
  if (invoiceType === "DEBIT_NOTE") return "384";
  return "381";
}

/**
 * Normalises a queued invoice payload in place of a copy. Field names follow
 * the hub's queue payload (src/queues/invoiceQueue.ts).
 */
export function preflightInvoice<T extends Record<string, any>>(
  input: T,
  opts: { today?: Date; catalog?: EfsCatalog | null } = {},
): PreflightResult<T> {
  const data: any = JSON.parse(JSON.stringify(input));
  const fixes: PreflightFix[] = [];
  const issues: PreflightIssue[] = [];
  const fix = (field: string, from: unknown, to: unknown, rule: string) => {
    if (String(from ?? "") !== String(to ?? "")) fixes.push({ field, from: String(from ?? ""), to: String(to ?? ""), rule });
  };

  // Invoice number: A-Z / 0-9 only. The ERP number stays as documentNumber.
  const efsNumber = toEfsInvoiceNumber(data.clientInvoiceNumber);
  if (!efsNumber || efsNumber.length < 3 || !/^[A-Z0-9]+$/.test(efsNumber)) {
    issues.push({ category: "EFS_FORMAT", field: "invoiceNumber", message: `Invoice number "${data.clientInvoiceNumber ?? ""}" has fewer than 3 letters or digits once symbols are removed. CittaEFS needs a unique A-Z / 0-9 number.` });
  } else if (efsNumber !== data.clientInvoiceNumber) {
    fix("invoiceNumber", data.clientInvoiceNumber, efsNumber, "CittaEFS accepts A-Z and 0-9 only; the ERP number is sent as documentNumber");
  }
  if (!data.documentNumber && data.clientInvoiceNumber) data.documentNumber = String(data.clientInvoiceNumber);

  // Issue date: YYYY-MM-DD, not in the future.
  const date = toEfsDate(data.issueDate);
  if (!date) {
    issues.push({ category: "INVALID_DATE", field: "issueDate", message: `Issue date "${data.issueDate ?? ""}" is not a real date. Fix it in the ERP and sync again.` });
  } else {
    fix("issueDate", data.issueDate, date, "CittaEFS date format YYYY-MM-DD");
    data.issueDate = date;
    const today = opts.today ?? new Date();
    const limit = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1)).toISOString().slice(0, 10);
    if (date > limit) issues.push({ category: "INVALID_DATE", field: "issueDate", message: `Issue date ${date} is in the future. Invoices can only be stamped on or after their issue date.` });
  }

  // Currency: ISO 4217 from the template list.
  const rawCurrency = data.currency ?? "NGN";
  const upper = cleanText(rawCurrency, 12).toUpperCase();
  const currency = CURRENCY_ALIASES[upper] || upper || "NGN";
  if (!CURRENCIES.has(currency)) {
    issues.push({ category: "EFS_FORMAT", field: "currencyCode", message: `Currency "${rawCurrency}" is not an ISO currency code CittaEFS accepts.` });
  } else {
    if (data.currency !== undefined) fix("currencyCode", rawCurrency, currency, "ISO 4217 currency code");
    data.currency = currency;
  }

  // Invoice type code and billing reference.
  const rawType = data.invoiceTypeCode !== undefined && data.invoiceTypeCode !== null ? String(data.invoiceTypeCode).trim() : "";
  const typeCode = rawType && TYPE_CODES.has(rawType) ? rawType : typeCodeFor(data.invoiceType);
  if (rawType && !TYPE_CODES.has(rawType)) fix("invoiceTypeCode", rawType, typeCode, "unknown type code replaced by the code for the invoice kind");
  data.invoiceTypeCode = typeCode;
  if (opts.catalog && !opts.catalog.invoiceTypes.has(typeCode)) {
    issues.push({ category: "EFS_FORMAT", field: "invoiceTypeCode", message: `Invoice type ${typeCode} is not enabled for this company in CittaEFS. Ask the CittaEFS administrator to enable it.` });
  }
  const refs = (Array.isArray(data.billingReferenceIrns) ? data.billingReferenceIrns : String(data.billingReferenceIrns || "").split(","))
    .map((r: unknown) => cleanText(r, 200))
    .filter(Boolean);
  if (!refs.length && data.originalIrn) refs.push(cleanText(data.originalIrn, 200));
  data.billingReferenceIrns = [...new Set(refs)];
  if (INVOICE_TYPE_REQUIRES_IRN.has(typeCode) && !data.billingReferenceIrns.length) {
    issues.push({ category: "EFS_FORMAT", field: "billingReferenceIrns", message: `Invoice type ${typeCode} must reference the original invoice's IRN. Link the original invoice in the ERP (credit/debit note "applied to") and sync again.` });
  }

  // Header discount / charges: non-negative money.
  for (const field of ["headerDiscount", "headerCharges"] as const) {
    if (data[field] === undefined || data[field] === null) continue;
    const n = toNumber(data[field]);
    if (n === null || n < 0) {
      issues.push({ category: "EFS_FORMAT", field, message: `${field} "${data[field]}" must be a number of zero or more.` });
    } else {
      fix(field, data[field], round2(n), "money to 2 decimals");
      data[field] = round2(n);
    }
  }

  // Customer.
  data.customerCode = cleanText(data.customerCode, 100);
  if (!data.customerCode) issues.push({ category: "EFS_FORMAT", field: "customerCode", message: "The invoice has no customer code. CittaEFS needs one for every invoice." });
  if (data.customerName !== undefined) data.customerName = cleanText(data.customerName, 200);
  if (data.customerTin) data.customerTin = cleanText(data.customerTin, 20).toUpperCase();
  // Self-billed types need a real buyer TIN (API guide: not empty, not 00000-000).
  if ((typeCode === "385" || typeCode === "393") && (!data.customerTin || /^0+-?0+$/.test(String(data.customerTin)))) {
    issues.push({ category: "EFS_FORMAT", field: "customerTin", message: `Self-billed invoice type ${typeCode} needs the customer's real TIN. Add it to the customer in the ERP and sync again.` });
  }

  // Lines.
  const lines: any[] = Array.isArray(data.lineItems) ? data.lineItems : [];
  if (!lines.length) issues.push({ category: "EFS_FORMAT", field: "lineItems", message: "The invoice has no lines." });
  lines.forEach((li, index) => {
    const at = `line ${index + 1}`;
    li.lineNum = String(index + 1);
    const sku = cleanText(li.itemCode, 100);
    if (!sku) issues.push({ category: "EFS_FORMAT", field: `${at}.itemCode`, message: `Line ${index + 1} has no item code.` });
    li.itemCode = sku;
    // itemName and itemDescription are both required; the SKU stands in for a missing description.
    const description = cleanText(li.description, 500);
    if (!description && sku) fix(`${at}.itemDescription`, "", sku, "item description required; item code used");
    li.description = description || sku;

    const qty = toNumber(li.quantity);
    const price = toNumber(li.unitPrice);
    const discount = toNumber(li.discountAmount) ?? 0;
    if (qty === null || qty <= 0) issues.push({ category: "EFS_FORMAT", field: `${at}.quantity`, message: `Line ${index + 1} (${sku || "no code"}) has quantity "${li.quantity ?? ""}". CittaEFS needs a quantity above zero.` });
    if (price === null || price <= 0) issues.push({ category: "EFS_FORMAT", field: `${at}.unitPrice`, message: `Line ${index + 1} (${sku || "no code"}) has unit price "${li.unitPrice ?? ""}". CittaEFS needs a unit price above zero (free items cannot be stamped).` });
    if (discount < 0) issues.push({ category: "EFS_FORMAT", field: `${at}.discountAmount`, message: `Line ${index + 1} has a negative discount.` });
    if (qty === null || price === null || qty <= 0 || price <= 0 || discount < 0) return;

    li.quantity = qty;
    li.unitPrice = price;
    li.discountAmount = round2(discount);

    // Taxable = qty x price - line discount (template rule).
    const expectedTaxable = round2(qty * price - discount);
    if (expectedTaxable <= 0) {
      issues.push({ category: "TAX_MISMATCH", field: `${at}.taxableAmount`, message: `Line ${index + 1} (${sku}): the discount leaves a taxable amount of ${expectedTaxable}. CittaEFS needs it above zero.` });
      return;
    }
    const sentTaxable = toNumber(li.taxableAmount);
    if (sentTaxable === null || Math.abs(sentTaxable - expectedTaxable) <= 1) {
      fix(`${at}.taxableAmount`, li.taxableAmount, expectedTaxable, "quantity x unit price - line discount");
      li.taxableAmount = expectedTaxable;
    } else {
      issues.push({ category: "TAX_MISMATCH", field: `${at}.taxableAmount`, message: `Line ${index + 1} (${sku}): taxable amount ${sentTaxable} does not equal quantity x price - discount (${expectedTaxable}).` });
    }

    // VAT rate and tax category.
    const rate = toNumber(li.vatRate) ?? 7.5;
    if (rate < 0 || rate > 100) {
      issues.push({ category: "TAX_MISMATCH", field: `${at}.vatRate`, message: `Line ${index + 1}: VAT rate ${li.vatRate} is outside 0-100%.` });
      return;
    }
    li.vatRate = rate;
    const rawCategory = cleanText(li.taxCategoryId, 40).toUpperCase();
    const category = TAX_CATEGORY_CODES.has(rawCategory)
      ? rawCategory
      : TAX_CATEGORY_ALIASES[rawCategory] || (rate === 0 ? "ZERO_VAT" : "STANDARD_VAT");
    if (rawCategory && rawCategory !== category) fix(`${at}.taxCategoryId`, rawCategory, category, "CittaEFS tax category code");
    if (category === "STANDARD_VAT" && rate === 0) {
      issues.push({ category: "TAX_MISMATCH", field: `${at}.taxCategoryId`, message: `Line ${index + 1} (${sku}) is standard VAT but has a 0% rate. Mark it exempt or zero-rated in the ERP, or apply 7.5%.` });
    }
    if (opts.catalog && !opts.catalog.taxCategories.has(category)) {
      issues.push({ category: "EFS_FORMAT", field: `${at}.taxCategoryId`, message: `Tax category ${category} is not configured for this company in CittaEFS.` });
    }
    li.taxCategoryId = category;

    // Tax amount = taxable x rate (rounding differences up to 1 are aligned).
    const expectedTax = round2((li.taxableAmount * rate) / 100);
    const sentTax = toNumber(li.vatAmount);
    if (sentTax === null || Math.abs(sentTax - expectedTax) <= 1) {
      fix(`${at}.taxAmount`, li.vatAmount, expectedTax, "taxable amount x VAT rate");
      li.vatAmount = expectedTax;
    } else {
      issues.push({ category: "TAX_MISMATCH", field: `${at}.taxAmount`, message: `Line ${index + 1} (${sku}): tax ${sentTax} does not match ${rate}% of ${li.taxableAmount} (${expectedTax}).` });
    }
    li.totalAmount = round2(li.taxableAmount + li.vatAmount);

    // Unit code: upper-case letters/digits, EA when the ERP sent none.
    const unit = cleanText(li.unitCode, 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
    li.unitCode = unit || "EA";

    // HS / service code must be one CittaEFS has configured (when its list is available).
    const code = String(li.hsOrServiceCode || "").trim();
    if (opts.catalog && code && code !== "UNMAPPED" && !opts.catalog.codes.has(code)) {
      issues.push({ category: "EFS_FORMAT", field: `${at}.hsOrServiceCode`, message: `Line ${index + 1} (${sku}): code ${code} is not in CittaEFS's configured HS / service code list. Choose a listed code.` });
    }
  });

  return { data, fixes, issues };
}
