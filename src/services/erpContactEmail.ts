import { prisma } from "../lib/prisma";
import { parseRecipientList } from "../lib/errorDigestFormat";

/**
 * The company email address held in each ERP the tenant has connected:
 *   QuickBooks Online -> CompanyInfo.Email (falls back to CustomerCommunicationEmailAddr)
 *   Odoo              -> res.company.email
 * Used as the default recipient for EFS feedback emails. Cached for 6h so a
 * cron running every few minutes does not hit the ERP APIs each time.
 */

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { emails: string[]; at: number }>();

export function extractQboCompanyEmails(info: any): string[] {
  return parseRecipientList(
    [info?.Email?.Address, info?.CustomerCommunicationEmailAddr?.Address].filter(Boolean).join(","),
  ).slice(0, 1);
}

export function extractOdooCompanyEmails(company: any): string[] {
  return parseRecipientList(typeof company?.email === "string" ? company.email : "");
}

export async function getErpCompanyEmails(tenantId: string): Promise<string[]> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.emails;

  const integrations = await prisma.integration.findMany({
    where: { tenantId, sourceSystem: { in: ["QUICKBOOKS_ONLINE", "ODOO"] }, status: { not: "DISCONNECTED" } },
    select: { sourceSystem: true },
  });

  const found: string[] = [];
  for (const { sourceSystem } of integrations) {
    try {
      if (sourceSystem === "QUICKBOOKS_ONLINE") {
        const { fetchQboCompanyInfo } = await import("./qboService");
        found.push(...extractQboCompanyEmails(await fetchQboCompanyInfo(tenantId)));
      } else if (sourceSystem === "ODOO") {
        const { fetchOdooCompanyInfo } = await import("./odooService");
        found.push(...extractOdooCompanyEmails(await fetchOdooCompanyInfo(tenantId)));
      }
    } catch (e: any) {
      console.warn(`[ErpContactEmail] Could not read company email from ${sourceSystem} for tenant ${tenantId}:`, e?.message);
    }
  }

  const emails = Array.from(new Set(found));
  // Don't cache an empty result caused by a transient failure for the full TTL.
  cache.set(tenantId, { emails, at: emails.length ? Date.now() : Date.now() - TTL_MS + 10 * 60 * 1000 });
  return emails;
}
