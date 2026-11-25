/**
 * Finds a QuickBooks company's IRN / QR / Status sales-form custom fields by name, so
 * the writeback lands in the right field whatever order the client created
 * them in. Pure (no I/O) so it is unit tested directly.
 *
 * Names come from two places, both keyed by DefinitionId ("1".."3"):
 *  - the invoice's own CustomField array (active fields carry their Name);
 *  - Preferences.SalesFormsPrefs.CustomField, where field n is described by
 *    "SalesFormsPrefs.SalesCustomName{n}" (its label) and
 *    "SalesFormsPrefs.UseSalesCustomName{n}" (whether it is switched on).
 */

/** QuickBooks rejects custom field values longer than this. */
export const QBO_CUSTOM_FIELD_MAX = 30;

export interface QboStampFieldIds {
  irn?: string;
  qr?: string;
  /** A field named "Status" or "Info": shows where the invoice is in the hub. */
  status?: string;
}

const IRN_NAME = /\birn\b|invoice\s*reference\s*number/i;
const QR_NAME = /\bqr\b|qr[\s_-]*code/i;
const STATUS_NAME = /\b(status|info)\b/i;

/** DefinitionId -> label of the company's active sales custom fields. */
export function customFieldNames(invoiceCustomFields: unknown, preferences: unknown): Map<string, string> {
  const names = new Map<string, string>();

  if (Array.isArray(invoiceCustomFields)) {
    for (const f of invoiceCustomFields as any[]) {
      if (f?.DefinitionId && typeof f?.Name === 'string' && f.Name.trim()) {
        names.set(String(f.DefinitionId), f.Name.trim());
      }
    }
  }

  const groups = (preferences as any)?.SalesFormsPrefs?.CustomField;
  if (Array.isArray(groups)) {
    const labels = new Map<string, string>();
    const enabled = new Map<string, boolean>();
    for (const group of groups) {
      const entries = Array.isArray(group?.CustomField) ? group.CustomField : [group];
      for (const e of entries) {
        const name = String(e?.Name || '');
        const label = name.match(/SalesCustomName(\d+)$/);
        const use = name.match(/UseSalesCustomName(\d+)$/);
        if (use) enabled.set(use[1], e?.BooleanValue !== false);
        else if (label && typeof e?.StringValue === 'string' && e.StringValue.trim()) labels.set(label[1], e.StringValue.trim());
      }
    }
    for (const [id, label] of labels) {
      if (enabled.get(id) === false || names.has(id)) continue;
      names.set(id, label);
    }
  }

  return names;
}

/** Picks the IRN, QR and Status fields by label; a field is never used twice. */
export function findQboStampFields(invoiceCustomFields: unknown, preferences: unknown): QboStampFieldIds {
  const names = customFieldNames(invoiceCustomFields, preferences);
  const ids = [...names.keys()].sort();
  const irn = ids.find(id => IRN_NAME.test(names.get(id)!) && !QR_NAME.test(names.get(id)!));
  const qr = ids.find(id => id !== irn && QR_NAME.test(names.get(id)!));
  const status = ids.find(id => id !== irn && id !== qr && STATUS_NAME.test(names.get(id)!));
  return { irn, qr, status };
}

/** Status-field values (each fits QuickBooks' 30-character limit). */
export const QBO_STATUS = {
  /** Picked up and being sent to CittaEFS / NRS. */
  processing: "Pending - sending to NRS",
  /** Waiting for an operator to approve it in the hub before sending. */
  review: "Pending - hub review",
  stamped: "Stamped by NRS",
} as const;

/** A short error label for the status field; the full reason is in the Memo. */
export function qboErrorStatus(problem: string): string {
  const p = (problem || "").toLowerCase();
  if (/customer details incomplete/.test(p)) return "Error: customer details";
  if (/\bhs\b|hs code|service code|product code/.test(p)) return "Error: HS/service code";
  if (/\btin\b/.test(p)) return "Error: customer TIN";
  if (/billing reference|original (invoice|irn)/.test(p)) return "Error: needs original IRN";
  if (/duplicate|already (been )?posted|already exists/.test(p)) return "Error: duplicate invoice";
  if (/regist/.test(p)) return "Error: customer not registered";
  return "Error - see memo";
}

/** What goes in the QR field: a short verification link, else a pointer to the attachment. */
export function qrFieldValue(qrCodeUrl: string | null | undefined): string {
  if (qrCodeUrl && /^https?:\/\//i.test(qrCodeUrl) && qrCodeUrl.length <= QBO_CUSTOM_FIELD_MAX) return qrCodeUrl;
  return 'See QR attachment';
}
