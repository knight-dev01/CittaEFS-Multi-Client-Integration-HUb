type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'ANOMALY';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  tenantId?: string;
  user?: string;
  requestId?: string;
}

function format(entry: LogEntry): string {
  const base = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;
  const meta: string[] = [];
  if (entry.tenantId) meta.push(`tenant=${entry.tenantId}`);
  if (entry.user) meta.push(`user=${entry.user}`);
  if (entry.requestId) meta.push(`req=${entry.requestId}`);
  if (entry.context) {
    const ctx = JSON.stringify(entry.context, (k, v) => typeof v === 'bigint' ? v.toString() : v).slice(0, 2000);
    meta.push(`ctx=${ctx}`);
  }
  return meta.length ? `${base} | ${meta.join(' | ')}` : base;
}

function log(level: LogLevel, message: string, context?: Record<string, any>, extra?: { tenantId?: string; user?: string; requestId?: string }) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
    tenantId: extra?.tenantId,
    user: extra?.user,
    requestId: extra?.requestId,
  };
  const line = format(entry);
  if (level === 'ERROR' || level === 'ANOMALY') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
  // Also persist anomalies to audit log via console anomalies can be grepped
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, any>, extra?: any) => log('DEBUG', msg, ctx, extra),
  info: (msg: string, ctx?: Record<string, any>, extra?: any) => log('INFO', msg, ctx, extra),
  warn: (msg: string, ctx?: Record<string, any>, extra?: any) => log('WARN', msg, ctx, extra),
  error: (msg: string, ctx?: Record<string, any>, extra?: any) => log('ERROR', msg, ctx, extra),
  anomaly: (msg: string, ctx?: Record<string, any>, extra?: any) => log('ANOMALY', msg, ctx, extra),
};

export function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  const clone = { ...headers };
  ['authorization', 'cookie', 'x-api-key', 'x-hub-api-key'].forEach(k => {
    if (clone[k]) clone[k] = '***';
    const cap = k.split('-').map(s=> s.charAt(0).toUpperCase()+s.slice(1)).join('-');
    if (clone[cap]) clone[cap] = '***';
  });
  return clone;
}

export function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const clone: any = Array.isArray(body) ? [...body] : { ...body };
  const secretKeys = ['password', 'passwordHash', 'cittaApiKey', 'apiKey', 'secret', 'token', 'refreshToken', 'accessToken', 'encryptedSecret'];
  for (const k of secretKeys) {
    if (k in clone) clone[k] = '***';
    // nested tenantErp config
    if (clone.config && typeof clone.config === 'object' && k in clone.config) clone.config[k] = '***';
  }
  return clone;
}
