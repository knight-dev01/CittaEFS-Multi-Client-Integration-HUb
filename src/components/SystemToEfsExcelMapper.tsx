import { useState } from 'react';
import { 
  ArrowRight, 
  Database, 
  FileSpreadsheet, 
  Globe, 
  Server, 
  Zap, 
  Sliders, 
  CheckCircle2, 
  Code2, 
  Layers, 
  Sparkles,
  HelpCircle,
  FileCode2,
  RefreshCw,
  Check
} from 'lucide-react';

interface SystemMappingConfig {
  id: string;
  name: string;
  icon: any;
  badge: string;
  color: string;
  description: string;
  mappings: {
    sourceField: string;
    efsExcelColumn: string;
    transformationRule: string;
    nrsTargetField: string;
    exampleValue: string;
  }[];
}

const SYSTEM_MAPPINGS: SystemMappingConfig[] = [
  {
    id: 'qbo',
    name: 'QuickBooks Online (QBO)',
    icon: Globe,
    badge: 'OAuth2 REST / Webhook',
    color: 'border-emerald-600 bg-emerald-50 text-emerald-950',
    description: 'QBO invoice objects & CDC webhook events map directly into EFS Excel column standards before fiscal signing.',
    mappings: [
      {
        sourceField: 'DocNumber',
        efsExcelColumn: 'InvoiceNumber',
        transformationRule: 'DIRECT_PASSTHROUGH',
        nrsTargetField: 'clientInvoiceNumber',
        exampleValue: 'QBO-99201'
      },
      {
        sourceField: 'CustomerRef.TaxId / TIN',
        efsExcelColumn: 'CustomerTIN',
        transformationRule: 'TRIM_UPPERCASE_VALIDATE_NRS_TIN',
        nrsTargetField: 'customer.customerTin',
        exampleValue: 'P019283746Z'
      },
      {
        sourceField: 'TxnDate (YYYY-MM-DD)',
        efsExcelColumn: 'IssueDate',
        transformationRule: 'CONVERT_UTC_ISO8601',
        nrsTargetField: 'issueDateUtc',
        exampleValue: '2026-07-28'
      },
      {
        sourceField: 'Line.SalesItemLineDetail.ItemRef.Name',
        efsExcelColumn: 'ItemDescription',
        transformationRule: 'TRIM_AND_SANITIZE',
        nrsTargetField: 'lineItems[].description',
        exampleValue: 'Dell XPS 15 Laptop'
      },
      {
        sourceField: 'Line.Amount',
        efsExcelColumn: 'LineTotalAmount',
        transformationRule: 'DECIMAL_2_PLACES',
        nrsTargetField: 'lineItems[].totalAmount',
        exampleValue: '120000.00'
      },
      {
        sourceField: 'ClassRef.Name / SKU',
        efsExcelColumn: 'HsOrServiceCode',
        transformationRule: 'DICTIONARY_HS_LOOKUP',
        nrsTargetField: 'lineItems[].hsOrServiceCode',
        exampleValue: 'HS-8471.30'
      }
    ]
  },
  {
    id: 'sap',
    name: 'SAP S/4HANA OData',
    icon: Server,
    badge: 'Enterprise OData',
    color: 'border-indigo-600 bg-indigo-50 text-indigo-950',
    description: 'SAP billing documents (`API_INVOICE_SRV`) mapped to standardized EFS Excel columns.',
    mappings: [
      {
        sourceField: 'BillingDocument',
        efsExcelColumn: 'InvoiceNumber',
        transformationRule: 'PREFIX_SAP_DOC',
        nrsTargetField: 'clientInvoiceNumber',
        exampleValue: 'SAP-900812'
      },
      {
        sourceField: 'STCEG (Tax Number 1)',
        efsExcelColumn: 'CustomerTIN',
        transformationRule: 'VALIDATE_TAX_ID_FORMAT',
        nrsTargetField: 'customer.customerTin',
        exampleValue: 'P000998877F'
      },
      {
        sourceField: 'FKDAT (Billing Date)',
        efsExcelColumn: 'IssueDate',
        transformationRule: 'FORMAT_YYYY_MM_DD',
        nrsTargetField: 'issueDateUtc',
        exampleValue: '2026-07-28'
      },
      {
        sourceField: 'ARKTX (Item Short Text)',
        efsExcelColumn: 'ItemDescription',
        transformationRule: 'PASSTHROUGH',
        nrsTargetField: 'lineItems[].description',
        exampleValue: 'Consulting Logistics Setup'
      },
      {
        sourceField: 'NETWR (Net Value in Doc Currency)',
        efsExcelColumn: 'LineTotalAmount',
        transformationRule: 'FORMAT_CURRENCY_NUMERIC',
        nrsTargetField: 'lineItems[].totalAmount',
        exampleValue: '85000.00'
      },
      {
        sourceField: 'MATNR / MWSKZ (Material Tax Code)',
        efsExcelColumn: 'HsOrServiceCode',
        transformationRule: 'AUTO_INFER_NRS_SERVICE_CODE',
        nrsTargetField: 'lineItems[].hsOrServiceCode',
        exampleValue: 'SRV-8703.20'
      }
    ]
  },
  {
    id: 'netsuite',
    name: 'NetSuite SuiteTalk RESTlet',
    icon: Zap,
    badge: 'TBA HMAC-SHA256',
    color: 'border-amber-600 bg-amber-50 text-amber-950',
    description: 'SuiteTalk RESTlet invoice payloads mapped into CittaEFS Excel ingestion structure.',
    mappings: [
      {
        sourceField: 'tranId',
        efsExcelColumn: 'InvoiceNumber',
        transformationRule: 'DIRECT_ASSIGN',
        nrsTargetField: 'clientInvoiceNumber',
        exampleValue: 'NS-INV-4401'
      },
      {
        sourceField: 'vatRegNum',
        efsExcelColumn: 'CustomerTIN',
        transformationRule: 'CLEAN_NON_ALPHANUMERIC',
        nrsTargetField: 'customer.customerTin',
        exampleValue: 'P019283746Z'
      },
      {
        sourceField: 'trandate',
        efsExcelColumn: 'IssueDate',
        transformationRule: 'PARSE_MM_DD_YYYY',
        nrsTargetField: 'issueDateUtc',
        exampleValue: '2026-07-28'
      },
      {
        sourceField: 'item_description',
        efsExcelColumn: 'ItemDescription',
        transformationRule: 'PASSTHROUGH',
        nrsTargetField: 'lineItems[].description',
        exampleValue: 'Oracle License Renewal'
      },
      {
        sourceField: 'amount',
        efsExcelColumn: 'LineTotalAmount',
        transformationRule: 'CONVERT_FLOAT',
        nrsTargetField: 'lineItems[].totalAmount',
        exampleValue: '250000.00'
      },
      {
        sourceField: 'custcol_hs_code',
        efsExcelColumn: 'HsOrServiceCode',
        transformationRule: 'VALIDATE_HS_REGISTRY',
        nrsTargetField: 'lineItems[].hsOrServiceCode',
        exampleValue: 'HS-8471.30'
      }
    ]
  },
  {
    id: 'sql',
    name: 'Custom SQL Staging View',
    icon: Database,
    badge: 'PostgreSQL / SQL Server',
    color: 'border-slate-700 bg-slate-100 text-slate-900',
    description: 'Relational database view (`vw_pending_invoices`) column mapping into EFS Excel schema.',
    mappings: [
      {
        sourceField: 'inv_no',
        efsExcelColumn: 'InvoiceNumber',
        transformationRule: 'DIRECT_PASSTHROUGH',
        nrsTargetField: 'clientInvoiceNumber',
        exampleValue: 'SQL-STG-8812'
      },
      {
        sourceField: 'cust_tin',
        efsExcelColumn: 'CustomerTIN',
        transformationRule: 'CHECK_NULL_DOWNGRADE_B2C',
        nrsTargetField: 'customer.customerTin',
        exampleValue: 'P019283746Z'
      },
      {
        sourceField: 'created_at',
        efsExcelColumn: 'IssueDate',
        transformationRule: 'TRUNCATE_DATE',
        nrsTargetField: 'issueDateUtc',
        exampleValue: '2026-07-28'
      },
      {
        sourceField: 'item_name',
        efsExcelColumn: 'ItemDescription',
        transformationRule: 'TRIM_WHITESPACE',
        nrsTargetField: 'lineItems[].description',
        exampleValue: 'Heavy Industrial Pumps'
      },
      {
        sourceField: 'subtotal',
        efsExcelColumn: 'LineTotalAmount',
        transformationRule: 'NUMERIC_PARSE',
        nrsTargetField: 'lineItems[].totalAmount',
        exampleValue: '450000.00'
      },
      {
        sourceField: 'hs_tariff_code',
        efsExcelColumn: 'HsOrServiceCode',
        transformationRule: 'DEFAULT_LOOKUP',
        nrsTargetField: 'lineItems[].hsOrServiceCode',
        exampleValue: 'HS-8471.30'
      }
    ]
  },
  {
    id: 'excel_native',
    name: 'Direct Excel (.xlsx / .xls) File Upload',
    icon: FileSpreadsheet,
    badge: 'EFS Excel Sheet Native',
    color: 'border-emerald-600 bg-emerald-100 text-emerald-950',
    description: 'Official EFS Excel Fiscal Ingestion Template standard. Direct 1:1 mapping with automatic row grouping.',
    mappings: [
      {
        sourceField: 'clientInvoiceNumber',
        efsExcelColumn: 'InvoiceNumber',
        transformationRule: 'ROW_GROUPING_KEY',
        nrsTargetField: 'clientInvoiceNumber',
        exampleValue: 'EFS-EXCEL-001'
      },
      {
        sourceField: 'customerTin',
        efsExcelColumn: 'CustomerTIN',
        transformationRule: 'REGULATORY_TIN_CHECK',
        nrsTargetField: 'customer.customerTin',
        exampleValue: 'P019283746Z'
      },
      {
        sourceField: 'issueDate',
        efsExcelColumn: 'IssueDate',
        transformationRule: 'DATE_ISO_FORMAT',
        nrsTargetField: 'issueDateUtc',
        exampleValue: '2026-07-28'
      },
      {
        sourceField: 'description',
        efsExcelColumn: 'ItemDescription',
        transformationRule: 'NRS_STRING_ESCAPE',
        nrsTargetField: 'lineItems[].description',
        exampleValue: 'Enterprise Cloud Server'
      },
      {
        sourceField: 'unitPrice',
        efsExcelColumn: 'UnitPrice',
        transformationRule: 'CURRENCY_MULTIPLY_QTY',
        nrsTargetField: 'lineItems[].unitPrice',
        exampleValue: '350000.00'
      },
      {
        sourceField: 'hsOrServiceCode',
        efsExcelColumn: 'HsOrServiceCode',
        transformationRule: 'TAXONOMY_MATCH',
        nrsTargetField: 'lineItems[].hsOrServiceCode',
        exampleValue: 'HS-8471.30'
      }
    ]
  }
];

