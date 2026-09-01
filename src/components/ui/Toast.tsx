import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; type: ToastType; title: string; description?: string; }

interface ToastContextType {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

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
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm w-[92vw] sm:w-[380px]">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-3 p-3 pr-2 rounded-xl border shadow-lg backdrop-blur-sm text-xs font-medium animate-[slideIn_0.2s_ease] ${t.type==='success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : t.type==='error' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-white border-slate-200 text-slate-800'}`}>
            <span className="mt-0.5">
              {t.type==='success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : t.type==='error' ? <AlertCircle className="w-4 h-4 text-rose-600" /> : <Info className="w-4 h-4 text-violet-600" />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-bold leading-tight">{t.title}</p>
              {t.description && <p className="font-normal text-[11px] leading-snug mt-0.5 opacity-80 line-clamp-3">{t.description}</p>}
            </div>
            <button onClick={() => setToasts(prev=>prev.filter(x=>x.id!==t.id))} className="p-1 rounded-lg hover:bg-black/5 text-slate-400 hover:text-slate-700 pointer-events-auto cursor-pointer"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <style>{`@keyframes slideIn{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
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
