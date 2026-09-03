/**
 * Invoice Template Reference — derived from invoice_template.xlsx:Instructions
 * Single source of truth for column guide, valid codes, and compliance rules.
 * Used by ExcelDocumentViewer validation and server-side ingestion.
 * Source: Instructions sheet (6292 rows, 📋 BULK INVOICE UPLOAD GUIDE)
 */

export interface ColumnDef {
  header: string;
  required: boolean;
  description: string;
  example?: string;
}

// COLUMN GUIDE (Instructions:21-34) — exact headers from InvoiceTemplate sheet
export const INVOICE_TEMPLATE_COLUMNS: ColumnDef[] = [
  { header: "Document Number", required: false, description: "Your order or document reference number. Optional.", example: "PO-001" },
  { header: "Customer Code", required: true, description: "MUST FILL - If code exists in customer list → B2B, else B2C (walk-in). System auto-detects." },
  { header: "Invoice Number", required: true, description: "MUST FILL - Unique, ONLY CAPS A-Z + NUMBERS 0-9, NO dash/underscore/lowercase.", example: "INV2024001" },
  { header: "Issue Date", required: true, description: "MUST FILL - Format YEAR-MONTH-DAY", example: "2026-07-26" },
  { header: "Header Charges", required: false, description: "Extra charges added to whole invoice (e.g. delivery fee). 0 if none. Same on all rows for same invoice — Last row wins.", example: "0" },
  { header: "Header Discount", required: false, description: "Discount applied to whole invoice. 0 if none. Same on all rows — Last row wins.", example: "0" },
  { header: "Invoice Type", required: false, description: "Type code. See INVOICE_TYPE_CODES.", example: "380" },
  { header: "Line Number", required: true, description: "MUST FILL - Item number 1,2,3... different per invoice.", example: "1" },
  { header: "Item Code", required: true, description: "MUST FILL - Must exist in product list.", example: "LPT-001" },
  { header: "Unit Price", required: true, description: "Price per unit.", example: "1000" },
  { header: "Quantity", required: true, description: "MUST FILL - How many, >0." },
  { header: "Taxable Amount", required: true, description: "MUST FILL - (Quantity × Unit Price) - Line Discount." },
  { header: "Tax Amount", required: true, description: "MUST FILL - Tax for this line." },
  { header: "Line Discount", required: false, description: "Discount on just this item. 0 if none." },
  { header: "Currency Code", required: false, description: "Currency, usually NGN. See CURRENCY_CODES.", example: "NGN" },
  { header: "Billing Reference IRNs", required: false, description: "For types requiring it — comma-separated IRNs (no spaces) from Archived Invoices. REQUIRED for 380/384/393.", example: "IRN123...,IRN098..." },
  // Metadata columns after Billing Reference IRNs become {key:value}
  { header: "Days", required: false, description: "Extra metadata — saved as customFields.Days" },
  { header: "Group Code", required: false, description: "Extra metadata" },
  { header: "Telephone", required: false, description: "Extra metadata" },
  { header: "Website", required: false, description: "Extra metadata" },
  { header: "Branch Network", required: false, description: "Extra metadata" },
  { header: "Order Number", required: false, description: "Extra metadata" },
  { header: "Sales Outlet", required: false, description: "Extra metadata" },
  { header: "Sales Person", required: false, description: "Extra metadata" },
  { header: "Branch Name", required: false, description: "Extra metadata" },
  { header: "Division Code", required: false, description: "Extra metadata" },
  // Gold EFS Template User defined1-10 also map to customFields
  { header: "User defined1", required: false, description: "EFS Template — customFields" },
  { header: "User defined2", required: false, description: "EFS Template — customFields" },
  { header: "User defined3", required: false, description: "EFS Template — customFields" },
  { header: "User defined4", required: false, description: "EFS Template — customFields" },
  { header: "User defined5", required: false, description: "EFS Template — customFields" },
  { header: "User defined6", required: false, description: "EFS Template — customFields" },
  { header: "User defined7", required: false, description: "EFS Template — customFields" },
  { header: "User defined8", required: false, description: "EFS Template — customFields" },
  { header: "User defined9", required: false, description: "EFS Template — customFields" },
  { header: "User defined10", required: false, description: "EFS Template — customFields" },
];

export interface InvoiceTypeDef {
  code: string;
  name: string;
  requiresBillingReference: boolean;
}

