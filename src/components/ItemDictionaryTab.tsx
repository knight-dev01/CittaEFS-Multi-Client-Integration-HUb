import { useState } from 'react';
import { useHub } from '../lib/store';
import { ItemCodeMapping } from '../types';
import { CITTA_HS_CODES_REFERENCE, CITTA_SERVICE_CODES_REFERENCE } from '../data/referenceData';
import { 
  BookOpen, 
  Search, 
  Plus, 
  Wand2, 
  CheckCircle2, 
  AlertCircle, 
  Tag, 
  Edit3, 
  Layers
} from 'lucide-react';

export function ItemDictionaryTab() {
  const { itemMappings, activeTenant, addItemMapping, autoMapItems } = useHub();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAutoMapping, setIsAutoMapping] = useState(false);

  // Form fields for new mapping
  const [sku, setSku] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState('General Merchandise');
  const [selectedCode, setSelectedCode] = useState('HS-8471.30');
  const [vatRate, setVatRate] = useState(activeTenant?.defaultVatRate ?? 7.5);

  const tenantMappings = itemMappings.filter(m => m.tenantId === activeTenant.id);

  const filteredMappings = tenantMappings.filter(m => {
    const matchesSearch = 
      m.clientSku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.hsOrServiceCode.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = filterStatus === 'ALL' || m.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const unmappedCount = tenantMappings.filter(m => m.status === 'UNMAPPED').length;

  const handleSaveMapping = async () => {
    if (!sku) return;

    const isService = selectedCode.startsWith('SRV');
    const refList = isService ? CITTA_SERVICE_CODES_REFERENCE : CITTA_HS_CODES_REFERENCE;
    const refObj = refList.find(r => r.code === selectedCode);

    await addItemMapping({
      clientSku: sku,
      description: desc || 'Item Description',
      category: category,
      hsOrServiceCode: selectedCode,
      codeType: isService ? 'SERVICE_CODE' : 'HS_CODE',
      codeDescription: refObj?.name || 'CittaEFS Mapped Code',
      defaultVatRate: vatRate,
      status: 'MAPPED'
    });

    setIsAddModalOpen(false);
    setSku('');
    setDesc('');
  };

  const handleAutoMap = async () => {
    setIsAutoMapping(true);
    await autoMapItems();
    setIsAutoMapping(false);
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Top Banner & Actions */}
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-500/20 rounded-lg text-indigo-400 border border-indigo-500/30">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight text-white">
              {activeTenant.name} Code Dictionary
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Maps internal client SKUs to official NRS Regulatory Codes (<strong className="text-slate-200 font-medium">hsOrServiceCode</strong>)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          
          {unmappedCount > 0 && (
            <button
              onClick={handleAutoMap}
              disabled={isAutoMapping}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center space-x-2 shrink-0"
            >
              <Wand2 className="w-4 h-4 text-emerald-200" />
              <span>{isAutoMapping ? 'Auto-Mapping...' : `Auto-Map ${unmappedCount} Unmapped SKUs`}</span>
            </button>
          )}

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center space-x-2 shrink-0"
          >
            <Plus className="w-4 h-4 text-indigo-200" />
            <span>Add Item Mapping</span>
          </button>

        </div>

      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-xl p-4 border border-slate-200/80 shadow-sm">
        
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search Client SKU, Description, or HS Code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-600">
          <span className="font-medium">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
          >
            <option value="ALL">All Items</option>
            <option value="MAPPED">MAPPED</option>
            <option value="UNMAPPED">UNMAPPED</option>
          </select>
        </div>

      </div>

      {/* Item Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-700">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-4">Client SKU</th>
                <th className="py-3 px-4">Item Description</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Regulatory Code (hsOrServiceCode)</th>
                <th className="py-3 px-4">Code Type</th>
                <th className="py-3 px-4">Default VAT</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMappings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 font-medium">
                    No SKU mappings found for this search filter.
                  </td>
                </tr>
              ) : (
                filteredMappings.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">{m.clientSku}</td>
                    <td className="py-3 px-4 max-w-xs truncate text-slate-600" title={m.description}>{m.description}</td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 text-[10px] bg-slate-100 text-slate-700 font-medium rounded-full border border-slate-200">
                        {m.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        m.status === 'UNMAPPED' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {m.hsOrServiceCode}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-[11px] text-slate-600">{m.codeType}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">{m.defaultVatRate}%</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        m.status === 'MAPPED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {m.status === 'MAPPED' ? <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> : <AlertCircle className="w-3 h-3 mr-1 text-amber-600" />}
                        {m.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[11px] text-slate-400">
                      {m.updatedAt}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD ITEM MAPPING MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 text-slate-900 space-y-5">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Tag className="w-4 h-4 text-indigo-600" />
                Add Client SKU Regulatory Mapping
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer font-medium"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Client Internal SKU / Item Code *
                </label>
                <input
                  type="text"
                  placeholder="e.g. SKU-LAP-DELL15"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-mono font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Item Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dell XPS 15 Business Laptop"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Regulatory Compliance Code (HS or Service Code) *
                </label>
                <select
                  value={selectedCode}
                  onChange={(e) => setSelectedCode(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-xs bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
                >
                  <optgroup label="Physical Goods (HS Codes)">
                    {CITTA_HS_CODES_REFERENCE.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.code} - {c.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Services (Service Codes)">
                    {CITTA_SERVICE_CODES_REFERENCE.map(s => (
                      <option key={s.code} value={s.code}>
                        {s.code} - {s.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Default VAT Classification Rate (%)
                </label>
                <input
                  type="number"
                  value={vatRate}
                  onChange={(e) => setVatRate(Number(e.target.value))}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
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
                onClick={handleSaveMapping}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors"
              >
                Save Item Mapping
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
