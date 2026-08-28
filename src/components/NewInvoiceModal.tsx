import React, { useState, FormEvent } from 'react';
import { useHub } from '../lib/store';
import { CITTA_HS_CODES_REFERENCE, CITTA_SERVICE_CODES_REFERENCE } from '../data/referenceData';
import { InvoicePreview } from './InvoicePreview';
import { Send, Plus, Trash2, X, AlertCircle, CheckCircle2, Eye } from 'lucide-react';

interface NewInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewInvoiceModal({ isOpen, onClose }: NewInvoiceModalProps) {
  const { activeTenant, transmitInvoice } = useHub();

  const [invNum, setInvNum] = useState(`INV-TEST-${Math.floor(1000 + Math.random() * 9000)}`);
  const [kind, setKind] = useState<'B2B' | 'B2C' | 'B2G'>('B2B');
  const [type, setType] = useState<'STANDARD' | 'CREDIT_NOTE' | 'DEBIT_NOTE'>('STANDARD');
  const [custName, setCustName] = useState('');
  const [custTin, setCustTin] = useState('P019283746Z');

  const [lineItems, setLineItems] = useState([
    {
      itemCode: 'SKU-LAP-DELL15',
      description: 'Dell XPS 15 Business Laptop 32GB RAM',
      quantity: 1,
      unitPrice: 120000,
      vatRate: 16,
      hsOrServiceCode: 'HS-8471.30'
    }
  ]);

  const [isTransmitting, setIsTransmitting] = useState(false);
  const [responseResult, setResponseResult] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(false);

  if (!isOpen) return null;

