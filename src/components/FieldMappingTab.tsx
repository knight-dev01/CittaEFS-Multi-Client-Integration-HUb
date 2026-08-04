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
    <div className="space-y-6 font-sans text-xs">
      
      {/* Top Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            Visual Field Mapping & Rule Engine Mapper
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Configures client ERP schema transformations to official NRS taxonomy specifications • Workspace: <strong className="text-white font-medium">{activeTenant.name}</strong>
          </p>
        </div>
        <button
          onClick={autoMapItems}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-2 shrink-0 transition-colors"
        >
          <Sparkles className="w-4 h-4 text-emerald-200" />
          <span>Auto-Infer HS/Service Codes</span>
        </button>
      </div>

      {/* Field Mapper Workbench */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm">
        <h3 className="font-bold text-slate-900 text-sm border-b border-slate-100 pb-3 flex items-center gap-2">
          <Code2 className="w-4 h-4 text-indigo-600" />
          <span>Define Schema Transformation Rule</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block font-medium text-slate-700 mb-1">1. Client ERP Field</label>
            <input
              type="text"
              value={clientField}
              onChange={(e) => setClientField(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              placeholder="e.g. LineItem.ProductSKU"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">2. Transformation Rule</label>
            <select
              value={transformation}
              onChange={(e) => setTransformation(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
            >
              <option value="MAP_TO_HS_CODE">Map to Harmonized System (HS) Code</option>
              <option value="MAP_TO_SERVICE_CODE">Map to Service Code</option>
              <option value="MAP_PERCENTAGE_16">VAT Percentage (16.00%)</option>
              <option value="TRIM_AND_UPPERCASE">Trim Whitespace & Uppercase</option>
              <option value="CONVERT_ISO_8601_UTC">Convert Date to ISO-8601 UTC</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">3. Target NRS Code / Value</label>
            <input
              type="text"
              value={nrsTargetCode}
              onChange={(e) => setNrsTargetCode(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              placeholder="e.g. HS-8471.30.00"
            />
          </div>

          <div>
            <button
              onClick={handleAddRule}
              className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm cursor-pointer flex items-center justify-center space-x-1.5 transition-colors"
            >
              {isSaved ? <Check className="w-4 h-4 text-emerald-300" /> : <Plus className="w-4 h-4 text-indigo-200" />}
              <span>{isSaved ? 'Rule Added!' : 'Add Mapping Rule'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Rules Matrix Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm">
        <div className="p-4 bg-slate-50 border-b border-slate-100 font-bold text-slate-900 flex justify-between items-center">
          <span>Active Transformation Rules Matrix ({fieldRules.length})</span>
          <span className="text-xs text-slate-500 font-normal">Strict pre-flight schema enforcement</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-700">
            <thead>
              <tr className="bg-slate-100/70 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-4">Rule ID</th>
                <th className="py-3 px-4">Client ERP Field</th>
                <th className="py-3 px-4">Target Field</th>
                <th className="py-3 px-4">Transformation</th>
                <th className="py-3 px-4">Default Value</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fieldRules.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-mono font-medium text-slate-400">{r.id}</td>
                  <td className="py-3 px-4 font-mono font-semibold text-indigo-600">{r.clientField}</td>
                  <td className="py-3 px-4 font-mono font-medium text-slate-900">{r.targetField}</td>
                  <td className="py-3 px-4">
                    <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-semibold rounded-full">
                      {r.rule}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono font-medium text-emerald-600">{r.defaultValue}</td>
                  <td className="py-3 px-4">
                    <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold rounded-full">
                      {r.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setFieldRules(fieldRules.filter(x => x.id !== r.id))}
                      className="text-rose-600 hover:text-rose-700 font-medium cursor-pointer"
                    >
                      Delete
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
