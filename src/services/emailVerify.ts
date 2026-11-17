import { promises as dns } from "dns";

/**
 * Background "is this a real address?" check for feedback-email recipients.
 *
 *   valid   - well-formed and the domain publishes a mail server (MX, or an A/AAAA
 *             record, which RFC 5321 accepts as an implicit MX)
 *   invalid - malformed, a reserved / non-deliverable domain, or a domain that does
 *             not exist or explicitly accepts no mail (null MX)
 *   unknown - DNS could not be reached; the address is still used
 *
 * This cannot prove a specific mailbox exists - mail servers hide that to stop
 * address harvesting. A real send (the Settings "Send test email" button) is the
 * final proof; a bounce shows up in the MAIL_FROM inbox.
 */

export type EmailCheckStatus = "valid" | "invalid" | "unknown";
export interface EmailCheck {
  email: string;
  status: EmailCheckStatus;
  reason: string;
}

export interface DnsLike {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

const SYNTAX_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/;

// Reserved (RFC 2606 / 6761) and well-known domains that never receive real mail.
const NON_DELIVERABLE_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "test.com", "domain.com", "email.com",
  "yourdomain.com", "yourcompany.com", "company.com", "sample.com", "mailinator.com",
]);
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);
const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "ENONAME", "NXDOMAIN"]);

const TTL_MS = 60 * 60 * 1000;
const domainCache = new Map<string, { result: Omit<EmailCheck, "email">; at: number }>();

export function clearEmailCheckCache() {
  domainCache.clear();
}

async function checkDomain(domain: string, resolver: DnsLike): Promise<Omit<EmailCheck, "email">> {
  try {
    const mx = await resolver.resolveMx(domain);
    // RFC 7505 "null MX": a single record with exchange "." means "accepts no mail".
    if (mx.length === 1 && (mx[0].exchange === "" || mx[0].exchange === ".")) {
      return { status: "invalid", reason: `${domain} does not accept email` };
    }
    if (mx.length) return { status: "valid", reason: `${domain} accepts email` };
  } catch (e: any) {
    if (!NOT_FOUND.has(e?.code)) return { status: "unknown", reason: `Could not check ${domain} (${e?.code || e?.message || "DNS error"})` };
  }
  // No MX: an A/AAAA record still makes the domain deliverable (implicit MX).
  for (const lookup of [resolver.resolve4.bind(resolver), resolver.resolve6.bind(resolver)]) {
    try {
      if ((await lookup(domain)).length) return { status: "valid", reason: `${domain} has no MX record but has a host address` };
    } catch (e: any) {
      if (!NOT_FOUND.has(e?.code)) return { status: "unknown", reason: `Could not check ${domain} (${e?.code || e?.message || "DNS error"})` };
    }
  }
  return { status: "invalid", reason: `${domain} has no mail server (domain may not exist or is misspelt)` };
}

export async function verifyEmailAddress(raw: string, resolver: DnsLike = dns): Promise<EmailCheck> {
  const email = String(raw || "").trim().toLowerCase();
  const m = SYNTAX_RE.exec(email);
  if (!m || email.length > 254 || email.split("@")[0].length > 64) {
    return { email, status: "invalid", reason: "Not a valid email address format" };
  }
  const domain = m[1];
  const tld = domain.split(".").pop() || "";
  if (NON_DELIVERABLE_DOMAINS.has(domain) || RESERVED_TLDS.has(tld)) {
    return { email, status: "invalid", reason: `${domain} is a reserved example domain, not a real mailbox` };
  }
  const hit = domainCache.get(domain);
  if (hit && Date.now() - hit.at < TTL_MS) return { email, ...hit.result };
  const result = await checkDomain(domain, resolver);
  if (result.status !== "unknown") domainCache.set(domain, { result, at: Date.now() });
  return { email, ...result };
}

export async function verifyEmailAddresses(emails: string[], resolver: DnsLike = dns): Promise<EmailCheck[]> {
  return Promise.all(emails.map(e => verifyEmailAddress(e, resolver)));
}

/** Recipients safe to send to: drops "invalid", keeps "valid" and "unknown". */
export async function filterDeliverable(emails: string[], resolver: DnsLike = dns): Promise<{ deliverable: string[]; rejected: EmailCheck[] }> {
  const checks = await verifyEmailAddresses(emails, resolver);
  return {
    deliverable: checks.filter(c => c.status !== "invalid").map(c => c.email),
    rejected: checks.filter(c => c.status === "invalid"),
  };
}
