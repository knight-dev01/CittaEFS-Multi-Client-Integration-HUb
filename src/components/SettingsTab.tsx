import { useState, FormEvent } from 'react';
import { useHub } from '../lib/store';
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
  Search
} from 'lucide-react';

interface UserMember {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'INTEGRATION_MANAGER' | 'OPERATOR' | 'AUDITOR';
  mfaStatus: 'ENFORCED' | 'OPTIONAL' | 'DISABLED';
  lastActive: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
}

export function SettingsTab() {
  const { activeTenant } = useHub();

  const [currentRole, setCurrentRole] = useState<'ADMIN' | 'INTEGRATION_MANAGER' | 'OPERATOR' | 'AUDITOR'>('ADMIN');
  const [retryMax, setRetryMax] = useState(5);
  const [cittaEndpoint, setCittaEndpoint] = useState('https://gateway.cittaefs.com/api/v1');
  const [timeZone, setTimeZone] = useState('UTC (ISO-8601)');
  const [apiKey, setApiKey] = useState(activeTenant.cittaApiKey || 'citta_live_9981223910');
  const [isSaved, setIsSaved] = useState(false);

  // Users State
  const [users, setUsers] = useState<UserMember[]>([
    { id: 'usr-1', name: 'Alexander Vance', email: 'a.vance@enterprise.com', role: 'ADMIN', mfaStatus: 'ENFORCED', lastActive: '2 mins ago', status: 'ACTIVE' },
    { id: 'usr-2', name: 'Elena Rostova', email: 'e.rostova@enterprise.com', role: 'INTEGRATION_MANAGER', mfaStatus: 'ENFORCED', lastActive: '14 mins ago', status: 'ACTIVE' },
    { id: 'usr-3', name: 'Kwame Osei', email: 'k.osei@enterprise.com', role: 'OPERATOR', mfaStatus: 'OPTIONAL', lastActive: '1 hour ago', status: 'ACTIVE' },
    { id: 'usr-4', name: 'Sarah Jenkins', email: 's.jenkins@auditfirm.com', role: 'AUDITOR', mfaStatus: 'ENFORCED', lastActive: 'Yesterday', status: 'ACTIVE' }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'ADMIN' | 'INTEGRATION_MANAGER' | 'OPERATOR' | 'AUDITOR'>('OPERATOR');

  const handleRotateKey = () => {
    if (currentRole !== 'ADMIN') {
      alert('Access Restricted: Only Platform Admins are authorized to rotate Tenant Gateway API Keys.');
      return;
    }
    const newKey = `citta_live_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 6)}`;
    setApiKey(newKey);
    alert(`CittaEFS Gateway API Key rotated successfully! New Key: ${newKey}`);
  };

  const handleSaveSettings = () => {
    if (currentRole === 'AUDITOR') {
      alert('Access Restricted: Auditor role is read-only. Security policy updates require Admin or Integration Manager privileges.');
      return;
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleAddUser = (e: FormEvent) => {
    e.preventDefault();
    if (!newUserName || !newUserEmail) return;

    const newUser: UserMember = {
      id: `usr-${Date.now().toString().slice(-4)}`,
      name: newUserName,
      email: newUserEmail,
      role: newUserRole,
      mfaStatus: 'ENFORCED',
      lastActive: 'Just invited',
      status: 'INVITED'
    };

    setUsers([newUser, ...users]);
    setNewUserName('');
    setNewUserEmail('');
    setIsAddUserOpen(false);
    alert(`Invitation sent to ${newUserEmail} with ${newUserRole} permissions.`);
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
    { capability: 'Tenant Credentials & API Key Rotation', admin: true, manager: false, operator: false, auditor: false },
    { capability: 'ERP Connectors & Custom Endpoint Config', admin: true, manager: true, operator: false, auditor: false },
    { capability: 'Field Mapping & JSON Transformation Rules', admin: true, manager: true, operator: false, auditor: false },
    { capability: 'Manual Invoice Ingestion & Retry Queue', admin: true, manager: true, operator: true, auditor: false },
    { capability: 'Dead-Letter Queue Replay & Purge', admin: true, manager: true, operator: true, auditor: false },
    { capability: 'Customer Sync & Tax Rule Management', admin: true, manager: true, operator: true, auditor: false },
    { capability: 'Audit Trail Inspection & Legal Hash Export', admin: true, manager: true, operator: true, auditor: true },
    { capability: 'User Management & Role Assignment', admin: true, manager: false, operator: false, auditor: false },
  ];

  return (
    <div className="space-y-6 font-mono text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-4 border-2 border-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-amber-400 uppercase flex items-center gap-2">
            <Settings className="w-5 h-5 text-amber-400" />
            Tenant Security, RBAC & User Permissions Hub
          </h2>
          <p className="text-slate-300 text-xs mt-1">
            Row-Level Security Context • Multi-User RBAC • Tenant: <strong className="text-white">{activeTenant.name}</strong> ({activeTenant.id})
          </p>
        </div>
      </div>

      {/* Role Context Switcher Workbench */}
      <div className="bg-white border-2 border-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
          <h3 className="font-black text-slate-900 uppercase text-sm flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-indigo-600" />
            <span>Simulate Active RBAC Role Session Context</span>
          </h3>
          <span className="px-2 py-0.5 bg-emerald-300 border border-slate-900 font-black uppercase text-[10px] text-slate-950">
            ACTIVE ROLE: {currentRole}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { role: 'ADMIN', label: 'Platform Admin', desc: 'Full write, API key rotation, tenant onboarding & RBAC user control' },
            { role: 'INTEGRATION_MANAGER', label: 'Integration Mgr', desc: 'Connector setup, field mapping, rules & queue retries' },
            { role: 'OPERATOR', label: 'Operations Tech', desc: 'Invoice ingestion, manual error recovery & job retries' },
            { role: 'AUDITOR', label: 'Regulatory Auditor', desc: 'Read-only compliance audit trail inspection & SHA-256 hash verify' }
          ].map((r) => (
            <button
              key={r.role}
              onClick={() => setCurrentRole(r.role as any)}
              className={`p-3 border-2 border-slate-900 text-left space-y-1 cursor-pointer transition-all ${
                currentRole === r.role ? 'bg-slate-900 text-amber-400 shadow-md' : 'bg-slate-50 hover:bg-slate-100 text-slate-900'
              }`}
            >
              <div className="font-black uppercase text-xs flex items-center justify-between">
                <span>{r.label}</span>
                {currentRole === r.role && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />}
              </div>
              <div className={`text-[10px] ${currentRole === r.role ? 'text-slate-300' : 'text-slate-600'}`}>{r.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* User Permissions & Directory Section */}
      <div className="bg-white border-2 border-slate-900 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-slate-900 pb-3">
          <div>
            <h3 className="font-black text-slate-900 uppercase text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-600" />
              <span>Tenant User Directory & Access Management</span>
            </h3>
            <p className="text-[11px] text-slate-600 mt-0.5">Manage user access, role assignments, and MFA enforcement policies.</p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search team members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 border-2 border-slate-900 text-xs font-bold focus:outline-none w-48"
              />
            </div>
            
            {currentRole === 'ADMIN' ? (
              <button
                onClick={() => setIsAddUserOpen(true)}
                className="px-3 py-1.5 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black uppercase border-2 border-slate-900 cursor-pointer flex items-center gap-1 shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>+ Invite User</span>
              </button>
            ) : (
              <span className="px-2 py-1 bg-slate-100 text-slate-500 border border-slate-300 text-[10px] font-bold">
                Admin required to invite
              </span>
            )}
          </div>
        </div>

        {/* User Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-amber-400 font-black uppercase text-[10px] border-b-2 border-slate-900">
                <th className="p-3">User Name & Email</th>
                <th className="p-3">Assigned Role</th>
                <th className="p-3">MFA Enforced</th>
                <th className="p-3">Last Active</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-100 font-mono text-slate-900">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="p-3">
                    <div className="font-black text-slate-900">{user.name}</div>
                    <div className="text-[10px] text-slate-500">{user.email}</div>
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 bg-slate-100 border border-slate-900 font-black uppercase text-[10px]">
                      {user.role}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-slate-700">
                    <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px]">
                      {user.mfaStatus}
                    </span>
                  </td>
                  <td className="p-3 text-slate-600">{user.lastActive}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase border ${
                      user.status === 'ACTIVE' ? 'bg-emerald-300 text-slate-950 border-slate-900' :
                      user.status === 'INVITED' ? 'bg-amber-300 text-slate-950 border-slate-900' :
                      'bg-red-400 text-white border-slate-900'
                    }`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {currentRole === 'ADMIN' ? (
                      <button
                        onClick={() => handleToggleUserStatus(user.id)}
                        className="px-2 py-1 bg-slate-900 text-amber-400 font-black text-[10px] uppercase border border-slate-900 hover:bg-slate-800 cursor-pointer"
                      >
                        {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-400">Read-Only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Capabilities & Access Matrix */}
      <div className="bg-white border-2 border-slate-900 p-5 space-y-4">
        <h3 className="font-black text-slate-900 uppercase text-sm border-b-2 border-slate-900 pb-2 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-indigo-600" />
          <span>Detailed Role Capabilities & Permissions Matrix</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-amber-400 font-black uppercase text-[10px] border-b-2 border-slate-900">
                <th className="p-3">Functional Capability</th>
                <th className="p-3 text-center">Admin</th>
                <th className="p-3 text-center">Integration Manager</th>
                <th className="p-3 text-center">Operations Tech</th>
                <th className="p-3 text-center">Auditor</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-100 font-mono text-slate-900">
              {permissionsMatrix.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-3 font-bold text-slate-800">{item.capability}</td>
                  <td className="p-3 text-center">
                    {item.admin ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" /> : <XCircle className="w-4 h-4 text-slate-300 mx-auto" />}
                  </td>
                  <td className="p-3 text-center">
                    {item.manager ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" /> : <XCircle className="w-4 h-4 text-slate-300 mx-auto" />}
                  </td>
                  <td className="p-3 text-center">
                    {item.operator ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" /> : <XCircle className="w-4 h-4 text-slate-300 mx-auto" />}
                  </td>
                  <td className="p-3 text-center">
                    {item.auditor ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" /> : <XCircle className="w-4 h-4 text-slate-300 mx-auto" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gateway Configuration & Policies Form */}
      <div className="bg-white border-2 border-slate-900 p-5 space-y-5">
        <h3 className="font-black text-slate-900 uppercase text-sm border-b-2 border-slate-900 pb-2 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-amber-600" />
          <span>Tenant Gateway & Retry Policies</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block font-black text-slate-900 uppercase mb-1">CittaEFS Gateway REST Endpoint URL</label>
            <input
              type="text"
              value={cittaEndpoint}
              disabled={currentRole === 'AUDITOR'}
              onChange={(e) => setCittaEndpoint(e.target.value)}
              className="w-full px-3 py-2 border-2 border-slate-900 font-mono text-slate-900 font-bold focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>

          <div>
            <label className="block font-black text-slate-900 uppercase mb-1">CittaEFS Gateway API Key (Tenant Secret)</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={currentRole === 'ADMIN' ? apiKey : '••••••••••••••••••••••••••••'}
                readOnly
                className="w-full px-3 py-2 border-2 border-slate-900 bg-slate-100 font-mono text-slate-900 font-bold"
              />
              <button
                onClick={handleRotateKey}
                disabled={currentRole !== 'ADMIN'}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black uppercase border-2 border-slate-900 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Rotate Key
              </button>
            </div>
            {currentRole !== 'ADMIN' && (
              <span className="text-[10px] text-red-600 font-bold block mt-1">
                * Secret key masked. Admin role required to view or rotate API credentials.
              </span>
            )}
          </div>

          <div>
            <label className="block font-black text-slate-900 uppercase mb-1">BullMQ Exponential Backoff Retries</label>
            <select
              value={retryMax}
              disabled={currentRole === 'AUDITOR'}
              onChange={(e) => setRetryMax(Number(e.target.value))}
              className="w-full px-3 py-2 border-2 border-slate-900 font-bold bg-white focus:outline-none disabled:bg-slate-100"
            >
              <option value={3}>3 Retries (5s, 30s, 2m)</option>
              <option value={5}>5 Retries (5s, 30s, 2m, 10m, 30m) - Recommended</option>
              <option value={10}>10 Retries (High Tolerance)</option>
            </select>
          </div>

          <div>
            <label className="block font-black text-slate-900 uppercase mb-1">Timestamp Serialization Format</label>
            <select
              value={timeZone}
              disabled={currentRole === 'AUDITOR'}
              onChange={(e) => setTimeZone(e.target.value)}
              className="w-full px-3 py-2 border-2 border-slate-900 font-bold bg-white focus:outline-none disabled:bg-slate-100"
            >
              <option value="UTC (ISO-8601)">UTC ISO-8601 (YYYY-MM-DDTHH:mm:ssZ) - Required by NRS</option>
              <option value="Local EAT (UTC+3)">Local EAT (UTC+3)</option>
            </select>
          </div>
        </div>

        <div className="pt-3 border-t-2 border-slate-900 flex justify-end">
          <button
            onClick={handleSaveSettings}
            disabled={currentRole === 'AUDITOR'}
            className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black uppercase border-2 border-slate-900 cursor-pointer flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4 text-amber-400" />
            <span>{isSaved ? 'Settings Saved!' : 'Save Security & Retry Policy'}</span>
          </button>
        </div>
      </div>

      {/* Invite User Modal */}
      {isAddUserOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border-4 border-slate-900 w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center border-b-2 border-slate-900 pb-3">
              <h3 className="font-black text-slate-900 uppercase text-sm flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-amber-600" />
                <span>Invite New Team Member</span>
              </h3>
              <button 
                onClick={() => setIsAddUserOpen(false)}
                className="font-black text-slate-900 hover:text-red-600 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. David Miller"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 font-bold focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. d.miller@company.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 font-bold focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">Assign Role</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full px-3 py-2 border-2 border-slate-900 font-bold bg-white focus:outline-none"
                >
                  <option value="ADMIN">Platform Admin</option>
                  <option value="INTEGRATION_MANAGER">Integration Manager</option>
                  <option value="OPERATOR">Operations Tech</option>
                  <option value="AUDITOR">Regulatory Auditor</option>
                </select>
              </div>

              <div className="p-3 bg-amber-50 border-2 border-amber-300 text-[10px] text-amber-900 space-y-1">
                <strong>Security Policy Note:</strong>
                <p>An automated invitation link with enforced 2FA setup will be dispatched to the provided email.</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-900 font-black uppercase border-2 border-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black uppercase border-2 border-slate-900 cursor-pointer"
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