  const handleAddLine = () => {
    setLineItems([
      ...lineItems,
      {
        itemCode: 'SKU-IT-ONBOARDING',
        description: 'Enterprise Cloud Setup Service',
        quantity: 1,
        unitPrice: 45000,
        vatRate: 16,
        hsOrServiceCode: 'SRV-7212.10'
      }
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  const handleLineChange = (idx: number, field: string, value: any) => {
    const updated = [...lineItems];
    (updated[idx] as any)[field] = value;
    setLineItems(updated);
  };

  const buildPayload = () => ({
    clientInvoiceNumber: invNum,
    invoiceKind: kind,
    invoiceType: type,
    issueDate: new Date().toISOString().substring(0, 10),
    customerCode: 'CUST-TEST-001',
    customerName: custName,
    customerTin: kind === 'B2B' || kind === 'B2G' ? custTin : undefined,
    lineItems,
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Validate required fields before preview
    if (!custName.trim()) {
      setResponseResult({ success: false, message: 'Customer Name is required.' });
      return;
    }
    if (lineItems.length === 0) {
      setResponseResult({ success: false, message: 'At least one line item is required.' });
      return;
    }
    setResponseResult(null);
    setShowPreview(true);
  };

  const handleConfirmTransmit = async () => {
    setIsTransmitting(true);
    setResponseResult(null);
    try {
      const result = await transmitInvoice(buildPayload());
      setResponseResult(result);
      setShowPreview(false);
    } catch (err: any) {
      setResponseResult({ success: false, message: err.message || 'Transmission failed.' });
      setShowPreview(false);
    } finally {
      setIsTransmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto font-sans text-xs">
      <div className="bg-white max-w-2xl w-full p-6 text-slate-900 space-y-4 rounded-2xl border border-slate-200 shadow-xl relative">

        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Send className="w-4 h-4 text-indigo-600" />
              Test Invoice Transmission Gateway
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Dispatches live payload to <code className="bg-slate-100 text-indigo-700 px-1.5 py-0.5 rounded font-mono text-[11px]">POST /api/integration/gen/invoices</code> for {activeTenant.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer font-medium p-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Client Invoice # *</label>
              <input
                type="text"
                value={invNum}
                onChange={(e) => setInvNum(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all uppercase"
                required
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Invoice Kind *</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as any)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
              >
                <option value="B2B">B2B (Corporate)</option>
                <option value="B2C">B2C (Retail)</option>
                <option value="B2G">B2G (Government)</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Document Type *</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg bg-white font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
              >
                <option value="STANDARD">STANDARD</option>
                <option value="CREDIT_NOTE">CREDIT NOTE</option>
                <option value="DEBIT_NOTE">DEBIT NOTE</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Customer Name *</label>
              <input
                type="text"
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                required
              />
            </div>

            {(kind === 'B2B' || kind === 'B2G') && (
              <div>
                <label className="block font-medium text-slate-700 mb-1">Tax ID (TIN) *</label>
                <input
                  type="text"
                  value={custTin}
                  onChange={(e) => setCustTin(e.target.value)}
                  placeholder="e.g. P019283746Z"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-lg font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all uppercase"
                  required
                />
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">Invoice Line Items ({lineItems.length}):</span>
              <button
                type="button"
                onClick={handleAddLine}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold border border-indigo-200 rounded-lg text-xs cursor-pointer inline-flex items-center space-x-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item Line</span>
              </button>
            </div>

            {lineItems.map((item, idx) => (
              <div key={idx} className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div className="sm:col-span-1">
                    <label className="text-[11px] text-slate-500 font-medium block mb-1">Item SKU</label>
                    <input
                      type="text"
                      value={item.itemCode}
                      onChange={(e) => handleLineChange(idx, 'itemCode', e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 uppercase"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] text-slate-500 font-medium block mb-1">Description</label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => handleLineChange(idx, 'description', e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium block mb-1">Unit Price (NGN)</label>
                    <input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => handleLineChange(idx, 'unitPrice', Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium block mb-1">Quantity</label>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => handleLineChange(idx, 'quantity', Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <div className="sm:col-span-2 flex items-center space-x-2">
                    <div className="flex-1">
                      <label className="text-[11px] text-slate-500 font-medium block mb-1">Compliance Code (hsOrServiceCode)</label>
                      <select
                        value={item.hsOrServiceCode}
                        onChange={(e) => handleLineChange(idx, 'hsOrServiceCode', e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs font-mono font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                      >
                        <option value="UNMAPPED">UNMAPPED (Trigger Pre-flight Error)</option>
                        <optgroup label="HS Codes">
                          {CITTA_HS_CODES_REFERENCE.map(c => (
                            <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Service Codes">
                          {CITTA_SERVICE_CODES_REFERENCE.map(s => (
                            <option key={s.code} value={s.code}>{s.code} - {s.name}</option>
                          ))}
                        </optgroup>
                      </select>
                    </div>

                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="p-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg cursor-pointer border border-rose-200 mt-5 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {responseResult && (
            <div className={`p-4 rounded-xl border text-xs space-y-1 shadow-sm ${responseResult.success ? 'bg-emerald-50 text-emerald-900 border-emerald-200 font-medium' : 'bg-rose-50 text-rose-900 border-rose-200 font-medium'
              }`}>
              <div className="flex items-center space-x-2 font-semibold">
                {responseResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
                <span>{responseResult.message || 'Gateway Response Returned'}</span>
              </div>
              {responseResult.cittaResponse?.irn && (
                <p className="font-mono text-xs">IRN Assigned: <strong className="text-slate-900">{responseResult.cittaResponse.irn}</strong></p>
              )}
            </div>
          )}

          <div className="pt-3 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-2 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview Invoice</span>
            </button>
          </div>

        </form>

        {/* Preview Overlay — shows everything before CittaEFS send */}
        {showPreview && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-slate-50 max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-4 my-8">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Confirm Invoice Transmission</h3>
                <button onClick={() => setShowPreview(false)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
              <InvoicePreview
                clientInvoiceNumber={invNum}
                invoiceKind={kind}
                invoiceType={type}
                issueDate={new Date().toISOString().substring(0, 10)}
                customerName={custName || '— (enter customer name)'}
                customerTin={kind === 'B2B' || kind === 'B2G' ? custTin : undefined}
                lineItems={lineItems}
                tenantName={activeTenant.name}
                onEdit={() => setShowPreview(false)}
                onConfirm={handleConfirmTransmit}
                isProcessing={isTransmitting}
                warnings={[
                  !custName.trim() ? 'Customer Name is empty — will be rejected by gateway.' : '',
                  invNum.trim().length < 3 ? 'Invoice number looks too short.' : '',
                ].filter(Boolean) as string[]}
              />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
