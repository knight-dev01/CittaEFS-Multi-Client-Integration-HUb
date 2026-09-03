import crypto from 'crypto';
import { prisma } from './prisma';

export function generateSha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export function validateAndSerializeAuditRawJson(rawJson: any): string | null {
  if (rawJson === undefined || rawJson === null) return null;
  if (typeof rawJson === 'string') {
    try { JSON.parse(rawJson); return rawJson; } catch { return JSON.stringify({ rawText: rawJson }); }
  }
  try {
    return JSON.stringify(rawJson, (_k, v) => typeof v === 'bigint' ? v.toString() : v);
  } catch (err) {
    console.warn('[AuditLog Validation Warning] Failed to serialize rawJson, defaulting to safe representation:', err);
    return JSON.stringify({ error: 'Serialization failed', rawContent: String(rawJson) });
  }
}

export async function safeAuditLogCreate(prismaClient: any, data: { tenantId?: string | null; action: string; entityType: string; entityRef: string; details: string; sha256PayloadHash?: string; performedBy?: string; rawJson?: any; }) {
  try {
    let resolvedTenantId: string | null = null;
    if (data.tenantId && typeof data.tenantId === 'string' && data.tenantId.trim()) {
      const tenant = await prismaClient.tenant.findUnique({ where: { id: data.tenantId.trim() }, select: { id: true } });
      if (tenant) resolvedTenantId = tenant.id;
    }
    if (!resolvedTenantId) {
      const anyTenant = await prismaClient.tenant.findFirst({ select: { id: true } });
      if (anyTenant) resolvedTenantId = anyTenant.id;
    }
    if (!resolvedTenantId) return null;
    const action = typeof data.action === 'string' && data.action.trim() ? data.action : 'UNKNOWN_ACTION';
    const entityType = typeof data.entityType === 'string' && data.entityType.trim() ? data.entityType : 'GENERAL';
    const entityRef = typeof data.entityRef === 'string' && data.entityRef.trim() ? data.entityRef : 'REF_UNKNOWN';
    const details = typeof data.details === 'string' && data.details.trim() ? data.details : 'No details provided.';
    const sha256PayloadHash = typeof data.sha256PayloadHash === 'string' && data.sha256PayloadHash.trim() ? data.sha256PayloadHash : generateSha256(details);
    const performedBy = typeof data.performedBy === 'string' && data.performedBy.trim() ? data.performedBy : 'System';
    const serializedRawJson = validateAndSerializeAuditRawJson(data.rawJson);
    return await prismaClient.auditLog.create({ data: { tenantId: resolvedTenantId, action, entityType, entityRef, details, sha256PayloadHash, performedBy, rawJson: serializedRawJson } });
  } catch (e: any) { console.error('[AuditLog Error] Database write failed:', e.message); return null; }
}

