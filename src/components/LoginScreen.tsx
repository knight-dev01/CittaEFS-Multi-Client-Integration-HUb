import { useState, FormEvent } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { Layers } from 'lucide-react';
import { UserSession } from '../types';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Field';
import { Notice } from './ui/Notice';

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">

        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-lg bg-accent p-2 text-white">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none tracking-tight text-ink">Citta Gateway</h1>
            <p className="mt-1 text-xs text-ink-soft">ERP integration &amp; NRS fiscalisation</p>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel p-6">
          <h2 className="text-base font-semibold text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-ink-soft">Administrator and operator accounts are managed in Settings.</p>

          {isQboConnectRedirect && (
            <div className="mt-5">
              <Notice tone="warn">
                QuickBooks authorisation requested. Sign in with an administrator account to complete the Intuit OAuth flow.
              </Notice>
            </div>
          )}

          {errorMsg && (
            <div className="mt-5">
              <Notice tone="fail">{errorMsg}</Notice>
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <Field label="Email" htmlFor="login-email">
              <Input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
              />
            </Field>

            <Field label="Password" htmlFor="login-password">
              <Input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

      </div>
    </div>
  );
}
