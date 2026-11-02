import { useState, useEffect } from 'react';
import { HubProvider, useHub } from './lib/store';
import { LoginScreen } from './components/LoginScreen';
import { Navbar } from './components/Navbar';
import { ErpWorkspace } from './components/erp/ErpWorkspace';
import { OnboardClientModal } from './components/OnboardClientModal';
import { Layers } from 'lucide-react';
import { ToastProvider, useToast, setGlobalToast } from './components/ui/Toast';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';
import { EmptyState } from './components/ui/EmptyState';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas">
      <Layers className="mb-3 h-8 w-8 text-accent" strokeWidth={1.5} />
      <p className="text-sm text-ink-soft">Loading workspace</p>
    </div>
  );
}

function HubMainContent() {
  const { currentUser, login, isBgRefreshing, isInitialized, tenants, activeTenant } = useHub();
  const [isInitializing, setIsInitializing] = useState(true);

  // All useState calls must be at the top (React Rules of Hooks)
  const [activeTab, setActiveTabState] = useState<string>('connections');
  const [isOnboardModalOpen, setIsOnboardModalOpen] = useState(false);
  const [onboardResumeTenant, setOnboardResumeTenant] = useState<any | null>(null);
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
        params.get('tab') === 'connections' ||
        params.has('qbo') ||
        params.get('qbo') === 'disconnected' ||
        params.get('connect') === 'qbo'
      ) {
        setActiveTabState('connections');
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

  // Opens the onboarding modal — with no args for a brand-new client, or with
  // an existing tenant to jump straight to its step-2 connect flow (e.g. a
  // tenant whose channel was never authenticated during initial onboarding).
  const openOnboardModal = (resumeTenant?: any) => {
    setOnboardResumeTenant(resumeTenant || null);
    setIsOnboardModalOpen(true);
  };
  const closeOnboardModal = () => {
    setIsOnboardModalOpen(false);
    setOnboardResumeTenant(null);
  };

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
      openOnboardModal();
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

  // Enforce role-based tab routing restrictions without setState-during-render
  const userRole = currentUser?.role || 'OPERATOR';
  const allowedTabs = userRole === 'ADMIN'
    ? ['connections', 'invoices']
    : ['invoices'];
  const effectiveTab = allowedTabs.includes(activeTab)
    ? activeTab
    : (userRole === 'ADMIN' ? 'connections' : 'invoices');

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink selection:bg-accent-soft selection:text-ink">

      {/* Background refresh indicator — 1px, no layout shift */}
      {isBgRefreshing && (
        <div className="pointer-events-none fixed left-0 right-0 top-0 z-50 h-0.5 overflow-hidden bg-accent-soft">
          <div className="animate-indeterminate h-full bg-accent" />
        </div>
      )}

      {/* Responsive Sidebar component */}
      <Navbar
        activeTab={effectiveTab}
        setActiveTab={setActiveTab}
        onOpenOnboardModal={() => openOnboardModal()}
      />

      {/* Main Content Area next to Sidebar — ERP-isolated, collapsible */}
      <div className={`flex min-w-0 flex-1 flex-col ${sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64 xl:pl-72'}`}>
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-6 lg:px-8">

          {/* ERP-dedicated workspace */}
          <div>
            {!activeTenant ? (
              !isInitialized ? (
                <p className="py-16 text-center text-sm text-ink-soft">Loading workspace…</p>
              ) : (
                <Card>
                  <EmptyState
                    icon={Layers}
                    title="No ERP connected yet"
                    description="Connect QuickBooks Online or Odoo to start normalising invoices for CittaEFS."
                    action={<Button onClick={() => openOnboardModal()}>Connect an ERP</Button>}
                  />
                </Card>
              )
            ) : (
              <ErpWorkspace activeTab={effectiveTab} onOpenOnboard={() => openOnboardModal()} />
            )}
          </div>

        </main>
      </div>

      {/* Modals */}
      {isOnboardModalOpen && (
        <OnboardClientModal onClose={closeOnboardModal} resumeTenant={onboardResumeTenant} />
      )}

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
