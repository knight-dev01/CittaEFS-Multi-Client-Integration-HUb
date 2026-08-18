import { useState, useEffect, useRef, FormEvent } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse, getApiBaseUrl } from '../lib/api';
import { ExcelDocumentViewer } from './ExcelDocumentViewer';
import {
  Building2,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Zap,
  FileSpreadsheet,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  ArrowLeft
} from 'lucide-react';

interface OnboardClientModalProps {
  onClose: () => void;
}

type QboConnectState = 'idle' | 'connecting' | 'connected' | 'syncing' | 'synced' | 'error';

// Kenyan KRA PIN format: one letter, 9 digits, one letter (e.g. P051123456Z)
const TIN_PATTERN = /^[A-Z]\d{9}[A-Z]$/;

function validateCompanyName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Client entity name is required.';
  if (trimmed.length < 2) return 'Must be at least 2 characters.';
  if (trimmed.length > 100) return 'Must be under 100 characters.';
  if (!/^[A-Za-z0-9 .,&'()\-]+$/.test(trimmed)) {
    return 'Only letters, numbers, spaces, and basic punctuation (. , & \' - ()) are allowed.';
  }
  return null;
}

function validateTin(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return 'Tax Identification Number is required.';
  if (!TIN_PATTERN.test(trimmed)) {
    return 'TIN must be one letter, 9 digits, one letter (e.g. P051123456Z).';
  }
  return null;
}