// VALID CODES (Instructions:113-134)
export const INVOICE_TYPE_CODES: InvoiceTypeDef[] = [
  { code: "380", name: "Credit Note", requiresBillingReference: true },
  { code: "381", name: "Commercial Invoice", requiresBillingReference: false },
  { code: "384", name: "Debit Note", requiresBillingReference: true },
  { code: "385", name: "Self Billed Invoice", requiresBillingReference: false },
  { code: "386", name: "Factored Invoice", requiresBillingReference: false },
  { code: "388", name: "Statement of Account", requiresBillingReference: false },
  { code: "389", name: "Purchase Order", requiresBillingReference: false },
  { code: "390", name: "Proforma Invoice", requiresBillingReference: false },
  { code: "392", name: "Consignment Invoice", requiresBillingReference: false },
  { code: "393", name: "Self-billed Credit Note", requiresBillingReference: true },
  { code: "395", name: "Credit Note Request", requiresBillingReference: false },
  { code: "396", name: "Invoice Request", requiresBillingReference: false },
  { code: "397", name: "Final Settlement", requiresBillingReference: false },
  { code: "399", name: "Bill of Lading", requiresBillingReference: false },
  { code: "400", name: "Waybill", requiresBillingReference: false },
  { code: "402", name: "Shipping Instructions", requiresBillingReference: false },
  { code: "404", name: "Certificate of Origin", requiresBillingReference: false },
  { code: "406", name: "Customs Declaration", requiresBillingReference: false },
  { code: "408", name: "Packing List", requiresBillingReference: false },
];

// Lookup helpers
export const INVOICE_TYPE_REQUIRES_IRN = new Set(
  INVOICE_TYPE_CODES.filter(t => t.requiresBillingReference).map(t => t.code)
);

// CURRENCY CODES (Instructions:135+) — full ISO 4217 as listed in template
export const CURRENCY_CODES = [
  "AED","AFN","ALL","AMD","ARS","AUD","AZN","BAM","BDT","BGN","BHD","BIF","BND","BOB","BRL","BWP","BYR","BZD",
  "CAD","CDF","CHF","CLP","CNY","COP","CRC","CVE","CZK","DJF","DKK","DOP","DZD","EEK","EGP","ERN","ETB","EUR",
  "GBP","GEL","GHS","GNF","GTQ","GTQ","HKD","HNL","HRK","HUF","IDR","ILS","INR","IQD","IRR","ISK","JMD","JOD",
  "JPY","KES","KHR","KMF","KRW","KWD","KZT","LBP","LKR","LTL","LVL","LYD","MAD","MDL","MGA","MKD","MMK","MOP",
  "MUR","MXN","MYR","MZN","NAD","NGN","NIO","NOK","NPR","NZD","OMR","PAB","PEN","PHP","PKR","PLN","PYG","QAR",
  "RON","RSD","RUB","RWF","SAR","SBD","SCR","SDG","SEK","SGD","SHP","SLL","SOS","SRD","STD","SVC","SYP","SZL",
  "THB","TJS","TMT","TND","TOP","TRY","TTD","TWD","TZS","UAH","UGX","USD","UYU","UZS","VEF","VND","VUV","WST",
  "XAF","XCD","XOF","XPF","YER","ZAR","ZMW","ZWL",
] as const;

// TAX CATEGORIES (Instructions:6287-6292)
export const TAX_CATEGORIES = [
  { code: "EXEMPTED", name: "Tax Exemption", rate: 0 },
  { code: "STANDARD_VAT", name: "Standard Value-Added Tax", rate: 7.5 },
  { code: "REDUCED_VAT", name: "Reduced Value-Added Tax", rate: 7.5 },
  { code: "ZERO_VAT", name: "Zero Value-Added Tax", rate: 0 },
  { code: "STAMP_DUTY", name: "Stamp Duty", rate: 1.0 },
] as const;

// FILE & INVOICE NUMBER RULES (Instructions:73-96)
export const INVOICE_NUMBER_PATTERN = /^[A-Z0-9]+$/; // ONLY CAPS+NUMBERS, no dash/underscore/lowercase
export const INVOICE_NUMBER_RULES = {
  pattern: INVOICE_NUMBER_PATTERN,
  description: "ONLY CAPITAL LETTERS A-Z and NUMBERS 0-9, NO dash (-), underscore (_) or lowercase. Must be unique.",
} as const;

export const FILE_RULES = {
  allowedExtensions: [".xlsx", ".xls"] as const,
  maxSizeMB: 10,
  expectedSheet: "InvoiceTemplate",
  onlyOneSheetWarning: "ONLY the 'InvoiceTemplate' sheet will be read — delete Instructions/FieldDefinitions before upload",
} as const;

export const COMMON_MISTAKES = [
  "Using dashes (-) in Invoice Number → Will be rejected",
  "Using lowercase letters in Invoice Number → Will be rejected",
  "Using an Item Code that doesn't exist → That row will be skipped",
  "Using a Customer Code that doesn't exist → Will be treated as B2C (walk-in)",
  "Reusing an Invoice Number already transmitted → Will be rejected (idempotent)",
  "Forgetting Billing Reference IRNs when required (380/384/393) → Will be rejected",
  "Using invalid IRNs in Billing Reference → Will be rejected",
] as const;

// Extra metadata note (Instructions:48-53)
// Any column after Billing Reference IRNs is saved as {"Header":"Value"} in customFields
export const METADATA_NOTE = "Any column after Billing Reference IRNs is saved as customFields {Header:Value} and forwarded to gateway." as const;