export function SystemToEfsExcelMapper() {
  const [selectedSystemId, setSelectedSystemId] = useState<string>('qbo');
  const [activeTab, setActiveTab] = useState<'MAPPER' | 'PIPELINE' | 'SCHEMA_JSON'>('MAPPER');
  const [isSimulatingTransform, setIsSimulatingTransform] = useState(false);
  const [transformedOutput, setTransformedOutput] = useState<any | null>(null);

  const selectedSystem = SYSTEM_MAPPINGS.find(s => s.id === selectedSystemId) || SYSTEM_MAPPINGS[0];

  const handleRunTransformationSimulation = () => {
    setIsSimulatingTransform(true);
    setTransformedOutput(null);

    setTimeout(() => {
      const transformedSampleJson = {
        tenantId: 'tenant_qbo_smb',
        sourceAdapter: selectedSystem.name,
        ingestionProtocol: selectedSystem.badge,
        efsExcelStandardRow: {
          clientInvoiceNumber: selectedSystem.mappings[0].exampleValue,
          customerTin: selectedSystem.mappings[1].exampleValue,
          issueDate: selectedSystem.mappings[2].exampleValue,
          lineItems: [
            {
              description: selectedSystem.mappings[3].exampleValue,
              totalAmount: parseFloat(selectedSystem.mappings[4].exampleValue.replace(/,/g, '')),
              hsOrServiceCode: selectedSystem.mappings[5].exampleValue,
              vatPercentage: 16.0
            }
          ]
        },
        cittaEfsNrsPayload: {
          header: {
            irn: `IRN-${selectedSystem.id.toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`,
            issueDateUtc: new Date().toISOString(),
            schemaVersion: 'NRS_2026_V2'
          },
          taxpayer: {
            tin: selectedSystem.mappings[1].exampleValue,
            status: 'NRS_VERIFIED'
          },
          validationStatus: 'PASSED_100_PERCENT'
        }
      };

      setTransformedOutput(transformedSampleJson);
      setIsSimulatingTransform(false);
    }, 600);
  };

  return (
    <div className="bg-white border-2 border-slate-900 p-4 sm:p-5 space-y-5 font-mono text-xs">
      
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-4 border-2 border-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-black text-amber-400 uppercase flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-400" />
            <span>How Systems Map to EFS Excel Ingestion Schema</span>
          </h3>
          <p className="text-[11px] text-slate-300 mt-1">
            Visual breakdown demonstrating how ERP APIs, Webhooks, SQL Views, and spreadsheets convert into the EFS Excel Matrix for NRS submission.
          </p>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 border border-slate-800 self-stretch sm:self-auto overflow-x-auto">
          <button
            onClick={() => setActiveTab('MAPPER')}
            className={`px-3 py-1.5 font-black uppercase text-[10px] cursor-pointer whitespace-nowrap ${
              activeTab === 'MAPPER' ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            Visual Field Matrix
          </button>
          <button
            onClick={() => setActiveTab('PIPELINE')}
            className={`px-3 py-1.5 font-black uppercase text-[10px] cursor-pointer whitespace-nowrap ${
              activeTab === 'PIPELINE' ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            4-Stage Pipeline Architecture
          </button>
          <button
            onClick={() => setActiveTab('SCHEMA_JSON')}
            className={`px-3 py-1.5 font-black uppercase text-[10px] cursor-pointer whitespace-nowrap ${
              activeTab === 'SCHEMA_JSON' ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            Live Payload Previewer
          </button>
        </div>
      </div>

      {/* System Selector Cards */}
      <div>
        <label className="block font-black text-slate-900 uppercase mb-2">Select Source System Architecture:</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {SYSTEM_MAPPINGS.map((sys) => {
            const Icon = sys.icon;
            const isSelected = sys.id === selectedSystemId;

            return (
              <button
                key={sys.id}
                onClick={() => {
                  setSelectedSystemId(sys.id);
                  setTransformedOutput(null);
                }}
                className={`p-3 text-left border-2 border-slate-900 transition cursor-pointer flex flex-col justify-between space-y-2 ${
                  isSelected ? 'bg-slate-900 text-white shadow-md' : 'bg-slate-50 text-slate-900 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-indigo-600'}`} />
                  {isSelected && <Check className="w-3.5 h-3.5 text-amber-400" />}
                </div>

                <div>
                  <div className="font-black text-[11px] leading-tight uppercase">{sys.name}</div>
                  <div className={`text-[9px] mt-1 font-bold ${isSelected ? 'text-amber-300' : 'text-slate-500'}`}>
                    {sys.badge}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: VISUAL FIELD MATRIX */}
      {activeTab === 'MAPPER' && (
        <div className="space-y-4">
          <div className="p-3 bg-slate-50 border-2 border-slate-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div>
              <span className="font-black text-slate-900 uppercase text-xs">Active Mapping Profile: </span>
              <strong className="text-indigo-700 font-black text-xs">{selectedSystem.name}</strong>
            </div>
            <p className="text-[11px] text-slate-600">{selectedSystem.description}</p>
          </div>

          {/* Table displaying field mapping path */}
          <div className="border-2 border-slate-900 overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-slate-900 text-amber-400 font-black text-[10px] uppercase border-b-2 border-slate-900">
                  <th className="p-2.5">1. Source System Field</th>
                  <th className="p-2.5">2. EFS Excel Column</th>
                  <th className="p-2.5">3. Transformation Rule</th>
                  <th className="p-2.5">4. NRS Gateway Target Field</th>
                  <th className="p-2.5">Sample Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-[11px] font-bold text-slate-800">
                {selectedSystem.mappings.map((m, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'}>
                    <td className="p-2.5 font-mono text-indigo-900">{m.sourceField}</td>
                    <td className="p-2.5 font-mono text-emerald-800 font-black">
                      <span className="bg-emerald-100 border border-emerald-300 px-1.5 py-0.5">
                        {m.efsExcelColumn}
                      </span>
                    </td>
                    <td className="p-2.5 text-[10px] font-mono text-slate-600 uppercase">{m.transformationRule}</td>
                    <td className="p-2.5 font-mono text-amber-800">{m.nrsTargetField}</td>
                    <td className="p-2.5 font-mono text-slate-900 bg-slate-100">{m.exampleValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleRunTransformationSimulation}
              disabled={isSimulatingTransform}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black uppercase border-2 border-slate-900 cursor-pointer flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isSimulatingTransform ? 'animate-spin' : ''}`} />
              <span>Simulate Live Mapping Transformation</span>
            </button>
          </div>

          {transformedOutput && (
            <div className="p-4 bg-slate-950 text-white border-2 border-slate-900 space-y-2 font-mono">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-emerald-400 font-black flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Mapping & Schema Standard Transformation Successful!</span>
                </span>
                <span className="text-[10px] bg-emerald-400 text-slate-950 font-black px-2 py-0.5">
                  NRS READY
                </span>
              </div>
              <pre className="text-[10px] text-emerald-400 bg-slate-900 p-3 overflow-x-auto max-h-60 border border-slate-800">
                {JSON.stringify(transformedOutput, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: 4-STAGE PIPELINE ARCHITECTURE */}
      {activeTab === 'PIPELINE' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            
            <div className="bg-slate-50 border-2 border-slate-900 p-3 space-y-2">
              <div className="flex items-center justify-between text-indigo-700 font-black text-[10px] uppercase">
                <span>Stage 01</span>
                <Database className="w-4 h-4" />
              </div>
              <h4 className="font-black text-slate-900 text-xs uppercase">Source Extraction</h4>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Connectors fetch raw invoice events via OAuth webhooks, OData endpoints, SQL view pollers, or manual Excel drops.
              </p>
            </div>

            <div className="bg-slate-50 border-2 border-slate-900 p-3 space-y-2">
              <div className="flex items-center justify-between text-amber-700 font-black text-[10px] uppercase">
                <span>Stage 02</span>
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <h4 className="font-black text-slate-900 text-xs uppercase">EFS Excel Standard Matrix</h4>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                All incoming payloads are converted into the standardized EFS Excel Matrix (`InvoiceNumber`, `CustomerTIN`, `HsOrServiceCode`, `VatRate`).
              </p>
            </div>

            <div className="bg-slate-50 border-2 border-slate-900 p-3 space-y-2">
              <div className="flex items-center justify-between text-emerald-700 font-black text-[10px] uppercase">
                <span>Stage 03</span>
                <Sparkles className="w-4 h-4" />
              </div>
              <h4 className="font-black text-slate-900 text-xs uppercase">Taxonomy & Rule Verification</h4>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Rules engine verifies TIN validity, infers HS/Service tax codes, calculates 16% VAT, and flags compliance errors.
              </p>
            </div>

            <div className="bg-slate-50 border-2 border-slate-900 p-3 space-y-2">
              <div className="flex items-center justify-between text-emerald-800 font-black text-[10px] uppercase">
                <span>Stage 04</span>
                <Globe className="w-4 h-4" />
              </div>
              <h4 className="font-black text-slate-900 text-xs uppercase">NRS Gateway Transmission</h4>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Generates cryptographic IRN hash and QR stamp, submitting directly to the official NRS E-Invoicing Gateway.
              </p>
            </div>

          </div>

          <div className="p-4 bg-amber-50 border-2 border-amber-400 text-amber-950 space-y-1 text-[11px]">
            <strong className="font-black uppercase flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-amber-900" />
              <span>Why the EFS Excel Ingestion Schema is the Unified Core:</span>
            </strong>
            <p className="leading-relaxed">
              Whether your client runs enterprise SAP S/4HANA, QuickBooks Online, legacy SQL databases, or simply drops a weekly Excel spreadsheet, CittaEFS normalizes all incoming transactions into this exact Excel schema first. This guarantees 100% tax compliance consistency regardless of source software!
            </p>
          </div>
        </div>
      )}

      {/* TAB 3: LIVE PAYLOAD PREVIEWER */}
      {activeTab === 'SCHEMA_JSON' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-black text-slate-900 uppercase text-xs">Standard EFS Excel Row JSON Representation:</span>
            <span className="px-2 py-0.5 bg-slate-900 text-amber-400 font-black text-[10px] uppercase">
              SCHEMA V2.4
            </span>
          </div>

          <div className="p-4 bg-slate-900 text-emerald-400 border-2 border-slate-900 font-mono text-[11px] overflow-x-auto">
            <pre>
{`{
  "efs_excel_matrix_header": {
    "source_system": "${selectedSystem.name}",
    "excel_template_version": "EFS_EXCEL_FISCAL_2026.xlsx",
    "rows_detected": 1
  },
  "columns": [
    "clientInvoiceNumber",
    "invoiceKind",
    "issueDate",
    "customerCode",
    "customerName",
    "customerTin",
    "itemCode",
    "description",
    "quantity",
    "unitPrice",
    "hsOrServiceCode",
    "vatRate"
  ],
  "mapped_row_data": {
    "clientInvoiceNumber": "${selectedSystem.mappings[0].exampleValue}",
    "customerTin": "${selectedSystem.mappings[1].exampleValue}",
    "issueDate": "${selectedSystem.mappings[2].exampleValue}",
    "description": "${selectedSystem.mappings[3].exampleValue}",
    "unitPrice": ${selectedSystem.mappings[4].exampleValue.replace(/,/g, '')},
    "hsOrServiceCode": "${selectedSystem.mappings[5].exampleValue}",
    "vatRate": 16.0
  }
}`}
            </pre>
          </div>
        </div>
      )}

    </div>
  );
}
