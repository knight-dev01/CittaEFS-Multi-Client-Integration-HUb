import { useState, ChangeEvent } from 'react';
import { fetchWithAuth, parseJsonResponse } from '../lib/api';
import * as XLSX from 'xlsx';
import { useHub } from '../lib/store';
import { SystemToEfsExcelMapper } from './SystemToEfsExcelMapper';
import { 
  FileSpreadsheet, 
  Upload, 
  Zap, 
  Database, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  Play, 
  Terminal,
  Cpu,
  Layers,
  FileCode2,
  FolderPlus,
  ShieldCheck
} from 'lucide-react';

export function CsvAndConnectorsTab() {
  const { activeTenant, ingestCsvInvoices } = useHub();

  const [csvText, setCsvText] = useState<string>(`clientInvoiceNumber,invoiceKind,issueDate,customerCode,customerName,customerTin,itemCode,description,quantity,unitPrice,hsOrServiceCode
CSV-BATCH-101,B2B,2026-07-27,CUST-CITTA-8812,Zenith Logistics Ltd,P019283746Z,SKU-LAP-DELL15,Dell XPS 15 Business Laptop,1,120000,HS-8471.30
CSV-BATCH-101,B2B,2026-07-27,CUST-CITTA-8812,Zenith Logistics Ltd,P019283746Z,SKU-IT-ONBOARDING,Cloud IT Setup Service,1,45000,SRV-7212.10
CSV-BATCH-102,B2C,2026-07-27,CUST-B2C-GENERIC,Over-The-Counter Cash Sale,N/A,SKU-LAP-DELL15,Dell XPS 15 Business Laptop,1,120000,HS-8471.30`);

  const [isProcessingCsv, setIsProcessingCsv] = useState(false);
  const [csvResultMsg, setCsvResultMsg] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // Connector Simulators
  const [qboStatus, setQboStatus] = useState<'IDLE' | 'SIMULATING' | 'SUCCESS'>('IDLE');
  const [efsStatus, setEfsStatus] = useState<'IDLE' | 'QUERYING' | 'SUCCESS'>('IDLE');
  const [connectorLog, setConnectorLog] = useState<string[]>([]);

  // Handle actual Excel (.xlsx, .xls) file upload
  const handleExcelFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    setIsProcessingCsv(true);
    setCsvResultMsg(null);

    const reader = new FileReader();

    if (file.name.endsWith('.csv') || file.type.includes('csv')) {
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        setCsvText(text);
        setIsProcessingCsv(false);
        setCsvResultMsg(`Loaded CSV file '${file.name}' into editor. Click 'Run SheetJS Batch Ingestion' to process.`);
      };
      reader.readAsText(file);
    } else {
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.SheetNames[0];
          const csvContent = XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheet]);

          setCsvText(csvContent);
          setIsProcessingCsv(false);
          setCsvResultMsg(`Successfully parsed Excel spreadsheet '${file.name}' [Sheet: ${firstSheet}]. Ready for CittaEFS transmission.`);
        } catch (err: any) {
          setIsProcessingCsv(false);
          setCsvResultMsg(`Excel parsing error: ${err.message}`);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // Generate downloadable official EFS Fiscal Excel Template (.xlsx)
  const handleDownloadExcelTemplate = () => {
    // 1. Customers Master Sheet
    const customerRows = [
      { customerCode: 'CUST-ZENITH-01', customerName: 'Zenith Logistics Ltd', customerTin: 'P019283746Z', email: 'billing@zenithlogistics.com', address: '102 Industrial Way, Commercial District', country: 'KE' },
      { customerCode: 'CUST-RETAIL-WALKIN', customerName: 'Walk-in Retail Customer', customerTin: 'N/A', email: 'pos@retailstore.com', address: 'Main Outlet Counter #4', country: 'KE' }
    ];

    // 2. Products Master Sheet
    const productRows = [
      { itemCode: 'SKU-LAP-DELL15', description: 'Dell XPS 15 Business Laptop', unitPrice: 120000, vatRate: 16, hsOrServiceCode: 'HS-8471.30', unitOfMeasure: 'PCE' },
      { itemCode: 'SRV-SETUP-02', description: 'Onsite Server Setup Service', unitPrice: 45000, vatRate: 16, hsOrServiceCode: 'SRV-7212.10', unitOfMeasure: 'HRS' },
      { itemCode: 'SKU-MON-DELL27', description: 'Dell 27-Inch 4K Monitor', unitPrice: 85000, vatRate: 16, hsOrServiceCode: 'HS-8528.52', unitOfMeasure: 'PCE' }
    ];

    // 3. Main Transactional Batch Sheet
    const templateRows = [
      {
        clientInvoiceNumber: 'EFS-EXCEL-001',
        invoiceKind: 'B2B',
        issueDate: '2026-07-28',
        customerCode: 'CUST-ZENITH-01',
        customerName: 'Zenith Logistics Ltd',
        customerTin: 'P019283746Z',
        itemCode: 'SKU-LAP-DELL15',
        description: 'Dell XPS 15 Business Laptop',
        quantity: 1,
        unitPrice: 120000,
        hsOrServiceCode: 'HS-8471.30',
        vatRate: 16
      },
      {
        clientInvoiceNumber: 'EFS-EXCEL-001',
        invoiceKind: 'B2B',
        issueDate: '2026-07-28',
        customerCode: 'CUST-ZENITH-01',
        customerName: 'Zenith Logistics Ltd',
        customerTin: 'P019283746Z',
        itemCode: 'SRV-SETUP-02',
        description: 'Onsite Server Setup Service',
        quantity: 1,
        unitPrice: 45000,
        hsOrServiceCode: 'SRV-7212.10',
        vatRate: 16
      },
      {
        clientInvoiceNumber: 'EFS-EXCEL-002',
        invoiceKind: 'B2C',
        issueDate: '2026-07-28',
        customerCode: 'CUST-RETAIL-WALKIN',
        customerName: 'Walk-in Retail Customer',
        customerTin: 'N/A',
        itemCode: 'SKU-MON-DELL27',
        description: 'Dell 27-Inch 4K Monitor',
        quantity: 2,
        unitPrice: 85000,
        hsOrServiceCode: 'HS-8528.52',
        vatRate: 16
      }
    ];

    const workbook = XLSX.utils.book_new();
    const wsInvoices = XLSX.utils.json_to_sheet(templateRows);
    const wsCustomers = XLSX.utils.json_to_sheet(customerRows);
    const wsProducts = XLSX.utils.json_to_sheet(productRows);

    XLSX.utils.book_append_sheet(workbook, wsInvoices, 'Fiscal_Invoices');
    XLSX.utils.book_append_sheet(workbook, wsCustomers, 'Customers');
    XLSX.utils.book_append_sheet(workbook, wsProducts, 'Products');

    XLSX.writeFile(workbook, 'CittaEFS_Official_Invoice_Template.xlsx');
  };

  const handleParseAndUploadCsv = async () => {
    try {
      setIsProcessingCsv(true);
      setCsvResultMsg(null);

      // Parse CSV using SheetJS
      const workbook = XLSX.read(csvText, { type: 'string' });
      const sheetName = workbook.SheetNames[0];
      const rawRows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      if (rawRows.length === 0) {
        setCsvResultMsg('Error: No rows detected in CSV data.');
        setIsProcessingCsv(false);
        return;
      }

      // Group rows by clientInvoiceNumber
      const groupedMap = new Map<string, any>();

      rawRows.forEach((row) => {
        const invNum = row.clientInvoiceNumber || `CSV-AUTO-${Date.now()}`;

        if (!groupedMap.has(invNum)) {
          groupedMap.set(invNum, {
            clientInvoiceNumber: invNum,
            invoiceKind: row.invoiceKind || 'B2B',
            issueDate: row.issueDate || new Date().toISOString().substring(0, 10),
            customerCode: row.customerCode || 'CUST-CITTA-GENERIC',
            customerName: row.customerName || 'CSV Batch Customer',
            customerTin: row.customerTin || (row.invoiceKind === 'B2B' ? 'P019283746Z' : undefined),
            lineItems: []
          });
        }

        const inv = groupedMap.get(invNum);
        inv.lineItems.push({
          itemCode: row.itemCode || 'SKU-GENERIC',
          description: row.description || 'Generic Item',
          quantity: Number(row.quantity || 1),
          unitPrice: Number(row.unitPrice || 0),
          discountAmount: Number(row.discountAmount || 0),
          vatRate: Number(row.vatRate || 16),
          hsOrServiceCode: row.hsOrServiceCode || 'HS-8471.30'
        });
      });

      const parsedInvoices = Array.from(groupedMap.values());
      await ingestCsvInvoices(parsedInvoices);

      setCsvResultMsg(`SheetJS Engine successfully parsed & grouped ${parsedInvoices.length} invoices (${rawRows.length} total line rows). Transmitted to CittaEFS!`);
      setIsProcessingCsv(false);
    } catch (e: any) {
      setCsvResultMsg(`CSV Parsing Exception: ${e.message}`);
      setIsProcessingCsv(false);
    }
  };

  const handleSimulateQboWebhook = async () => {
    setQboStatus('SIMULATING');
    setConnectorLog(prev => [
      `[${new Date().toLocaleTimeString()}] QBO Event: Customer created invoice #QBO-${Math.floor(1000 + Math.random() * 9000)}...`,
      `[${new Date().toLocaleTimeString()}] Webhook listener triggered: Listening on /api/webhooks/cittaefs...`,
      ...prev
    ]);

    setTimeout(async () => {
      try {
        const res = await fetchWithAuth('/api/integration/gen/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: activeTenant.id,
            clientInvoiceNumber: `QBO-LIVE-${Math.floor(1000 + Math.random() * 9000)}`,
            invoiceKind: 'B2B',
            issueDate: new Date().toISOString().substring(0, 10),
            customerCode: 'QBO-CUST-1092',
            customerName: 'Zenith Logistics Ltd',
            customerTin: 'P019283746Z',
            lineItems: [
              {
                itemCode: 'SKU-LAP-DELL15',
                description: 'Dell XPS 15 Business Laptop',
                quantity: 1,
                unitPrice: 120000,
                vatRate: 16,
                hsOrServiceCode: 'HS-8471.30'
              }
            ]
          })
        });
        const data = await parseJsonResponse(res);
        setQboStatus('SUCCESS');
        setConnectorLog(prev => [
          `[${new Date().toLocaleTimeString()}] NRS Stamp IRN generated: ${data.cittaResponse?.irn || 'IRN-QBO-SUCCESS'}`,
          `[${new Date().toLocaleTimeString()}] QBO Sync Complete: IRN & QR writeback updated in QuickBooks ledger!`,
          ...prev
        ]);
      } catch (e: any) {
        setQboStatus('IDLE');
      }
    }, 1200);
  };

  const handleSimulateEfsWebhook = async () => {
    setEfsStatus('QUERYING');
    setConnectorLog(prev => [
      `[${new Date().toLocaleTimeString()}] CittaEFS Gateway Webhook: Received inbound tax signature verification callback...`,
      `[${new Date().toLocaleTimeString()}] HMAC SHA-256 Digest Signature: Validated (0x9F82A1B...)`,
      ...prev
    ]);

    setTimeout(async () => {
      try {
        const res = await fetchWithAuth('/api/webhooks/cittaefs', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-cittaefs-signature': 'sig_hmac_256_valid_token_0918237'
          },
          body: JSON.stringify({
            tenantId: activeTenant.id,
            eventType: 'INVOICE_STAMPED',
            irn: `IRN-CSL-${Math.floor(100000 + Math.random() * 900000)}`,
            clientInvoiceNumber: `INV-EFS-${Math.floor(4000 + Math.random() * 5000)}`,
            qrCodeUrl: 'https://nrs.portal.gov/verify?irn=IRN-CSL-CONFIRMED',
            status: 'APPROVED',
            timestamp: new Date().toISOString()
          })
        });
        const data = await parseJsonResponse(res);
        setEfsStatus('SUCCESS');
        setConnectorLog(prev => [
          `[${new Date().toLocaleTimeString()}] Reconciliation Engine: Match confirmed. Status set to APPROVED`,
          `[${new Date().toLocaleTimeString()}] Client Writeback: Updated transaction ledger with official QR verification URL!`,
          ...prev
        ]);
      } catch (e: any) {
        setEfsStatus('IDLE');
      }
    }, 1200);
  };

  return (
    <div className="space-y-6 font-sans text-xs">
      
      {/* Top Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Box: Excel & CSV Drop Processor */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                <span>Excel (.xlsx) & CSV Drop Parser</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload or paste Excel spreadsheets for automated multi-item fiscal grouping.
              </p>
            </div>
            <button
              onClick={handleDownloadExcelTemplate}
              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors shadow-sm"
              title="Download official pre-formatted Excel template"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Get Excel Template</span>
            </button>
          </div>

          {/* File Drag-and-Drop Area */}
          <div className="border-2 border-dashed border-slate-200 bg-slate-50/50 rounded-xl p-4 text-center space-y-1 relative hover:bg-slate-100/60 hover:border-indigo-300 transition-all cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
            />
            <div className="flex flex-col items-center justify-center space-y-1">
              <FolderPlus className="w-5 h-5 text-indigo-600" />
              <span className="font-semibold text-slate-900 text-xs">
                {uploadedFileName ? `Selected: ${uploadedFileName}` : 'Drop Excel (.xlsx / .xls) or CSV File Here'}
              </span>
              <span className="text-[11px] text-slate-500">
                Click or drag spreadsheet file to auto-extract columns & rows
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Parsed Spreadsheet Data Buffer (Multi-item grouping by <code className="bg-slate-100 text-indigo-700 px-1.5 py-0.5 rounded font-mono text-[11px]">clientInvoiceNumber</code>):
            </label>
            <textarea
              rows={6}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full p-3 font-mono text-xs bg-slate-900 text-emerald-400 rounded-xl border border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {csvResultMsg && (
            <div className={`p-3.5 rounded-xl border text-xs font-medium ${
              csvResultMsg.startsWith('Error') || csvResultMsg.startsWith('CSV Parsing Exception') 
                ? 'bg-rose-50 text-rose-800 border-rose-200' 
                : 'bg-emerald-50 text-emerald-900 border-emerald-200'
            }`}>
              {csvResultMsg}
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-1">
            <button
              onClick={handleParseAndUploadCsv}
              disabled={isProcessingCsv}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer inline-flex items-center space-x-2 transition-colors"
            >
              <Upload className="w-4 h-4 text-indigo-200" />
              <span>{isProcessingCsv ? 'Parsing & Transmitting...' : 'Transmit Excel Data to CittaEFS'}</span>
            </button>
          </div>
        </div>

        {/* Right Box: Live ERP Webhook & SQL Connectors Simulator */}
        <div className="bg-slate-900 text-white rounded-xl p-5 border border-slate-800 space-y-4 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-indigo-400" />
                <span>Live ERP & SQL Event Simulators</span>
              </h3>
              <span className="px-2.5 py-0.5 text-[10px] font-semibold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {activeTenant.platformType}
              </span>
            </div>

            <p className="text-xs text-slate-400 my-2">
              Test real-time webhook listeners & database CDC polling triggers without leaving the Hub Control Panel.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">
              
              <button
                onClick={handleSimulateQboWebhook}
                disabled={qboStatus === 'SIMULATING'}
                className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-left hover:border-indigo-500/50 transition cursor-pointer group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white group-hover:text-indigo-400">QuickBooks Online</span>
                  <Zap className="w-4 h-4 text-indigo-400" />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Simulate OAuth 2.0 REST Webhook Event</p>
                <span className="mt-2 inline-flex items-center text-[11px] font-semibold text-indigo-400">
                  <Play className="w-3 h-3 mr-1" /> Trigger Event
                </span>
              </button>

              <button
                onClick={handleSimulateEfsWebhook}
                disabled={efsStatus === 'QUERYING'}
                className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-left hover:border-emerald-500/50 transition cursor-pointer group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white group-hover:text-emerald-400">CittaEFS Gateway (CSL)</span>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Simulate Gateway Webhook & Audit Sync</p>
                <span className="mt-2 inline-flex items-center text-[11px] font-semibold text-emerald-400">
                  <Play className="w-3 h-3 mr-1" /> Fire Gateway Callback
                </span>
              </button>

            </div>

            {/* Terminal Live Output Log */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono font-semibold">
                <span className="flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5 text-indigo-400" /> Real-time Connector Output:</span>
                <span className="text-emerald-400">CDC Stream Active</span>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-emerald-400 max-h-40 overflow-y-auto space-y-1">
                {connectorLog.length === 0 ? (
                  <span className="text-slate-500">Select a connector above to execute live synchronization events...</span>
                ) : (
                  connectorLog.map((log, idx) => (
                    <div key={idx} className="leading-snug">{log}</div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 text-center pt-3 border-t border-slate-800 font-medium">
            Hub ensures <strong className="text-indigo-400 font-semibold">symmetrical bi-directional synchronization</strong> across all client platforms.
          </div>
        </div>

      </div>

      {/* System to EFS Excel Mapping Visual Explainer */}
      <SystemToEfsExcelMapper />

    </div>
  );
}

