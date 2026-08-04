import { useState, ChangeEvent } from 'react';
import { useHub } from '../lib/store';
import * as XLSX from 'xlsx';
import { 
  Building2, 
  FileSpreadsheet, 
  Zap, 
  Send, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Upload, 
  RefreshCw, 
  ExternalLink, 
  FileText,
  ShieldCheck,
  Search,
  CheckSquare,
  Square,
  ArrowRight
} from 'lucide-react';
import { Invoice } from '../types';

export function ClientPortalTab() {
  const { 
    activeTenant, 
    invoices, 
    transmitInvoice, 
    ingestCsvInvoices, 
    refreshAll,
    isBgRefreshing 
  } = useHub();

  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'QBO' | 'EXCEL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [transmissionSuccessMsg, setTransmissionSuccessMsg] = useState<string | null>(null);
  const [transmissionErrorMsg, setTransmissionErrorMsg] = useState<string | null>(null);

  // Excel File Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadLog, setUploadLog] = useState<string | null>(null);

  const themeConfig: any = {
    'QuickBooks Online': {
      bg: 'bg-emerald-800',
      text: 'text-white',
      accent: 'text-emerald-300',
      border: 'border-emerald-950',
      buttonBg: 'bg-emerald-700 hover:bg-emerald-600',
      badgeBg: 'bg-emerald-200 text-emerald-950',
      icon: <Zap className="w-5 h-5 text-emerald-300" />
    },
    'SAP S/4HANA': {
      bg: 'bg-blue-900',
      text: 'text-blue-50',
      accent: 'text-blue-300',
      border: 'border-blue-950',
      buttonBg: 'bg-blue-800 hover:bg-blue-700',
      badgeBg: 'bg-blue-200 text-blue-950',
      icon: <Building2 className="w-5 h-5 text-blue-300" />
    },
    'Xero': {
      bg: 'bg-sky-600',
      text: 'text-white',
      accent: 'text-sky-100',
      border: 'border-sky-800',
      buttonBg: 'bg-sky-500 hover:bg-sky-400',
      badgeBg: 'bg-sky-100 text-sky-900',
      icon: <FileSpreadsheet className="w-5 h-5 text-sky-100" />
    }
  }[activeTenant.platformType] || {
    bg: 'bg-slate-900',
    text: 'text-white',
    accent: 'text-amber-400',
    border: 'border-slate-900',
    buttonBg: 'bg-slate-800 hover:bg-slate-700',
    badgeBg: 'bg-emerald-400 text-slate-950',
    icon: <Building2 className="w-5 h-5 text-amber-400" />
  };

  // Filter invoices for current tenant
  const tenantInvoices = invoices.filter(inv => inv.tenantId === activeTenant.id);

  // Derive source based on invoice number prefix or metadata
  const getInvoiceSource = (inv: Invoice): 'QBO' | 'EXCEL' => {
    if (inv.clientInvoiceNumber.startsWith('QBO') || inv.clientInvoiceNumber.includes('QBO')) {
      return 'QBO';
    }
    return 'EXCEL';
  };

  const filteredInvoices = tenantInvoices.filter(inv => {
    const src = getInvoiceSource(inv);
    if (sourceFilter === 'QBO' && src !== 'QBO') return false;
    if (sourceFilter === 'EXCEL' && src !== 'EXCEL') return false;

    if (statusFilter === 'PENDING' && (inv.status === 'APPROVED' || inv.status === 'SIGNED')) return false;
    if (statusFilter === 'APPROVED' && inv.status !== 'APPROVED' && inv.status !== 'SIGNED') return false;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        inv.clientInvoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        (inv.customerTin && inv.customerTin.toLowerCase().includes(q)) ||
        (inv.irn && inv.irn.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const pendingInvoices = filteredInvoices.filter(inv => inv.status !== 'APPROVED' && inv.status !== 'SIGNED');

  // Toggle Selection
  const toggleSelectAll = () => {
    if (selectedInvoiceIds.length === pendingInvoices.length) {
      setSelectedInvoiceIds([]);
    } else {
      setSelectedInvoiceIds(pendingInvoices.map(i => i.id));
    }
  };

  const toggleSelectInvoice = (id: string) => {
    setSelectedInvoiceIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Push single invoice to CittaEFS
  const handlePushSingleToCittaEFS = async (inv: Invoice) => {
    setIsTransmitting(true);
    setTransmissionSuccessMsg(null);
    setTransmissionErrorMsg(null);

    try {
      const payload = {
        clientInvoiceNumber: inv.clientInvoiceNumber,
        invoiceKind: inv.invoiceKind || 'B2B',
        issueDate: inv.issueDate || new Date().toISOString().substring(0, 10),
        customerCode: inv.customerCode || 'CUST-001',
        customerName: inv.customerName,
        customerTin: inv.customerTin,
        lineItems: inv.lineItems?.length ? inv.lineItems : [
          {
            itemCode: 'SKU-001',
            description: 'Item Goods / Services',
            quantity: 1,
            unitPrice: inv.grandTotal || 5000,
            hsOrServiceCode: 'HS-8471.30',
            vatRate: 16
          }
        ]
      };

      const res = await transmitInvoice(payload);
      const irn = res?.cittaResponse?.irn || res?.irn || 'IRN-STAMPED-OK';
      setTransmissionSuccessMsg(`Invoice ${inv.clientInvoiceNumber} transmitted to CittaEFS REST Gateway (gateway.cittaefs.com/api/v1). Stamp IRN: ${irn}`);
      await refreshAll();
    } catch (err: any) {
      setTransmissionErrorMsg(`Transmission failed for ${inv.clientInvoiceNumber}: ${err.message || 'Error reaching CittaEFS Gateway'}`);
    } finally {
      setIsTransmitting(false);
    }
  };

  // Push batch selected invoices to CittaEFS
  const handlePushBatchToCittaEFS = async () => {
    if (selectedInvoiceIds.length === 0) return;
    setIsTransmitting(true);
    setTransmissionSuccessMsg(null);
    setTransmissionErrorMsg(null);

    try {
      let count = 0;
      for (const id of selectedInvoiceIds) {
        const inv = invoices.find(i => i.id === id);
        if (inv) {
          const payload = {
            clientInvoiceNumber: inv.clientInvoiceNumber,
            invoiceKind: inv.invoiceKind || 'B2B',
            issueDate: inv.issueDate || new Date().toISOString().substring(0, 10),
            customerCode: inv.customerCode || 'CUST-001',
            customerName: inv.customerName,
            customerTin: inv.customerTin,
            lineItems: inv.lineItems?.length ? inv.lineItems : [
              {
                itemCode: 'SKU-001',
                description: 'Item Goods / Services',
                quantity: 1,
                unitPrice: inv.grandTotal || 5000,
                hsOrServiceCode: 'HS-8471.30',
                vatRate: 16
              }
            ]
          };
          await transmitInvoice(payload);
          count++;
        }
      }
      setTransmissionSuccessMsg(`Batch Transmission Complete! ${count} invoice(s) pushed to CittaEFS REST Gateway (gateway.cittaefs.com/api/v1).`);
      setSelectedInvoiceIds([]);
      await refreshAll();
    } catch (err: any) {
      setTransmissionErrorMsg(`Batch transmission encountered an issue: ${err.message}`);
    } finally {
      setIsTransmitting(false);
    }
  };

  // Handle Excel Upload
  const handleExcelUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadLog(`Parsing '${file.name}'...`);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const rawRows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (rawRows.length === 0) {
          setUploadLog(`❌ Error: Spreadsheet '${file.name}' contains no rows.`);
          setIsUploading(false);
          return;
        }

        // Group rows by invoice number
        const groupedMap = new Map<string, any>();
        rawRows.forEach((row, idx) => {
          const invNum = row.clientInvoiceNumber || row.InvoiceNumber || `EXCEL-INV-${Date.now().toString().slice(-4)}-${idx + 1}`;
          if (!groupedMap.has(invNum)) {
            groupedMap.set(invNum, {
              clientInvoiceNumber: invNum,
              invoiceKind: row.invoiceKind || row.Kind || 'B2B',
              issueDate: row.issueDate || new Date().toISOString().substring(0, 10),
              customerCode: row.customerCode || 'CUST-EXCEL',
              customerName: row.customerName || row.Customer || 'Excel Retail Customer',
              customerTin: row.customerTin || row.TaxID || 'P019283746Z',
              lineItems: []
            });
          }
          const inv = groupedMap.get(invNum);
          inv.lineItems.push({
            itemCode: row.itemCode || 'SKU-EXCEL',
            description: row.description || row.ItemDescription || 'Excel Product / Service',
            quantity: Number(row.quantity || 1),
            unitPrice: Number(row.unitPrice || row.Amount || 5000),
            vatRate: Number(row.vatRate || 16),
            hsOrServiceCode: row.hsOrServiceCode || row.HSN || 'HS-8471.30'
          });
        });

        const parsedInvoices = Array.from(groupedMap.values());
        await ingestCsvInvoices(parsedInvoices);
        setUploadLog(`✅ Ingested ${parsedInvoices.length} invoice(s) from '${file.name}' into CittaEFS Portal staging.`);
        await refreshAll();
      } catch (err: any) {
        setUploadLog(`❌ Error parsing Excel file: ${err.message}`);
      } finally {
        setIsUploading(false);
      }
    };

    if (file.name.endsWith('.csv')) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Top Banner Header */}
      <div className="bg-slate-900 text-white rounded-xl p-6 shadow-sm border border-slate-800 transition-colors duration-300">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-full text-xs font-semibold border border-indigo-500/30">
                {activeTenant.platformType} Environment
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white mt-1">
              Client ERP & CittaEFS Gateway Portal
            </h1>
            <p className="text-slate-400 text-xs mt-1">
              Active Workspace: <strong className="text-white font-medium">{activeTenant.name}</strong>
            </p>
          </div>
          <button
            onClick={refreshAll}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 font-semibold text-xs flex items-center gap-2 cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-indigo-400 ${isBgRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync ERP Records</span>
          </button>
        </div>
      </div>

      {/* Feedback Banners */}
      {transmissionSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 p-4 flex items-center justify-between text-xs shadow-sm">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <strong className="font-semibold text-emerald-950">Transmission Success:</strong>
              <p className="mt-0.5 text-emerald-800">{transmissionSuccessMsg}</p>
            </div>
          </div>
          <button 
            onClick={() => setTransmissionSuccessMsg(null)}
            className="text-emerald-700 font-semibold hover:underline cursor-pointer ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {transmissionErrorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl text-rose-900 p-4 flex items-center justify-between text-xs shadow-sm">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <div>
              <strong className="font-semibold text-rose-950">Gateway Transmission Alert:</strong>
              <p className="mt-0.5 text-rose-800">{transmissionErrorMsg}</p>
            </div>
          </div>
          <button 
            onClick={() => setTransmissionErrorMsg(null)}
            className="text-rose-700 font-semibold hover:underline cursor-pointer ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2 Supported Client ERP Connectors Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* QuickBooks Online Connector Card */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="font-bold text-slate-900 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                QuickBooks Online (QBO)
              </span>
              <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold rounded-full text-[10px]">
                ACTIVE & CONNECTED
              </span>
            </div>
            <p className="text-slate-500 text-xs my-3 leading-relaxed">
              Invoices created in QuickBooks Online are automatically pulled into this preview table via background webhooks & CDC sync.
            </p>
            <div className="text-xs text-slate-600 space-y-1.5 bg-slate-50/80 p-3 rounded-lg border border-slate-200/60">
              <div className="flex justify-between">
                <span>Target CittaEFS Endpoint:</span>
                <span className="font-medium text-slate-900">gateway.cittaefs.com/api/v1</span>
              </div>
              <div className="flex justify-between">
                <span>QBO Invoices Ready:</span>
                <span className="font-semibold text-indigo-600">
                  {tenantInvoices.filter(i => getInvoiceSource(i) === 'QBO').length} Records
                </span>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={() => setSourceFilter('QBO')}
              className={`px-3 py-1.5 rounded-lg border font-semibold text-xs transition-all cursor-pointer ${
                sourceFilter === 'QBO' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              View QBO Invoices
            </button>
          </div>
        </div>

        {/* Excel & CSV File Upload Connector Card */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="font-bold text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                Excel & CSV File Import
              </span>
              <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold rounded-full text-[10px]">
                UPLOAD READY
              </span>
            </div>
            <p className="text-slate-500 text-xs my-3 leading-relaxed">
              Upload your billing spreadsheet (.xlsx or .csv) to preview invoice rows and push them directly to CittaEFS.
            </p>

            <div className="relative border-2 border-dashed border-slate-200 bg-slate-50/50 rounded-xl p-4 text-center space-y-1 hover:bg-slate-100/60 hover:border-indigo-300 transition-all cursor-pointer">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleExcelUpload}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
              />
              <div className="flex items-center justify-center space-x-2 text-indigo-600">
                <Upload className="w-4 h-4" />
                <span className="font-semibold text-xs">
                  {isUploading ? 'Parsing Spreadsheet...' : 'Click to Upload Excel / CSV'}
                </span>
              </div>
            </div>

            {uploadLog && (
              <div className="text-xs text-indigo-900 font-medium mt-2 bg-indigo-50 p-2.5 rounded-lg border border-indigo-200">
                {uploadLog}
              </div>
            )}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={() => setSourceFilter('EXCEL')}
              className={`px-3 py-1.5 rounded-lg border font-semibold text-xs transition-all cursor-pointer ${
                sourceFilter === 'EXCEL' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              View Excel Invoices
            </button>
          </div>
        </div>

      </div>

      {/* Main Invoice Preview & CittaEFS Push Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden shadow-sm">
        
        {/* Table Toolbar Controls */}
        <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-500 text-xs">Filter Source:</span>
            <button
              onClick={() => setSourceFilter('ALL')}
              className={`px-3 py-1 rounded-lg border font-medium text-xs transition-all cursor-pointer ${
                sourceFilter === 'ALL' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              All Sources ({tenantInvoices.length})
            </button>
            <button
              onClick={() => setSourceFilter('QBO')}
              className={`px-3 py-1 rounded-lg border font-medium text-xs transition-all cursor-pointer ${
                sourceFilter === 'QBO' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              QuickBooks Online ({tenantInvoices.filter(i => getInvoiceSource(i) === 'QBO').length})
            </button>
            <button
              onClick={() => setSourceFilter('EXCEL')}
              className={`px-3 py-1 rounded-lg border font-medium text-xs transition-all cursor-pointer ${
                sourceFilter === 'EXCEL' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Excel / CSV ({tenantInvoices.filter(i => getInvoiceSource(i) === 'EXCEL').length})
            </button>
          </div>

          <div className="flex items-center space-x-2 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative flex-1 md:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search Invoice #, Customer..."
                className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              />
            </div>

            {/* Batch Action Push to CittaEFS */}
            {selectedInvoiceIds.length > 0 && (
              <button
                onClick={handlePushBatchToCittaEFS}
                disabled={isTransmitting}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer shrink-0 shadow-sm transition-colors"
              >
                <Send className="w-3.5 h-3.5 text-indigo-200" />
                <span>Push ({selectedInvoiceIds.length}) to CittaEFS</span>
              </button>
            )}
          </div>

        </div>

        {/* Invoice List Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase tracking-wider border-b border-slate-100">
                <th className="py-3 px-3 w-8 text-center">
                  <button 
                    onClick={toggleSelectAll} 
                    className="text-slate-400 hover:text-indigo-600 cursor-pointer"
                    title="Select all pending"
                  >
                    {selectedInvoiceIds.length > 0 && selectedInvoiceIds.length === pendingInvoices.length ? (
                      <CheckSquare className="w-4 h-4 text-indigo-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-300" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-4">Client Inv #</th>
                <th className="py-3 px-4">ERP Source</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">TIN (Tax ID)</th>
                <th className="py-3 px-4">Issue Date</th>
                <th className="py-3 px-4">Total Amount</th>
                <th className="py-3 px-4">CittaEFS Status</th>
                <th className="py-3 px-4">NRS IRN Stamp & Link</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400 font-medium">
                    No invoices match current filter settings.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const src = getInvoiceSource(inv);
                  const isApproved = inv.status === 'APPROVED' || inv.status === 'SIGNED';
                  const isSelected = selectedInvoiceIds.includes(inv.id);

                  return (
                    <tr key={inv.id} className={`hover:bg-slate-50/80 transition-colors ${isSelected ? 'bg-indigo-50/30' : ''}`}>
                      <td className="py-3 px-3 text-center">
                        {!isApproved ? (
                          <button 
                            onClick={() => toggleSelectInvoice(inv.id)}
                            className="text-slate-400 hover:text-indigo-600 cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-indigo-600" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-300" />
                            )}
                          </button>
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                        )}
                      </td>
                      <td className="py-3 px-4 font-semibold text-indigo-600">{inv.clientInvoiceNumber}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          src === 'QBO' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                        }`}>
                          {src === 'QBO' ? 'QuickBooks Online' : 'Excel / CSV'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">{inv.customerName}</td>
                      <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">{inv.customerTin || 'B2C / Cash Sale'}</td>
                      <td className="py-3 px-4 text-slate-500">{inv.issueDate}</td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {inv.currency || 'KES'} {inv.grandTotal?.toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          isApproved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                          inv.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {inv.irn ? (
                          <div className="space-y-0.5">
                            <span className="font-mono text-emerald-700 text-xs block">{inv.irn}</span>
                            {inv.verificationLink && (
                              <a 
                                href={inv.verificationLink} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 font-medium"
                              >
                                <span>Verify QR Link</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">Not Stamped Yet</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {!isApproved ? (
                          <button
                            onClick={() => handlePushSingleToCittaEFS(inv)}
                            disabled={isTransmitting}
                            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1 ml-auto cursor-pointer transition-colors shadow-sm"
                          >
                            <Send className="w-3 h-3 text-indigo-200" />
                            <span>Push to CittaEFS</span>
                          </button>
                        ) : (
                          <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold rounded-full text-[10px]">
                            ✓ Transmitted
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info note */}
        <div className="p-4 bg-slate-50/50 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between">
          <span>All pushed invoices are validated & transmitted directly to CittaEFS REST Gateway (gateway.cittaefs.com/api/v1).</span>
          <span className="font-semibold text-slate-800">Total: {tenantInvoices.length} Invoices</span>
        </div>

      </div>

    </div>
  );
}
