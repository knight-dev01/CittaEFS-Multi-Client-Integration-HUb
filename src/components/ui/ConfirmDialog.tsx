import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Field';

/**
 * App-styled replacement for window.confirm / window.prompt. Use
 * `const confirm = useConfirm(); if (!(await confirm({...}))) return;`
 * Never call the browser's native alert/confirm/prompt in the UI.
 */
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = useCallback<ConfirmFn>(
    options => new Promise<boolean>(resolve => {
      setTyped('');
      setPending({ ...options, resolve });
    }),
    [],
  );

  const close = useCallback((ok: boolean) => {
    setPending(prev => {
      prev?.resolve(ok);
      return null;
    });
  }, []);

  const canConfirm = !pending?.requireText || typed === pending.requireText;

  useEffect(() => {
    if (!pending) return;
    (pending.requireText ? inputRef.current : confirmRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  const danger = pending?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-ink/50 p-4"
          onMouseDown={e => { if (e.target === e.currentTarget) close(false); }}
        >
          <form
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="w-full max-w-md rounded-lg border border-line bg-panel p-5 shadow-xl"
            onSubmit={e => { e.preventDefault(); if (canConfirm) close(true); }}
          >
            <div className="flex items-start gap-3">
              {danger && (
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                  <AlertTriangle className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 id="confirm-dialog-title" className="text-base font-semibold tracking-tight text-ink">{pending.title}</h2>
                {pending.message && (
                  <div className="mt-1.5 whitespace-pre-line break-words text-sm text-ink-soft">{pending.message}</div>
                )}
                {pending.requireText && (
                  <label className="mt-4 block text-xs text-ink-soft">
                    Type <span className="font-mono font-semibold text-ink">{pending.requireText}</span> to confirm
                    <Input
                      ref={inputRef}
                      value={typed}
                      onChange={e => setTyped(e.target.value)}
                      className="mt-1.5 w-full font-mono"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => close(false)}>{pending.cancelLabel || 'Cancel'}</Button>
              <Button ref={confirmRef} type="submit" variant={danger ? 'danger' : 'primary'} disabled={!canConfirm}>
                {pending.confirmLabel || 'Confirm'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
