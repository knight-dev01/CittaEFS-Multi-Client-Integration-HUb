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
  const [vatRate, setVatRate] = useState(16);

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
    <div className="space-y-6 font-mono">
      
      {/* Top Banner & Actions */}
      <div className="bg-white p-4 border-2 border-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-amber-400 border border-slate-900 text-slate-950">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase">
              {activeTenant.name} Code Dictionary
            </h3>
            <p className="text-xs text-slate-600">
              Maps internal client SKUs to official NRS Regulatory Codes (<strong className="text-slate-900 font-black">hsOrServiceCode</strong>)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          
          {unmappedCount > 0 && (
            <button
              onClick={handleAutoMap}
              disabled={isAutoMapping}
              className="px-3 py-1.5 bg-amber-400 border-2 border-slate-900 text-slate-950 font-black text-xs hover:bg-amber-300 transition cursor-pointer inline-flex items-center space-x-1 uppercase"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>{isAutoMapping ? 'Auto-Mapping...' : `Auto-Map ${unmappedCount} Unmapped SKUs`}</span>
            </button>
          )}

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-3 py-1.5 bg-slate-900 border-2 border-slate-900 text-amber-400 font-black text-xs hover:bg-slate-800 transition cursor-pointer inline-flex items-center space-x-1 uppercase"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Item Mapping</span>
          </button>

        </div>

      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-900 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="SEARCH CLIENT SKU, DESCRIPTION, OR HS CODE..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs border-2 border-slate-900 bg-white font-bold focus:outline-none uppercase text-slate-900"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-900">
          <span className="font-black uppercase">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-white border-2 border-slate-900 px-2.5 py-1.5 text-xs text-slate-900 font-black uppercase focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Items</option>
            <option value="MAPPED">MAPPED</option>
            <option value="UNMAPPED">UNMAPPED</option>
          </select>
        </div>

      </div>

      {/* Item Table */}
      <div className="bg-white border-2 border-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-900">
            <thead>
              <tr className="bg-slate-100 text-slate-900 uppercase text-[10px] tracking-wider border-b-2 border-slate-900">
                <th className="py-2.5 px-3 border-r border-slate-300">Client SKU</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Item Description</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Category</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Regulatory Code (hsOrServiceCode)</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Code Type</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Default VAT</th>
                <th className="py-2.5 px-3 border-r border-slate-300">Status</th>
                <th className="py-2.5 px-3 text-right">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {filteredMappings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-900 font-black uppercase">
                    No SKU mappings found for this search filter.
                  </td>
                </tr>
              ) : (
                filteredMappings.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-100 transition">
                    <td className="py-3 px-3 font-mono font-black text-slate-900 border-r border-slate-200">{m.clientSku}</td>
                    <td className="py-3 px-3 max-w-xs truncate border-r border-slate-200" title={m.description}>{m.description}</td>
                    <td className="py-3 px-3 border-r border-slate-200">
                      <span className="px-2 py-0.5 text-[10px] bg-slate-900 font-black text-white uppercase">
                        {m.category}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono border-r border-slate-200">
                      <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black border border-slate-900 uppercase ${
                        m.status === 'UNMAPPED' ? 'bg-red-500 text-white' : 'bg-emerald-400 text-slate-950'
                      }`}>
                        {m.hsOrServiceCode}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-black text-[10px] text-slate-900 border-r border-slate-200">{m.codeType}</td>
                    <td className="py-3 px-3 font-black text-slate-900 border-r border-slate-200">{m.defaultVatRate}%</td>
                    <td className="py-3 px-3 border-r border-slate-200">
                      <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-black border border-slate-900 uppercase ${
                        m.status === 'MAPPED' ? 'bg-emerald-400 text-slate-950' : 'bg-amber-400 text-slate-950'
                      }`}>
                        {m.status === 'MAPPED' ? <CheckCircle2 className="w-3 h-3 mr-1 text-slate-950" /> : <AlertCircle className="w-3 h-3 mr-1 text-slate-950" />}
                        {m.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-[10px] text-slate-600 font-bold">
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
        <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-slate-900 max-w-md w-full p-6 text-slate-900 space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-900">
              <h3 className="text-sm font-black text-slate-900 uppercase flex items-center gap-2">
                <Tag className="w-4 h-4 text-amber-500" />
                Add Client SKU Regulatory Mapping
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer font-black"
              >
                [CANCEL]
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">
                  Client Internal SKU / Item Code *
                </label>
                <input
                  type="text"
                  placeholder="e.g. SKU-LAP-DELL15"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-mono font-bold focus:outline-none uppercase"
                />
              </div>

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">
                  Item Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dell XPS 15 Business Laptop"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">
                  Regulatory Compliance Code (HS or Service Code) *
                </label>
                <select
                  value={selectedCode}
                  onChange={(e) => setSelectedCode(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-slate-900 text-xs bg-white font-black text-slate-900 focus:outline-none"
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
                <label className="block font-black text-slate-900 uppercase mb-1">
                  Default VAT Classification Rate (%)
                </label>
                <input
                  type="number"
                  value={vatRate}
                  onChange={(e) => setVatRate(Number(e.target.value))}
                  className="w-full px-3 py-2 border-2 border-slate-900 text-xs font-black text-slate-900 focus:outline-none"
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
                onClick={handleSaveMapping}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-black uppercase border-2 border-slate-900 cursor-pointer"
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
