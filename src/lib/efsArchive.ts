/**
 * Reads CittaEFS archive records without depending on one exact response
 * shape. The archive endpoint is documented only by URL, so records are
 * unwrapped from a bare array or a common envelope, and fields are read
 * case-insensitively (C# APIs often serialise PascalCase). Pure: unit tested.
 */
import { toEfsInvoiceNumber } from "./efsInvoiceNumber";
import { hubInvoiceIdFrom } from "./sourceErpTag";

const ENVELOPE_KEYS = ["data", "items", "invoices", "records", "results", "result", "value", "archive"];

/** The list of archive records inside whatever the endpoint returned. */
export function unwrapArchive(body: unknown): any[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  for (const key of ENVELOPE_KEYS) {
    const value = readField(body, key);
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const inner = unwrapArchive(value);
      if (inner.length) return inner;
    }
  }
  return [];
}

/** A field by name, ignoring case and underscores ("qr_code" = "QrCode"). */
export function readField(record: unknown, ...names: string[]): any {
  if (!record || typeof record !== "object") return undefined;
  const wanted = new Set(names.map(n => n.toLowerCase().replace(/_/g, "")));
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (wanted.has(key.toLowerCase().replace(/_/g, "")) && value !== null && value !== undefined && value !== "") return value;
  }
  return undefined;
}

export interface ArchiveStamp {
  irn: string;
  csid: string | null;
  /** A verification URL or a data: URL of the QR image; null when EFS sent none. */
  qrCodeUrl: string | null;
  status: string | null;
}

/** The stamp in an archive record, or null when it has no IRN yet. */
export function stampFromArchiveRecord(record: any): ArchiveStamp | null {
  const irn = readField(record, "irn");
  if (!irn) return null;
  const status = readField(record, "status");
  if (status && /fail|reject/i.test(String(status))) return null;
  const qrUrl = readField(record, "qrCodeUrl", "qrUrl");
  const qrImage = readField(record, "qrCode", "qr");
  const qrCodeUrl = qrUrl
    ? String(qrUrl)
    : qrImage
      ? (String(qrImage).startsWith("data:") || /^https?:/i.test(String(qrImage)) ? String(qrImage) : `data:image/png;base64,${qrImage}`)
      : null;
  return { irn: String(irn), csid: readField(record, "csid") ?? null, qrCodeUrl, status: status ? String(status) : null };
}

export interface ArchiveIndex {
  /** By the hub's own invoice id, echoed back in the record's metadata. */
  byHubInvoiceId: Map<string, any>;
  /** By EFS's own invoiceNumber (the A-Z/0-9 form of the ERP number). */
  byInvoiceNumber: Map<string, any>;
  /** By the ERP's original number, echoed back as sourceNbr / documentNumber. */
  bySourceNumber: Map<string, any>;
}

function put(map: Map<string, any>, value: unknown, record: any) {
  if (!value) return;
  const key = toEfsInvoiceNumber(String(value));
  // Prefer a record that already carries an IRN.
  if (!map.has(key) || (!readField(map.get(key), "irn") && readField(record, "irn"))) map.set(key, record);
}

export function indexArchive(records: any[]): ArchiveIndex {
  const index: ArchiveIndex = { byHubInvoiceId: new Map(), byInvoiceNumber: new Map(), bySourceNumber: new Map() };
  for (const record of records) {
    const hubId = hubInvoiceIdFrom(record);
    if (hubId && (!index.byHubInvoiceId.has(hubId) || readField(record, "irn"))) index.byHubInvoiceId.set(hubId, record);
    put(index.byInvoiceNumber, readField(record, "invoiceNumber", "clientInvoiceNumber"), record);
    put(index.bySourceNumber, readField(record, "sourceNbr", "documentNumber"), record);
  }
  return index;
}

/**
 * The archive record for a hub invoice: by the HubInvoiceId the hub put in
 * the metadata when there is one, else by number. EFS's invoiceNumber is matched before the echoed source number,
 * so a credit memo sent as "CM1005" never takes invoice 1005's stamp; the
 * echoed source number is used only when no invoiceNumber matches.
 */
export function findArchiveRecord(index: ArchiveIndex, invoice: { id?: string; clientInvoiceId: string }): any | undefined {
  const key = toEfsInvoiceNumber(invoice.clientInvoiceId);
  return (invoice.id ? index.byHubInvoiceId.get(invoice.id) : undefined)
    ?? index.byInvoiceNumber.get(key)
    ?? index.bySourceNumber.get(key);
}

/**
 * The hub invoice a CittaEFS event is about. The HubInvoiceId echoed in the
 * event's metadata decides outright. Otherwise, among rows sharing its number, rows whose number matches EFS's invoiceNumber exactly win, then rows
 * matching the echoed sourceNbr, then any candidate; among those, the one
 * already holding this IRN, then the newest still awaiting a stamp, then the
 * newest.
 */
export function pickWebhookInvoice<T extends { id?: string; irn?: string | null; status: string; clientInvoiceId: string; createdAt: Date | string }>(
  candidates: T[],
  event: { irn?: string | null; invoiceNumber?: string | null; sourceNbr?: string | null; hubInvoiceId?: string | null },
): T | null {
  if (!candidates.length) return null;
  // The hub's own id, echoed back in the metadata, is an exact match.
  const tagged = event.hubInvoiceId ? candidates.find(c => c.id === event.hubInvoiceId) : undefined;
  if (tagged) return tagged;
  const newest = [...candidates].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const matching = (n?: string | null) =>
    n ? newest.filter(c => toEfsInvoiceNumber(c.clientInvoiceId) === toEfsInvoiceNumber(String(n))) : [];
  // invoiceNumber first: a credit memo sent as "CM1005" echoes sourceNbr
  // "1005", which must not pull in invoice 1005.
  const byInvoiceNumber = matching(event.invoiceNumber);
  const rows = byInvoiceNumber.length ? byInvoiceNumber : matching(event.sourceNbr).length ? matching(event.sourceNbr) : newest;
  const awaiting = (c: T) => c.status !== "APPROVED" && c.status !== "SIGNED";
  return (event.irn ? rows.find(c => c.irn === event.irn) : undefined) || rows.find(awaiting) || rows[0] || null;
}
