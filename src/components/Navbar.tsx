import { useState } from 'react';
import { useHub } from '../lib/store';
import { 
  Building2, 
  Plug, 
  Download, 
  FileText, 
  AlertCircle, 
  Layers, 
  RotateCcw, 
  ShieldCheck, 
  Settings, 
  Users, 
  Tag, 
  Sliders, 
  Radio, 
  Menu, 
  X, 
  LogOut, 
  RefreshCw, 
  Plus, 
  User, 
  Zap, 
  ChevronDown
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenNewInvoiceModal: () => void;
  onOpenOnboardModal: () => void;
}

export function Navbar({ activeTab, setActiveTab, onOpenNewInvoiceModal, onOpenOnboardModal }: NavbarProps) {
  const { 
    activeTenantId, 
    setActiveTenantId, 
    activeTenant, 
    tenants, 
    validationErrors, 
    refreshAll, 
    currentUser, 
    logout 
  } = useHub();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const openErrorCount = validationErrors.filter(e => e.tenantId === activeTenant.id && e.status === 'OPEN').length;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshAll();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const userRole = currentUser?.role || 'OPERATOR';

  const categories = userRole === 'ADMIN' ? [
    { id: 'core', label: 'Overall Control & Hub' },
    { id: 'integration', label: 'Integrations & Mapping' },
    { id: 'engine', label: 'Queue & Processing' },
    { id: 'security', label: 'Security & Governance' }
  ] : [
    { id: 'actions', label: 'Operator Action Points' }
  ];

  const allTabs = [
    // Admin Overall Views
    { id: 'clients', label: 'Overview Center', icon: Layers, category: 'core', requiredRoles: ['ADMIN'] },
    { id: 'client_portal', label: 'Client ERP & Gateway', icon: Building2, category: 'core', requiredRoles: ['ADMIN'] },

    // Action Points (Available to Operator & Admin)
    { id: 'invoices', label: 'Invoices Ledger', icon: FileText, category: userRole === 'ADMIN' ? 'core' : 'actions', requiredRoles: ['ADMIN', 'OPERATOR'] },
    { id: 'validation', label: 'Validation Errors', icon: AlertCircle, count: openErrorCount, category: userRole === 'ADMIN' ? 'engine' : 'actions', requiredRoles: ['ADMIN', 'OPERATOR'] },
    { id: 'items', label: 'Items & HS Mapping', icon: Tag, category: userRole === 'ADMIN' ? 'core' : 'actions', requiredRoles: ['ADMIN', 'OPERATOR'] },
    { id: 'import', label: 'Import & Ingest', icon: Download, category: userRole === 'ADMIN' ? 'integration' : 'actions', requiredRoles: ['ADMIN', 'OPERATOR'] },
    { id: 'customers', label: 'Customers', icon: Users, category: userRole === 'ADMIN' ? 'core' : 'actions', requiredRoles: ['ADMIN', 'OPERATOR'] },

    // Admin System Infrastructure & Connectors
    { id: 'connectors', label: 'Connectors', icon: Plug, category: 'integration', requiredRoles: ['ADMIN'] },
    { id: 'field_mapping', label: 'Field Mapping', icon: Sliders, category: 'integration', requiredRoles: ['ADMIN'] },
    { id: 'webhooks', label: 'Webhooks', icon: Radio, category: 'integration', requiredRoles: ['ADMIN'] },

    // Admin Queue & Engine
    { id: 'queues', label: 'Queue Monitor', icon: Layers, category: 'engine', requiredRoles: ['ADMIN'] },
    { id: 'gateway', label: 'Gateway & Rec Engine', icon: RotateCcw, category: 'engine', requiredRoles: ['ADMIN'] },

    // Admin Security & Governance
    { id: 'audit', label: 'Audit Trail', icon: ShieldCheck, category: 'security', requiredRoles: ['ADMIN'] },
    { id: 'settings', label: 'System Settings', icon: Settings, category: 'security', requiredRoles: ['ADMIN'] }
  ];

  const visibleTabs = allTabs.filter(tab => tab.requiredRoles.includes(userRole));

  const canOnboard = userRole === 'ADMIN';
  const canIngest = userRole === 'ADMIN' || userRole === 'OPERATOR';

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-slate-900 text-white font-mono border-r-4 border-slate-950">
      {/* Brand Title */}
      <div className="p-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="bg-amber-400 p-1.5 border-2 border-slate-950 font-black text-slate-950 flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-xs font-black text-amber-400 uppercase tracking-widest leading-none">
                CittaEFS Hub
              </h1>
              <span className="text-[9px] bg-emerald-400 text-slate-950 px-1 py-0.2 border border-slate-950 font-black shrink-0">
                v2.4
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold mt-1">
              Multi-Tenant Middleware
            </p>
          </div>
        </div>
      </div>

      {/* Tenant Selector */}
      <div className="p-4 border-b border-slate-800 shrink-0 bg-slate-950/40">
        <label className="block text-[10px] text-slate-500 font-bold uppercase mb-1.5 tracking-wider">Active Workspace Tenant:</label>
        <div className="flex items-center bg-slate-800 border-2 border-slate-700 px-2 py-1.5 space-x-1.5 w-full">
          <Building2 className="w-4 h-4 text-amber-400 shrink-0" />
          <select
            value={activeTenantId}
            onChange={(e) => setActiveTenantId(e.target.value as any)}
            className="bg-transparent text-white font-bold focus:outline-none cursor-pointer uppercase text-xs w-full"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="text-[9px] text-slate-400 font-bold mt-1.5 flex justify-between items-center px-1">
          <span>Platform: {activeTenant.platformType}</span>
          <span className="bg-slate-800 px-1 py-0.2 text-[8px] text-amber-400 border border-slate-700 font-mono">
            {activeTenant.region || 'EU-WEST2'}
          </span>
        </div>
      </div>

      {/* Main navigation section grouped by categories */}
      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-4 scrollbar-thin">
        {categories.map((category) => {
          const categoryTabs = visibleTabs.filter(tab => tab.category === category.id);
          if (categoryTabs.length === 0) return null;

          return (
            <div key={category.id} className="space-y-1">
              <h3 className="px-2 text-[9px] font-black tracking-widest text-slate-500 uppercase">
                {category.label}
              </h3>
              <div className="space-y-0.5">
                {categoryTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`flex items-center justify-between w-full px-2.5 py-1.5 font-bold uppercase tracking-wider text-xs border transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-amber-400 text-slate-950 border-amber-400 font-black'
                          : 'bg-transparent text-slate-400 hover:text-white hover:bg-slate-800 border-transparent'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                        <span>{tab.label}</span>
                      </div>
                      {tab.count !== undefined && tab.count > 0 && (
                        <span className={`px-1.5 py-0.2 text-[9px] font-black border ${
                          isActive ? 'bg-slate-950 text-red-400 border-slate-950' : 'bg-red-500 text-white border-red-600'
                        }`}>
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Action Button Section */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/20 shrink-0 space-y-2">
        {canOnboard && (
          <button
            onClick={() => {
              onOpenOnboardModal();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center justify-center space-x-1.5 w-full py-1.5 bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-xs font-black border-2 border-slate-950 cursor-pointer uppercase tracking-wider transition-colors"
          >
            <Plus className="w-4 h-4 text-slate-950" />
            <span>+ Onboard Client</span>
          </button>
        )}
        {canIngest && (
          <button
            onClick={() => {
              onOpenNewInvoiceModal();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center justify-center space-x-1.5 w-full py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black border-2 border-slate-950 cursor-pointer uppercase tracking-wider transition-colors"
          >
            <Plus className="w-4 h-4 text-slate-950" />
            <span>Ingest Transaction</span>
          </button>
        )}
      </div>

      {/* User profile footer section */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/60 shrink-0 flex items-center justify-between text-xs gap-2">
        <div className="flex items-center space-x-2 shrink-0 truncate max-w-[130px]">
          <div className="w-7 h-7 bg-slate-800 border-2 border-slate-700 flex items-center justify-center font-black text-amber-400 text-xs rounded-none">
            {currentUser?.name?.substring(0, 2).toUpperCase() || 'OP'}
          </div>
          <div className="flex flex-col text-left truncate">
            <span className="font-black text-white leading-none uppercase truncate">{currentUser?.name}</span>
            <span className="text-[8px] text-amber-400 font-mono font-bold uppercase mt-1">[{currentUser?.role}]</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Sync Button */}
          <button
            onClick={handleRefresh}
            className="p-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-amber-400 cursor-pointer transition-colors"
            title="Refresh All Engine Services"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
          </button>

          {/* Logout */}
          <button
            onClick={logout}
            className="p-1 bg-slate-800 hover:bg-red-600 border border-slate-700 hover:border-red-600 text-slate-300 hover:text-white cursor-pointer transition-colors"
            title="Log Out Session"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Top Header (Fixed only on Mobile) */}
      <header className="lg:hidden bg-slate-900 border-b-2 border-slate-950 text-white font-mono sticky top-0 z-40 h-14 flex items-center justify-between px-4">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-1 border border-slate-700 hover:border-white text-slate-300 hover:text-white bg-slate-800 cursor-pointer focus:outline-none"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center space-x-1">
            <div className="bg-amber-400 p-1 border border-slate-950 font-black text-slate-950 flex items-center justify-center shrink-0">
              <Layers className="w-3.5 h-3.5 text-slate-950" />
            </div>
            <span className="text-xs font-black text-amber-400 uppercase tracking-wider">CittaEFS</span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Active Tenant Code Badge */}
          <span className="text-[9px] bg-slate-850 px-2 py-0.5 border border-slate-700 font-bold uppercase text-slate-300 max-w-[120px] truncate">
            {activeTenant.name}
          </span>
          <button
            onClick={handleRefresh}
            className="p-1 border border-slate-700 hover:border-white text-slate-300 hover:text-white bg-slate-800 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </header>

      {/* Mobile Sidebar Slide Drawer */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-slate-950/85" 
            onClick={() => setIsMobileMenuOpen(false)}
          />
          {/* Sliding Menu */}
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-slate-900 h-full shadow-xl">
            <div className="absolute top-0 right-0 -mr-12 pt-2">
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white bg-slate-850 border border-slate-700 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 h-full flex flex-col overflow-y-auto">
              <SidebarContent />
            </div>
          </div>
        </div>
      )}

      {/* Desktop Persistent Sidebar (Large screen layout) */}
      <aside className="hidden lg:flex lg:flex-shrink-0 lg:w-64 xl:w-72 fixed inset-y-0 left-0 z-30">
        <div className="flex flex-col w-full h-full">
          <SidebarContent />
        </div>
      </aside>
    </>
  );
}
