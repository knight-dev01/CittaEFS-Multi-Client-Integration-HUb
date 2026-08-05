import { useState } from 'react';
import { HubProvider, useHub } from './lib/store';
import { LoginScreen } from './components/LoginScreen';
import { Navbar } from './components/Navbar';
import { OverviewTab } from './components/OverviewTab';
import { ClientPortalTab } from './components/ClientPortalTab';
import { ConnectorsTab } from './components/ConnectorsTab';
import { ImportTab } from './components/ImportTab';
import { FieldMappingTab } from './components/FieldMappingTab';
import { InvoicesTab } from './components/InvoicesTab';
import { CustomerSyncTab } from './components/CustomerSyncTab';
import { ItemDictionaryTab } from './components/ItemDictionaryTab';
import { QueueMonitorTab } from './components/QueueMonitorTab';
import { WebhookInspectorTab } from './components/WebhookInspectorTab';
import { ValidationErrorsTab } from './components/ValidationErrorsTab';
import { ReconciliationTab } from './components/ReconciliationTab';
import { AuditTrailTab } from './components/AuditTrailTab';
import { SettingsTab } from './components/SettingsTab';
import { NewInvoiceModal } from './components/NewInvoiceModal';
import { OnboardClientModal } from './components/OnboardClientModal';

import { Cpu } from 'lucide-react';

function HubMainContent() {
  const { currentUser, login, isBgRefreshing } = useHub();

  const [activeTab, setActiveTabState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('citta_active_tab');
      if (saved) return saved;
      const params = new URLSearchParams(window.location.search);
      const path = window.location.pathname;
      if (
        path === '/connect-quickbooks' || 
        params.get('tab') === 'connectors' || 
        params.get('qbo') === 'disconnected' || 
        params.get('connect') === 'qbo'
      ) {
        return 'connectors';
      }
    }
    return 'clients';
  });

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    if (typeof window !== 'undefined') {
      localStorage.setItem('citta_active_tab', tab);
    }
  };

  const [isNewInvoiceModalOpen, setIsNewInvoiceModalOpen] = useState(false);
  const [isOnboardModalOpen, setIsOnboardModalOpen] = useState(false);

  if (!currentUser) {
    return <LoginScreen onLogin={login} />;
  }

  // Enforce role-based tab routing restrictions:
  // Admin: Full access to all tabs
  // Operator: Main tabs only (Invoices, Validation, Items, Import, Customers, Overview)
  const userRole = currentUser?.role || 'OPERATOR';
  const allowedTabs = userRole === 'ADMIN'
    ? ['clients', 'invoices', 'import', 'customers', 'items', 'validation', 'connectors', 'settings']
    : ['clients', 'invoices', 'import', 'customers', 'items', 'validation'];

  if (!allowedTabs.includes(activeTab)) {
    setActiveTab(userRole === 'ADMIN' ? 'clients' : 'invoices');
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans flex flex-col selection:bg-amber-400 selection:text-slate-950">
      
      {/* Real-time Background Activity Progress Bar */}
      {isBgRefreshing && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-amber-400/20 z-50 overflow-hidden pointer-events-none">
          <div className="h-full bg-amber-400 rounded-full" style={{
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

      {/* Main Content Area next to Sidebar */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64 xl:pl-72">
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-8 space-y-8 w-full mx-auto max-w-7xl">
          
          {/* Render Tab Content */}
          <div className="transition-all duration-150">
            {activeTab === 'clients' && (
              <OverviewTab onOpenOnboardModal={() => setIsOnboardModalOpen(true)} />
            )}
            {activeTab === 'connectors' && <ConnectorsTab />}
            {activeTab === 'import' && <ImportTab onNavigate={(t) => setActiveTab(t)} />}
            {activeTab === 'invoices' && <InvoicesTab />}
            {activeTab === 'validation' && <ValidationErrorsTab />}
            {activeTab === 'settings' && <SettingsTab />}
            
            {/* Secondary Modules */}
            {activeTab === 'customers' && <CustomerSyncTab />}
            {activeTab === 'items' && <ItemDictionaryTab />}
          </div>

        </main>

        {/* Footer */}
        <footer className="bg-white text-slate-500 border-t border-slate-200 text-xs py-6 mt-12 font-sans shrink-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 rounded bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs">
                C
              </div>
              <span className="font-semibold text-slate-700">CittaEFS Integration Hub</span>
            </div>
            <div className="flex items-center space-x-4 text-[11px] text-slate-400">
              <span>PostgreSQL</span>
              <span>•</span>
              <span>QuickBooks + Excel</span>
              <span>•</span>
              <span>CittaEFS Gateway</span>
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

export default function App() {
  return (
    <HubProvider>
      <HubMainContent />
    </HubProvider>
  );
}
