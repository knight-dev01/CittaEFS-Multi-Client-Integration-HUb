import { useState } from 'react';
import { useHub } from '../lib/store';
import { 
  ArrowRight, 
  Layers, 
  Save, 
  Plus, 
  Trash2, 
  ShieldCheck, 
  Sparkles, 
  Check, 
  Code2, 
  Sliders
} from 'lucide-react';

export function FieldMappingTab() {
  const { itemMappings, addItemMapping, autoMapItems, activeTenant } = useHub();

  const [clientField, setClientField] = useState('LineItem.ProductSKU');
  const [transformation, setTransformation] = useState('MAP_TO_HS_CODE');
  const [nrsTargetCode, setNrsTargetCode] = useState('HS-8471.30.00');
  const [defaultVatRate, setDefaultVatRate] = useState(16);
  const [isSaved, setIsSaved] = useState(false);

  // Field Mapping Rules Matrix
  const [fieldRules, setFieldRules] = useState([
    {
      id: 'rule_01',
      clientField: 'Invoice.Header.CustomerTaxId',
      targetField: 'Customer.TaxIdentificationNumber',
      rule: 'TRIM_AND_UPPERCASE',
      defaultValue: 'AUTO_DOWNGRADE_TO_B2C',
      status: 'ACTIVE'
    },
    {
      id: 'rule_02',
      clientField: 'LineItem.SKU',
      targetField: 'InvoiceLineItem.HsOrServiceCode',
      rule: 'LOOKUP_DICTIONARY',
      defaultValue: 'ASSIGN_SERV_DEFAULT',
      status: 'ACTIVE'
    },
    {
      id: 'rule_03',
      clientField: 'LineItem.TaxCode',
      targetField: 'InvoiceLineItem.VatRate',
      rule: 'MAP_PERCENTAGE_16',
      defaultValue: '16.00',
      status: 'ACTIVE'
    },
    {
      id: 'rule_04',
      clientField: 'Invoice.TxnDate',
      targetField: 'Invoice.IssueDateUtc',
      rule: 'CONVERT_ISO_8601_UTC',
      defaultValue: 'CURRENT_TIMESTAMP',
      status: 'ACTIVE'
    }
  ]);

  const handleAddRule = () => {
    const newRule = {
      id: `rule_${Date.now()}`,
      clientField,
      targetField: transformation === 'MAP_TO_HS_CODE' ? 'InvoiceLineItem.HsOrServiceCode' : 'InvoiceLineItem.VatRate',
      rule: transformation,
      defaultValue: nrsTargetCode || 'SERV-DEFAULT',
      status: 'ACTIVE'
    };
    setFieldRules([newRule, ...fieldRules]);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="space-y-6 font-mono text-xs">
      
      {/* Top Banner */}
      <div className="bg-slate-900 text-white p-4 border-2 border-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-amber-400 uppercase flex items-center gap-2">
            <Sliders className="w-5 h-5 text-amber-400" />
            Visual Field Mapping & Rule Engine Mapper
          </h2>
          <p className="text-slate-300 text-xs mt-1">
            Configures client ERP schema transformations to official NRS taxonomy specifications • Tenant: <strong className="text-white">{activeTenant.name}</strong>
          </p>
        </div>
        <button
          onClick={autoMapItems}
          className="px-4 py-2 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black uppercase border-2 border-slate-900 cursor-pointer inline-flex items-center space-x-1.5"
        >
          <Sparkles className="w-4 h-4 text-slate-950" />
          <span>Auto-Infer HS/Service Codes</span>
        </button>
      </div>

      {/* Field Mapper Workbench */}
      <div className="bg-white border-2 border-slate-900 p-5 space-y-4">
        <h3 className="font-black text-slate-900 uppercase text-sm border-b-2 border-slate-900 pb-2 flex items-center gap-2">
          <Code2 className="w-4 h-4 text-indigo-600" />
          <span>Define Schema Transformation Rule</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block font-black text-slate-900 uppercase mb-1">1. Client ERP Field</label>
            <input
              type="text"
              value={clientField}
              onChange={(e) => setClientField(e.target.value)}
              className="w-full px-3 py-2 border-2 border-slate-900 font-mono text-slate-900 font-bold focus:outline-none"
              placeholder="e.g. LineItem.ProductSKU"
            />
          </div>

          <div>
            <label className="block font-black text-slate-900 uppercase mb-1">2. Transformation Rule</label>
            <select
              value={transformation}
              onChange={(e) => setTransformation(e.target.value)}
              className="w-full px-3 py-2 border-2 border-slate-900 font-bold bg-white focus:outline-none"
            >
              <option value="MAP_TO_HS_CODE">Map to Harmonized System (HS) Code</option>
              <option value="MAP_TO_SERVICE_CODE">Map to Service Code</option>
              <option value="MAP_PERCENTAGE_16">VAT Percentage (16.00%)</option>
              <option value="TRIM_AND_UPPERCASE">Trim Whitespace & Uppercase</option>
              <option value="CONVERT_ISO_8601_UTC">Convert Date to ISO-8601 UTC</option>
            </select>
          </div>

          <div>
            <label className="block font-black text-slate-900 uppercase mb-1">3. Target NRS Code / Value</label>
            <input
              type="text"
              value={nrsTargetCode}
              onChange={(e) => setNrsTargetCode(e.target.value)}
              className="w-full px-3 py-2 border-2 border-slate-900 font-mono text-slate-900 font-bold focus:outline-none"
              placeholder="e.g. HS-8471.30.00"
            />
          </div>

          <div>
            <button
              onClick={handleAddRule}
              className="w-full px-4 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black uppercase border-2 border-slate-900 cursor-pointer flex items-center justify-center space-x-1.5"
            >
              {isSaved ? <Check className="w-4 h-4 text-emerald-400" /> : <Plus className="w-4 h-4 text-amber-400" />}
              <span>{isSaved ? 'Rule Added!' : 'Add Mapping Rule'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Rules Matrix Table */}
      <div className="bg-white border-2 border-slate-900 overflow-hidden">
        <div className="p-3 bg-slate-100 border-b-2 border-slate-900 font-black uppercase text-slate-900 flex justify-between items-center">
          <span>Active Transformation Rules Matrix ({fieldRules.length})</span>
          <span className="text-[10px] text-slate-600 font-normal">Strict pre-flight schema enforcement</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-amber-400 font-black uppercase text-[10px] border-b-2 border-slate-900">
                <th className="p-3">Rule ID</th>
                <th className="p-3">Client ERP Field</th>
                <th className="p-3">Target Field</th>
                <th className="p-3">Transformation</th>
                <th className="p-3">Default Value</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-100 font-mono text-slate-900">
              {fieldRules.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="p-3 font-bold text-slate-600">{r.id}</td>
                  <td className="p-3 font-bold text-indigo-700">{r.clientField}</td>
                  <td className="p-3 font-bold text-slate-900">{r.targetField}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 bg-slate-200 border border-slate-800 text-[10px] font-black uppercase">
                      {r.rule}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-emerald-700">{r.defaultValue}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 bg-emerald-300 text-slate-950 border border-slate-900 text-[10px] font-black uppercase">
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => setFieldRules(fieldRules.filter(x => x.id !== r.id))}
                      className="text-red-600 hover:text-red-900 font-black uppercase cursor-pointer"
                    >
                      [Delete]
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
