/**
 * Normalised invoice export for EFS bulk upload.
 *
 * One row per invoice line, using the exact headers from
 * INVOICE_TEMPLATE_COLUMNS so the file can be uploaded without editing.
 * Amounts stay numeric so Excel can total them; the CSV writer only quotes
 * values that genuinely need it.
 */
import * as XLSX from "xlsx";
import { INVOICE_TEMPLATE_COLUMNS } from "../data/invoiceTemplateReference";

export type EfsExportFormat = "csv" | "xlsx" | "json";

export const EFS_EXPORT_FORMATS: EfsExportFormat[] = ["csv", "xlsx", "json"];

export function isEfsExportFormat(value: unknown): value is EfsExportFormat {
  return value === "csv" || value === "xlsx" || value === "json";
}

/**
 * Hub invoice type → EFS numeric code. The template defines 381 as commercial
 * invoice, 380 as credit note and 384 as debit note; 395 is the credit note
 * request. An explicit three-digit code already stored on the invoice wins
 * over the type.
 */
export function efsInvoiceTypeCode(invoiceType?: string | null, explicitCode?: string | null): string {
  const explicit = String(explicitCode ?? "").trim();
  if (/^\d{3}$/.test(explicit)) return explicit;
  switch (String(invoiceType ?? "").toUpperCase()) {
    case "CREDIT_NOTE":
    case "CREDITNOTE":
      return "380";
    case "DEBIT_NOTE":
    case "DEBITNOTE":
      return "384";
    case "CREDIT_NOTE_REQUEST":
    case "CREDITNOTEREQUEST":
      return "395";
    case "STANDARD":
    case "COMMERCIAL_INVOICE":
    default:
      return "381";
  }
}

function isoDate(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function numberValue(value: unknown, digits = 2): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(digits));
}

function billingReferences(invoice: any): string {
  const direct = invoice.billingReferenceIrns;
  if (Array.isArray(direct)) return direct.filter(Boolean).join(",");
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (invoice.originalIrn) return String(invoice.originalIrn);
  return "";
}

export interface EfsExportRow {
  [header: string]: string | number;
}

export interface EfsExportResult {
  columns: string[];
  rows: EfsExportRow[];
  invoicesExported: number;
  invoicesSkipped: string[];
}

function buildRow(invoice: any, line: any, lineNumber: number): EfsExportRow {
  const invoiceNumber = invoice.clientInvoiceNumber || invoice.clientInvoiceId || "";
  return {
    "Document Number": invoice.documentNumber || invoiceNumber,
    "Customer Code": invoice.customerCode || "",
    "Invoice Number": invoiceNumber,
    "Issue Date": isoDate(invoice.issueDate),
    "Header Charges": numberValue(invoice.headerCharges),
    "Header Discount": numberValue(invoice.headerDiscount),
    "Invoice Type": efsInvoiceTypeCode(invoice.invoiceType, invoice.invoiceTypeCode),
    "Line Number": lineNumber,
    "Item Code": line.itemCode || "",
    "Unit Price": numberValue(line.unitPrice),
    "Quantity": numberValue(line.quantity, 4),
    "Taxable Amount": numberValue(line.taxableAmount),
    "Tax Amount": numberValue(line.vatAmount),
    "Line Discount": numberValue(line.discountAmount),
    "Currency Code": invoice.currency || "NGN",
    "Billing Reference IRNs": billingReferences(invoice),
    "Days": "",
    "Group Code": "",
    "Telephone": "",
    "Website": "",
    "Branch Network": "",
    "Order Number": "",
    "Sales Outlet": "",
    "Sales Person": "",
    "Branch Name": "",
    "Division Code": "",
    "User defined1": "",
    "User defined2": "",
    "User defined3": "",
    "User defined4": "",
    "User defined5": "",
    "User defined6": "",
    "User defined7": "",
    "User defined8": "",
    "User defined9": "",
    "User defined10": "",
  };
}

/**
 * Builds the EFS rows. Invoices with no line items are reported in
 * invoicesSkipped instead of emitting a row with an empty Item Code that EFS
 * would reject.
 */
export function buildEfsExport(invoices: any[]): EfsExportResult {
  const rows: EfsExportRow[] = [];
  const invoicesSkipped: string[] = [];

  for (const invoice of invoices) {
    const lines = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
    if (lines.length === 0) {
      invoicesSkipped.push(invoice.clientInvoiceNumber || invoice.clientInvoiceId || invoice.id);
      continue;
    }
    lines.forEach((line: any, index: number) => {
      rows.push(buildRow(invoice, line, index + 1));
    });
  }

  return {
    columns: INVOICE_TEMPLATE_COLUMNS.map((column) => column.header),
    rows,
    invoicesExported: invoices.length - invoicesSkipped.length,
    invoicesSkipped,
  };
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(result: EfsExportResult): string {
  const lines = [
    result.columns.map(csvCell).join(","),
    ...result.rows.map((row) => result.columns.map((column) => csvCell(row[column] ?? "")).join(",")),
  ];
  // BOM keeps Excel from mangling the header row; CRLF matches the template.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function toXlsx(result: EfsExportResult): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(result.rows, { header: result.columns });
  worksheet["!cols"] = result.columns.map((column) => ({
    wch: Math.max(12, Math.min(40, column.length + 4)),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "InvoiceTemplate");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function toJson(result: EfsExportResult): string {
  return JSON.stringify(
    {
      format: "cittaefs-efs-upload",
      generatedAt: new Date().toISOString(),
      sheetName: "InvoiceTemplate",
      columns: result.columns,
      rowCount: result.rows.length,
      invoicesExported: result.invoicesExported,
      invoicesSkipped: result.invoicesSkipped,
      rows: result.rows,
    },
    null,
    2,
  );
}

export function exportFileName(format: EfsExportFormat, tenantId: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const safeTenant = String(tenantId || "tenant").replace(/[^a-zA-Z0-9_-]/g, "_");
  const extension = format === "xlsx" ? "xlsx" : format;
  return `cittaefs-efs-${safeTenant}-${stamp}.${extension}`;
}
