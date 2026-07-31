import { useState, FormEvent } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { 
  ShieldCheck, 
  Lock, 
  Mail, 
  Key, 
  Building2, 
  Layers, 
  ArrowRight, 
  Globe, 
  AlertCircle,
  KeyRound
} from 'lucide-react';
import { UserSession } from '../types';

interface LoginScreenProps {
  onLogin: (session: UserSession, token: string) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('admin@cittaefs.com');
  const [password, setPassword] = useState('Admin123!');
  const [isSso, setIsSso] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const queryParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const isQboConnectRedirect = (typeof window !== 'undefined' && window.location.pathname === '/connect-quickbooks') || queryParams.get('connect') === 'qbo';

  const quickTestAccounts = [
    { label: 'Admin Access (Overall System Control & Governance)', email: 'admin@cittaefs.com', pass: 'Admin123!' },
    { label: 'Operator Access (Daily Action Points & Billing)', email: 'billing@acme.com', pass: 'Acme2026!' }
  ];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSso) return;
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const res = await fetchWithAuth('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await parseJsonResponse(res);
      if (!data.success) {
        throw new Error(data.error || 'Authentication failed');
      }

      localStorage.setItem('citta_jwt_token', data.token);
      const session: UserSession = {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role, // Derived from the authenticated user record
        organization: data.user.organization,
        loginAt: new Date().toISOString()
      };
      onLogin(session, data.token);
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-mono flex flex-col justify-center items-center p-4 selection:bg-amber-400 selection:text-slate-950 relative overflow-hidden">
      
      {/* Background Decorative Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20 pointer-events-none" />

      <div className="max-w-md w-full bg-slate-900 border-4 border-slate-800 shadow-2xl relative z-10 space-y-6 p-6 sm:p-8">
        
        {/* Brand Header */}
        <div className="flex items-center space-x-3 pb-6 border-b-2 border-slate-800">
          <div className="bg-amber-400 p-2.5 border-2 border-slate-950 text-slate-950 font-black shadow-md">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black text-amber-400 uppercase tracking-widest leading-none">
                CittaEFS Hub
              </h1>
              <span className="text-[9px] bg-emerald-400 text-slate-950 px-2 py-0.5 font-black uppercase border border-slate-900">
                JWT Auth
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-bold mt-1">
              Secure Enterprise Portal & RBAC Gateway
            </p>
          </div>
        </div>

        {isQboConnectRedirect && (
          <div className="bg-amber-950/90 border-2 border-amber-500 text-amber-200 p-3 text-xs flex items-center space-x-2">
            <KeyRound className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>QuickBooks Authorization Request: Please sign in with an Administrator or Integration Manager account to manage Intuit OAuth integration.</span>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-950/80 border-2 border-red-600 text-red-200 p-3 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          <div className="flex bg-slate-950 p-1 border-2 border-slate-800 text-xs font-bold">
            <button
              type="button"
              onClick={() => setIsSso(false)}
              className={`flex-1 py-2 text-center transition cursor-pointer ${!isSso ? 'bg-amber-400 text-slate-950 font-black' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Password Login
            </button>
            <button
              type="button"
              onClick={() => setIsSso(true)}
              className={`flex-1 py-2 text-center transition cursor-pointer ${isSso ? 'bg-amber-400 text-slate-950 font-black' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Corporate SSO
            </button>
          </div>

          {isSso ? (
            <div className="bg-slate-950 border-2 border-amber-400/30 p-4 text-xs text-amber-400 space-y-3 font-mono">
              <div className="flex items-center space-x-2 text-amber-400 font-black">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="uppercase tracking-wider">SAML SSO Under Hardening</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Corporate SAML Single Sign-On and OAuth integrations are currently undergoing infrastructure security review and hardening.
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                To access the Hub, please use standard credentials on the <strong className="text-amber-400 font-bold">Password Login</strong> tab with one of our pre-seeded roles.
              </p>
              <button
                type="button"
                onClick={() => setIsSso(false)}
                className="w-full mt-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black py-2.5 text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Switch to Password Login
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="block text-[11px] font-black uppercase text-slate-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-amber-400" />
                  <span>Enterprise Email</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. admin@cittaefs.com"
                  className="w-full bg-slate-950 border-2 border-slate-700 px-3 py-2 text-xs text-slate-100 focus:border-amber-400 outline-none transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-black uppercase text-slate-300 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  <span>Password</span>
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border-2 border-slate-700 px-3 py-2 text-xs text-slate-100 focus:border-amber-400 outline-none transition"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black py-3 text-xs uppercase tracking-wider border-2 border-slate-950 shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Authenticating & Issuing Token...' : 'Secure Login'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}
        </form>

        {/* Quick Demo Credentials Helper */}
        <div className="pt-4 border-t-2 border-slate-800 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-amber-400" />
            <span>Quick-Test Seeded Accounts (Click to load):</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {quickTestAccounts.map((acc, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setEmail(acc.email);
                  setPassword(acc.pass);
                  setIsSso(false);
                }}
                className="text-left text-[10px] bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 p-2 text-slate-300 flex items-center justify-between transition cursor-pointer"
              >
                <span className="font-bold text-amber-400">{acc.label}</span>
                <span className="text-slate-500">{acc.email}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="text-center text-[10px] text-slate-500 pt-2 border-t border-slate-800/60 flex items-center justify-center space-x-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Role-Based Access Control derived from authenticated DB record</span>
        </div>

      </div>
    </div>
  );
}
