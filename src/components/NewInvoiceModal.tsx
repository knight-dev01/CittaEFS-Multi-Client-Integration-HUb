import React, { useState, FormEvent } from 'react';
import { useHub } from '../lib/store';
import { CITTA_HS_CODES_REFERENCE, CITTA_SERVICE_CODES_REFERENCE } from '../data/referenceData';
import { Send, Plus, Trash2, X, AlertCircle, CheckCircle2 } from 'lucide-react';

interface NewInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewInvoiceModal({ isOpen, onClose }: NewInvoiceModalProps) {
  const { activeTenant, transmitInvoice } = useHub();

  const [invNum, setInvNum] = useState(`INV-TEST-${Math.floor(1000 + Math.random() * 9000)}`);
  const [kind, setKind] = useState<'B2B' | 'B2C'>('B2B');
  const [type, setType] = useState<'STANDARD' | 'CREDIT_NOTE' | 'DEBIT_NOTE'>('STANDARD');
  const [custName, setCustName] = useState('Zenith Logistics Ltd');
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsTransmitting(true);
    setResponseResult(null);

    const payload = {
      clientInvoiceNumber: invNum,
      invoiceKind: kind,
      invoiceType: type,
      issueDate: new Date().toISOString().substring(0, 10),
      customerCode: 'CUST-TEST-001',
      customerName: custName,
      customerTin: kind === 'B2B' ? custTin : undefined,
      lineItems
    };

    const result = await transmitInvoice(payload);
    setResponseResult(result);
    setIsTransmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4 overflow-y-auto font-mono">
      <div className="bg-white max-w-2xl w-full p-6 text-slate-900 space-y-4 border-4 border-slate-900 relative">
        
        <div className="flex items-center justify-between pb-3 border-b-2 border-slate-900">
          <div>
            <h3 className="text-base font-black text-slate-900 uppercase flex items-center gap-2">
              <Send className="w-5 h-5 text-amber-500" />
              Test Invoice Transmission Gateway
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Dispatches live payload to <code className="bg-slate-900 text-amber-400 px-1 py-0.5 font-mono">POST /api/integration/gen/invoices</code> for {activeTenant.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer font-black"
          >
            [X]
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-black text-slate-900 uppercase mb-1">Client Invoice # *</label>
              <input
                type="text"
                value={invNum}
                onChange={(e) => setInvNum(e.target.value)}
                className="w-full px-3 py-2 border-2 border-slate-900 font-mono font-bold text-slate-900 focus:outline-none uppercase"
                required
              />
            </div>

            <div>
              <label className="block font-black text-slate-900 uppercase mb-1">Invoice Kind *</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as any)}
                className="w-full px-3 py-2 border-2 border-slate-900 bg-white font-black text-slate-900 focus:outline-none uppercase cursor-pointer"
              >
                <option value="B2B">B2B (Corporate)</option>
                <option value="B2C">B2C (Retail)</option>
              </select>
            </div>

            <div>
              <label className="block font-black text-slate-900 uppercase mb-1">Document Type *</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="w-full px-3 py-2 border-2 border-slate-900 bg-white font-black text-slate-900 focus:outline-none uppercase cursor-pointer"
              >
                <option value="STANDARD">STANDARD</option>
                <option value="CREDIT_NOTE">CREDIT NOTE</option>
                <option value="DEBIT_NOTE">DEBIT NOTE</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-black text-slate-900 uppercase mb-1">Customer Name *</label>
              <input
                type="text"
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
                className="w-full px-3 py-2 border-2 border-slate-900 font-bold text-slate-900 focus:outline-none uppercase"
                required
              />
            </div>

            {kind === 'B2B' && (
              <div>
                <label className="block font-black text-slate-900 uppercase mb-1">Tax ID (TIN) *</label>
                <input
                  type="text"
                  value={custTin}
                  onChange={(e) => setCustTin(e.target.value)}
                  placeholder="e.g. P019283746Z"
                  className="w-full px-3 py-2 border-2 border-slate-900 font-mono font-bold text-slate-900 focus:outline-none uppercase"
                  required
                />
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="space-y-2 pt-2 border-t-2 border-slate-900">
            <div className="flex items-center justify-between">
              <span className="font-black uppercase text-slate-900">Invoice Line Items ({lineItems.length}):</span>
              <button
                type="button"
                onClick={handleAddLine}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black border border-slate-900 text-[11px] cursor-pointer inline-flex items-center space-x-1 uppercase"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item Line</span>
              </button>
            </div>

            {lineItems.map((item, idx) => (
              <div key={idx} className="p-3 bg-slate-100 border-2 border-slate-900 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div className="sm:col-span-1">
                    <label className="text-[10px] text-slate-900 font-black uppercase block">Item SKU</label>
                    <input
                      type="text"
                      value={item.itemCode}
                      onChange={(e) => handleLineChange(idx, 'itemCode', e.target.value)}
                      className="w-full px-2 py-1 border-2 border-slate-900 font-mono font-bold text-slate-900 uppercase"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] text-slate-900 font-black uppercase block">Description</label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => handleLineChange(idx, 'description', e.target.value)}
                      className="w-full px-2 py-1 border-2 border-slate-900 font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-900 font-black uppercase block">Unit Price (KES)</label>
                    <input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => handleLineChange(idx, 'unitPrice', Number(e.target.value))}
                      className="w-full px-2 py-1 border-2 border-slate-900 font-black text-slate-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                  <div>
                    <label className="text-[10px] text-slate-900 font-black uppercase block">Quantity</label>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => handleLineChange(idx, 'quantity', Number(e.target.value))}
                      className="w-full px-2 py-1 border-2 border-slate-900 font-black text-slate-900"
                    />
                  </div>

                  <div className="sm:col-span-2 flex items-center space-x-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-slate-900 font-black uppercase block">Compliance Code (hsOrServiceCode)</label>
                      <select
                        value={item.hsOrServiceCode}
                        onChange={(e) => handleLineChange(idx, 'hsOrServiceCode', e.target.value)}
                        className="w-full px-2 py-1 border-2 border-slate-900 bg-white text-[11px] font-mono font-bold text-slate-900 uppercase cursor-pointer"
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
                        className="p-1 bg-red-500 text-white hover:bg-red-600 cursor-pointer border border-slate-900 mt-4"
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
            <div className={`p-3 border-2 border-slate-900 text-xs space-y-1 ${
              responseResult.success ? 'bg-emerald-400 text-slate-950 font-black' : 'bg-red-500 text-white font-black'
            }`}>
              <div className="flex items-center space-x-1.5 font-black uppercase">
                {responseResult.success ? <CheckCircle2 className="w-4 h-4 text-slate-950" /> : <AlertCircle className="w-4 h-4 text-white" />}
                <span>{responseResult.message || 'Gateway Response Returned'}</span>
              </div>
              {responseResult.cittaResponse?.irn && (
                <p className="font-mono text-[11px]">IRN Assigned: <strong>{responseResult.cittaResponse.irn}</strong></p>
              )}
            </div>
          )}

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-900 font-black text-xs uppercase border-2 border-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isTransmitting}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black text-xs uppercase border-2 border-slate-900 cursor-pointer inline-flex items-center space-x-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isTransmitting ? 'Transmitting to Gateway...' : 'Transmit Invoice'}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
