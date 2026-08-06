import { useState, FormEvent } from 'react';
import { useHub } from '../lib/store';
import { Building2, ShieldCheck, CheckCircle2, Sparkles, Key, Zap, FileSpreadsheet } from 'lucide-react';

interface OnboardClientModalProps {
  onClose: () => void;
}

export function OnboardClientModal({ onClose }: OnboardClientModalProps) {
  const { onboardTenant, setActiveTenantId } = useHub();

  const [companyName, setCompanyName] = useState('');
  const [tin, setTin] = useState('');
  const [platformType, setPlatformType] = useState('QuickBooks Online');
  const [marketTier, setMarketTier] = useState('Enterprise');
  const [oauthSecret, setOauthSecret] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdResult, setCreatedResult] = useState<any | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !tin.trim()) return;

    setIsSubmitting(true);
    try {
      const tenant = await onboardTenant({
        companyName: companyName.trim(),
        tin: tin.trim(),
        platformType,
        marketTier,
        oauthSecret: oauthSecret.trim() || `rt_live_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString(36)}`
      });
      setCreatedResult(tenant);
      setIsSubmitting(false);
      if (tenant?.id) {
        setActiveTenantId(tenant.id);
      }
    } catch (err) {
      setIsSubmitting(false);
      alert('Failed to onboard client organization. Please check details and try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto font-sans text-xs">
      <div className="bg-white max-w-2xl w-full p-6 text-slate-900 space-y-5 rounded-2xl border border-slate-200 shadow-xl relative">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" />
              Onboard Active Client Entity
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Register live client organization with active integration credentials & provision CittaEFS Gateway API Key.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer font-medium p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {createdResult ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 text-emerald-900 rounded-xl border border-emerald-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Client Organization Onboarded & Verified!</span>
              </div>
              <p className="text-xs font-medium">
                <strong className="text-slate-900">{createdResult.name}</strong> has been provisioned as an active live organization.
              </p>
            </div>

            <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 font-medium text-[11px] block">Tenant ID</span>
                  <span className="font-mono font-bold text-slate-900">{createdResult.id}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-medium text-[11px] block">Tax ID (TIN)</span>
                  <span className="font-mono font-bold text-slate-900">{createdResult.tin}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-medium text-[11px] block">Platform Type</span>
                  <span className="font-semibold text-indigo-600">{createdResult.platformType}</span>
                </div>
              </div>
            </div>

            <div className="pt-3 flex justify-end">
              <button
                onClick={onClose}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer flex items-center gap-2 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4 text-indigo-200" />
                <span>Activate & Access {createdResult.name}</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Client Entity Name *</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Acme Logistics Ltd"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  required
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Tax Identification Number (TIN) *</label>
                <input
                  type="text"
                  value={tin}
                  onChange={(e) => setTin(e.target.value)}
                  placeholder="e.g. P099112233X"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all uppercase"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Ingestion Integration Channel *</label>
                <select
                  value={platformType}
                  onChange={(e) => setPlatformType(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
                >
                  <option value="QuickBooks Online">QuickBooks Online (OAuth 2.0 API)</option>
                  <option value="Excel & CSV Import">Excel & CSV Import (.xlsx, .csv)</option>
                </select>
              </div>

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
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1 flex items-center justify-between">
                <span>OAuth Refresh Secret / API Integration Token</span>
                <span className="text-[11px] text-emerald-600 font-mono font-semibold">AES-256-GCM Encrypted</span>
              </label>
              <input
                type="password"
                value={oauthSecret}
                onChange={(e) => setOauthSecret(e.target.value)}
                placeholder={platformType === 'QuickBooks Online' ? 'Paste QuickBooks OAuth2 Refresh Token...' : 'Enter client storage bucket key or secret...'}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              />
            </div>

            <div className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Client Onboarding Protocol:</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                1. Dedicated Row-Level Security (RLS) tenant isolated.<br />
                2. CittaEFS Gateway API Key generated & mapped.<br />
                3. Direct integration connector initialized and ready for transaction processing.
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
                <span>{isSubmitting ? 'Onboarding Client...' : 'Register Active Client'}</span>
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
