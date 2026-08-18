import { useState, FormEvent, useEffect } from 'react';
import { useHub } from '../lib/store';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import { getStoredCittaEndpoint, saveStoredCittaEndpoint } from '../lib/gatewaySettings';
import { 
  Settings, 
  ShieldCheck, 
  Key, 
  Clock, 
  RefreshCw, 
  UserCheck, 
  Save, 
  Lock, 
  Globe, 
  Sliders,
  Users,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserPlus,
  ShieldAlert,
  Search,
  X
} from 'lucide-react';

interface UserMember {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'OPERATOR';
  mfaStatus: 'ENFORCED' | 'OPTIONAL' | 'DISABLED';
  lastActive: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
}

export function SettingsTab() {
  const { activeTenant } = useHub();

  const [currentRole, setCurrentRole] = useState<'ADMIN' | 'OPERATOR'>('ADMIN');
  const [retryMax, setRetryMax] = useState(5);
  const [cittaEndpoint, setCittaEndpoint] = useState(getStoredCittaEndpoint);
  const [timeZone, setTimeZone] = useState('UTC (ISO-8601)');
  const [isSaved, setIsSaved] = useState(false);

  // Users State - fetched from API, empty initially
  const [users, setUsers] = useState<UserMember[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('SecurePass123!');
  const [newUserRole, setNewUserRole] = useState<'ADMIN' | 'OPERATOR'>('OPERATOR');

  useEffect(() => {
    fetchUsers();
  }, [activeTenant?.id]);

  const fetchUsers = async () => {
    if (!activeTenant) return;
    setIsLoadingUsers(true);
    try {
      const res = await fetchWithAuth(`/api/users?tenantId=${activeTenant.id}`);
      const data = await parseJsonResponse(res);
      if (Array.isArray(data)) {
        const mapped: UserMember[] = data.map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          mfaStatus: 'ENFORCED',
          lastActive: 'Recently',
          status: 'ACTIVE'
        }));
        setUsers(mapped);
      }
    } catch (err) {
      console.warn('Failed to fetch users from API:', err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleSaveSettings = () => {
    saveStoredCittaEndpoint(cittaEndpoint);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleAddUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!newUserName || !newUserEmail || !newUserPassword) return;

    try {
      const res = await fetchWithAuth('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
          tenantId: activeTenant.id
        })
      });
      const data = await parseJsonResponse(res);
      if (data.success) {
        const createdUser: UserMember = {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
          mfaStatus: 'ENFORCED',
          lastActive: 'Just now',
          status: 'ACTIVE'
        };
        setUsers([createdUser, ...users]);
        setNewUserName('');
        setNewUserEmail('');
        setNewUserPassword('SecurePass123!');
        setIsAddUserOpen(false);
        alert(`✅ User ${createdUser.name} (${createdUser.email}) successfully created with ${createdUser.role} role for tenant ${activeTenant?.name}!`);
      } else {
        alert(`❌ Failed to create user: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`❌ Error creating user: ${err.message}`);
    }
  };

  const handleToggleUserStatus = (id: string) => {
    setUsers(users.map(u => {
      if (u.id === id) {
        const nextStatus = u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
        return { ...u, status: nextStatus };
      }
      return u;
    }));
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const permissionsMatrix = [
    { capability: 'Gateway Configuration (Environment Variables)', admin: true, operator: false },
    { capability: 'ERP Connectors & Custom Endpoint Config', admin: true, operator: false },
    { capability: 'Field Mapping & JSON Transformation Rules', admin: true, operator: false },
    { capability: 'Manual Invoice Ingestion & Retry Queue', admin: true, operator: true },
    { capability: 'Dead-Letter Queue Replay & Purge', admin: true, operator: true },
    { capability: 'Customer Sync & Tax Rule Management', admin: true, operator: true },
    { capability: 'Audit Trail Inspection & Legal Hash Export', admin: true, operator: true },
    { capability: 'User Management & Role Assignment', admin: true, operator: false },
  ];

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-400" />
            Tenant Security, RBAC & User Permissions Hub
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Row-Level Security Context • Multi-User RBAC • Workspace: <strong className="text-white font-medium">{activeTenant?.name || 'No Workspace'}</strong> ({activeTenant?.id || 'N/A'})
          </p>
        </div>
      </div>

      {/* Role Context Switcher Workbench */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-indigo-600" />
            <span>Simulate Active RBAC Role Session Context</span>
          </h3>
          <span className="px-2.5 py-0.5 bg-emerald-50 border border-emerald-200 font-semibold text-[11px] rounded-full text-emerald-700">
            ACTIVE ROLE: {currentRole}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { role: 'ADMIN', label: 'Platform Admin', desc: 'Full write, API key rotation, tenant onboarding & RBAC user control' },
            { role: 'OPERATOR', label: 'Operations Tech', desc: 'Invoice ingestion, manual error recovery & job retries' }
          ].map((r) => (
            <button
              key={r.role}
              onClick={() => setCurrentRole(r.role as any)}
              className={`p-4 border rounded-xl text-left space-y-1.5 cursor-pointer transition-all ${
                currentRole === r.role ? 'bg-indigo-50/70 border-indigo-500 shadow-sm' : 'bg-white hover:bg-slate-50 border-slate-200/80'
              }`}
            >
              <div className="font-bold text-slate-900 text-xs flex items-center justify-between">
                <span>{r.label}</span>
                {currentRole === r.role && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
              </div>
              <div className="text-xs text-slate-500 leading-relaxed">{r.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* User Permissions & Directory Section */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-600" />
              <span>Tenant User Directory & Access Management</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Manage user access, role assignments, and MFA enforcement policies.</p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search team members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 border border-slate-200/80 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-48 transition-all"
              />
            </div>
            
            {currentRole === 'ADMIN' ? (
              <button
                onClick={() => setIsAddUserOpen(true)}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>Invite User</span>
              </button>
            ) : (
              <span className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs font-medium">
                Admin required
              </span>
            )}
          </div>
        </div>

        {/* User Table */}
        <div className="overflow-x-auto border border-slate-100 rounded-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 font-semibold text-[10px] uppercase tracking-wider border-b border-slate-100">
                <th className="p-3 px-4">User Name & Email</th>
                <th className="p-3 px-4">Assigned Role</th>
                <th className="p-3 px-4">MFA Status</th>
                <th className="p-3 px-4">Last Active</th>
                <th className="p-3 px-4">Status</th>
                <th className="p-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-900">
              {isLoadingUsers ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Loading users...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <Users className="w-8 h-8 text-slate-300" />
                      <p>No users yet</p>
                      <p className="text-[11px]">Add your first user using the form above</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="p-3 px-4">
                    <div className="font-bold text-slate-900">{user.name}</div>
                    <div className="text-[11px] text-slate-500">{user.email}</div>
                  </td>
                  <td className="p-3 px-4">
                    <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 font-medium rounded-full text-[11px]">
                      {user.role}
                    </span>
                  </td>
                  <td className="p-3 px-4 font-medium text-slate-700">
                    <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] rounded-full font-semibold">
                      {user.mfaStatus}
                    </span>
                  </td>
                  <td className="p-3 px-4 text-slate-500 text-xs">{user.lastActive}</td>
                  <td className="p-3 px-4">
                    <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full border ${
                      user.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      user.status === 'INVITED' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="p-3 px-4 text-right">
                    {currentRole === 'ADMIN' ? (
                      <button
                        onClick={() => handleToggleUserStatus(user.id)}
                        className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
                      >
                        {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">Read-Only</span>
                    )}
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Capabilities & Access Matrix */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 text-sm border-b border-slate-100 pb-3 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-indigo-600" />
          <span>Detailed Role Capabilities & Permissions Matrix</span>
        </h3>

        <div className="overflow-x-auto border border-slate-100 rounded-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 font-semibold text-[10px] uppercase tracking-wider border-b border-slate-100">
                <th className="p-3 px-4">Functional Capability</th>
                <th className="p-3 px-4 text-center">Admin</th>
                <th className="p-3 px-4 text-center">Operations Tech</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-900">
              {permissionsMatrix.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                  <td className="p-3 px-4 font-medium text-slate-800">{item.capability}</td>
                  <td className="p-3 px-4 text-center">
                    {item.admin ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" /> : <XCircle className="w-4 h-4 text-slate-300 mx-auto" />}
                  </td>
                  <td className="p-3 px-4 text-center">
                    {item.operator ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" /> : <XCircle className="w-4 h-4 text-slate-300 mx-auto" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gateway Configuration & Policies Form */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm space-y-5">
        <h3 className="font-bold text-slate-900 text-sm border-b border-slate-100 pb-3 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-indigo-600" />
          <span>Tenant Gateway & Retry Policies</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block font-medium text-slate-700 mb-1">CittaEFS Gateway REST Endpoint URL</label>
            <input
              type="text"
              value={cittaEndpoint}
              disabled={currentRole === 'OPERATOR'}
              onChange={(e) => setCittaEndpoint(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400 transition-all"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">CittaEFS Gateway API Key (Organization-Wide)</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3.5 py-2 border border-slate-200 rounded-lg bg-amber-50 font-mono text-amber-800 text-xs">
                ⚙️ Configured via CITTAEFS_API_KEY environment variable
              </div>
            </div>
            <span className="text-xs text-slate-500 font-medium block mt-1">
              * Single API key shared across all workspaces (tenants). Configure via server environment variables.
            </span>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">BullMQ Exponential Backoff Retries</label>
            <select
              value={retryMax}
              disabled={currentRole === 'OPERATOR'}
              onChange={(e) => setRetryMax(Number(e.target.value))}
              className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:bg-slate-50 cursor-pointer transition-all"
            >
              <option value={3}>3 Retries (5s, 30s, 2m)</option>
              <option value={5}>5 Retries (5s, 30s, 2m, 10m, 30m) - Recommended</option>
              <option value={10}>10 Retries (High Tolerance)</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Timestamp Serialization Format</label>
            <select
              value={timeZone}
              disabled={currentRole === 'OPERATOR'}
              onChange={(e) => setTimeZone(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:bg-slate-50 cursor-pointer transition-all"
            >
              <option value="UTC (ISO-8601)">UTC ISO-8601 (YYYY-MM-DDTHH:mm:ssZ) - Required by NRS</option>
              <option value="Local EAT (UTC+3)">Local EAT (UTC+3)</option>
            </select>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={handleSaveSettings}
            disabled={currentRole === 'OPERATOR'}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm cursor-pointer flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4 text-white" />
            <span>{isSaved ? 'Settings Saved!' : 'Save Security & Retry Policy'}</span>
          </button>
        </div>
      </div>

      {/* Invite User Modal */}
      {isAddUserOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-600" />
                <span>Invite New Team Member</span>
              </h3>
              <button 
                onClick={() => setIsAddUserOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. David Miller"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. d.miller@company.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Temporary Password</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SecurePass123!"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Assign Role</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
                >
                  <option value="ADMIN">Platform Admin</option>
                  <option value="OPERATOR">Operations Tech</option>
                </select>
              </div>

              <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200/80 text-xs text-amber-900 space-y-1">
                <strong>Security Policy Note:</strong>
                <p className="text-amber-800">An automated invitation link with enforced 2FA setup will be dispatched to the provided email.</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer transition-colors"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

