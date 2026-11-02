import { useState, useMemo, useRef, useEffect } from 'react';
import { useHub } from '../lib/store';
import { getErpForTenant, groupTenantsByErp } from '../config/erpRegistry';
import {
  Building2,
  Plug,
  FileText,
  ShieldAlert,
  Layers,
  Menu,
  X,
  LogOut,
  RefreshCw,
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenOnboardModal: () => void;
}

export function Navbar({ activeTab, setActiveTab, onOpenOnboardModal }: NavbarProps) {
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
  const attentionCount = tenants.length > 0 && activeTenant ? invoices.filter((i:any) => i.tenantId === activeTenant.id && ['PENDING_NRS_STAMP','PENDING','QUEUED','REJECTED','FAILED'].includes(i.status)).length : 0;
  const openValidationCount = tenants.length > 0 && activeTenant ? validationErrors.filter((e:any) => e.tenantId === activeTenant.id && e.status === 'OPEN').length : 0;

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
  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    setIsMobileMenuOpen(false);
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

  const allTabs = [
    { id: 'connections', label: 'Connections', icon: Plug, requiredRoles: ['ADMIN'] },
    { id: 'invoices', label: 'Invoices', icon: FileText, requiredRoles: ['ADMIN', 'OPERATOR'], count: attentionCount },
    { id: 'validation', label: 'Validation', icon: ShieldAlert, requiredRoles: ['ADMIN', 'OPERATOR'], count: openValidationCount }
  ];

  const visibleTabs = allTabs.filter(tab => tab.requiredRoles.includes(userRole));

  const grouped = useMemo(() => groupTenantsByErp(tenants as any), [tenants]);

  const canOnboard = userRole === 'ADMIN';

  const SidebarContent = () => (
    <div className="flex flex-col h-full max-h-screen bg-chrome text-chrome-ink font-sans border-r border-chrome-line shadow-xl overflow-hidden">
      <div className="p-5 border-b border-chrome-line shrink-0">
        <div className="flex items-center space-x-3">
          <div className="bg-accent p-2 rounded-lg text-white flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight leading-none">
              Citta Gateway
            </h1>
          </div>
        </div>
      </div>

      <div className="p-4 border-b border-chrome-line shrink-0 bg-black/20">
        <label className="block text-xs text-chrome-ink-soft font-semibold uppercase mb-1.5 tracking-wider">
          Active Workspace:
        </label>
        <div className="relative flex items-center gap-2">
          <div className="flex items-center bg-chrome-line/90 border border-chrome-line rounded-lg px-3 py-2 space-x-2 flex-1 focus-within:ring-2 focus-within:ring-accent transition-all">
            <Building2 className="w-4 h-4 text-accent-bright shrink-0" />
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
                <option value="" className="bg-chrome text-accent-bright font-medium">
                  + Onboard ERP
                </option>
              ) : (
                Object.entries(grouped).map(([groupLabel, groupTenants]: any) => (
                  <optgroup key={groupLabel} label={`${groupLabel} — ${groupTenants.length} tenant(s)`} className="bg-chrome text-chrome-ink-soft">
                    {groupTenants.map((t: any) => (
                      <option key={t.id} value={t.id} className="bg-chrome text-white">
                        {t.name} ({getErpForTenant(t.platformType).shortLabel})
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
            <X className="w-3.5 h-3.5 text-chrome-ink-soft absolute right-2.5 pointer-events-none" />
          </div>
          {userRole === 'ADMIN' && activeTenant && (
            <button
              onClick={handleDeleteActiveTenant}
              disabled={isDeletingTenant}
              title={`Remove tenant "${activeTenant.name}"`}
              className="p-2 bg-chrome-line hover:bg-rose-600 border border-chrome-line hover:border-rose-700 text-chrome-ink-soft hover:text-white rounded-lg transition-colors disabled:opacity-50 cursor-pointer shrink-0"
            >
              <Trash2 className={`w-3.5 h-3.5 ${isDeletingTenant ? 'animate-pulse' : ''}`} />
            </button>
          )}
        </div>
      </div>

      <div
        ref={navScrollRef}
        onScroll={e => { scrollTopRef.current = (e.target as HTMLDivElement).scrollTop; }}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-5 "
      >
        <div className="space-y-1">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => handleNavClick(tab.id)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-accent text-white'
                    : 'text-chrome-ink-soft hover:bg-chrome-line/60 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-chrome-ink-soft'}`} />
                  <span>{tab.label}</span>
                </div>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
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

      <div className="p-4 border-t border-chrome-line bg-black/20 shrink-0 space-y-2">
        {canOnboard && (
          <button
            onClick={() => {
              onOpenOnboardModal();
              setIsMobileMenuOpen(false);
            }}
            className="flex items-center justify-center space-x-2 w-full py-2 bg-accent hover:bg-accent-strong text-white text-xs font-semibold rounded-lg cursor-pointer shadow-sm transition-all"
          >
            <Plus className="w-4 h-4 text-white" />
            <span>Onboard ERP</span>
          </button>
        )}
      </div>

      <div className="p-4 border-t border-chrome-line bg-black/25 shrink-0 flex items-center justify-between text-xs gap-2">
        <div className="flex items-center space-x-2.5 shrink-0 truncate max-w-[140px]">
          <div className="w-8 h-8 bg-accent/20 border border-accent/30 rounded-full flex items-center justify-center font-bold text-accent-bright text-xs shrink-0">
            {currentUser?.name?.substring(0, 2).toUpperCase() || 'OP'}
          </div>
          <div className="flex flex-col text-left truncate">
            <span className="font-semibold text-white leading-tight truncate">{currentUser?.name}</span>
            <span className="text-xs text-chrome-ink-soft font-medium capitalize">{currentUser?.role?.toLowerCase()}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg bg-chrome-line hover:bg-chrome-line text-chrome-ink hover:text-white cursor-pointer transition-colors"
            title="Refresh All Engine Services"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-accent-bright' : ''}`} />
          </button>

          <button
            onClick={logout}
            className="p-1.5 rounded-lg bg-chrome-line hover:bg-rose-600 text-chrome-ink hover:text-white cursor-pointer transition-colors"
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
      <header className="lg:hidden bg-chrome border-b border-chrome-line text-white font-sans sticky top-0 z-40 h-14 flex items-center justify-between px-4 shadow-sm">
        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-1.5 rounded-lg border border-chrome-line hover:border-chrome-line text-chrome-ink hover:text-white bg-chrome-line/80 cursor-pointer focus:outline-none transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center space-x-2">
            <div className="bg-accent p-1.5 rounded-lg font-bold text-white flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-white tracking-tight">Citta Gateway</span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs bg-chrome-line px-2.5 py-1 rounded-full border border-chrome-line font-medium text-chrome-ink max-w-[120px] truncate">
            {activeTenant?.name || 'No Workspace'}
          </span>
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg border border-chrome-line hover:border-chrome-line text-chrome-ink hover:text-white bg-chrome-line/80 cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-accent-bright' : ''}`} />
          </button>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-ink/70"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-chrome h-full shadow-xl">
            <div className="absolute top-0 right-0 -mr-12 pt-2">
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white bg-chrome border border-chrome-line text-white cursor-pointer"
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

      <aside className={`hidden lg:flex lg:flex-shrink-0 fixed inset-y-0 left-0 z-30 ${isCollapsed ? 'lg:w-16' : 'lg:w-64 xl:w-72'}`}>
        <div className="flex flex-col w-full h-full relative">
          <button
            onClick={toggleCollapsed}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="absolute -right-3 top-5 z-40 w-6 h-6 bg-panel border border-line rounded-full shadow flex items-center justify-center text-ink-soft hover:text-ink hover:border-line-strong cursor-pointer"
          >
            {isCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </button>
          <div className={isCollapsed ? 'opacity-0 pointer-events-none lg:opacity-100 lg:pointer-events-auto' : ''} style={isCollapsed ? { display: 'none' } : undefined}>
            <SidebarContent />
          </div>
          {isCollapsed && (
            <div className="flex flex-col h-full bg-chrome text-chrome-ink border-r border-chrome-line">
              <div className="p-3 border-b border-chrome-line flex flex-col items-center gap-2">
                <div className="bg-accent p-2 rounded-lg text-white"><Layers className="w-4 h-4" /></div>
              </div>
              <div className="flex-1 overflow-y-auto py-3 space-y-1">
                {visibleTabs.map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button key={tab.id} onClick={() => handleNavClick(tab.id)} title={tab.label} className={`w-full flex justify-center py-2.5 ${isActive ? 'text-chrome-ink-soft bg-white/10' : 'text-chrome-ink-soft hover:text-white hover:bg-chrome-line'} cursor-pointer`}>
                      <Icon className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>
              <div className="p-2 border-t border-chrome-line flex flex-col items-center gap-2">
                {activeTenant && (
                  <button onClick={handleDeleteActiveTenant} title="Remove workspace" className="p-2 bg-chrome-line hover:bg-rose-600 rounded-lg text-chrome-ink-soft hover:text-white cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
                <button onClick={handleRefresh} className="p-2 bg-chrome-line hover:bg-chrome-line rounded-lg text-chrome-ink cursor-pointer"><RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /></button>
                <button onClick={logout} className="p-2 bg-chrome-line hover:bg-rose-600 rounded-lg text-chrome-ink hover:text-white cursor-pointer"><LogOut className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
