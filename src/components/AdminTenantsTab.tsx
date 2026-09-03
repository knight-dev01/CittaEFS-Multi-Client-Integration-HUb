import { useState, useEffect } from 'react';
import { useHub } from '../lib/store';
import { ERP_REGISTRY } from '../config/erpRegistry';
import { Building2, Plus, Trash2, Settings, UserPlus, CheckCircle2, AlertCircle, Plug, Users, Shield } from 'lucide-react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';

export function AdminTenantsTab() {
  const { tenants, tenantErps, activeTenant, addTenantErp, removeTenantErp, createTenantUser, currentUser } = useHub() as any;
  const isAdmin = currentUser?.role === 'ADMIN';

  const [selectedTenantId, setSelectedTenantId] = useState<string>(activeTenant?.id || tenants[0]?.id || '');
  const selectedTenant = tenants.find((t:any) => t.id === selectedTenantId) || activeTenant;
  const erpsForTenant: any[] = selectedTenant?.tenantErps || tenantErps?.filter((e:any) => e.tenantId === selectedTenantId) || [];

  const [newErpPlatform, setNewErpPlatform] = useState<string>('QuickBooks Online');
  const [isAddingErp, setIsAddingErp] = useState(false);
  const [erpMsg, setErpMsg] = useState<{type:'success'|'error', text:string} | null>(null);

  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('OPERATOR');
  const [userMsg, setUserMsg] = useState<{type:'success'|'error', text:string} | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  if (!isAdmin) return <div className="p-8 text-center text-slate-400 text-xs">Admin access required.</div>;

  const handleAddErp = async () => {
    if (!selectedTenant) return;
    setIsAddingErp(true);
    setErpMsg(null);
    try {
      await addTenantErp(selectedTenant.id, newErpPlatform, newErpPlatform);
      setErpMsg({ type: 'success', text: `${newErpPlatform} connected to ${selectedTenant.name}` });
    } catch (e:any) {
      setErpMsg({ type: 'error', text: e.message });
    } finally { setIsAddingErp(false); }
  };

  const handleRemoveErp = async (erp: any) => {
    if (!confirm(`Disconnect ${erp.platformType} from ${selectedTenant?.name}?`)) return;
    try {
      await removeTenantErp(selectedTenant.id, erp.id);
      setErpMsg({ type: 'success', text: `Removed ${erp.platformType}` });
    } catch (e:any) { setErpMsg({ type: 'error', text: e.message }); }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userEmail || !userPassword || !userName) { setUserMsg({ type: 'error', text: 'Email, password, name required' }); return; }
    setIsCreatingUser(true);
    setUserMsg(null);
    try {
      await createTenantUser({ email: userEmail, password: userPassword, name: userName, role: userRole, organization: selectedTenant?.companyName || selectedTenant?.name, tenantId: selectedTenant.id });
      setUserMsg({ type: 'success', text: `Login created: ${userEmail} for ${selectedTenant?.name} (${userRole})` });
      setUserEmail(''); setUserPassword(''); setUserName('');
      loadUsers();
    } catch (err:any) { setUserMsg({ type: 'error', text: err.message }); }
    finally { setIsCreatingUser(false); }
  };

  const loadUsers = async () => {
    if (!selectedTenant?.id) return;
    setLoadingUsers(true);
    try {
      const res = await fetchWithAuth(`/api/users?tenantId=${selectedTenant.id}`);
      const data = await parseJsonResponse(res);
      const list = Array.isArray(data) ? data : (data?.data || []);
      setUsers(list.filter((u:any)=> !u.tenantId || u.tenantId===selectedTenant.id));
    } catch { setUsers([]); } finally { setLoadingUsers(false); }
  };
  useEffect(()=>{ loadUsers(); }, [selectedTenantId]);

  const availableErps = Object.keys(ERP_REGISTRY);

  return (
    <div className="space-y-6 font-sans text-xs">
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-violet-400" />
          <h1 className="text-base font-bold">Companies & ERPs</h1>
        </div>
        <p className="text-slate-400 text-xs mt-1">Admin: add companies, attach multiple ERPs per company, and create hub logins. Each ERP is isolated (own config, own pull, same CittaEFS shared key <span className="font-mono text-violet-300">CITTAEFS_API_KEY</span>).</p>
      </div>

      {/* Company selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Company:</span>
        <select value={selectedTenantId} onChange={e=>setSelectedTenantId(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium cursor-pointer">
          {tenants.map((t:any)=><option key={t.id} value={t.id}>{t.name} — {t.tin} ({t.platformType})</option>)}
        </select>
        <span className="text-[11px] text-slate-500">{selectedTenant?.companyName} • TIN {selectedTenant?.tin}</span>
      </div>

      {/* ERPs for selected company */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-900 text-xs flex items-center gap-2"><Plug className="w-4 h-4 text-violet-600" /> ERPs for {selectedTenant?.name} ({erpsForTenant.length})</span>
          <span className="text-[11px] text-slate-500">Multi-ERP per company</span>
        </div>
        <div className="p-4 space-y-3">
          {erpsForTenant.length === 0 ? (
            <div className="p-6 text-center text-slate-400">No ERPs connected — add one below.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {erpsForTenant.map((erp:any)=>{
                const def = ERP_REGISTRY[erp.platformType];
                return (
                  <div key={erp.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg ${def?.color==='amber' ? 'bg-amber-100 text-amber-700' : def?.color==='indigo' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
                        {def?.icon ? <def.icon className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 text-xs">{erp.platformType}</div>
                        <div className="text-[11px] text-slate-500">{erp.erpId} • {erp.status}</div>
                      </div>
                    </div>
                    <button onClick={()=>handleRemoveErp(erp)} className="p-1.5 bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
            <select value={newErpPlatform} onChange={e=>setNewErpPlatform(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium cursor-pointer">
              {availableErps.map(k=><option key={k} value={k}>{k} ({ERP_REGISTRY[k].shortLabel})</option>)}
            </select>
            <button onClick={handleAddErp} disabled={isAddingErp} className="px-3.5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer"><Plus className="w-3.5 h-3.5" />{isAddingErp ? 'Adding...' : 'Connect ERP'}</button>
            {erpMsg && <span className={`text-xs flex items-center gap-1 ${erpMsg.type==='success'?'text-violet-700':'text-rose-700'}`}>{erpMsg.type==='success'?<CheckCircle2 className="w-3.5 h-3.5"/>:<AlertCircle className="w-3.5 h-3.5"/>}{erpMsg.text}</span>}
          </div>
          <p className="text-[11px] text-slate-400">Each ERP keeps its own pull logic (QBO OAuth, Excel grouping, SAP OData). Invoices store <span className="font-mono">sourceErp</span> for traceability and writeback routing.</p>
        </div>
      </div>

      {/* Users list for company — admin sees credentials */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
          <span className="font-bold text-slate-900 text-xs flex items-center gap-2"><Users className="w-4 h-4 text-violet-600" /> Users for {selectedTenant?.name} ({users.length}) {loadingUsers && <span className="text-[11px] text-slate-400">loading…</span>}</span>
          <span className="text-[11px] text-slate-500">Admin sees email • role • tenant</span>
        </div>
        {users.length===0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">No users for this company — create one below.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead><tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100"><th className="py-2.5 px-4">Name</th><th className="py-2.5 px-4">Email (login)</th><th className="py-2.5 px-4">Role</th><th className="py-2.5 px-4">Organization</th><th className="py-2.5 px-4">Tenant</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u:any)=>(
                  <tr key={u.id} className="hover:bg-violet-50/30">
                    <td className="py-2.5 px-4 font-semibold text-slate-900 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-violet-600" />{u.name}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">{u.email}</td>
                    <td className="py-2.5 px-4"><span className="px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded-full text-[10px] font-bold">{u.role}</span></td>
                    <td className="py-2.5 px-4 text-slate-600">{u.organization}</td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">{u.tenantId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create login for company */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h3 className="font-bold text-slate-900 flex items-center gap-2"><UserPlus className="w-4 h-4 text-violet-600" /> Create hub login for {selectedTenant?.name}</h3>
        <p className="text-slate-500 text-xs mt-1">Creates a user scoped to this company (tenantId). They will see only their company's workspaces/invoices.</p>
        <form onSubmit={handleCreateUser} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Email *</label>
            <input value={userEmail} onChange={e=>setUserEmail(e.target.value)} placeholder="user@company.com" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" required />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Full name *</label>
            <input value={userName} onChange={e=>setUserName(e.target.value)} placeholder="John Doe" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" required />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Password *</label>
            <input type="password" value={userPassword} onChange={e=>setUserPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs" required />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Role</label>
            <select value={userRole} onChange={e=>setUserRole(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs cursor-pointer">
              <option value="OPERATOR">OPERATOR</option>
              <option value="ADMIN">ADMIN</option>
              <option value="INTEGRATION_MANAGER">INTEGRATION_MANAGER</option>
              <option value="AUDITOR">AUDITOR</option>
            </select>
          </div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button type="submit" disabled={isCreatingUser} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg cursor-pointer">{isCreatingUser ? 'Creating...' : 'Create login'}</button>
            {userMsg && <span className={`text-xs flex items-center gap-1 ${userMsg.type==='success'?'text-violet-700':'text-rose-700'}`}>{userMsg.type==='success'?<CheckCircle2 className="w-3.5 h-3.5"/>:<AlertCircle className="w-3.5 h-3.5"/>}{userMsg.text}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
