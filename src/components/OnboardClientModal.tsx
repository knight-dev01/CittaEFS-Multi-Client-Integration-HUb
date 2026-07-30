import { useState, FormEvent } from 'react';
import { useHub } from '../lib/store';
import { Building2, Key, ShieldCheck, CheckCircle2, Lock, Sparkles, X, Award } from 'lucide-react';

interface OnboardClientModalProps {
  onClose: () => void;
}

export function OnboardClientModal({ onClose }: OnboardClientModalProps) {
  const { onboardTenant, purgeDemoData } = useHub();

  const [companyName, setCompanyName] = useState('');
  const [tin, setTin] = useState('');
  const [platformType, setPlatformType] = useState('QuickBooks Online');
  const [marketTier, setMarketTier] = useState('Enterprise');
  const [oauthSecret, setOauthSecret] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdResult, setCreatedResult] = useState<any | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyName || !tin) return;

    setIsSubmitting(true);
    try {
      const tenant = await onboardTenant({
        companyName,
        tin,
        platformType,
        marketTier,
        oauthSecret: oauthSecret || 'demo_secret_token_123'
      });
      setCreatedResult(tenant);
      setIsSubmitting(false);
    } catch (err) {
      setIsSubmitting(false);
      alert('Failed to onboard client organization.');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4 overflow-y-auto font-mono">
      <div className="bg-white max-w-2xl w-full p-6 text-slate-900 space-y-5 border-4 border-slate-900 relative">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b-2 border-slate-900">
          <div>
            <h3 className="text-base font-black text-slate-900 uppercase flex items-center gap-2">
              <Building2 className="w-5 h-5 text-amber-500" />
              Onboard New Client Organization
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Registers new ERP entity, encrypts refresh keys with AES-256-GCM, & issues CittaEFS Gateway API Key
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer font-black"
          >
            [X]
          </button>
        </div>

        {createdResult ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-400 text-slate-950 border-2 border-slate-900 space-y-2">
              <div className="flex items-center gap-2 font-black text-sm uppercase">
                <CheckCircle2 className="w-5 h-5 text-slate-950" />
                <span>Client Organization Onboarded & Verified!</span>
              </div>
              <p className="text-xs font-bold">
                <strong>{createdResult.name}</strong> has been provisioned as an active multi-tenant organization.
              </p>
            </div>

            <div className="bg-slate-100 p-4 border-2 border-slate-900 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-600 font-black uppercase text-[10px] block">Tenant ID</span>
                  <span className="font-mono font-bold text-slate-900">{createdResult.id}</span>
                </div>
                <div>
                  <span className="text-slate-600 font-black uppercase text-[10px] block">Tax ID (TIN)</span>
                  <span className="font-mono font-bold text-slate-900">{createdResult.tin}</span>
                </div>
                <div>
                  <span className="text-slate-600 font-black uppercase text-[10px] block">CittaEFS Gateway API Key</span>
                  <span className="font-mono font-black text-slate-900">{createdResult.cittaApiKey || 'Global Hub Gateway Key'}</span>
                </div>
                <div>
                  <span className="text-slate-600 font-black uppercase text-[10px] block">Credentials Storage</span>
                  <span className="font-mono font-bold text-emerald-700">AES-256-GCM Encrypted</span>
                </div>
              </div>
            </div>

            <div className="pt-3 flex justify-end">
              <button
                onClick={onClose}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer"
              >
                Switch to {createdResult.name}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">Company / Entity Name *</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Apex Manufacturing Ltd"
                  className="w-full px-3 py-2 border-2 border-slate-900 font-bold text-slate-900 focus:outline-none uppercase"
                  required
                />
              </div>

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">Tax Identification Number (TIN) *</label>
                <input
                  type="text"
                  value={tin}
                  onChange={(e) => setTin(e.target.value)}
                  placeholder="e.g. P099112233X"
                  className="w-full px-3 py-2 border-2 border-slate-900 font-mono font-bold text-slate-900 focus:outline-none uppercase"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">Native ERP / Accounting Platform *</label>
                <select
                  value={platformType}
                  onChange={(e) => setPlatformType(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 bg-white font-black text-slate-900 focus:outline-none uppercase cursor-pointer"
                >
                  <option value="Excel & CSV Import">Excel & CSV Import (.xlsx, .csv)</option>
                  <option value="QuickBooks Online">QuickBooks Online (OAuth 2.0)</option>
                  <option value="Sage ERP">Sage ERP (Sage 50 / Sage Intacct)</option>
                  <option value="SAP S/4HANA" disabled>SAP S/4HANA Cloud (Coming Soon)</option>
                  <option value="NetSuite SuiteTalk" disabled>Oracle NetSuite (Coming Soon)</option>
                  <option value="Custom SQL Staging DB" disabled>Custom PostgreSQL / MS-SQL (Coming Soon)</option>
                </select>
              </div>

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">Market Tier / Monthly Band *</label>
                <select
                  value={marketTier}
                  onChange={(e) => setMarketTier(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 bg-white font-black text-slate-900 focus:outline-none uppercase cursor-pointer"
                >
                  <option value="Enterprise">Enterprise (10,000 monthly invoices)</option>
                  <option value="Mid-Market">Mid-Market (5,000 monthly invoices)</option>
                  <option value="SMB Tier">SMB Tier (1,000 monthly invoices)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-black text-slate-900 uppercase mb-1 flex items-center justify-between">
                <span>OAuth Refresh Secret / DB Connection String (Encrypted server-side)</span>
                <span className="text-[10px] text-emerald-700 font-mono">AES-256-GCM</span>
              </label>
              <input
                type="password"
                value={oauthSecret}
                onChange={(e) => setOauthSecret(e.target.value)}
                placeholder="Paste client OAuth Refresh Token or DB Connection String..."
                className="w-full px-3 py-2 border-2 border-slate-900 font-mono text-slate-900 focus:outline-none"
              />
            </div>

            <div className="p-3 bg-slate-100 border-2 border-slate-900 space-y-1">
              <div className="flex items-center gap-1.5 font-black text-slate-900 uppercase">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Automated White-Glove Onboarding Protocol:</span>
              </div>
              <p className="text-[11px] text-slate-600">
                1. Dedicated Row-Level Security (RLS) tenant context initialized.<br />
                2. CittaEFS REST Gateway API Key provisioned with UTC timestamp serialization.<br />
                3. BullMQ queue listener & Zod pre-flight validator activated.<br />
                4. Immediate NRS Compliance Verification Certificate issued.
              </p>
            </div>

            <div className="pt-2 flex justify-between items-center">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-900 font-black text-xs uppercase border-2 border-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black text-xs uppercase border-2 border-slate-900 cursor-pointer inline-flex items-center space-x-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>{isSubmitting ? 'Onboarding Entity...' : 'Onboard Client Entity'}</span>
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
