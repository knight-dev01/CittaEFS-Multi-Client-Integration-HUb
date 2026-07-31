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

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window !== 'undefined') {
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

  const [isNewInvoiceModalOpen, setIsNewInvoiceModalOpen] = useState(false);
  const [isOnboardModalOpen, setIsOnboardModalOpen] = useState(false);

  if (!currentUser) {
    return <LoginScreen onLogin={login} />;
  }

  // Enforce role-based tab routing restrictions on active tabs
  const userRole = currentUser.role || 'OPERATOR';
  const allowedTabs = [
    'clients', 'client_portal', 'invoices', 'customers', 'items', 'validation', 'queues',
    ...(userRole === 'ADMIN' || userRole === 'OPERATOR' ? ['connectors', 'import', 'field_mapping', 'webhooks', 'gateway', 'reconciliation'] : []),
    ...(userRole === 'ADMIN' || userRole === 'AUDITOR' ? ['audit'] : []),
    ...(userRole === 'ADMIN' ? ['settings'] : [])
  ];

  if (!allowedTabs.includes(activeTab)) {
    setActiveTab(userRole === 'OPERATOR' ? 'client_portal' : 'clients');
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
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 space-y-6 w-full mx-auto max-w-7xl">
          
          {/* Render Tab Content */}
          <div className="transition-all duration-150">
            {(activeTab === 'clients' || activeTab === 'overview') && (
              <OverviewTab onOpenOnboardModal={() => setIsOnboardModalOpen(true)} />
            )}
            {activeTab === 'client_portal' && <ClientPortalTab />}
            {activeTab === 'connectors' && <ConnectorsTab />}
            {activeTab === 'import' && <ImportTab onNavigate={(t) => setActiveTab(t)} />}
            {activeTab === 'invoices' && <InvoicesTab />}
            {activeTab === 'validation' && <ValidationErrorsTab />}
            {activeTab === 'queues' && <QueueMonitorTab />}
            {(activeTab === 'gateway' || activeTab === 'reconciliation') && <ReconciliationTab />}
            {activeTab === 'audit' && <AuditTrailTab />}
            {activeTab === 'settings' && <SettingsTab />}
            
            {/* Secondary Modules */}
            {activeTab === 'customers' && <CustomerSyncTab />}
            {activeTab === 'items' && <ItemDictionaryTab />}
            {activeTab === 'field_mapping' && <FieldMappingTab />}
            {activeTab === 'webhooks' && <WebhookInspectorTab />}
          </div>

        </main>

        {/* Footer */}
        <footer className="bg-slate-900 text-slate-400 border-t-2 border-slate-900 text-xs py-5 mt-12 font-mono shrink-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              <span className="font-bold text-slate-200">CittaEFS Multi-Tenant Integration Hub Engine</span>
            </div>
            <div className="flex items-center space-x-4 text-[11px] text-slate-400">
              <span>PostgreSQL Row-Level Security</span>
              <span>•</span>
              <span>BullMQ Async Queues</span>
              <span>•</span>
              <span>AES-256-GCM Token Encryption</span>
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
