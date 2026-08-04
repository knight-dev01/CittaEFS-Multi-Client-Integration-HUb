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
  KeyRound,
  CheckCircle2,
  Sparkles
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
    { label: 'Admin Access', role: 'Full System Control & Governance', email: 'admin@cittaefs.com', pass: 'Admin123!' },
    { label: 'Operator Access', role: 'Daily Action Points & Ingestion', email: 'operator@cittaefs.com', pass: 'Operator123!' }
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
        role: data.user.role,
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
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col justify-center items-center p-4 relative overflow-hidden">
      
      {/* Background Subtle Gradient & Mesh Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-950 pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#334155_1px,transparent_1px),linear-gradient(to_bottom,#334155_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-10 pointer-events-none" />

      <div className="max-w-md w-full bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl relative z-10 space-y-6 p-7 sm:p-8">
        
        {/* Brand Header */}
        <div className="flex items-center space-x-3.5 pb-6 border-b border-slate-800/80">
          <div className="bg-indigo-600 p-3 rounded-xl text-white shadow-lg shadow-indigo-600/20">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white tracking-tight leading-none">
                CittaEFS Hub
              </h1>
              <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-semibold">
                JWT Auth
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-1">
              Enterprise Integration & Fiscalization Gateway
            </p>
          </div>
        </div>

        {isQboConnectRedirect && (
          <div className="bg-amber-950/40 border border-amber-500/30 text-amber-200/90 rounded-xl p-3.5 text-xs flex items-start space-x-2.5">
            <KeyRound className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <span className="leading-relaxed">QuickBooks Authorization Request: Please sign in with an Administrator or Integration Manager account to manage Intuit OAuth integration.</span>
          </div>
        )}

        {errorMsg && (
          <div className="bg-rose-950/40 border border-rose-500/30 text-rose-200/90 rounded-xl p-3.5 text-xs flex items-center space-x-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          
          <div className="flex bg-slate-950/60 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setIsSso(false)}
              className={`flex-1 py-2 rounded-lg text-center transition cursor-pointer ${!isSso ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Password Login
            </button>
            <button
              type="button"
              onClick={() => setIsSso(true)}
              className={`flex-1 py-2 rounded-lg text-center transition cursor-pointer ${isSso ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Corporate SSO
            </button>
          </div>

          {isSso ? (
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs text-slate-300 space-y-3">
              <div className="flex items-center space-x-2 text-indigo-400 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>SAML SSO Security Hardening</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Corporate SAML Single Sign-On and OAuth integrations are currently undergoing security review.
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Please use standard credentials on the <strong className="text-white font-medium">Password Login</strong> tab with pre-seeded test accounts.
              </p>
              <button
                type="button"
                onClick={() => setIsSso(false)}
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg text-xs transition shadow-sm cursor-pointer"
              >
                Switch to Password Login
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Enterprise Email</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. admin@cittaefs.com"
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg px-3.5 py-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Password</span>
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg px-3.5 py-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-lg text-xs shadow-lg shadow-indigo-600/20 transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Authenticating & Issuing Token...' : 'Secure Sign In'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}
        </form>

        {/* Quick Demo Credentials Helper */}
        <div className="pt-4 border-t border-slate-800/80 space-y-2.5">
          <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
            <span>Quick-Test Seeded Accounts (Click to fill):</span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {quickTestAccounts.map((acc, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setEmail(acc.email);
                  setPassword(acc.pass);
                  setIsSso(false);
                }}
                className="text-left text-xs bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-xl p-3 text-slate-300 flex items-center justify-between transition cursor-pointer group"
              >
                <div>
                  <div className="font-semibold text-slate-200 group-hover:text-indigo-400 transition-colors">{acc.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{acc.role}</div>
                </div>
                <span className="font-mono text-[11px] text-slate-400 bg-slate-900 px-2 py-1 rounded border border-slate-800">{acc.email.split('@')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="text-center text-[11px] text-slate-500 pt-2 border-t border-slate-800/60 flex items-center justify-center space-x-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Role-Based Access Control derived from DB record</span>
        </div>

      </div>
    </div>
  );
}

