import { useState, useMemo, useRef, useEffect } from 'react';
import { useHub } from '../lib/store';
import { getErpForTenant, groupTenantsByErp, ERP_REGISTRY } from '../config/erpRegistry';
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
  ChevronDown,
  Globe,
  Database,
  Cloud,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronsLeft
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
    invoices,
    validationErrors, 
    refreshAll, 
    currentUser, 
    logout,
    deleteTenant
  } = useHub() as any;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDeletingTenant, setIsDeletingTenant] = useState(false);

  const userRole = currentUser?.role || 'OPERATOR';
  const erp = getErpForTenant(activeTenant?.platformType);
  const erpTabs = erp.tabs;
  const openErrorCount = tenants.length > 0 && activeTenant ? validationErrors.filter(e => e.tenantId === activeTenant.id && e.status === 'OPEN').length : 0;
  const pendingStagingCount = tenants.length > 0 && activeTenant ? invoices.filter((i:any) => i.tenantId === activeTenant.id && ['PENDING_NRS_STAMP','PENDING','QUEUED'].includes(i.status)).length : 0;
  const failedInvoiceCount = tenants.length > 0 && activeTenant ? invoices.filter((i:any) => i.tenantId === activeTenant.id && ['REJECTED','FAILED'].includes(i.status)).length : 0;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshAll();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return localStorage.getItem('citta_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const navScrollRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef<number>(0);
  useEffect(() => {
    const el = navScrollRef.current;
    if (el) el.scrollTop = scrollTopRef.current;
  }, [activeTab, tenants.length, userRole, isCollapsed]);

  const toggleCollapsed = () => {
    if (navScrollRef.current) scrollTopRef.current = navScrollRef.current.scrollTop;
    setIsCollapsed(v => {
      const nv = !v;
      try { localStorage.setItem('citta_sidebar_collapsed', nv ? '1' : '0'); } catch {}
      try { window.dispatchEvent(new CustomEvent('citta_sidebar_collapsed', { detail: nv })); } catch {}
      return nv;
    });
  };

  const handleDeleteActiveTenant = async () => {
    if (!activeTenant) return;
    if (userRole !== 'ADMIN') return;
    const confirmMsg = `Delete tenant "${activeTenant.name}" (${activeTenant.id})?\n\nThis will permanently delete the tenant and CASCADE delete its invoices, customers, items, queue jobs and integrations. This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;
    const doubleConfirm = window.prompt(`Type DELETE to confirm removal of "${activeTenant.name}":`, "");
    if (doubleConfirm !== 'DELETE') {
      if (doubleConfirm !== null) alert('Cancelled — type DELETE exactly to confirm.');
      return;
    }
    setIsDeletingTenant(true);
    try {
      await deleteTenant(activeTenant.id);
    } catch (e: any) {
      alert(e.message || 'Failed to delete tenant');
    } finally {
      setIsDeletingTenant(false);
    }
  };

  const categories = userRole === 'ADMIN' ? [
    { id: 'main', label: 'Main' },
    { id: 'erp', label: `${erp.shortLabel} Workspace` },
    { id: 'admin', label: 'Administration' }
  ] : [
    { id: 'main', label: 'Main' },
    { id: 'erp', label: `${erp.shortLabel} Workspace` }
  ];

  const allTabs = [
    // Main tabs (Available to all roles)
    { id: 'clients', label: 'Overview', icon: Layers, category: 'main', requiredRoles: ['ADMIN', 'OPERATOR'] },
    { id: 'invoices', label: 'Invoices', icon: FileText, category: 'main', requiredRoles: ['ADMIN', 'OPERATOR'], count: pendingStagingCount + failedInvoiceCount },
    { id: 'import', label: 'Import', icon: Download, category: 'erp', requiredRoles: ['ADMIN', 'OPERATOR'], erpOnly: true },
    { id: 'staging', label: 'Staging', icon: Layers, category: 'main', requiredRoles: ['ADMIN', 'OPERATOR'], count: pendingStagingCount }, // pre-transmission holding area
    { id: 'customers', label: 'Customers', icon: Users, category: 'main', requiredRoles: ['ADMIN', 'OPERATOR'] },
    { id: 'items', label: 'Items', icon: Tag, category: 'main', requiredRoles: ['ADMIN', 'OPERATOR'] },
    { id: 'validation', label: 'Validation', icon: AlertCircle, count: openErrorCount, category: 'main', requiredRoles: ['ADMIN', 'OPERATOR'] },

    // ERP-dedicated
    { id: 'connectors', label: erp.id === 'qbo' ? 'QBO Connect' : 'Connectors', icon: Plug, category: 'erp', requiredRoles: ['ADMIN'], erpOnly: true },
    { id: 'mapping', label: 'Field Mapping', icon: Sliders, category: 'erp', requiredRoles: ['ADMIN'], erpOnly: true },
    { id: 'gateway', label: 'CittaEFS Gateway', icon: Globe, category: 'erp', requiredRoles: ['ADMIN'], erpOnly: true },

    // Admin tabs
    { id: 'companies', label: 'Companies', icon: Building2, category: 'admin', requiredRoles: ['ADMIN'] },
    { id: 'settings', label: 'Settings', icon: Settings, category: 'admin', requiredRoles: ['ADMIN'] }
  ];

  const visibleTabs = allTabs.filter(tab => {
    if (!tab.requiredRoles.includes(userRole)) return false;
    if ((tab as any).erpOnly && !erpTabs.includes(tab.id)) return false;
    return true;
  });

  const grouped = useMemo(() => groupTenantsByErp(tenants as any), [tenants]);

  const canOnboard = userRole === 'ADMIN';
  const canIngest = userRole === 'ADMIN' || userRole === 'OPERATOR';

  const SidebarContent = () => (
    <div className="flex flex-col h-full max-h-screen bg-slate-900 text-slate-100 font-sans border-r border-slate-800 shadow-xl overflow-hidden">
      {/* Brand Title */}
      <div className="p-5 border-b border-slate-800/80 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-indigo-600 to-indigo-500 p-2 rounded-xl text-white shadow-md shadow-indigo-600/30 flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-tight leading-none">
                CittaEFS
              </h1>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-medium border border-indigo-500/30 shrink-0">
                v2.18
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-normal mt-1">
              Integration & Tax Compliance Hub
            </p>
          </div>
        </div>
      </div>

      {/* Tenant Selector — grouped by ERP */}
      <div className="p-4 border-b border-slate-800/80 shrink-0 bg-slate-950/30">
        <label className="block text-[10px] text-slate-400 font-semibold uppercase mb-1.5 tracking-wider flex items-center justify-between">
          <span>Active Workspace Client:</span>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${erp.id==='qbo'?'bg-amber-500/20 text-amber-300 border-amber-500/30': erp.id==='excel'?'bg-indigo-500/20 text-indigo-300 border-indigo-500/30':'bg-slate-700 text-slate-300 border-slate-600'}`}>{erp.shortLabel} MODE</span>
        </label>
        <div className="relative flex items-center gap-2">
          <div className="flex items-center bg-slate-800/90 border border-slate-700/80 rounded-lg px-3 py-2 space-x-2 flex-1 focus-within:ring-2 focus-within:ring-indigo-500 transition-all">
            <Building2 className="w-4 h-4 text-indigo-400 shrink-0" />
            <select
              value={activeTenantId}
              onChange={(e) => {
                if (!e.target.value) {
                  onOpenOnboardModal();
                } else {
                  setActiveTenantId(e.target.value as any);
                }
              }}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer text-xs w-full pr-4 appearance-none"
            >
              {tenants.length === 0 ? (
                <option value="" className="bg-slate-900 text-indigo-400 font-medium">
                  + Onboard Client Entity
                </option>
              ) : (
                Object.entries(grouped).map(([groupLabel, groupTenants]: any) => (
                  <optgroup key={groupLabel} label={`${groupLabel} — ${groupTenants.length} tenant(s)`} className="bg-slate-900 text-slate-400">
                    {groupTenants.map((t: any) => (
                      <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                        {t.name} ({getErpForTenant(t.platformType).shortLabel})
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 pointer-events-none" />
          </div>
          {userRole === 'ADMIN' && activeTenant && (
            <button
              onClick={handleDeleteActiveTenant}
              disabled={isDeletingTenant}
              title={`Remove tenant "${activeTenant.name}"`}
              className="p-2 bg-slate-800 hover:bg-rose-600 border border-slate-700 hover:border-rose-700 text-slate-400 hover:text-white rounded-lg transition-colors disabled:opacity-50 cursor-pointer shrink-0"
            >
              <Trash2 className={`w-3.5 h-3.5 ${isDeletingTenant ? 'animate-pulse' : ''}`} />
            </button>
          )}
        </div>
        <div className="text-[10px] text-slate-400 font-medium mt-2 flex justify-between items-center px-0.5">
          <span>{activeTenant?.platformType || 'QuickBooks / Excel'}</span>
          <span className="bg-slate-800 px-2 py-0.5 text-[9px] text-indigo-300 rounded border border-slate-700 font-mono">
            {activeTenant?.region || 'EU-WEST2'}
          </span>
        </div>
        {userRole === 'ADMIN' && activeTenant && (
          <p className="text-[10px] text-slate-500 mt-1">ADMIN: use trash icon to remove this workspace (cascades all data).</p>
        )}
      </div>

      {/* Main navigation section grouped by categories — scrollable, position persists */}
      <div
        ref={navScrollRef}
        onScroll={e => { scrollTopRef.current = (e.target as HTMLDivElement).scrollTop; }}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-5 scrollbar-thin scrollbar-track-slate-900 scrollbar-thumb-slate-700 hover:scrollbar-thumb-slate-600"
      >
        {categories.map((category) => {
          const categoryTabs = visibleTabs.filter(tab => tab.category === category.id);
          if (categoryTabs.length === 0) return null;

          return (
            <div key={category.id} className="space-y-1">
              <h3 className="px-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                {category.label}
              </h3>
              <div className="space-y-1">
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
                      className={`flex items-center justify-between w-full px-3 py-2 rounded-lg font-medium text-xs transition-all cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        <span>{tab.label}</span>
                      </div>
                      {tab.count !== undefined && tab.count > 0 && (
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                          isActive ? 'bg-white/20 text-white' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
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
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/30 shrink-0 space-y-2">
        {canOnboard && (
          <button
            onClick={() => {
              onOpenOnboardModal();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center justify-center space-x-2 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg cursor-pointer shadow-sm transition-all"
          >
            <Plus className="w-4 h-4 text-white" />
            <span>Onboard Client</span>
          </button>
        )}
        {canIngest && (
          <button
            onClick={() => {
              onOpenNewInvoiceModal();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center justify-center space-x-2 w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg border border-slate-700 cursor-pointer transition-all"
          >
            <Plus className="w-4 h-4 text-indigo-400" />
            <span>Ingest Transaction</span>
          </button>
        )}
      </div>

      {/* User profile footer section */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/50 shrink-0 flex items-center justify-between text-xs gap-2">
        <div className="flex items-center space-x-2.5 shrink-0 truncate max-w-[140px]">
          <div className="w-8 h-8 bg-indigo-500/20 border border-indigo-500/30 rounded-full flex items-center justify-center font-bold text-indigo-400 text-xs shrink-0">
            {currentUser?.name?.substring(0, 2).toUpperCase() || 'OP'}
          </div>
          <div className="flex flex-col text-left truncate">
            <span className="font-semibold text-white leading-tight truncate">{currentUser?.name}</span>
            <span className="text-[10px] text-slate-400 font-medium capitalize">{currentUser?.role?.toLowerCase()}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Sync Button */}
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer transition-colors"
            title="Refresh All Engine Services"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          {/* Logout */}
          <button
            onClick={logout}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white cursor-pointer transition-colors"
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
      <header className="lg:hidden bg-slate-900 border-b border-slate-800 text-white font-sans sticky top-0 z-40 h-14 flex items-center justify-between px-4 shadow-sm">
        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-1.5 rounded-lg border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white bg-slate-800/80 cursor-pointer focus:outline-none transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center space-x-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg font-bold text-white flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-white tracking-tight">CittaEFS</span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Active Tenant Code Badge */}
          <span className="text-[11px] bg-slate-800 px-2.5 py-1 rounded-full border border-slate-700 font-medium text-slate-200 max-w-[120px] truncate">
            {activeTenant?.name || 'No Workspace'}
          </span>
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white bg-slate-800/80 cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
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

      {/* Desktop Persistent Sidebar — single toggle + hover to expand */}
      <aside onMouseEnter={() => { if (isCollapsed) toggleCollapsed(); }} className={`hidden lg:flex lg:flex-shrink-0 fixed inset-y-0 left-0 z-30 transition-all duration-200 ${isCollapsed ? 'lg:w-16' : 'lg:w-64 xl:w-72'}`}>
        <div className="flex flex-col w-full h-full relative">
          {/* Single collapse toggle — top-right */}
          <button
            onClick={toggleCollapsed}
            title={isCollapsed ? 'Expand sidebar (also hover to expand)' : 'Collapse sidebar'}
            className="absolute -right-3 top-5 z-40 w-6 h-6 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center text-slate-600 hover:text-violet-600 hover:border-violet-300 cursor-pointer"
          >
            {isCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </button>
          <div className={isCollapsed ? 'opacity-0 pointer-events-none lg:opacity-100 lg:pointer-events-auto' : ''} style={isCollapsed ? { display: 'none' } : undefined}>
            <SidebarContent />
          </div>
          {isCollapsed && (
            <div className="flex flex-col h-full bg-slate-900 text-slate-100 border-r border-slate-800">
              <div className="p-3 border-b border-slate-800 flex flex-col items-center gap-2">
                <div className="bg-gradient-to-tr from-violet-600 to-indigo-500 p-2 rounded-xl text-white"><Layers className="w-4 h-4" /></div>
              </div>
              <div className="flex-1 overflow-y-auto py-3 space-y-1">
                {visibleTabs.slice(0,8).map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} title={tab.label} className={`w-full flex justify-center py-2.5 ${isActive ? 'text-violet-400 bg-violet-600/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'} cursor-pointer`}>
                      <Icon className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>
              <div className="p-2 border-t border-slate-800 flex flex-col items-center gap-2">
                {activeTenant && (
                  <button onClick={handleDeleteActiveTenant} title="Remove workspace" className="p-2 bg-slate-800 hover:bg-rose-600 rounded-lg text-slate-400 hover:text-white cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
                <button onClick={handleRefresh} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 cursor-pointer"><RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /></button>
                <button onClick={logout} className="p-2 bg-slate-800 hover:bg-rose-600 rounded-lg text-slate-300 hover:text-white cursor-pointer"><LogOut className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      </aside>
      {/* Sidebar is now independent — no full-screen overlay; main area clicks no longer toggle sidebar */}

    </>
  );
}
