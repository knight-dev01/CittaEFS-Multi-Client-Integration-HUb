import { useState } from 'react';
import { useHub } from '../lib/store';
import { CustomerProfile } from '../types';
import { 
  Users, 
  Search, 
  Plus, 
  CheckCircle2, 
  AlertTriangle, 
  Building2, 
  UserCheck, 
  Mail, 
  Phone, 
  MapPin,
  ShieldCheck
} from 'lucide-react';

export function CustomerSyncTab() {
  const { customers, activeTenant, addCustomer } = useHub();

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Form
  const [name, setName] = useState('');
  const [tin, setTin] = useState('P019283746Z');
  const [isB2B, setIsB2B] = useState(true);
  const [clientCode, setClientCode] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');

  const tenantCustomers = customers.filter(c => c.tenantId === activeTenant.id);

  const filteredCustomers = tenantCustomers.filter(c => {
    const matchesSearch = 
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.tin.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.clientCustomerCode.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = 
      typeFilter === 'ALL' || 
      (typeFilter === 'B2B' && c.isB2B) || 
      (typeFilter === 'B2C' && !c.isB2B);

    return matchesSearch && matchesType;
  });

  const handleSaveCustomer = async () => {
    if (!name) return;

    await addCustomer({
      name,
      tin: isB2B ? tin : 'N/A',
      isB2B,
      clientCustomerCode: clientCode || `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      email: email || 'contact@client.com',
      address: address || 'Nairobi Business District',
      city: 'Nairobi',
      phone: '+254700000000'
    });

    setIsAddModalOpen(false);
    setName('');
    setClientCode('');
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-500/20 rounded-lg text-indigo-400 border border-indigo-500/30">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight text-white">
              {activeTenant.name} Customer Directory
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Automates B2B TIN Validation, <strong className="text-slate-200 font-medium">customerCode</strong> mapping & B2C profile rules
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center space-x-2 shrink-0"
        >
          <Plus className="w-4 h-4 text-indigo-200" />
          <span>Sync New Customer</span>
        </button>

      </div>

      {/* Rules Information Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 text-xs space-y-1.5 shadow-sm">
          <div className="flex items-center space-x-2 font-semibold text-slate-900">
            <Building2 className="w-4 h-4 text-amber-500" />
            <span>B2B Customer Protocol:</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            Requires validated Tax Identification Number (TIN), official billing address, and unique <code className="bg-slate-100 text-indigo-700 rounded px-1.5 py-0.5 font-mono text-[11px]">customerCode</code>.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-5 text-xs space-y-1.5 shadow-sm">
          <div className="flex items-center space-x-2 font-semibold text-slate-900">
            <UserCheck className="w-4 h-4 text-emerald-600" />
            <span>B2C Over-The-Counter Protocol:</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            Automatically toggles <code className="bg-slate-100 text-emerald-700 rounded px-1.5 py-0.5 font-mono text-[11px]">invoiceKind = "B2C"</code> and extracts dynamic <code className="bg-slate-100 text-emerald-700 rounded px-1.5 py-0.5 font-mono text-[11px]">customerName</code> strings.
          </p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-xl p-4 border border-slate-200/80 shadow-sm">
        
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search Customer Name, Code, or TIN..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-600">
          <span className="font-medium">Profile Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
          >
            <option value="ALL">All Profiles</option>
            <option value="B2B">B2B Corporate Clients</option>
            <option value="B2C">B2C Retail / Walk-in</option>
          </select>
        </div>

      </div>

      {/* Customer Directory Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-700">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-4">Client Code</th>
                <th className="py-3 px-4">CittaEFS Code</th>
                <th className="py-3 px-4">Customer Name</th>
                <th className="py-3 px-4">Tax ID (TIN)</th>
                <th className="py-3 px-4">Kind</th>
                <th className="py-3 px-4">Billing Address</th>
                <th className="py-3 px-4">TIN Validation</th>
                <th className="py-3 px-4 text-right">Last Synced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 font-medium">
                    No customers match your search query.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">{c.clientCustomerCode}</td>
                    <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">{c.cittaCustomerCode}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">{c.name}</td>
                    <td className="py-3 px-4 font-mono text-slate-600">{c.tin}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        c.isB2B ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {c.isB2B ? 'B2B Corporate' : 'B2C Retail'}
                      </span>
                    </td>
                    <td className="py-3 px-4 max-w-xs truncate text-slate-500" title={c.address}>
                      {c.address}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        c.tinValidationStatus === 'VALIDATED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>
                        {c.tinValidationStatus === 'VALIDATED' ? (
                          <ShieldCheck className="w-3 h-3 mr-1 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 mr-1 text-rose-600" />
                        )}
                        {c.tinValidationStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[11px] text-slate-400">
                      {c.lastSyncedAt}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD CUSTOMER MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 text-slate-900 space-y-5">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                Sync New Customer Profile
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer font-medium"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-4 text-xs">
              
              <div className="flex items-center space-x-4 bg-slate-50 p-3 rounded-xl border border-slate-200/80 font-medium">
                <label className="flex items-center space-x-2 cursor-pointer text-slate-800">
                  <input
                    type="radio"
                    name="custKind"
                    checked={isB2B}
                    onChange={() => setIsB2B(true)}
                    className="accent-indigo-600"
                  />
                  <span>B2B Corporate</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer text-slate-800">
                  <input
                    type="radio"
                    name="custKind"
                    checked={!isB2B}
                    onChange={() => setIsB2B(false)}
                    className="accent-indigo-600"
                  />
                  <span>B2C Retail Consumer</span>
                </label>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Customer / Company Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Zenith Logistics Ltd"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              {isB2B && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Tax Identification Number (TIN) *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. P051239841A"
                    value={tin}
                    onChange={(e) => setTin(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Client System Code Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g. QBO-CUST-1092"
                  value={clientCode}
                  onChange={(e) => setClientCode(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Billing Address
                </label>
                <input
                  type="text"
                  placeholder="e.g. Plot 42, Industrial Avenue, Nairobi"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

            </div>

            <div className="pt-2 flex justify-end space-x-2">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCustomer}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors"
              >
                Save Customer Profile
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
