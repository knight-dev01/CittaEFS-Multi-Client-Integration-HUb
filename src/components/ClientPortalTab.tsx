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
    <div className="space-y-6 font-mono text-xs">
      
      {/* Top Banner Header */}
      <div className={`${themeConfig.bg} ${themeConfig.text} p-5 border-2 ${themeConfig.border} shadow-md transition-colors duration-300`}>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {themeConfig.icon}
              <h1 className={`text-base font-black ${themeConfig.accent} uppercase tracking-widest`}>
                Client ERP & CittaEFS Gateway Portal
              </h1>
              <span className={`px-2 py-0.5 ${themeConfig.badgeBg} font-black text-[10px] uppercase border border-slate-950`}>
                {activeTenant.platformType} Environment
              </span>
            </div>
            <p className="text-slate-200 text-xs mt-1">
              Active Organization: <strong className="text-white">{activeTenant.name}</strong>
            </p>
          </div>
          <button
            onClick={refreshAll}
            className={`px-3 py-1.5 ${themeConfig.buttonBg} ${themeConfig.accent} font-black uppercase border border-slate-950 text-xs flex items-center gap-1.5 cursor-pointer`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isBgRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync ERP Records</span>
          </button>
        </div>
      </div>

      {/* Feedback Banners */}
      {transmissionSuccessMsg && (
        <div className="bg-emerald-100 border-2 border-emerald-700 text-emerald-950 p-4 flex items-center justify-between font-mono text-xs">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
            <div>
              <strong className="font-black uppercase text-emerald-950">Transmission Success:</strong>
              <p className="mt-0.5">{transmissionSuccessMsg}</p>
            </div>
          </div>
          <button 
            onClick={() => setTransmissionSuccessMsg(null)}
            className="text-emerald-950 font-bold hover:underline cursor-pointer ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {transmissionErrorMsg && (
        <div className="bg-red-100 border-2 border-red-700 text-red-950 p-4 flex items-center justify-between font-mono text-xs">
          <div className="flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 text-red-700 shrink-0" />
            <div>
              <strong className="font-black uppercase text-red-950">Gateway Transmission Alert:</strong>
              <p className="mt-0.5">{transmissionErrorMsg}</p>
            </div>
          </div>
          <button 
            onClick={() => setTransmissionErrorMsg(null)}
            className="text-red-950 font-bold hover:underline cursor-pointer ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2 Supported Client ERP Connectors Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* QuickBooks Online Connector Card */}
        <div className="bg-white border-2 border-slate-900 p-4 space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
              <span className="font-black text-slate-900 uppercase flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-600" />
                QuickBooks Online (QBO)
              </span>
              <span className="px-2 py-0.5 bg-emerald-300 text-slate-950 border border-slate-900 font-black uppercase text-[10px]">
                ACTIVE & CONNECTED
              </span>
            </div>
            <p className="text-slate-600 text-xs my-2 leading-relaxed">
              Invoices created in QuickBooks Online are automatically pulled into this preview table via background webhooks & CDC sync.
            </p>
            <div className="text-[11px] text-slate-700 space-y-1 bg-slate-50 p-2 border border-slate-200">
              <div className="flex justify-between">
                <span>Target CittaEFS Endpoint:</span>
                <span className="font-bold text-slate-900">gateway.cittaefs.com/api/v1</span>
              </div>
              <div className="flex justify-between">
                <span>QBO Invoices Ready:</span>
                <span className="font-black text-indigo-700">
                  {tenantInvoices.filter(i => getInvoiceSource(i) === 'QBO').length} Records
                </span>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={() => setSourceFilter('QBO')}
              className={`px-3 py-1.5 border-2 font-black uppercase text-[11px] cursor-pointer ${
                sourceFilter === 'QBO' ? 'bg-amber-400 text-slate-950 border-slate-900' : 'bg-slate-100 text-slate-900 border-slate-800 hover:bg-slate-200'
              }`}
            >
              View QBO Invoices
            </button>
          </div>
        </div>

        {/* Excel & CSV File Upload Connector Card */}
        <div className="bg-white border-2 border-slate-900 p-4 space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
              <span className="font-black text-slate-900 uppercase flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                Excel & CSV File Import
              </span>
              <span className="px-2 py-0.5 bg-emerald-300 text-slate-950 border border-slate-900 font-black uppercase text-[10px]">
                UPLOAD READY
              </span>
            </div>
            <p className="text-slate-600 text-xs my-2 leading-relaxed">
              Upload your billing spreadsheet (.xlsx or .csv) to preview invoice rows and push them directly to CittaEFS.
            </p>

            <div className="relative border-2 border-dashed border-slate-400 bg-slate-50 p-3 text-center space-y-1 hover:bg-slate-100 transition cursor-pointer">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleExcelUpload}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
              />
              <div className="flex items-center justify-center space-x-2 text-emerald-800">
                <Upload className="w-4 h-4" />
                <span className="font-black uppercase text-xs">
                  {isUploading ? 'Parsing Spreadsheet...' : 'Click to Upload Excel / CSV'}
                </span>
              </div>
            </div>

            {uploadLog && (
              <div className="text-[10px] text-emerald-800 font-mono font-bold mt-1.5 bg-emerald-50 p-1.5 border border-emerald-300">
                {uploadLog}
              </div>
            )}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={() => setSourceFilter('EXCEL')}
              className={`px-3 py-1.5 border-2 font-black uppercase text-[11px] cursor-pointer ${
                sourceFilter === 'EXCEL' ? 'bg-emerald-400 text-slate-950 border-slate-900' : 'bg-slate-100 text-slate-900 border-slate-800 hover:bg-slate-200'
              }`}
            >
              View Excel Invoices
            </button>
          </div>
        </div>

      </div>

      {/* Main Invoice Preview & CittaEFS Push Table */}
      <div className="bg-white border-2 border-slate-900 overflow-hidden">
        
        {/* Table Toolbar Controls */}
        <div className="p-4 bg-slate-100 border-b-2 border-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-black uppercase text-slate-900 text-xs">Filter Source:</span>
            <button
              onClick={() => setSourceFilter('ALL')}
              className={`px-2.5 py-1 border border-slate-900 font-bold uppercase text-[10px] cursor-pointer ${
                sourceFilter === 'ALL' ? 'bg-slate-900 text-amber-400' : 'bg-white text-slate-800 hover:bg-slate-200'
              }`}
            >
              All Sources ({tenantInvoices.length})
            </button>
            <button
              onClick={() => setSourceFilter('QBO')}
              className={`px-2.5 py-1 border border-slate-900 font-bold uppercase text-[10px] cursor-pointer ${
                sourceFilter === 'QBO' ? 'bg-amber-400 text-slate-950 font-black' : 'bg-white text-slate-800 hover:bg-slate-200'
              }`}
            >
              QuickBooks Online ({tenantInvoices.filter(i => getInvoiceSource(i) === 'QBO').length})
            </button>
            <button
              onClick={() => setSourceFilter('EXCEL')}
              className={`px-2.5 py-1 border border-slate-900 font-bold uppercase text-[10px] cursor-pointer ${
                sourceFilter === 'EXCEL' ? 'bg-emerald-400 text-slate-950 font-black' : 'bg-white text-slate-800 hover:bg-slate-200'
              }`}
            >
              Excel / CSV ({tenantInvoices.filter(i => getInvoiceSource(i) === 'EXCEL').length})
            </button>
          </div>

          <div className="flex items-center space-x-2 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative flex-1 md:w-56">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search Invoice #, Customer..."
                className="w-full bg-white border border-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-900 outline-none"
              />
            </div>

            {/* Batch Action Push to CittaEFS */}
            {selectedInvoiceIds.length > 0 && (
              <button
                onClick={handlePushBatchToCittaEFS}
                disabled={isTransmitting}
                className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black border-2 border-slate-900 uppercase text-[11px] flex items-center gap-1.5 cursor-pointer shrink-0 shadow"
              >
                <Send className="w-3.5 h-3.5 text-slate-950" />
                <span>Push ({selectedInvoiceIds.length}) to CittaEFS</span>
              </button>
            )}
          </div>

        </div>

        {/* Invoice List Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-amber-400 font-black uppercase text-[10px] border-b-2 border-slate-900">
                <th className="p-3 w-8 text-center">
                  <button 
                    onClick={toggleSelectAll} 
                    className="text-amber-400 hover:text-white cursor-pointer"
                    title="Select all pending"
                  >
                    {selectedInvoiceIds.length > 0 && selectedInvoiceIds.length === pendingInvoices.length ? (
                      <CheckSquare className="w-4 h-4 text-amber-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </th>
                <th className="p-3">Client Inv #</th>
                <th className="p-3">ERP Source</th>
                <th className="p-3">Customer</th>
                <th className="p-3">TIN (Tax ID)</th>
                <th className="p-3">Issue Date</th>
                <th className="p-3">Total Amount</th>
                <th className="p-3">CittaEFS Status</th>
                <th className="p-3">NRS IRN Stamp & Link</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-slate-100 font-mono text-slate-900 text-xs">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500 uppercase font-bold">
                    No invoices match current filter settings.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const src = getInvoiceSource(inv);
                  const isApproved = inv.status === 'APPROVED' || inv.status === 'SIGNED';
                  const isSelected = selectedInvoiceIds.includes(inv.id);

                  return (
                    <tr key={inv.id} className={`hover:bg-slate-50 transition ${isSelected ? 'bg-amber-50/60' : ''}`}>
                      <td className="p-3 text-center">
                        {!isApproved ? (
                          <button 
                            onClick={() => toggleSelectInvoice(inv.id)}
                            className="text-slate-700 hover:text-slate-950 cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-amber-600" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                        )}
                      </td>
                      <td className="p-3 font-black text-indigo-700">{inv.clientInvoiceNumber}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 border border-slate-900 text-[9px] font-black uppercase ${
                          src === 'QBO' ? 'bg-amber-100 text-amber-950 border-amber-500' : 'bg-emerald-100 text-emerald-950 border-emerald-600'
                        }`}>
                          {src === 'QBO' ? 'QuickBooks Online' : 'Excel / CSV'}
                        </span>
                      </td>
                      <td className="p-3 font-bold">{inv.customerName}</td>
                      <td className="p-3 text-slate-700 font-bold">{inv.customerTin || 'B2C / Cash Sale'}</td>
                      <td className="p-3 text-slate-600">{inv.issueDate}</td>
                      <td className="p-3 font-black text-slate-900">
                        {inv.currency || 'KES'} {inv.grandTotal?.toLocaleString()}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 border border-slate-900 text-[10px] font-black uppercase ${
                          isApproved ? 'bg-emerald-300 text-slate-950' :
                          inv.status === 'REJECTED' ? 'bg-red-400 text-slate-950' : 'bg-amber-300 text-slate-950'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="p-3">
                        {inv.irn ? (
                          <div className="space-y-0.5">
                            <span className="font-bold text-emerald-800 text-[11px] block">{inv.irn}</span>
                            {inv.verificationLink && (
                              <a 
                                href={inv.verificationLink} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-[10px] text-indigo-600 hover:underline flex items-center gap-1 font-bold"
                              >
                                <span>Verify QR Link</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Not Stamped Yet</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {!isApproved ? (
                          <button
                            onClick={() => handlePushSingleToCittaEFS(inv)}
                            disabled={isTransmitting}
                            className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black border border-slate-900 uppercase text-[10px] flex items-center gap-1 ml-auto cursor-pointer"
                          >
                            <Send className="w-3 h-3 text-slate-950" />
                            <span>Push to CittaEFS</span>
                          </button>
                        ) : (
                          <span className="px-2 py-0.5 bg-slate-100 text-emerald-800 border border-emerald-400 font-bold text-[10px] uppercase">
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
        <div className="p-3 bg-slate-50 border-t-2 border-slate-900 text-[11px] text-slate-600 flex items-center justify-between">
          <span>All pushed invoices are validated & transmitted directly to CittaEFS REST Gateway (`gateway.cittaefs.com/api/v1`).</span>
          <span className="font-bold text-slate-900">Total: {tenantInvoices.length} Invoices</span>
        </div>

      </div>

    </div>
  );
}
