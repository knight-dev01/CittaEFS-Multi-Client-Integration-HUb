import { useEffect, useState } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { toastGlobal } from './ui/Toast';
import { PageHeader } from './ui/PageHeader';
import { Card, CardHeader, CardBody } from './ui/Card';
import { Button } from './ui/Button';
import { Field, Input, Select } from './ui/Field';
import { Notice } from './ui/Notice';
import { Save, RefreshCw, Mail, Send } from 'lucide-react';

interface EmailCheck { email: string; status: 'valid' | 'invalid' | 'unknown'; reason: string }
interface FeedbackRecipients {
  mailConfigured: boolean;
  source: 'settings' | 'erp' | 'hub_users' | 'none';
  recipients: string[];
  configured: EmailCheck[];
  erpEmails: EmailCheck[];
  rejected: EmailCheck[];
}

const SOURCE_LABEL: Record<FeedbackRecipients['source'], string> = {
  settings: 'the override below',
  erp: 'the company email in the connected ERP',
  hub_users: 'hub users linked to this workspace (no ERP company email found)',
  none: 'nobody - no usable address found',
};
const CHECK_STYLE: Record<EmailCheck['status'], string> = {
  valid: 'text-emerald-700',
  invalid: 'text-red-700',
  unknown: 'text-amber-700',
};

interface CittaGatewayConfig {
  mode: string;
  envHasKey: boolean;
  envGatewayUrl: string;
  dbSharedKeyPreview: string | null;
  dbSharedGatewayUrl: string | null;
  dbWritebackTarget: 'HUB' | 'CITTAEFS' | 'BOTH';
  effectiveApiKeyPreview: string;
  effectiveGatewayUrl: string;
  note: string;
}

