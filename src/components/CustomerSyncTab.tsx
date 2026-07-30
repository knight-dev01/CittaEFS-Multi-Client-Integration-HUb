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
    <div className="space-y-6 font-mono">
      
      {/* Header Banner */}
      <div className="bg-white p-4 border-2 border-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-amber-400 border border-slate-900 text-slate-950">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase">
              {activeTenant.name} Customer Directory
            </h3>
            <p className="text-xs text-slate-600">
              Automates B2B TIN Validation, <strong className="text-slate-900 font-black">customerCode</strong> mapping & B2C profile rules
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-3 py-1.5 bg-slate-900 border-2 border-slate-900 text-amber-400 font-black text-xs hover:bg-slate-800 transition cursor-pointer inline-flex items-center space-x-1 uppercase"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Sync New Customer</span>
        </button>

      </div>

      {/* Rules Information Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border-2 border-slate-900 p-4 text-xs space-y-1">
          <div className="flex items-center space-x-1.5 font-black text-slate-900 uppercase">
            <Building2 className="w-4 h-4 text-amber-500" />
            <span>B2B Customer Protocol:</span>
          </div>
          <p className="text-slate-700">
            Requires validated Tax Identification Number (TIN), official billing address, and unique <code className="bg-slate-900 text-amber-400 px-1 py-0.5 font-mono">customerCode</code>.
          </p>
        </div>

        <div className="bg-white border-2 border-slate-900 p-4 text-xs space-y-1">
          <div className="flex items-center space-x-1.5 font-black text-slate-900 uppercase">
            <UserCheck className="w-4 h-4 text-emerald-600" />
            <span>B2C Over-The-Counter Protocol:</span>
          </div>
          <p className="text-slate-700">
            Automatically toggles <code className="bg-slate-900 text-emerald-400 px-1 py-0.5 font-mono">invoiceKind = "B2C"</code> and extracts dynamic <code className="bg-slate-900 text-emerald-400 px-1 py-0.5 font-mono">customerName</code> strings.
          </p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-900 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="SEARCH CUSTOMER NAME, CODE, OR TIN..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs border-2 border-slate-900 bg-white font-bold focus:outline-none uppercase text-slate-900"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-900">
          <span className="font-black uppercase">Profile Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-white border-2 border-slate-900 px-2.5 py-1.5 text-xs text-slate-900 font-black uppercase focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Profiles</option>
            <option value="B2B">B2B Corporate Clients</option>
            <option value="B2C">B2C Retail / Walk-in</option>
          </select>
        </div>

      </div>

      {/* Customer Directory Table */}
      <div className="bg-white border-2 border-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-900">
            <thead>
              <tr className="bg-slate-100 text-slate-900 uppercase text-[10px] tracking-wider border-b-2 border-slate-900">
                <th className="py-2.5 px-3 border-r border-slate-300">Client Code</th>
                <th className="py-2.5 px-3 border-r border-slate-300">CittaEFS Code</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Customer Name</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Tax ID (TIN)</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Kind</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Billing Address</th>
                <th className="py-2.5 px-3 border-r border-slate-300">TIN Validation</th>
                <th className="py-2.5 px-3 text-right">Last Synced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-900 font-black uppercase">
                    No customers match your search query.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-100 transition">
                    <td className="py-3 px-3 font-mono font-black text-slate-900 border-r border-slate-200">{c.clientCustomerCode}</td>
                    <td className="py-3 px-3 font-mono text-[10px] text-slate-900 font-black border-r border-slate-200">{c.cittaCustomerCode}</td>
                    <td className="py-3 px-3 font-black text-slate-900 border-r border-slate-200">{c.name}</td>
                    <td className="py-3 px-3 font-mono font-black text-slate-900 border-r border-slate-200">{c.tin}</td>
                    <td className="py-3 px-3 border-r border-slate-200">
                      <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black border border-slate-900 uppercase ${
                        c.isB2B ? 'bg-slate-900 text-amber-400' : 'bg-emerald-400 text-slate-950'
                      }`}>
                        {c.isB2B ? 'B2B Corporate' : 'B2C Retail'}
                      </span>
                    </td>
                    <td className="py-3 px-3 max-w-xs truncate text-slate-700 font-medium border-r border-slate-200" title={c.address}>
                      {c.address}
                    </td>
                    <td className="py-3 px-3 border-r border-slate-200">
                      <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black border border-slate-900 uppercase ${
                        c.tinValidationStatus === 'VALIDATED' ? 'bg-emerald-400 text-slate-950' : 'bg-red-500 text-white'
                      }`}>
                        {c.tinValidationStatus === 'VALIDATED' ? (
                          <ShieldCheck className="w-3 h-3 mr-1 text-slate-950" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 mr-1 text-white" />
                        )}
                        {c.tinValidationStatus}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-[10px] text-slate-600 font-bold">
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
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-slate-900 max-w-md w-full p-6 text-slate-900 space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-900">
              <h3 className="text-sm font-black text-slate-900 uppercase flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-500" />
                Sync New Customer Profile
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer font-black"
              >
                [CANCEL]
              </button>
            </div>

            <div className="space-y-3 text-xs">
              
              <div className="flex items-center space-x-4 bg-slate-100 p-2.5 border-2 border-slate-900 font-black uppercase">
                <label className="flex items-center space-x-1.5 cursor-pointer text-slate-900">
                  <input
                    type="radio"
                    name="custKind"
                    checked={isB2B}
                    onChange={() => setIsB2B(true)}
                    className="accent-slate-900"
                  />
                  <span>B2B Corporate</span>
                </label>
                <label className="flex items-center space-x-1.5 cursor-pointer text-slate-900">
                  <input
                    type="radio"
                    name="custKind"
                    checked={!isB2B}
                    onChange={() => setIsB2B(false)}
                    className="accent-slate-900"
                  />
                  <span>B2C Retail Consumer</span>
                </label>
              </div>

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">
                  Customer / Company Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Zenith Logistics Ltd"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-bold text-slate-900 focus:outline-none uppercase"
                />
              </div>

              {isB2B && (
                <div>
                  <label className="block font-black text-slate-900 uppercase mb-1">
                    Tax Identification Number (TIN) *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. P051239841A"
                    value={tin}
                    onChange={(e) => setTin(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-mono font-bold text-slate-900 focus:outline-none uppercase"
                  />
                </div>
              )}

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">
                  Client System Code Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g. QBO-CUST-1092"
                  value={clientCode}
                  onChange={(e) => setClientCode(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-mono text-slate-900 focus:outline-none uppercase"
                />
              </div>

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">
                  Billing Address
                </label>
                <input
                  type="text"
                  placeholder="e.g. Plot 42, Industrial Avenue, Nairobi"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 text-xs text-slate-900 focus:outline-none"
                />
              </div>

            </div>

            <div className="pt-2 flex justify-end space-x-2">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-900 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCustomer}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer"
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
