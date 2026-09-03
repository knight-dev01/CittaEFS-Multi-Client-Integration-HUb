import { useState, ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { useHub } from '../lib/store';
import { getRowErrors as sharedGetRowErrors } from '../lib/invoiceValidation';
import { InvoicePreview } from './InvoicePreview';
import {
  FileSpreadsheet,
  Upload,
  Plus,
  Trash2,
  Download,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Play,
  Users,
  Tag,
  RefreshCw,
  FileCode,
  ShieldCheck,
  Building2,
  Check,
  Search,
  SlidersHorizontal,
  ArrowRight
} from 'lucide-react';

export interface SpreadsheetRow {
  id: string;
  clientInvoiceNumber: string;
  documentNumber?: string;
  invoiceKind: 'B2B' | 'B2C' | 'B2G' | 'EXPORT';
  invoiceTypeCode?: string;
  issueDate: string;
  customerCode: string;
  customerName: string;
  customerTin: string;
  itemCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  hsOrServiceCode: string;
  vatRate: number;
  lineNum?: number;
  unitCode?: string;
  taxCategoryId?: string;
  discountAmount?: number;
  taxableAmount?: number;
  vatAmount?: number;
  headerCharges?: number;
  headerDiscount?: number;
  currency?: string;
  billingReferenceIrns?: string;
  customFields?: Record<string, any>;
  partyNormalized?: boolean;
  itemNormalized?: boolean;
}

interface ExcelDocumentViewerProps {
  tenantId?: string;
  startEmpty?: boolean;
}

const DEFAULT_SAMPLE_ROWS: SpreadsheetRow[] = [
  {
    id: 'row_1',
    clientInvoiceNumber: 'EXCEL-INV-1001',
    invoiceKind: 'B2B',
    issueDate: '2026-08-04',
    customerCode: 'CUST-ZENITH-01',
    customerName: 'Zenith Logistics Ltd',
    customerTin: 'P019283746Z',
    itemCode: 'SKU-LAP-DELL15',
    description: 'Dell XPS 15 Business Laptop',
    quantity: 2,
    unitPrice: 120000,
    hsOrServiceCode: 'HS-8471.30',
    vatRate: 16,
    partyNormalized: true,
    itemNormalized: true
  },
  {
    id: 'row_2',
    clientInvoiceNumber: 'EXCEL-INV-1001',
    invoiceKind: 'B2B',
    issueDate: '2026-08-04',
    customerCode: 'CUST-ZENITH-01',
    customerName: 'Zenith Logistics Ltd',
    customerTin: 'P019283746Z',
    itemCode: 'SRV-SETUP-02',
    description: 'Onsite Server Setup Service',
    quantity: 1,
    unitPrice: 45000,
    hsOrServiceCode: 'SRV-7212.10',
    vatRate: 16,
    partyNormalized: true,
    itemNormalized: true
  },
  {
    id: 'row_3',
    clientInvoiceNumber: 'EXCEL-INV-1002',
    invoiceKind: 'B2C',
    issueDate: '2026-08-04',
    customerCode: 'CUST-WALKIN-99',
    customerName: 'Walk-in Retail Customer',
    customerTin: 'N/A',
    itemCode: 'SKU-MON-DELL27',
    description: 'Dell 27-Inch 4K Display Monitor',
    quantity: 1,
    unitPrice: 85000,
    hsOrServiceCode: 'HS-8528.52',
    vatRate: 16,
    partyNormalized: true,
    itemNormalized: true
  }
];

export function ExcelDocumentViewer({ tenantId, startEmpty = false }: ExcelDocumentViewerProps = {}) {
  const { activeTenant, ingestCsvInvoices, customers, itemMappings, addCustomer, addItemMapping, refreshAll } = useHub();
  const targetTenantId = tenantId || activeTenant?.id;

  const [rows, setRowsState] = useState<SpreadsheetRow[]>(() => {
    if (!startEmpty && typeof window !== 'undefined') {
      const saved = localStorage.getItem('citta_excel_grid_rows');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch { }
      }
    }
    return startEmpty ? [] : DEFAULT_SAMPLE_ROWS;
  });

  const setRows = (newRowsOrFn: SpreadsheetRow[] | ((prev: SpreadsheetRow[]) => SpreadsheetRow[])) => {
    setRowsState(prev => {
      const nextRows = typeof newRowsOrFn === 'function' ? newRowsOrFn(prev) : newRowsOrFn;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('citta_excel_grid_rows', JSON.stringify(nextRows));
        } catch { }
      }
      return nextRows;
    });
  };

  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isNormalized, setIsNormalized] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showDictionaryPicker, setShowDictionaryPicker] = useState<{ rowId: string; type: 'customer' | 'item' } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewGroups, setPreviewGroups] = useState<any[]>([]);

  // Cell Editing Handler
  const handleCellChange = (id: string, field: keyof SpreadsheetRow, value: any) => {
    setRows(prevRows => prevRows.map(row => {
      if (row.id === id) {
        const updatedRow = { ...row, [field]: value };
        // Reset normalization flags on manual edit
        updatedRow.partyNormalized = checkPartyNormalized(updatedRow.customerCode, updatedRow.customerTin);
        updatedRow.itemNormalized = checkItemNormalized(updatedRow.itemCode);
        return updatedRow;
      }
      return row;
    }));
    setIsNormalized(false);
  };

  // Helper checks against master dictionary
  const checkPartyNormalized = (code: string, tin: string) => {
    return customers.some(c => c.clientCustomerCode === code || (tin && tin !== 'N/A' && c.tin === tin));
  };

  const checkItemNormalized = (sku: string) => {
    return itemMappings.some(m => m.clientSku === sku);
  };

  // Strict validation — highlight missing editable fields before send (shared lib)
  const getRowErrors = (row: SpreadsheetRow): string[] => sharedGetRowErrors(row as any);

  // Quick inline assignment from Master Dictionary
  const assignCustomerFromMaster = (rowId: string, custCode: string) => {
    const cust = customers.find(c => c.clientCustomerCode === custCode);
    if (!cust) return;

    setRows(prevRows => prevRows.map(r => {
      if (r.id === rowId) {
        return {
          ...r,
          customerCode: cust.clientCustomerCode,
          customerName: cust.name,
          customerTin: cust.tin || 'N/A',
          invoiceKind: cust.isB2B ? 'B2B' : 'B2C',
          partyNormalized: true
        };
      }
      return r;
    }));
    setShowDictionaryPicker(null);
  };

  const assignItemFromMaster = (rowId: string, sku: string) => {
    const item = itemMappings.find(m => m.clientSku === sku);
    if (!item) return;

    setRows(prevRows => prevRows.map(r => {
      if (r.id === rowId) {
        return {
          ...r,
          itemCode: item.clientSku,
          description: item.description,
          hsOrServiceCode: item.hsOrServiceCode,
          vatRate: item.defaultVatRate || 16,
          itemNormalized: true
        };
      }
      return r;
    }));
    setShowDictionaryPicker(null);
  };

  // Add New Row to Grid
  const handleAddRow = () => {
    const newRow: SpreadsheetRow = {
      id: `row_${Date.now()}`,
      clientInvoiceNumber: `EXCEL-INV-${1000 + rows.length + 1}`,
      invoiceKind: 'B2B',
      issueDate: new Date().toISOString().substring(0, 10),
      customerCode: 'CUST-NEW-01',
      customerName: 'New Client Entity',
      customerTin: 'P019283746Z',
      itemCode: 'SKU-NEW-ITEM',
      description: 'Consulting / Tech Service',
      quantity: 1,
      unitPrice: 50000,
      hsOrServiceCode: 'SRV-7212.10',
      vatRate: 16,
      partyNormalized: false,
      itemNormalized: false
    };
    setRows([...rows, newRow]);
    setIsNormalized(false);
  };

  // Delete Row
  const handleDeleteRow = (id: string) => {
    if (rows.length <= 1) {
      alert('Spreadsheet grid must contain at least one row.');
      return;
    }
    setRows(rows.filter(r => r.id !== id));
    setIsNormalized(false);
  };

  // Handle Excel / CSV File Upload — gold: supports 3-sheet EFS Template (Invoices/Customer/Product) + single-sheet alternative
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    setIsProcessing(true);
    setStatusMsg({ text: `Parsing spreadsheet '${file.name}' into interactive editor grid...`, type: 'info' });

    const reader = new FileReader();

    const processWorkbook = (workbook: any, fileName: string) => {
      try {
        const sheetNames = workbook.SheetNames || [];
        // Gold: 3-sheet EFS Template
        const hasInvoices = sheetNames.some((n:string)=> /^Invoices$/i.test(n.trim()));
        const hasCustomer = sheetNames.some((n:string)=> /^Customer$/i.test(n.trim()));
        const hasProduct = sheetNames.some((n:string)=> /^Product$/i.test(n.trim()));
        if (hasInvoices) {
          const invSheet = sheetNames.find((n:string)=> /^Invoices$/i.test(n.trim())) || sheetNames[0];
          const custSheet = sheetNames.find((n:string)=> /^Customer$/i.test(n.trim()));
          const prodSheet = sheetNames.find((n:string)=> /^Product$/i.test(n.trim()));
          const invData:any[] = XLSX.utils.sheet_to_json(workbook.Sheets[invSheet], { defval: '' });
          let custData:any[] = [];
          let prodData:any[] = [];
          if (custSheet) custData = XLSX.utils.sheet_to_json(workbook.Sheets[custSheet], { defval: '' });
          if (prodSheet) prodData = XLSX.utils.sheet_to_json(workbook.Sheets[prodSheet], { defval: '' });
          // Pre-populate master data from Customer/Product sheets before invoice rows
          if (custData.length) {
            custData.forEach((r:any)=>{
              const code = r.CustomerCode || r['CustomerCode'] || r['Customer Code'] || '';
              if (!code) return;
              // Will be normalized via handleNormalizeMasterData; just log
            });
          }
          parseAndLoadRows(invData, fileName, custData, prodData);
        } else {
          // Reference: invoice_template.xlsx Instructions: must delete Instructions sheet — prefer InvoiceTemplate explicitly
          const invoiceTemplateSheet = sheetNames.find((n:string)=> /^InvoiceTemplate$/i.test(n.trim()))
            || sheetNames.find((n:string)=> /Invoice/.test(n.trim()));
          const firstSheet = invoiceTemplateSheet || sheetNames[0];
          if (!invoiceTemplateSheet && (sheetNames.length > 1 || !/^(Customer Template|Item Template|Invoice Template|Sheet1)$/i.test(firstSheet))) {
            console.warn(`[Compliance] Expected sheet "InvoiceTemplate" or "Invoices" but got "${firstSheet}". Using "${firstSheet}". Reference: invoice_template.xlsx Instructions says delete Instructions sheet.`);
          }
          const rawData: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' });
          parseAndLoadRows(rawData, fileName);
        }
      } catch (err:any) {
        setIsProcessing(false);
        setStatusMsg({ text: `Parse Error: ${err.message}`, type: 'error' });
      }
    };

    if (file.name.endsWith('.csv') || file.type.includes('csv')) {
      reader.onload = (evt) => {
        try {
          const csvText = evt.target?.result as string;
          const workbook = XLSX.read(csvText, { type: 'string' });
          processWorkbook(workbook, file.name);
        } catch (err: any) {
          setIsProcessing(false);
          setStatusMsg({ text: `CSV Parse Error: ${err.message}`, type: 'error' });
        }
      };
      reader.readAsText(file);
    } else {
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          processWorkbook(workbook, file.name);
        } catch (err: any) {
          setIsProcessing(false);
          setStatusMsg({ text: `Excel Parse Error: ${err.message}`, type: 'error' });
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // XLSX auto-detects date-looking cell values (even from CSV) and returns them as
  // Excel serial-date numbers instead of strings. Convert those back to YYYY-MM-DD
  // so the date input and downstream validation both get a real date string.
  const normalizeIssueDate = (value: any): string => {
    if (typeof value === 'number') {
      const d = XLSX.SSF.parse_date_code(value);
      if (d) {
        return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      }
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return value.trim();
    }
    return new Date().toISOString().substring(0, 10);
  };

  const parseAndLoadRows = (rawData: any[], fileName: string, custData?: any[], prodData?: any[]) => {
    if (!rawData || rawData.length === 0) {
      setIsProcessing(false);
      setStatusMsg({ text: `File '${fileName}' contains no data rows.`, type: 'error' });
      return;
    }

    // Helper to get case-insensitive field with gold aliases
    const get = (r:any, ...keys:string[]) => {
      for (const k of keys) {
        if (r[k] !== undefined && r[k] !== '') return r[k];
        const found = Object.keys(r).find(x=> x.toLowerCase().replace(/[^a-z0-9]/g,'') === k.toLowerCase().replace(/[^a-z0-9]/g,''));
        if (found && r[found] !== '') return r[found];
      }
      return undefined;
    };

    const loadedRows: SpreadsheetRow[] = rawData.map((r, i) => {
      const cCode = get(r, 'customerCode','CustomerCode','Customercode','Customer Code') || `CUST-${i + 101}`;
      const cTin = get(r, 'customerTin','CustomerTin','TIN','Tax ID') || (r.invoiceKind === 'B2C' ? 'N/A' : 'P019283746Z');
      const iCode = get(r, 'itemCode','ItemCode','itemcode','SKU','Item Code') || `SKU-${i + 1}`;
      const docNum = get(r, 'documentNumber','DocumentNumber','Document Number');
      const invNum = get(r, 'clientInvoiceNumber','InvoiceNumber','Invoice number','Invoice Number') || `EXCEL-${i + 1}`;
      const itc = get(r, 'invoiceTypeCode','InvoiceTypeCode','Invoice Type','InvoiceType');
      const hdrCharges = Number(get(r, 'headerCharges','HeaderCharges','Header Charges') ?? 0);
      const hdrDiscount = Number(get(r, 'headerDiscount','HeaderDiscount','Header Discount') ?? 0);
      const lineNum = Number(get(r, 'lineNum','Linenumber','Line Number','Line number') ?? i+1);
      const unitCode = get(r, 'unitCode','UnitCode') || 'EA';
      const taxCat = get(r, 'taxCategoryId','TaxCategory','Tax Category') || 'STANDARD_VAT';
      const discount = Number(get(r, 'discountAmount','LineDiscount','Line Discount') ?? 0);
      const taxable = get(r, 'taxableAmount','taxableamount','Taxable Amount');
      const taxAmt = get(r, 'vatAmount','taxamount','Tax Amount','taxAmount');
      const currency = get(r, 'currency','Currency Code','CurrencyCode') || 'NGN';
      const billingIRNs = get(r, 'billingReferenceIrns','Billing Reference IRNs','BillingReferenceIRNs');
      // User defined 1-10 and Days...Division -> customFields
      const customFields: Record<string,any> = {};
      for (let n=1;n<=10;n++) { const v=get(r, `User defined${n}`, `UserDefined${n}`); if(v) customFields[`User defined${n}`]=v; }
      for (const k of ['Days','Group Code','Telephone','Website','Branch Network','Order Number','Sales Outlet','Sales Person','Branch Name','Division Code']) { const v=get(r,k); if(v) customFields[k]=v; }

      return {
        id: `row_up_${i}_${Date.now()}`,
        clientInvoiceNumber: String(invNum).trim(),
        documentNumber: docNum ? String(docNum).trim() : undefined,
        invoiceKind: (get(r, 'invoiceKind','Kind','InvoiceKind') || 'B2B').toUpperCase() as any,
        invoiceTypeCode: itc ? String(itc).trim() : undefined,
        issueDate: normalizeIssueDate(get(r, 'issueDate','IssueDate','Issuedate','Date')),
        customerCode: String(cCode).trim(),
        customerName: get(r, 'customerName','CustomerName','Name') || 'Uploaded Customer Entity',
        customerTin: String(cTin).trim(),
        itemCode: String(iCode).trim(),
        description: get(r, 'description','Description','ItemDescription','Item Description') || 'Uploaded Product Line Item',
        quantity: Number(get(r, 'quantity','Quantity','Qty') ?? 1),
        unitPrice: Number(get(r, 'unitPrice','UnitPrice','Price','price') ?? 0),
        hsOrServiceCode: get(r, 'hsOrServiceCode','HsOrServiceCode','HsorServiceCode','HSCode','HS Code') || 'HS-8471.30',
        vatRate: Number(get(r, 'vatRate','VatRate','VAT Rate') ?? 16),
        lineNum, unitCode, taxCategoryId: taxCat, discountAmount: discount,
        taxableAmount: taxable !== undefined ? Number(taxable) : undefined,
        vatAmount: taxAmt !== undefined ? Number(taxAmt) : undefined,
        headerCharges: hdrCharges, headerDiscount: hdrDiscount, currency,
        billingReferenceIrns: billingIRNs ? String(billingIRNs) : undefined,
        customFields: Object.keys(customFields).length ? customFields : undefined,
        partyNormalized: checkPartyNormalized(String(cCode).trim(), String(cTin).trim()),
        itemNormalized: checkItemNormalized(String(iCode).trim())
      };
    });

    // If 3-sheet gold, also handle Customer/Product sheets for master population (deferred to normalize step)
    if (custData && custData.length) {
      // Store for normalize step via window temp
      (window as any).__goldCustData = custData;
    }
    if (prodData && prodData.length) {
      (window as any).__goldProdData = prodData;
    }

    setRows(loadedRows);
    setIsProcessing(false);
    setIsNormalized(false);
    setStatusMsg({
      text: `Loaded ${loadedRows.length} spreadsheet rows from '${fileName}'. You can now review, edit, and normalize all items and customers against master data before submission.`,
      type: 'success'
    });
  };

  // Master Data Normalization Action — gold: also handles Customer/Product sheets if present
  const handleNormalizeMasterData = async () => {
    if (rows.length === 0) {
      setStatusMsg({ text: 'Upload an Excel or CSV file before normalizing master data.', type: 'error' });
      return;
    }

    setIsProcessing(true);
    setStatusMsg({ text: 'Normalizing row data against Master Party Directory & Item Classification Taxonomy...', type: 'info' });

    try {
      const updatedRows = [...rows];

      // Gold: if 3-sheet upload, use Customer/Product sheets for master data
      const goldCustData = (window as any).__goldCustData as any[] | undefined;
      const goldProdData = (window as any).__goldProdData as any[] | undefined;
      if (goldCustData && goldCustData.length) {
        for (const r of goldCustData) {
          const code = r.CustomerCode || r['CustomerCode'] || r['Customer Code'];
          const name = r['Name '] || r.Name || r['Name'];
          const tin = r['TIN '] || r.TIN || r['TIN'];
          const email = r['Email '] || r.Email || r['Email'];
          const ccEmail = r['CCEmail (optional) (seperate with ;)'] || r.CCEmail;
          const street = r['StreetName '] || r.StreetName || r['StreetName'];
          const city = r['CityName '] || r.CityName || r['CityName'];
          const country = r[' Country'] || r.Country || r['Country'] || 'NG';
          if (!code) continue;
          const exists = customers.find(c => c.clientCustomerCode === String(code).trim());
          if (!exists) {
            await addCustomer({
              clientCustomerCode: String(code).trim(),
              name: String(name || code).trim(),
              tin: String(tin || 'N/A').trim(),
              isB2B: String(tin || '').trim() !== 'N/A' && String(tin || '').trim() !== '',
              email: String(email || `billing@${String(code).toLowerCase().replace(/[^a-z0-9]/g,'')}.com`).trim(),
              street: String(street || 'Commercial Business Park').trim(),
              city: String(city || 'Lagos').trim(),
              country: String(country || 'NG').trim()
            }, targetTenantId);
            if (ccEmail) { /* ccEmail stored via addCustomer if supported */ }
          }
        }
      }
      if (goldProdData && goldProdData.length) {
        for (const r of goldProdData) {
          const code = r.ItemCode || r['ItemCode'] || r['Item Code'];
          if (!code) continue;
          const exists = itemMappings.find(m => m.clientSku === String(code).trim());
          if (!exists) {
            const hs = r.HsorServiceCode || r['HsorServiceCode'] || r['HSorServiceCode'] || 'HS-8471.30';
            const price = Number(r.price || r.Price || 0);
            const taxCat = r.TaxCategory || r['TaxCategory'] || 'STANDARD_VAT';
            await addItemMapping({
              clientSku: String(code).trim(),
              name: String(r.ItemName || r['ItemName'] || r.ItemDescription || code).trim(),
              description: String(r.ItemDescription || r['ItemDescription'] || r.ItemName || code).trim(),
              unitCode: String(r.UnitCode || r['UnitCode'] || 'EA').trim(),
              hsOrServiceCode: String(hs).trim(),
              category: 'General Goods',
              codeType: String(hs).startsWith('HS') ? 'HS_CODE' : 'SERVICE_CODE',
              codeDescription: String(r.ItemDescription || r['ItemDescription'] || '').trim(),
              defaultVatRate: taxCat === 'EXEMPT' ? 0 : (activeTenant?.defaultVatRate || 7.5),
              status: 'MAPPED'
            }, targetTenantId);
          }
        }
      }

      for (let i = 0; i < updatedRows.length; i++) {
        const row = updatedRows[i];

        // 1. Party / Customer Normalization
        let existingCust = customers.find(c => c.clientCustomerCode === row.customerCode || (row.customerTin !== 'N/A' && c.tin === row.customerTin));
        if (!existingCust && row.customerName) {
          await addCustomer({
            clientCustomerCode: row.customerCode,
            name: row.customerName,
            tin: row.customerTin || 'N/A',
            isB2B: row.invoiceKind === 'B2B' || row.invoiceKind === 'B2G',
            email: `billing@${row.customerCode.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
            street: 'Commercial Business Park',
            city: 'Nairobi',
            country: 'NG'
          }, targetTenantId);
        }
        row.partyNormalized = true;

        // 2. Item SKU Taxonomy Normalization
        let existingItem = itemMappings.find(m => m.clientSku === row.itemCode);
        if (!existingItem) {
          await addItemMapping({
            clientSku: row.itemCode,
            name: row.description,
            description: row.description,
            unitCode: (row as any).unitCode || 'EA',
            hsOrServiceCode: row.hsOrServiceCode || 'HS-8471.30',
            category: 'General Goods',
            codeType: (row.hsOrServiceCode || '').startsWith('HS') ? 'HS_CODE' : 'SERVICE_CODE',
            codeDescription: row.description,
            defaultVatRate: row.vatRate || activeTenant?.defaultVatRate || 7.5,
            status: 'MAPPED'
          }, targetTenantId);
        }
        row.itemNormalized = true;
      }

      setRows(updatedRows);
      setIsNormalized(true);
      setIsProcessing(false);
      setStatusMsg({
        text: `Master Data Normalization Complete! All ${updatedRows.length} rows cross-referenced & registered in Party Directory and SKU Item Classification Taxonomy.`,
        type: 'success'
      });
      await refreshAll();
    } catch (e: any) {
      setIsProcessing(false);
      setStatusMsg({ text: `Normalization Error: ${e.message}`, type: 'error' });
    }
  };

  // Download / Export Spreadsheet Workbook (.xlsx or .csv)
  const handleExportSpreadsheet = (format: 'xlsx' | 'csv') => {
    if (rows.length === 0) {
      setStatusMsg({ text: 'Upload an Excel or CSV file before exporting spreadsheet data.', type: 'error' });
      return;
    }

    const exportData = rows.map(r => ({
      clientInvoiceNumber: r.clientInvoiceNumber,
      invoiceKind: r.invoiceKind,
      issueDate: r.issueDate,
      customerCode: r.customerCode,
      customerName: r.customerName,
      customerTin: r.customerTin,
      itemCode: r.itemCode,
      description: r.description,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      subtotal: r.quantity * r.unitPrice,
      vatRate: r.vatRate,
      vatAmount: (r.quantity * r.unitPrice * (r.vatRate / 100)),
      totalAmount: (r.quantity * r.unitPrice) * (1 + r.vatRate / 100),
      hsOrServiceCode: r.hsOrServiceCode
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Normalized_Invoices');

    if (format === 'csv') {
      XLSX.writeFile(workbook, `CittaEFS_Normalized_Invoices_${Date.now()}.csv`);
    } else {
      XLSX.writeFile(workbook, `CittaEFS_Normalized_Invoices_${Date.now()}.xlsx`);
    }
    setStatusMsg({ text: `Exported normalized spreadsheet data as .${format} workbook!`, type: 'success' });
  };

  // EFS Template export — matches EFS Template.xlsx (Invoices/Customer/Product sheets)
  const handleExportEFSTemplate = () => {
    if (rows.length === 0) {
      setStatusMsg({ text: 'Add or upload rows before exporting EFS Template.', type: 'error' });
      return;
    }
    // Group rows by invoice for linenumber
    const groups = new Map<string, typeof rows>();
    rows.forEach(r => {
      const arr = groups.get(r.clientInvoiceNumber) || [];
      arr.push(r);
      groups.set(r.clientInvoiceNumber, arr);
    });

    // Invoices sheet — EFS Template headers
    const invoicesHeader = ["DocumentNumber","Customercode","Invoice number","Issuedate","HeaderCharges","HeaderDiscount","InvoiceTypeCode","Linenumber","itemcode","Price","Quantity","taxableamount","taxamount","LineDiscount","User defined1","User defined2","User defined3","User defined4","User defined5","User defined6","User defined7","User defined8","User defined9","User defined10"];
    const invoicesRows: any[][] = [invoicesHeader];
    groups.forEach((groupRows) => {
      groupRows.forEach((r, idx) => {
        const taxable = r.quantity * r.unitPrice;
        const tax = taxable * (r.vatRate / 100);
        invoicesRows.push([
          r.clientInvoiceNumber, // DocumentNumber
          r.customerCode, // Customercode
          r.clientInvoiceNumber, // Invoice number
          r.issueDate, // Issuedate
          0, // HeaderCharges
          0, // HeaderDiscount
          r.invoiceKind === 'B2C' ? '388' : '388', // InvoiceTypeCode (STANDARD)
          idx + 1, // Linenumber
          r.itemCode, // itemcode
          r.unitPrice, // Price
          r.quantity, // Quantity
          Number(taxable.toFixed(2)), // taxableamount
          Number(tax.toFixed(2)), // taxamount
          0, // LineDiscount
          "", "", "", "", "", "", "", "", "", "" // User defined1-10
        ]);
      });
    });

    // Customer sheet — unique customers
    const customerHeader = ["CustomerCode","Name ","TIN ","Email ","CCEmail (optional) (seperate with ;)", "StreetName ","CityName "," Country"];
    const customerMap = new Map<string, any>();
    rows.forEach(r => {
      if (!customerMap.has(r.customerCode)) {
        customerMap.set(r.customerCode, [r.customerCode, r.customerName, r.customerTin, `billing@${r.customerCode.toLowerCase().replace(/[^a-z0-9]/g,'')}.com`, "", "Commercial Business Park", "Lagos", "NG"]);
      }
    });
    const customerRows: any[][] = [customerHeader, ...Array.from(customerMap.values())];

    // Product sheet — unique items
    const productHeader = ["ItemCode","ItemName","ItemDescription","UnitCode","HsorServiceCode","price","TaxCategory"];
    const productMap = new Map<string, any>();
    rows.forEach(r => {
      if (!productMap.has(r.itemCode)) {
        productMap.set(r.itemCode, [r.itemCode, r.description, r.description, "EA", r.hsOrServiceCode, r.unitPrice, r.vatRate === 0 ? "EXEMPT" : "STANDARD_VAT"]);
      }
    });
    const productRows: any[][] = [productHeader, ...Array.from(productMap.values())];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invoicesRows), 'Invoices');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(customerRows), 'Customer');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(productRows), 'Product');
    XLSX.writeFile(wb, `EFS_Template_${activeTenant?.name?.replace(/[^A-Za-z0-9]/g,'_') || 'Export'}_${new Date().toISOString().slice(0,10)}.xlsx`);
    setStatusMsg({ text: `Exported EFS Template (Invoices ${invoicesRows.length-1} lines, ${customerMap.size} customers, ${productMap.size} products) — matches EFS Template.xlsx`, type: 'success' });
  };

  // Build preview before gateway send — strict validation with highlights
  const handleTransmitInvoices = async () => {
    if (rows.length === 0) {
      setStatusMsg({ text: 'Upload an Excel or CSV file before submitting invoices to the gateway.', type: 'error' });
      return;
    }
    if (!targetTenantId) {
      setStatusMsg({ text: 'Gateway Transmission Failure: no active client tenant is selected.', type: 'error' });
      return;
    }
    const invalidRows = rows.filter(r => getRowErrors(r).length>0);
    if (invalidRows.length>0) {
      setStatusMsg({ text: `${invalidRows.length} row(s) have missing/invalid fields (highlighted red below). Fix Invoice #, Customer TIN (10-14 alphanum for B2B), HS code, Qty/Price before Send.`, type: 'error' });
      return;
    }
    const groupedMap = new Map<string, any>();
    rows.forEach(r => {
      if (!groupedMap.has(r.clientInvoiceNumber)) {
        groupedMap.set(r.clientInvoiceNumber, {
          clientInvoiceNumber: r.clientInvoiceNumber,
          documentNumber: (r as any).documentNumber,
          invoiceKind: r.invoiceKind,
          invoiceTypeCode: (r as any).invoiceTypeCode,
          issueDate: r.issueDate,
          customerCode: r.customerCode,
          customerName: r.customerName,
          customerTin: r.customerTin,
          headerCharges: (r as any).headerCharges,
          headerDiscount: (r as any).headerDiscount,
          currency: (r as any).currency,
          billingReferenceIrns: (r as any).billingReferenceIrns,
          customFields: (r as any).customFields,
          lineItems: []
        });
      }
      const inv = groupedMap.get(r.clientInvoiceNumber);
      // Instructions:35-38 — Header Charges/Discount same on all rows for same invoice, Last row wins
      if ((r as any).headerCharges !== undefined) inv.headerCharges = (r as any).headerCharges;
      if ((r as any).headerDiscount !== undefined) inv.headerDiscount = (r as any).headerDiscount;
      if ((r as any).billingReferenceIrns) inv.billingReferenceIrns = (r as any).billingReferenceIrns;
      if ((r as any).currency) inv.currency = (r as any).currency;
      if ((r as any).customFields) inv.customFields = { ...(inv.customFields || {}), ...(r as any).customFields };
      inv.lineItems.push({
        itemCode: r.itemCode,
        description: r.description,
        quantity: Number(r.quantity),
        unitPrice: Number(r.unitPrice),
        vatRate: Number(r.vatRate || 7.5),
        hsOrServiceCode: r.hsOrServiceCode,
        lineNum: (r as any).lineNum,
        unitCode: (r as any).unitCode,
        taxCategoryId: (r as any).taxCategoryId,
        discountAmount: (r as any).discountAmount,
        taxableAmount: (r as any).taxableAmount,
        vatAmount: (r as any).vatAmount,
      });
    });
    const grouped = Array.from(groupedMap.values());
    setPreviewGroups(grouped);
    setShowPreview(true);
  };

  const handleConfirmTransmit = async () => {
    if (previewGroups.length === 0) return;
    setIsProcessing(true);
    setShowPreview(false);
    setStatusMsg({ text: 'Grouping multi-item invoices & transmitting to CittaEFS Gateway for IRN stamping...', type: 'info' });
    try {
      const res:any = await ingestCsvInvoices(previewGroups, targetTenantId);
      setIsProcessing(false);
      const failed = res?.failedCount ?? 0;
      const success = res?.successCount ?? previewGroups.length;
      if (failed > 0) {
        const details = (res?.results||[]).filter((r:any)=> !r.success).slice(0,3).map((r:any)=> `${r.clientInvoiceNumber}: ${(r.errors||[r.error||r.message]).join('; ')}`).join(' | ');
        setStatusMsg({
          text: `Batch finished: ${success} queued, ${failed} rejected — ${details} — check Invoices (REJECTED) + Validation Errors for full reason.`,
          type: 'error'
        });
      } else {
        setStatusMsg({
          text: `🎉 Batch Transmission Complete! Transmitted ${success} fiscal invoice(s) (${rows.length} line items) queued for IRN stamping. Duplicate numbers were treated as idempotent.`,
          type: 'success'
        });
      }
      await refreshAll();
    } catch (e: any) {
      setIsProcessing(false);
      setStatusMsg({ text: `Gateway Transmission Failure: ${e.message} — if this is a duplicate, it is already queued (idempotent). For REJECTED see Validation Errors tab.`, type: 'error' });
    }
  };

  // Totals Calculation
  const filteredRows = rows.filter(r => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.clientInvoiceNumber.toLowerCase().includes(term) ||
      r.customerName.toLowerCase().includes(term) ||
      r.customerCode.toLowerCase().includes(term) ||
      r.itemCode.toLowerCase().includes(term) ||
      r.description.toLowerCase().includes(term) ||
      r.customerTin.toLowerCase().includes(term)
    );
  });

  const totalSubtotal = filteredRows.reduce((sum, r) => sum + (r.quantity * r.unitPrice), 0);
  const totalVat = filteredRows.reduce((sum, r) => sum + ((r.quantity * r.unitPrice) * (r.vatRate / 100)), 0);
  const grandTotal = totalSubtotal + totalVat;
  const uniqueInvoicesCount = new Set(filteredRows.map(r => r.clientInvoiceNumber)).size;

  return (
    <div className="space-y-6 font-sans text-xs">

      {/* Top Banner Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-5 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600 border border-emerald-100">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900 tracking-tight">
                    Excel & CSV Document Viewer
                  </h2>
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold text-[10px] rounded-full border border-emerald-200/60">
                    Live Grid Editor
                  </span>
                </div>
                <p className="text-slate-500 text-xs mt-0.5">
                  View and edit uploaded spreadsheet documents. Normalize customer entities & SKUs against Master Data, then transmit to Gateway.
                </p>
              </div>
            </div>
          </div>

          {/* Action Button Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg cursor-pointer flex items-center gap-2 shadow-sm transition-all">
              <Upload className="w-4 h-4" />
              <span>Upload File</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            <button
              onClick={handleNormalizeMasterData}
              disabled={isProcessing || rows.length === 0}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg cursor-pointer flex items-center gap-2 shadow-sm transition-all"
            >
              <Sparkles className="w-4 h-4" />
              <span>Normalize Master Data</span>
            </button>

            <button
              onClick={handleTransmitInvoices}
              disabled={isProcessing || rows.length === 0}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg cursor-pointer flex items-center gap-2 shadow-sm transition-all"
            >
              <Play className="w-4 h-4 text-emerald-400" />
              <span>Preview & Submit to Gateway</span>
            </button>
          </div>
        </div>

        {/* Status Notification Banner */}
        {statusMsg && (
          <div className={`p-3.5 rounded-lg border text-xs font-medium flex items-center gap-2.5 ${statusMsg.type === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' :
              statusMsg.type === 'success' ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-slate-50 text-slate-800 border-slate-200'
            }`}>
            {statusMsg.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* Strict validation banner — highlights missing editable fields */}
        {(() => {
          const invalid = rows.filter(r => getRowErrors(r).length>0);
          if (invalid.length===0) return null;
          return (
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs">
              <div className="font-bold flex items-center gap-1"><AlertCircle className="w-4 h-4 text-amber-600" /> {invalid.length} row(s) have missing/invalid fields — highlighted red below. Fix before Send.</div>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {invalid.slice(0,3).map(r=> <li key={r.id}><span className="font-mono font-semibold">{r.clientInvoiceNumber}</span> — {getRowErrors(r).join('; ')}</li>)}
                {invalid.length>3 && <li>…and {invalid.length-3} more</li>}
              </ul>
            </div>
          );
        })()}

        {/* Summary Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200/70">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Active Document</span>
            <span className="font-semibold text-slate-800 truncate block mt-0.5">
              {uploadedFileName || 'Sample_Invoices.xlsx'}
            </span>
          </div>

          <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200/70">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Invoices / Lines</span>
            <span className="font-semibold text-indigo-600 mt-0.5 block">{uniqueInvoicesCount} Invoices ({filteredRows.length} Lines)</span>
          </div>

          <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200/70">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Subtotal (Excl. VAT)</span>
            <span className="font-semibold text-slate-800 mt-0.5 block">NGN {totalSubtotal.toLocaleString()}</span>
          </div>

          <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200/70">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Tax Amount (VAT)</span>
            <span className="font-semibold text-amber-600 mt-0.5 block">NGN {totalVat.toLocaleString()}</span>
          </div>

          <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200/70 col-span-2 sm:col-span-1">
            <span className="text-[10px] text-slate-400 font-semibold uppercase block">Grand Total</span>
            <span className="font-bold text-emerald-600 mt-0.5 block">NGN {grandTotal.toLocaleString()}</span>
          </div>
        </div>

        {/* Search & Export Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter by Invoice #, Customer, or SKU..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleAddRow}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg border border-slate-200 cursor-pointer flex items-center gap-1.5 transition-all"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-600" />
              <span>Add Row</span>
            </button>

            <button
              onClick={handleExportEFSTemplate}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs rounded-lg border border-violet-700 cursor-pointer flex items-center gap-1.5 transition-all"
              title="Export 3-sheet EFS Template (Invoices/Customer/Product) matching EFS Template.xlsx"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export EFS Template</span>
            </button>

            <button
              onClick={() => handleExportSpreadsheet('xlsx')}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-lg border border-slate-200 cursor-pointer flex items-center gap-1.5 transition-all"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export .xlsx</span>
            </button>

            <button
              onClick={() => handleExportSpreadsheet('csv')}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-lg border border-slate-200 cursor-pointer flex items-center gap-1.5 transition-all"
            >
              <Download className="w-3.5 h-3.5 text-indigo-600" />
              <span>Export .csv</span>
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Grid Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 overflow-x-auto shadow-sm">
        <table className="w-full text-left border-collapse min-w-[1200px]">
          <thead>
            <tr className="bg-slate-50/80 text-slate-600 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-200">
              <th className="p-3 w-10 text-center">#</th>
              <th className="p-3">Invoice #</th>
              <th className="p-3 w-24">Type</th>
              <th className="p-3 w-28">Date</th>
              <th className="p-3 min-w-[180px]">Customer Name & Code</th>
              <th className="p-3 w-32">Customer TIN</th>
              <th className="p-3 min-w-[160px]">Item SKU</th>
              <th className="p-3 min-w-[200px]">Line Description</th>
              <th className="p-3 w-20 text-right">Qty</th>
              <th className="p-3 w-28 text-right">Unit Price</th>
              <th className="p-3 w-28 text-right">Subtotal</th>
              <th className="p-3 w-28">HS / Service Code</th>
              <th className="p-3 w-20 text-right">VAT%</th>
              <th className="p-3 text-center w-12 font-normal">Del</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={14} className="p-8 text-center text-slate-400 font-medium">
                  {rows.length === 0
                    ? 'Upload an Excel or CSV file to preview invoice rows here.'
                    : `No spreadsheet rows matched search term '${searchTerm}'.`}
                </td>
              </tr>
            ) : (
              filteredRows.map((row, idx) => {
                const isPartyNorm = checkPartyNormalized(row.customerCode, row.customerTin);
                const isItemNorm = checkItemNormalized(row.itemCode);
                const lineSubtotal = row.quantity * row.unitPrice;

                return (
                  <tr key={row.id} className="hover:bg-indigo-50/30 transition-colors">

                    {/* Index */}
                    <td className="p-2.5 text-center font-semibold text-slate-400">
                      {idx + 1}
                    </td>

                    {/* Invoice Number */}
                    <td className="p-2">
                      <input
                        type="text"
                        value={row.clientInvoiceNumber}
                        onChange={(e) => handleCellChange(row.id, 'clientInvoiceNumber', e.target.value)}
                        className={`w-full px-2 py-1 font-semibold text-slate-900 rounded border focus:ring-1 focus:outline-none uppercase text-xs ${getRowErrors(row).some(e=>e.includes('Invoice #')) ? 'border-rose-300 bg-rose-50 focus:border-rose-500 focus:ring-rose-500' : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 bg-white'}`}
                      />
                    </td>

                    {/* Kind */}
                    <td className="p-2">
                      <select
                        value={row.invoiceKind}
                        onChange={(e) => handleCellChange(row.id, 'invoiceKind', e.target.value)}
                        className="w-full px-2 py-1 font-semibold text-slate-800 rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white cursor-pointer text-xs"
                      >
                        <option value="B2B">B2B</option>
                        <option value="B2C">B2C</option>
                        <option value="B2G">B2G</option>
                        <option value="EXPORT">EXPORT</option>
                      </select>
                    </td>

                    {/* Issue Date */}
                    <td className="p-2">
                      <input
                        type="date"
                        value={row.issueDate}
                        onChange={(e) => handleCellChange(row.id, 'issueDate', e.target.value)}
                        className="w-full px-2 py-1 font-medium text-slate-800 rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-xs"
                      />
                    </td>

                    {/* Customer Name & Code */}
                    <td className="p-2 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={row.customerName}
                          onChange={(e) => handleCellChange(row.id, 'customerName', e.target.value)}
                          placeholder="Customer Name"
                          className="w-full px-2 py-1 font-semibold text-slate-900 rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setShowDictionaryPicker(showDictionaryPicker?.rowId === row.id && showDictionaryPicker.type === 'customer' ? null : { rowId: row.id, type: 'customer' })}
                          title="Pick from Master Customer Directory"
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[10px] rounded border border-slate-200 cursor-pointer shrink-0"
                        >
                          Pick
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-1 text-[10px]">
                        <input
                          type="text"
                          value={row.customerCode}
                          onChange={(e) => handleCellChange(row.id, 'customerCode', e.target.value)}
                          placeholder="Code"
                          className="w-24 px-1.5 py-0.5 font-medium text-slate-500 rounded border border-slate-100 focus:outline-none bg-slate-50"
                        />

                        {isPartyNorm ? (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-medium text-[9px] rounded-full border border-emerald-200 flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-600" /> Matched
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 font-medium text-[9px] rounded-full border border-amber-200 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-amber-600" /> Unregistered
                          </span>
                        )}
                      </div>

                      {/* Dropdown Picker Popup for Customer */}
                      {showDictionaryPicker?.rowId === row.id && showDictionaryPicker.type === 'customer' && (
                        <div className="p-3 bg-slate-900 text-white rounded-xl shadow-xl space-y-2 mt-1 z-20 relative border border-slate-800">
                          <span className="text-[10px] text-indigo-400 font-semibold uppercase block">
                            Master Customer Directory:
                          </span>
                          <div className="max-h-36 overflow-y-auto space-y-1">
                            {customers.map(c => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => assignCustomerFromMaster(row.id, c.clientCustomerCode)}
                                className="w-full text-left px-2.5 py-1.5 bg-slate-800 hover:bg-indigo-600 text-white text-[11px] rounded font-medium flex justify-between items-center cursor-pointer transition-colors"
                              >
                                <span>{c.name} ({c.clientCustomerCode})</span>
                                <span className="text-slate-400">{c.tin}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Customer TIN */}
                    <td className="p-2">
                      <input
                        type="text"
                        value={row.customerTin}
                        onChange={(e) => handleCellChange(row.id, 'customerTin', e.target.value)}
                        className="w-full px-2 py-1 font-mono font-medium text-slate-800 rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-xs uppercase"
                      />
                    </td>

                    {/* Item SKU Code */}
                    <td className="p-2 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={row.itemCode}
                          onChange={(e) => handleCellChange(row.id, 'itemCode', e.target.value)}
                          className="w-full px-2 py-1 font-mono font-medium text-slate-900 rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-xs uppercase"
                        />
                        <button
                          type="button"
                          onClick={() => setShowDictionaryPicker(showDictionaryPicker?.rowId === row.id && showDictionaryPicker.type === 'item' ? null : { rowId: row.id, type: 'item' })}
                          title="Pick from Master SKU Taxonomy"
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[10px] rounded border border-slate-200 cursor-pointer shrink-0"
                        >
                          Pick
                        </button>
                      </div>

                      <div className="flex items-center justify-end">
                        {isItemNorm ? (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-medium text-[9px] rounded-full border border-emerald-200 flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-600" /> SKU Mapped
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 font-medium text-[9px] rounded-full border border-amber-200 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-amber-600" /> Unmapped SKU
                          </span>
                        )}
                      </div>

                      {/* Dropdown Picker Popup for SKU */}
                      {showDictionaryPicker?.rowId === row.id && showDictionaryPicker.type === 'item' && (
                        <div className="p-3 bg-slate-900 text-white rounded-xl shadow-xl space-y-2 mt-1 z-20 relative border border-slate-800">
                          <span className="text-[10px] text-indigo-400 font-semibold uppercase block">
                            Master SKU Classification:
                          </span>
                          <div className="max-h-36 overflow-y-auto space-y-1">
                            {itemMappings.map(m => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => assignItemFromMaster(row.id, m.clientSku)}
                                className="w-full text-left px-2.5 py-1.5 bg-slate-800 hover:bg-indigo-600 text-white text-[11px] rounded font-medium flex justify-between items-center cursor-pointer transition-colors"
                              >
                                <span>{m.description} ({m.clientSku})</span>
                                <span className="text-indigo-300">{m.hsOrServiceCode}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Description */}
                    <td className="p-2">
                      <input
                        type="text"
                        value={row.description}
                        onChange={(e) => handleCellChange(row.id, 'description', e.target.value)}
                        className="w-full px-2 py-1 font-medium text-slate-900 rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-xs"
                      />
                    </td>

                    {/* Quantity */}
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        min="1"
                        value={row.quantity}
                        onChange={(e) => handleCellChange(row.id, 'quantity', Number(e.target.value))}
                        className="w-20 px-2 py-1 font-semibold text-slate-900 text-right rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </td>

                    {/* Unit Price */}
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        min="0"
                        value={row.unitPrice}
                        onChange={(e) => handleCellChange(row.id, 'unitPrice', Number(e.target.value))}
                        className="w-28 px-2 py-1 font-semibold text-slate-900 text-right rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </td>

                    {/* Line Subtotal */}
                    <td className="p-3 text-right font-bold text-slate-900">
                      {lineSubtotal.toLocaleString()}
                    </td>

                    {/* HS / Service Code */}
                    <td className="p-2">
                      <input
                        type="text"
                        value={row.hsOrServiceCode}
                        onChange={(e) => handleCellChange(row.id, 'hsOrServiceCode', e.target.value)}
                        className="w-full px-2 py-1 font-mono font-medium text-slate-900 rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-xs uppercase"
                      />
                    </td>

                    {/* VAT Rate */}
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        value={row.vatRate}
                        onChange={(e) => handleCellChange(row.id, 'vatRate', Number(e.target.value))}
                        className="w-16 px-2 py-1 font-semibold text-slate-900 text-right rounded border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </td>

                    {/* Delete Action */}
                    <td className="p-2 text-center">
                      <button
                        onClick={() => handleDeleteRow(row.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Delete Row"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>

                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom Master Data Sync Banner */}
      <div className="p-5 bg-slate-900 text-white rounded-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400 shrink-0 mt-0.5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-sm text-white block">
              Automated Data Dictionary Normalization
            </span>
            <p className="text-xs text-slate-400 mt-0.5">
              Unmapped customers & SKU codes are automatically cross-referenced, assigned standard HS tax codes, and written to the CittaEFS Master Data directory.
            </p>
          </div>
        </div>

        <button
          onClick={handleNormalizeMasterData}
          disabled={isProcessing}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer shrink-0 flex items-center gap-2 transition-all"
        >
          <Sparkles className="w-4 h-4 text-indigo-200" />
          <span>Sync Master Dictionary</span>
        </button>
      </div>

      {/* Preview Modal — grouped invoices before gateway send */}
      {showPreview && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-50 max-w-5xl w-full max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-6 my-8">
            <div className="flex items-center justify-between sticky top-0 bg-slate-50 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-900">Preview Invoices Before Gateway Submission</h3>
                <p className="text-xs text-slate-500 mt-0.5">Review {previewGroups.length} invoice(s) grouped from {rows.length} rows — no data has been sent yet.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowPreview(false)} className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 font-semibold text-xs cursor-pointer">Back to Edit</button>
                <button onClick={handleConfirmTransmit} disabled={isProcessing} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{isProcessing ? 'Transmitting...' : `Confirm & Send ${previewGroups.length} Invoice(s)`}</span>
                </button>
              </div>
            </div>
            <div className="space-y-8">
              {previewGroups.map((inv: any, idx: number) => (
                <div key={inv.clientInvoiceNumber + idx} className="space-y-2">
                  <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">Invoice {idx + 1} of {previewGroups.length}</span>
                  <InvoicePreview
                    clientInvoiceNumber={inv.clientInvoiceNumber}
                    invoiceKind={inv.invoiceKind}
                    invoiceType="STANDARD"
                    issueDate={inv.issueDate}
                    customerName={inv.customerName}
                    customerTin={inv.customerTin}
                    customerCode={inv.customerCode}
                    lineItems={inv.lineItems}
                    tenantName={activeTenant?.name || targetTenantId}
                  />
                </div>
              ))}
            </div>
            <div className="sticky bottom-0 bg-slate-50 pt-3 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setShowPreview(false)} className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-lg border border-slate-200 cursor-pointer">Cancel</button>
              <button onClick={handleConfirmTransmit} disabled={isProcessing} className="px-5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer flex items-center gap-2">
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>Send {previewGroups.length} Invoice(s) to CittaEFS</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
