/**
 * CittaEFS's inline customer: lets a B2B invoice go to CittaEFS for a buyer
 * that is not registered there. CittaEFS API documentation, "Customer
 * Options": provide either customerCode or customer; an inline customer needs
 * name, tin, email, city, country, street and postalCode, and "does not need to
 * already exist as a customer record".
 *
 * Pure: the ERP adapters fetch the live details, this decides whether they are
 * complete. Nothing is guessed: a missing detail is reported so it can be
 * filled in in the ERP.
 */

export interface CustomerDetails {
  name?: string | null;
  tin?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  /** A country name ("Nigeria") or ISO code ("NG" / "NGA"). */
  country?: string | null;
}

export interface InlineCustomer {
  name: string;
  tin: string;
  email: string;
  city: string;
  country: string;
  street: string;
  postalCode: string;
}

/** The ERP-facing label for each field, used in "fill in X" messages. */
const FIELD_LABELS: Record<keyof InlineCustomer, string> = {
  name: "name",
  tin: "TIN",
  email: "email address",
  street: "street address",
  city: "city",
  postalCode: "postal code",
  country: "country",
};

const ISO3_TO_ISO2: Record<string, string> = {
  NGA: "NG", GHA: "GH", KEN: "KE", ZAF: "ZA", USA: "US", GBR: "GB", CAN: "CA",
  FRA: "FR", DEU: "DE", CHN: "CN", IND: "IN", ARE: "AE", BEN: "BJ", TGO: "TG",
  CMR: "CM", CIV: "CI", SEN: "SN", EGY: "EG", NLD: "NL", BEL: "BE", ITA: "IT",
  ESP: "ES", IRL: "IE", JPN: "JP", SAU: "SA", RWA: "RW", UGA: "UG", TZA: "TZ",
};

let namesToIso2: Map<string, string> | null = null;

/** English country name -> ISO 3166-1 alpha-2, built from the runtime's ICU data. */
function countryNameIndex(): Map<string, string> {
  if (namesToIso2) return namesToIso2;
  namesToIso2 = new Map();
  try {
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = display.of(code);
        // First code wins: "GB" before the reserved "UK" for United Kingdom.
        if (name && name !== code && !namesToIso2.has(name.toLowerCase())) namesToIso2.set(name.toLowerCase(), code);
      }
    }
  } catch {
    // No ICU region names: only ISO codes are recognised.
  }
  namesToIso2.set("united states of america", "US");
  namesToIso2.set("uk", "GB");
  return namesToIso2;
}

/** ISO 3166-1 alpha-2 for a country name or code; null when it is not recognisable. */
export function toIso2Country(country: unknown): string | null {
  const raw = typeof country === "string" ? country.trim() : "";
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  if (/^[A-Z]{3}$/.test(upper) && ISO3_TO_ISO2[upper]) return ISO3_TO_ISO2[upper];
  return countryNameIndex().get(raw.toLowerCase()) ?? null;
}

/** Odoo sends `false` for an empty field: anything but a string counts as blank. */
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** The inline customer when every required detail is present, else what is missing. */
export function buildInlineCustomer(details: CustomerDetails): { customer: InlineCustomer | null; missing: string[] } {
  const email = clean(details.email);
  const draft: InlineCustomer = {
    name: clean(details.name),
    tin: clean(details.tin),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    street: clean(details.street),
    city: clean(details.city),
    postalCode: clean(details.postalCode),
    country: toIso2Country(details.country) ?? "",
  };
  const missing = (Object.keys(FIELD_LABELS) as (keyof InlineCustomer)[])
    .filter(k => !draft[k])
    .map(k => (k === "email" && email ? "a valid email address" : k === "country" && clean(details.country) ? `a recognised country (got "${clean(details.country)}")` : FIELD_LABELS[k]));
  return missing.length ? { customer: null, missing } : { customer: draft, missing: [] };
}

/** The problem text written back to the ERP when details are missing. */
export function missingCustomerDetailsMessage(customerName: string, missing: string[]): string {
  return `Customer details incomplete: "${customerName}" is a B2B buyer (has a TIN) and is not registered in CittaEFS, ` +
    `so CittaEFS needs the customer's ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"} to the customer in the ERP and send the invoice again.`;
}
