import { useState, useEffect } from 'react';
import { HubProvider, useHub } from './lib/store';
import { LoginScreen } from './components/LoginScreen';
import { Navbar } from './components/Navbar';
import { ErpWorkspace } from './components/erp/ErpWorkspace';
import { NewInvoiceModal } from './components/NewInvoiceModal';
import { OnboardClientModal } from './components/OnboardClientModal';
import { Layers } from 'lucide-react';
import { ToastProvider, useToast, setGlobalToast } from './components/ui/Toast';

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col justify-center items-center">
      <Layers className="w-12 h-12 text-indigo-500 animate-pulse mb-4" />
      <p className="text-slate-400 text-sm">Loading...</p>
    </div>
  );
}

function HubMainContent() {
  const { currentUser, login, isBgRefreshing, isInitialized, tenants, activeTenant } = useHub();
  const [isInitializing, setIsInitializing] = useState(true);

  // All useState calls must be at the top (React Rules of Hooks)
  const [activeTab, setActiveTabState] = useState<string>('clients');
  const [isNewInvoiceModalOpen, setIsNewInvoiceModalOpen] = useState(false);
  const [isOnboardModalOpen, setIsOnboardModalOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem('citta_sidebar_collapsed') === '1'; } catch { return false; }
  });

  // Load saved tab from localStorage after mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('citta_active_tab');
      if (saved) {
        setActiveTabState(saved);
      }
      const params = new URLSearchParams(window.location.search);
      const path = window.location.pathname;
      if (
        path === '/connect-quickbooks' || 
        params.get('tab') === 'connectors' || 
        params.has('qbo') ||
        params.get('qbo') === 'disconnected' || 
        params.get('connect') === 'qbo'
      ) {
        setActiveTabState('connectors');
      }
    }
    // Small delay to ensure smooth transition
    const timer = setTimeout(() => setIsInitializing(false), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handler = (e: any) => setSidebarCollapsed(!!e.detail);
    const onStorage = () => {
      try { setSidebarCollapsed(localStorage.getItem('citta_sidebar_collapsed') === '1'); } catch {}
    };
    window.addEventListener('citta_sidebar_collapsed' as any, handler);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('citta_sidebar_collapsed' as any, handler);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    if (typeof window !== 'undefined') {
      localStorage.setItem('citta_active_tab', tab);
    }
  };

  // Force open onboarding modal if no tenants exist after login
  const hasTenant = tenants && tenants.length > 0;

  // Show onboarding modal if no tenants exist
  // (must run on every render, before any conditional early return, per Rules of Hooks)
  useEffect(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const hasQboRedirect =
      params?.has('qbo') ||
      params?.get('tab') === 'connectors' ||
      params?.get('connect') === 'qbo';

    if (isInitialized && !hasTenant && currentUser && !hasQboRedirect) {
      setIsOnboardModalOpen(true);
    }
  }, [isInitialized, hasTenant, currentUser]);

  // Show loading screen only if initializing AND we have a user (authenticated state)
  if (isInitializing && currentUser) {
    return <LoadingScreen />;
  }

  // Show login if not authenticated
  if (!currentUser) {
    return <LoginScreen onLogin={login} />;
  }

  // Enforce role-based tab routing restrictions
  const userRole = currentUser?.role || 'OPERATOR';
  const allowedTabs = userRole === 'ADMIN'
    ? ['clients', 'invoices', 'import', 'customers', 'items', 'validation', 'connectors', 'settings', 'gateway', 'mapping', 'companies']
    : ['clients', 'invoices', 'import', 'customers', 'items', 'validation'];

  if (!allowedTabs.includes(activeTab)) {
    setActiveTab(userRole === 'ADMIN' ? 'clients' : 'invoices');
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans flex flex-col selection:bg-violet-400 selection:text-white">
      
      {/* Real-time Background Activity Progress Bar — purple */}
      {isBgRefreshing && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-violet-500/20 z-50 overflow-hidden pointer-events-none">
          <div className="h-full bg-violet-500 rounded-full" style={{
            animation: 'shimmer-loading 1.5s infinite ease-in-out',
            transformOrigin: 'left'
          }} />
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes shimmer-loading {
              0% { transform: translateX(-100%) scaleX(0.5); }
              50% { transform: translateX(50%) scaleX(1.2); }
              100% { transform: translateX(200%) scaleX(0.5); }
            }
          `}} />
        </div>
      )}

      {/* Responsive Sidebar component */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenNewInvoiceModal={() => setIsNewInvoiceModalOpen(true)}
        onOpenOnboardModal={() => setIsOnboardModalOpen(true)}
      />

      {/* Main Content Area next to Sidebar — ERP-isolated, collapsible purple theme */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-200 ${sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64 xl:pl-72'}`}>
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-8 space-y-8 w-full mx-auto max-w-7xl">
          
          {/* ERP-dedicated workspace */}
          <div className="transition-all duration-150">
            {!activeTenant ? (
              <div className="p-8 text-center text-slate-400 text-xs">Loading workspace...</div>
            ) : (
              <ErpWorkspace activeTab={activeTab} setActiveTab={setActiveTab} onOpenOnboard={() => setIsOnboardModalOpen(true)} />
            )}
          </div>

        </main>

        {/* Footer — purple */}
        <footer className="bg-white text-slate-500 border-t border-slate-200 text-xs py-6 mt-12 font-sans shrink-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 rounded bg-violet-100 text-violet-600 flex items-center justify-center font-bold text-xs">
                C
              </div>
              <span className="font-semibold text-slate-700">CittaEFS Integration Hub</span>
            </div>
            <div className="flex items-center space-x-4 text-[11px] text-slate-400">
              <span>PostgreSQL</span>
              <span>•</span>
              <span>QuickBooks + Excel</span>
              <span>•</span>
              <span className="text-violet-600 font-semibold">CittaEFS Gateway</span>
            </div>
          </div>
        </footer>
      </div>

      {/* Modals */}
      {isOnboardModalOpen && (
        <OnboardClientModal onClose={() => setIsOnboardModalOpen(false)} />
      )}

      <NewInvoiceModal
        isOpen={isNewInvoiceModalOpen}
        onClose={() => setIsNewInvoiceModalOpen(false)}
      />

    </div>
  );
}

function ToastBridge({ children }: { children: React.ReactNode }) {
  const t = useToast();
  useEffect(() => { setGlobalToast(t); }, [t]);
  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
      <ToastBridge>
        <HubProvider>
          <HubMainContent />
        </HubProvider>
      </ToastBridge>
    </ToastProvider>
  );
}