export function formatInvoice(inv: any) {
  if (!inv) return inv;
  return {
    ...inv,
    clientInvoiceNumber: inv.clientInvoiceId || inv.clientInvoiceNumber || 'INV-UNKNOWN',
    totalVat: inv.taxAmount ?? inv.totalVat ?? 0,
    grandTotal: inv.totalAmount ?? inv.grandTotal ?? 0,
    totalDiscount: inv.totalDiscount ?? 0,
    dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().substring(0,10) : inv.issueDate ? new Date(inv.issueDate).toISOString().substring(0,10) : new Date().toISOString().substring(0,10),
    issueDate: inv.issueDate ? new Date(inv.issueDate).toISOString().substring(0,10) : new Date().toISOString().substring(0,10),
    paymentStatus: inv.paymentStatus || 'PAID',
    createdAt: inv.createdAt ? new Date(inv.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: inv.updatedAt ? new Date(inv.updatedAt).toISOString() : new Date().toISOString(),
    lineItems: (inv.lineItems || []).map((li:any)=>({ ...li, discountAmount: li.discountAmount ?? 0, codeType: li.hsOrServiceCode?.startsWith('SRV') ? 'SERVICE_CODE' : 'HS_CODE' })),
  };
}

export function formatCustomer(c:any) {
  if (!c) return c;
  const isB2B = c.taxClassification === 'B2B' || c.isB2B === true;
  return {
    ...c,
    clientCustomerCode: c.clientSystemCustId || c.clientCustomerCode || 'CUST-001',
    cittaCustomerCode: c.cittaCustomerId || c.cittaCustomerCode || null,
    name: c.companyName || c.name || 'Unnamed Customer',
    tin: c.taxId || c.tin || 'N/A',
    isB2B,
    street: c.street || 'Nairobi Business District',
    city: c.city || 'Nairobi',
    country: c.country || null,
    email: c.email || 'contact@client.com',
    ccEmail: (c as any).ccEmail || null,
    postcode: (c as any).postcode || null,
    phone: c.phone || '+254700000000',
    tinValidationStatus: c.tinValidationStatus || (isB2B ? 'VALIDATED' : 'UNVERIFIED'),
    lastSyncedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : new Date().toISOString(),
  };
}

export function parsePagination(req:any): { skip:number; take:number; page:number; limit:number } {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const rawLimit = parseInt(req.query.limit as string) || 50;
  const limit = Math.min(Math.max(1, rawLimit), 200);
  return { page, limit, skip: (page-1)*limit, take: limit };
}

export function getScopedTenantWhere(req:any, queryTenantId?:string): any {
  const role = req.user?.role;
  const userTenantId = req.user?.tenantId || (req as any).tenantId;
  if (role && role !== 'ADMIN') return userTenantId ? { tenantId: userTenantId } : {};
  return queryTenantId ? { tenantId: queryTenantId } : {};
}
export function canAccessTenant(req:any, targetTenantId:string): boolean {
  const role = req.user?.role;
  if (!req.user || role === 'ADMIN') return true;
  return req.user.tenantId === targetTenantId;
}

export function renderOAuthBridgeHtml(payload: { success:boolean; tenantId?:string; realmId?:string; error?:string; redirectQs:string }) {
  const result = JSON.stringify({ type:'qbo-oauth-result', success: payload.success, tenantId: payload.tenantId, realmId: payload.realmId, error: payload.error });
  const message = payload.success ? 'QuickBooks Online authorization successful! Completing setup...' : `Connection failed: ${payload.error || 'Unknown error'}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>QuickBooks Connection</title><style>body{font-family:-apple-system, BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0;font-size:14px;text-align:center}.card{background:#1e293b;border:1px solid #334155;padding:24px 32px;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.5);max-width:420px}.status{font-size:16px;font-weight:600;margin-bottom:8px;color:${payload.success?'#34d399':'#f87171'}}.sub{color:#94a3b8;font-size:13px}</style></head><body><div class="card"><div class="status">${payload.success?'✓ Authorization Successful':'✗ Authorization Failed'}</div><div class="sub">${message}</div></div><script>(function(){var result=${result};try{if(typeof BroadcastChannel!=='undefined'){var bc=new BroadcastChannel('citta_qbo_oauth');bc.postMessage(result);}}catch(e){}try{localStorage.setItem('citta_qbo_oauth_result', JSON.stringify({type:result.type,success:result.success,tenantId:result.tenantId,realmId:result.realmId,error:result.error,_ts:Date.now()}));}catch(e){}var postedToOpener=false;try{if(window.opener&&!window.opener.closed){window.opener.postMessage(result, window.location.origin);postedToOpener=true;}}catch(e){}var isPopup=postedToOpener||window.name==='qbo_oauth'||(typeof window.opener!=='undefined'&&window.opener!==null);if(isPopup){setTimeout(function(){try{window.close();}catch(e){}},800);}else{setTimeout(function(){window.location.href='/?tab=connectors&${payload.redirectQs}';},1200);}})();<\/script></body></html>`;
}

let cachedAuth: { JWT_SECRET:string; JWT_REFRESH_SECRET:string; ACCESS_TOKEN_MAX_AGE_MS:number; REFRESH_TOKEN_MAX_AGE_MS:number } | null = null;
export function getAuthConfig() {
  if (cachedAuth) return cachedAuth;
  let jwtSecret: string = process.env.JWT_SECRET?.trim() || '';
  if (!jwtSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Security] JWT_SECRET not set — generating ephemeral value for this boot. Set JWT_SECRET in Render env for persistence.');
      jwtSecret = crypto.randomBytes(32).toString('hex');
    } else {
      console.warn('[Security Warning] JWT_SECRET not set — using insecure dev value. Set JWT_SECRET for production.');
      jwtSecret = 'citta_efs_jwt_secret_998_dev_only';
    }
  }
  if (process.env.NODE_ENV === 'production' && jwtSecret.includes('dev_only')) {
    console.warn('[Security] JWT_SECRET is dev-only value — generating ephemeral strong secret for production boot. Set JWT_SECRET in Render env to persist sessions.');
    jwtSecret = crypto.randomBytes(32).toString('hex');
  }
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET?.trim() || `${jwtSecret}_refresh`;
  cachedAuth = { JWT_SECRET: jwtSecret, JWT_REFRESH_SECRET: jwtRefreshSecret, ACCESS_TOKEN_MAX_AGE_MS: 8*3600*1000, REFRESH_TOKEN_MAX_AGE_MS: 7*24*3600*1000 };
  return cachedAuth;
}
