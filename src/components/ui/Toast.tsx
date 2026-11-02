import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; type: ToastType; title: string; description?: string; }

interface ToastContextType {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
const ICON_COLOUR = { success: 'text-emerald-700', error: 'text-rose-600', info: 'text-ink-soft' };
const RULE = { success: 'border-l-emerald-600', error: 'border-l-rose-600', info: 'border-l-line-strong' };

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((type: ToastType, title: string, description?: string) => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, type, title, description }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  const ctx: ToastContextType = {
    success: useCallback((t: string, d?: string) => push('success', t, d), [push]),
    error: useCallback((t: string, d?: string) => push('error', t, d), [push]),
    info: useCallback((t: string, d?: string) => push('info', t, d), [push]),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-[92vw] max-w-sm flex-col gap-2 sm:w-[380px]">
        {toasts.map(t => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              className={`animate-slide-in pointer-events-auto flex items-start gap-3 rounded-lg border border-l-2 border-line bg-panel p-3 pr-2 shadow-lg ${RULE[t.type]}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_COLOUR[t.type]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight text-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 line-clamp-3 text-xs leading-snug text-ink-soft">{t.description}</p>}
              </div>
              <button
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                className="cursor-pointer rounded-lg p-1 text-ink-faint hover:bg-panel-muted hover:text-ink"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// Optional global helper for non-React contexts (store, etc.) — set by provider
let globalToast: ToastContextType | null = null;
export function setGlobalToast(t: ToastContextType) { globalToast = t; }
export function toastGlobal(type: ToastType, title: string, description?: string) {
  if (globalToast) (globalToast as any)[type](title, description);
  else console.log(`[toast:${type}] ${title} ${description||''}`);
}