export function OnboardClientModal({ onClose }: OnboardClientModalProps) {
  const { onboardTenant, updateTenant, refreshAll } = useHub();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [companyName, setCompanyName] = useState('');
  const [tin, setTin] = useState('');
  const [platformType, setPlatformType] = useState<'QuickBooks Online' | 'Excel & CSV Import'>('QuickBooks Online');
  const [marketTier, setMarketTier] = useState('Enterprise');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState({ companyName: false, tin: false });

  // Result of step 1
  const [tenant, setTenant] = useState<any | null>(null);

  // Step 2: QuickBooks OAuth + initial sync state
  const [qboState, setQboState] = useState<QboConnectState>('idle');
  const [qboError, setQboError] = useState<string | null>(null);
  const [qboSyncStats, setQboSyncStats] = useState<{ totalFound: number; newSynced: number; alreadySynced: number } | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPopupPoll = () => {
    if (popupPollRef.current) {
      clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
  };

  const runInitialQboSync = async (tenantId: string) => {
    setQboState('syncing');
    try {
      const res = await fetchWithAuth('/api/integrations/qbo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId })
      });
      const data = await parseJsonResponse(res);
      setQboSyncStats({
        totalFound: data.totalFound ?? 0,
        newSynced: data.newSynced ?? 0,
        alreadySynced: data.alreadySynced ?? 0
      });
      setQboState('synced');
      await refreshAll();
    } catch (err: any) {
      setQboState('error');
      setQboError(err.message || 'Initial QuickBooks sync failed.');
    }
  };

  // Listen for the OAuth popup bridge page posting back its result
  useEffect(() => {
    if (step !== 2 || platformType !== 'QuickBooks Online' || !tenant) return;

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'qbo-oauth-result') return;

      clearPopupPoll();

      if (event.data.success) {
        setQboState('connected');
        runInitialQboSync(tenant.id);
      } else {
        setQboState('error');
        setQboError(event.data.error || 'QuickBooks authorization failed.');
      }
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      clearPopupPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, platformType, tenant]);

  const handleConnectQuickBooks = () => {
    if (!tenant) return;
    setQboError(null);
    setQboState('connecting');

    const base = getApiBaseUrl();
    const url = `${base}/api/integrations/qbo/connect?tenantId=${encodeURIComponent(tenant.id)}`;
    const popup = window.open(url, 'qbo_oauth', 'width=600,height=750');
    popupRef.current = popup;

    if (!popup) {
      setQboState('error');
      setQboError('Popup was blocked by the browser. Please allow popups for this site and try again.');
      return;
    }

    clearPopupPoll();
    popupPollRef.current = setInterval(() => {
      if (popup.closed) {
        clearPopupPoll();
        setQboState(prev => (prev === 'connecting' ? 'idle' : prev));
      }
    }, 700);
  };

  const handleSubmitStep1 = async (e: FormEvent) => {
    e.preventDefault();

    setTouched({ companyName: true, tin: true });
    const nameErr = validateCompanyName(companyName);
    const tinErr = validateTin(tin);
    if (nameErr || tinErr) return;

    setIsSubmitting(true);
    try {
      if (tenant) {
        // Already onboarded earlier in this session (user came back via Previous) —
        // update the existing tenant instead of creating a duplicate.
        const updated = await updateTenant(tenant.id, {
          companyName: companyName.trim(),
          tin: tin.trim().toUpperCase(),
          platformType,
          marketTier
        });
        setTenant(updated);
      } else {
        const newTenant = await onboardTenant({
          companyName: companyName.trim(),
          tin: tin.trim().toUpperCase(),
          platformType,
          marketTier
        });
        setTenant(newTenant);
      }
      setIsSubmitting(false);
      setStep(2);
    } catch (err: any) {
      setIsSubmitting(false);
      const action = tenant ? 'update' : 'onboard';
      alert(`Failed to ${action} client organization: ${err?.message || 'Please check details and try again.'}`);
    }
  };

  const isQbo = platformType === 'QuickBooks Online';
  const nameError = touched.companyName ? validateCompanyName(companyName) : null;
  const tinError = touched.tin ? validateTin(tin) : null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto font-sans text-xs">
      <div className="bg-white max-w-2xl w-full p-6 text-slate-900 space-y-5 rounded-2xl border border-slate-200 shadow-xl relative">

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" />
              {step === 1 ? 'Onboard Active Client Entity' : `Connect ${platformType}`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 1
                ? 'Register a client organization and choose how their invoice data reaches CittaEFS.'
                : isQbo
                  ? 'Authorize QuickBooks Online and pull the initial historical invoice sync.'
                  : 'Upload a spreadsheet and normalize it against Master Data to complete onboarding.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer font-medium p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
            {step > 1 ? <CheckCircle2 className="w-3.5 h-3.5" /> : '1'}
          </span>
          <span className={step >= 1 ? 'text-indigo-600' : 'text-slate-400'}>Client & Channel</span>
          <div className="flex-1 h-px bg-slate-200" />
          <span className={`w-5 h-5 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>2</span>
          <span className={step >= 2 ? 'text-indigo-600' : 'text-slate-400'}>{isQbo ? 'Connect QuickBooks' : 'Upload & Normalize'}</span>
        </div>

        {step === 1 ? (
          <form onSubmit={handleSubmitStep1} className="space-y-4 text-xs">

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Client Entity Name *</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onBlur={() => setTouched(prev => ({ ...prev, companyName: true }))}
                  placeholder="e.g. Acme Logistics Ltd"
                  className={`w-full px-3.5 py-2 border rounded-lg font-medium text-slate-900 focus:outline-none focus:ring-2 transition-all ${
                    nameError ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-500' : 'border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500'
                  }`}
                  required
                />
                {nameError && <p className="text-rose-600 text-[11px] mt-1">{nameError}</p>}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Tax Identification Number (TIN) *</label>
                <input
                  type="text"
                  value={tin}
                  onChange={(e) => setTin(e.target.value.toUpperCase())}
                  onBlur={() => setTouched(prev => ({ ...prev, tin: true }))}
                  placeholder="e.g. P099112233X"
                  maxLength={11}
                  className={`w-full px-3.5 py-2 border rounded-lg font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 transition-all uppercase ${
                    tinError ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-500' : 'border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500'
                  }`}
                  required
                />
                {tinError && <p className="text-rose-600 text-[11px] mt-1">{tinError}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Market Tier / Processing Allowance *</label>
                <select
                  value={marketTier}
                  onChange={(e) => setMarketTier(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
                >
                  <option value="Enterprise">Enterprise (10,000 monthly invoices)</option>
                  <option value="Mid-Market">Mid-Market (5,000 monthly invoices)</option>
                  <option value="SMB Tier">SMB Tier (1,000 monthly invoices)</option>
                </select>
              </div>
              <div />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-2">Ingestion Channel *</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPlatformType('QuickBooks Online')}
                  className={`p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
                    platformType === 'QuickBooks Online'
                      ? 'bg-indigo-50/60 border-indigo-600 ring-2 ring-indigo-500/20'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-500" />
                    QuickBooks Online
                  </span>
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                    OAuth 2.0 connection. You'll authorize access and we'll pull the historical invoice, customer, and item data automatically.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPlatformType('Excel & CSV Import')}
                  className={`p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
                    platformType === 'Excel & CSV Import'
                      ? 'bg-indigo-50/60 border-indigo-600 ring-2 ring-indigo-500/20'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    Excel & CSV Import
                  </span>
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                    Upload an .xlsx/.csv spreadsheet next. You'll review and normalize it against Master Data before it's submitted.
                  </p>
                </button>
              </div>
              {tenant && (
                <p className="text-slate-400 text-[11px] mt-2">
                  Changing these will update the client record you already created.
                </p>
              )}
            </div>

            <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Client Onboarding Protocol:</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                1. Dedicated Row-Level Security (RLS) tenant isolated.<br />
                2. CittaEFS Gateway API Key generated & mapped.<br />
                3. Next step connects the live ingestion channel selected above.
              </p>
            </div>

            <div className="pt-3 flex justify-between items-center">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-2 transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                <span>{isSubmitting ? (tenant ? 'Saving Changes...' : 'Onboarding Client...') : 'Continue'}</span>
                {!isSubmitting && <ArrowRight className="w-3.5 h-3.5 text-indigo-200" />}
              </button>
            </div>
          </form>
        ) : isQbo ? (
          <div className="space-y-4">
            <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-500 font-medium text-[11px] block">Tenant ID</span>
                <span className="font-mono font-bold text-slate-900">{tenant?.id}</span>
              </div>
              <div>
                <span className="text-slate-500 font-medium text-[11px] block">Client Entity</span>
                <span className="font-bold text-slate-900">{tenant?.name}</span>
              </div>
            </div>

            {qboState === 'idle' && (
              <div className="p-5 bg-white rounded-xl border border-slate-200/80 text-center space-y-3">
                <Zap className="w-8 h-8 text-amber-500 mx-auto" />
                <p className="text-slate-600 text-xs leading-relaxed max-w-sm mx-auto">
                  Click below to open QuickBooks Online in a secure popup and authorize CittaEFS to read invoices, customers, and items.
                </p>
                <button
                  onClick={handleConnectQuickBooks}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center gap-2 transition-colors"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Connect QuickBooks Online</span>
                </button>
              </div>
            )}

            {qboState === 'connecting' && (
              <div className="p-5 bg-slate-50/80 rounded-xl border border-slate-200/80 text-center space-y-2">
                <RefreshCw className="w-6 h-6 text-indigo-500 mx-auto animate-spin" />
                <p className="text-slate-600 text-xs">Waiting for authorization in the popup window...</p>
              </div>
            )}

            {(qboState === 'connected' || qboState === 'syncing') && (
              <div className="p-5 bg-slate-50/80 rounded-xl border border-slate-200/80 text-center space-y-2">
                <RefreshCw className="w-6 h-6 text-indigo-500 mx-auto animate-spin" />
                <p className="text-slate-600 text-xs">QuickBooks connected. Pulling historical invoices, customers, and items...</p>
              </div>
            )}

            {qboState === 'synced' && (
              <div className="p-4 bg-emerald-50 text-emerald-900 rounded-xl border border-emerald-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>QuickBooks Online Connected & Synced!</span>
                </div>
                <p className="text-xs">
                  Found <strong>{qboSyncStats?.totalFound ?? 0}</strong> invoices &mdash;
                  {' '}<strong>{qboSyncStats?.newSynced ?? 0}</strong> newly ingested,
                  {' '}<strong>{qboSyncStats?.alreadySynced ?? 0}</strong> already on file.
                </p>
              </div>
            )}

            {qboState === 'error' && (
              <div className="p-4 bg-rose-50 text-rose-900 rounded-xl border border-rose-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <AlertCircle className="w-5 h-5 text-rose-600" />
                  <span>Connection Issue</span>
                </div>
                <p className="text-xs">{qboError}</p>
                <button
                  onClick={handleConnectQuickBooks}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-lg cursor-pointer transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}

            <div className="pt-3 flex justify-between items-center">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg cursor-pointer inline-flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer flex items-center gap-2 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4 text-indigo-200" />
                <span>{qboState === 'synced' ? `Go to ${tenant?.name}` : 'Finish Later & Close'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ExcelDocumentViewer tenantId={tenant?.id} startEmpty />
            <div className="pt-1 flex justify-between items-center">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg cursor-pointer inline-flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer flex items-center gap-2 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4 text-indigo-200" />
                <span>Finish Onboarding</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