export function SettingsTab() {
  const { activeTenant, updateTenant, isBgRefreshing } = useHub() as any;

  const [companyName, setCompanyName] = useState('');
  const [tin, setTin] = useState('');
  const [vatRate, setVatRate] = useState('7.5');
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [notifyEmail, setNotifyEmail] = useState('');
  const [isSavingNotify, setIsSavingNotify] = useState(false);
  const [isSendingDigest, setIsSendingDigest] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<FeedbackRecipients | null>(null);
  const [isCheckingRecipients, setIsCheckingRecipients] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);

  const [gatewayUrl, setGatewayUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [writebackTarget, setWritebackTarget] = useState<'HUB' | 'CITTAEFS' | 'BOTH'>('BOTH');
  const [gatewayConfig, setGatewayConfig] = useState<CittaGatewayConfig | null>(null);
  const [isLoadingGateway, setIsLoadingGateway] = useState(false);
  const [isSavingGateway, setIsSavingGateway] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  // Re-seed the form when the operator switches workspace, otherwise the fields
  // keep the previous tenant's values and a save would write them to the new one.
  useEffect(() => {
    setCompanyName(activeTenant?.companyName || activeTenant?.name || '');
    setTin(activeTenant?.tin || '');
    setVatRate(String(activeTenant?.defaultVatRate ?? 7.5));
    setWorkspaceError(null);
    setNotifyEmail(activeTenant?.notificationEmail || '');
    setNotifyError(null);
    setRecipients(null);
  }, [activeTenant?.id, activeTenant?.companyName, activeTenant?.name, activeTenant?.tin, activeTenant?.defaultVatRate, activeTenant?.notificationEmail]);

  const loadGatewayConfig = async () => {
    setIsLoadingGateway(true);
    setGatewayError(null);
    try {
      const res = await fetchWithAuth('/api/system/citta-config');
      const data = await parseJsonResponse<CittaGatewayConfig>(res);
      setGatewayConfig(data);
      setGatewayUrl(data.dbSharedGatewayUrl || data.envGatewayUrl || '');
      setWritebackTarget(data.dbWritebackTarget || 'BOTH');
    } catch (e: any) {
      setGatewayConfig(null);
      setGatewayError(e?.message || 'Could not load gateway config');
    } finally {
      setIsLoadingGateway(false);
    }
  };

  useEffect(() => {
    loadGatewayConfig();
  }, []);

  if (!activeTenant) {
    return <p className="py-16 text-center text-sm text-ink-soft">No workspace — connect an ERP to open settings.</p>;
  }

  const handleSaveWorkspace = async () => {
    const rate = Number(vatRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setWorkspaceError('VAT rate must be a number between 0 and 100.');
      return;
    }
    setWorkspaceError(null);
    setIsSavingWorkspace(true);
    try {
      await updateTenant(activeTenant.id, {
        companyName: companyName.trim(),
        tin: tin.trim().toUpperCase(),
        defaultVatRate: rate,
      });
    } catch (e: any) {
      setWorkspaceError(e?.message || 'Save failed');
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const loadRecipients = async () => {
    if (!activeTenant?.id) return;
    setIsCheckingRecipients(true);
    try {
      const res = await fetchWithAuth(`/api/tenants/${activeTenant.id}/feedback-recipients`);
      setRecipients(await parseJsonResponse<FeedbackRecipients>(res));
    } catch (e: any) {
      setNotifyError(e?.message || 'Could not check recipients');
    } finally {
      setIsCheckingRecipients(false);
    }
  };

  useEffect(() => { loadRecipients(); }, [activeTenant?.id]);

  const handleSendTest = async () => {
    setNotifyError(null);
    setIsSendingTest(true);
    try {
      const res = await fetchWithAuth(`/api/tenants/${activeTenant.id}/feedback-test-email`, { method: 'POST' });
      const data = await parseJsonResponse<{ sentTo: string[] }>(res);
      toastGlobal('success', 'Test email sent', `Sent to ${data.sentTo.join(', ')}. Ask them to confirm it arrived.`);
    } catch (e: any) {
      setNotifyError(e?.message || 'Test email failed');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleSaveNotify = async () => {
    setNotifyError(null);
    setIsSavingNotify(true);
    try {
      await updateTenant(activeTenant.id, { notificationEmail: notifyEmail.trim() });
      await loadRecipients();
    } catch (e: any) {
      setNotifyError(e?.message || 'Save failed');
    } finally {
      setIsSavingNotify(false);
    }
  };

  const handleSendDigestNow = async () => {
    setNotifyError(null);
    setIsSendingDigest(true);
    try {
      const res = await fetchWithAuth('/api/system/error-digest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenant.id }),
      });
      type Report = { errorsEmailed: number; tenantsWithoutRecipients: string[]; failures: { error: string }[] };
      const data = await parseJsonResponse<{ report: Report; approvals: Report }>(res);
      const r = data.report;
      const a = data.approvals;
      if (r.failures.length || a.failures.length) setNotifyError((r.failures[0] || a.failures[0]).error);
      else if (r.tenantsWithoutRecipients.length || a.tenantsWithoutRecipients.length) setNotifyError('No recipient: no ERP company email was found - add an override email above.');
      else if (r.errorsEmailed === 0 && a.errorsEmailed === 0) toastGlobal('success', 'Nothing to send', 'There is no new CittaEFS feedback for this workspace.');
      else toastGlobal('success', 'Feedback sent', `${r.errorsEmailed} issue(s) and ${a.errorsEmailed} approval(s) emailed.`);
    } catch (e: any) {
      setNotifyError(e?.message || 'Send failed');
    } finally {
      setIsSendingDigest(false);
    }
  };

  const handleSaveGateway = async () => {
    setGatewayError(null);
    setIsSavingGateway(true);
    try {
      const res = await fetchWithAuth('/api/system/citta-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cittaGatewayUrl: gatewayUrl.trim(),
          cittaWritebackTarget: writebackTarget,
          // Only send a key when one was typed — an empty field means "leave the
          // shared key alone", not "blank it for every tenant".
          ...(apiKey.trim() ? { cittaApiKey: apiKey.trim() } : {}),
        }),
      });
      const data = await parseJsonResponse<{ updatedCount: number; note: string }>(res);
      toastGlobal('success', 'Gateway config saved', `Applied to ${data.updatedCount} workspace(s).`);
      setApiKey('');
      await loadGatewayConfig();
    } catch (e: any) {
      setGatewayError(e?.message || 'Save failed');
    } finally {
      setIsSavingGateway(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle={<>Workspace identity, numbering defaults and the shared CittaEFS gateway for <span className="font-medium text-ink">{activeTenant.name}</span>.</>}
        actions={(
          <Button variant="secondary" onClick={loadGatewayConfig} disabled={isLoadingGateway || isBgRefreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingGateway ? 'animate-spin' : ''}`} />
            {isLoadingGateway ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      <Card>
        <CardHeader title="Workspace" meta="Legal identity used on every invoice sent to CittaEFS" />
        <CardBody className="space-y-4">
          {workspaceError && <Notice tone="fail" title="Could not save">{workspaceError}</Notice>}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Registered company name" htmlFor="settings-company-name" hint="2–100 characters. Appears on the NRS record.">
              <Input
                id="settings-company-name"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                maxLength={100}
              />
            </Field>
            <Field
              label="Tax identification number (TIN)"
              htmlFor="settings-tin"
              hint="One letter, nine digits, one letter — e.g. P051123456Z."
            >
              <Input
                id="settings-tin"
                value={tin}
                onChange={e => setTin(e.target.value.toUpperCase())}
                className="font-mono"
                placeholder="P051123456Z"
                maxLength={11}
              />
            </Field>
            <Field
              label="Default VAT rate (%)"
              htmlFor="settings-vat"
              hint="Applied to new line items whose ERP record has no explicit rate."
            >
              <Input
                id="settings-vat"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={vatRate}
                onChange={e => setVatRate(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveWorkspace} disabled={isSavingWorkspace}>
              <Save className="h-3.5 w-3.5" />
              {isSavingWorkspace ? 'Saving…' : 'Save workspace'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="CittaEFS feedback emails" meta="Rejections are emailed within minutes; approvals (IRN issued) in an hourly summary" />
        <CardBody className="space-y-4">
          {notifyError && <Notice tone="fail" title="Notification problem">{notifyError}</Notice>}
          {recipients && !recipients.mailConfigured && (
            <Notice tone="fail" title="Email is off">The server has no SMTP settings (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM), so nothing is sent yet.</Notice>
          )}
          <div className="rounded-md border border-gray-200 p-3 text-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Currently sending to</span>
              <Button variant="secondary" onClick={loadRecipients} disabled={isCheckingRecipients}>
                <RefreshCw className="h-3.5 w-3.5" />
                {isCheckingRecipients ? 'Checking…' : 'Re-check'}
              </Button>
            </div>
            {recipients ? (
              <>
                <p>{recipients.recipients.length ? recipients.recipients.join(', ') : '—'} <span className="text-gray-500">via {SOURCE_LABEL[recipients.source]}</span></p>
                {[...recipients.erpEmails.map(c => ({ ...c, from: 'ERP' })), ...recipients.configured.map(c => ({ ...c, from: 'Override' }))].map(c => (
                  <p key={c.from + c.email} className={CHECK_STYLE[c.status]}>
                    {c.from}: {c.email} — {c.status === 'valid' ? 'looks real' : c.status === 'invalid' ? 'not real' : 'could not check'} ({c.reason})
                  </p>
                ))}
                {recipients.erpEmails.length === 0 && <p className="text-gray-500">No company email found in the connected ERP. Set one in QuickBooks (Settings → Company → Contact info) or Odoo (Settings → Companies), or use the override below.</p>}
              </>
            ) : (
              <p className="text-gray-500">{isCheckingRecipients ? 'Checking…' : 'Not checked yet.'}</p>
            )}
          </div>
          <Field
            label="Override email(s) (optional)"
            htmlFor="settings-notify-email"
            hint="Leave empty to use the company email from the client's ERP. Separate several addresses with commas. Each address is checked before it is saved."
          >
            <Input
              id="settings-notify-email"
              type="text"
              value={notifyEmail}
              onChange={e => setNotifyEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={handleSendTest} disabled={isSendingTest}>
              <Send className="h-3.5 w-3.5" />
              {isSendingTest ? 'Sending…' : 'Send test email'}
            </Button>
            <Button variant="secondary" onClick={handleSendDigestNow} disabled={isSendingDigest}>
              <Mail className="h-3.5 w-3.5" />
              {isSendingDigest ? 'Sending…' : 'Send pending feedback now'}
            </Button>
            <Button onClick={handleSaveNotify} disabled={isSavingNotify}>
              <Save className="h-3.5 w-3.5" />
              {isSavingNotify ? 'Saving…' : 'Save notifications'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="CittaEFS gateway"
          meta="One shared key and URL for every workspace — changes propagate to all tenants"
        />
        <CardBody className="space-y-4">
          {gatewayError && <Notice tone="fail" title="Could not save">{gatewayError}</Notice>}

          {gatewayConfig && (
            <>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-line bg-panel-muted px-3 py-2.5">
                  <dt className="text-xs text-ink-soft">Effective API key</dt>
                  <dd className="mt-0.5 font-mono text-sm text-ink">{gatewayConfig.effectiveApiKeyPreview}</dd>
                </div>
                <div className="rounded-lg border border-line bg-panel-muted px-3 py-2.5">
                  <dt className="text-xs text-ink-soft">Effective gateway</dt>
                  <dd className="mt-0.5 truncate font-mono text-xs text-ink" title={gatewayConfig.effectiveGatewayUrl}>
                    {gatewayConfig.effectiveGatewayUrl}
                  </dd>
                </div>
                <div className="rounded-lg border border-line bg-panel-muted px-3 py-2.5">
                  <dt className="text-xs text-ink-soft">Credential source</dt>
                  <dd className="mt-0.5 text-sm text-ink">
                    {gatewayConfig.envHasKey ? 'Environment variable (overrides DB)' : 'Shared database key'}
                  </dd>
                </div>
              </dl>

              {gatewayConfig.envHasKey && (
                <Notice tone="warn" title="Environment override is active">
                  A key saved here is stored, but <code className="font-mono">CITTAEFS_API_KEY</code> wins at runtime until
                  that environment variable is removed.
                </Notice>
              )}
            </>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Gateway URL" htmlFor="settings-gateway-url" hint="Must start with http:// or https://">
              <Input
                id="settings-gateway-url"
                value={gatewayUrl}
                onChange={e => setGatewayUrl(e.target.value)}
                placeholder="https://ei-api.azurewebsites.net"
                className="font-mono"
              />
            </Field>
            <Field
              label="Replace shared API key"
              htmlFor="settings-gateway-key"
              hint="Leave blank to keep the current key. Must be at least 10 characters."
            >
              <Input
                id="settings-gateway-key"
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk_live_…"
                className="font-mono"
                autoComplete="new-password"
              />
            </Field>
            <Field label="Ledger writeback target" htmlFor="settings-writeback" hint="Where approved invoices are written back.">
              <Select
                id="settings-writeback"
                value={writebackTarget}
                onChange={e => setWritebackTarget(e.target.value as 'HUB' | 'CITTAEFS' | 'BOTH')}
              >
                <option value="BOTH">Both hub and CittaEFS</option>
                <option value="HUB">Hub only</option>
                <option value="CITTAEFS">CittaEFS only</option>
              </Select>
            </Field>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveGateway} disabled={isSavingGateway}>
              <Save className="h-3.5 w-3.5" />
              {isSavingGateway ? 'Saving…' : 'Save gateway'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Retry policy" meta="How failed transmissions are re-attempted" />
        <CardBody>
          <p className="text-sm text-ink-soft">
            Automatic retries use an exponential backoff compiled into the queue
            (<code className="font-mono text-xs">src/queues/invoiceQueue.ts</code>) — it is not editable from this screen.
            Failed invoices can be re-queued manually from the Invoices tab.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
