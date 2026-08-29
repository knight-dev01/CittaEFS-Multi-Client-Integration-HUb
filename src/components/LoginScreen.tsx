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
  AlertCircle,
  CheckCircle2,
  User
} from 'lucide-react';
import { UserSession } from '../types';

interface LoginScreenProps {
  onLogin: (session: UserSession, token: string) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  // Do not prefill credentials in the UI — start with empty fields.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const queryParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const isQboConnectRedirect = (typeof window !== 'undefined' && window.location.pathname === '/connect-quickbooks') || queryParams.get('connect') === 'qbo';

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
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
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#334155_1px,transparent_1px),linear-gradient(to_bottom,#334155_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(closest-side,_transparent,_black)] opacity-30 pointer-events-none" />

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
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <span className="leading-relaxed">QuickBooks Authorization Request: Please sign in with an Administrator account to manage Intuit OAuth integration.</span>
          </div>
        )}

        {errorMsg && (
          <div className="bg-rose-950/40 border border-rose-500/30 text-rose-200/90 rounded-xl p-3.5 text-xs flex items-center space-x-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-indigo-400" />
              <span>Email</span>
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg px-3.5 py-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg px-3.5 py-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-lg text-xs shadow-lg shadow-indigo-600/20 transition flex items-center justify-center space-x-2"
          >
            <span>{isSubmitting ? 'Signing in...' : 'Sign In'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="text-center text-[11px] text-slate-500 pt-2 border-t border-slate-800/60 flex items-center justify-center space-x-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Role-Based Access Control</span>
        </div>

      </div>
    </div>
  );
}
