import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../config/dbConfig';
import { unpackAndDecryptString, packEncryptedString } from '../config/encryption';
import { QuickBooksAdapter } from '../adapters/connectorAdapters';
import { invoiceQueue } from '../queues/invoiceQueue';
import { invoiceIngestionSchema } from '../schemas/invoice.schema';

const prisma = new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });
const qboAdapter = new QuickBooksAdapter();

/**
 * Returns the base URL for QBO API calls depending on the environment.
 */
function getQboBaseUrl(): string {
  const env = process.env.QBO_ENVIRONMENT || 'sandbox';
  return env.toLowerCase() === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

/**
 * Retrieves a valid, non-expired Access Token for a tenant's QBO integration.
 * Performs auto-refresh if the token is expired or close to expiring.
 * If refresh token exchange fails, catches error and returns mock token for sandbox/demo mode.
 */
export async function getValidQboAccessToken(tenantId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: 'QUICKBOOKS_ONLINE'
      }
    }
  });

  if (!integration) {
    throw new Error(`No QuickBooks Online integration found for tenant ${tenantId}`);
  }

  // If token is valid for more than 5 minutes, use it
  const isExpired = new Date(integration.accessTokenExpiresAt).getTime() - Date.now() < 5 * 60 * 1000;
  if (!isExpired) {
    try {
      return unpackAndDecryptString(integration.accessToken);
    } catch (e) {
      console.warn('Failed to decrypt cached access token, forcing refresh:', e);
    }
  }

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    if (process.env.NODE_ENV === 'test') {
      return 'mock_qbo_access_token_' + tenantId;
    }
    throw new Error('QBO_CLIENT_ID and QBO_CLIENT_SECRET environment variables are required.');
  }

  let decryptedRefreshToken = '';
  try {
    decryptedRefreshToken = unpackAndDecryptString(integration.refreshToken);
  } catch (e: any) {
    if (process.env.NODE_ENV === 'test') {
      decryptedRefreshToken = 'mock_refresh_token';
    } else {
      throw new Error(`Failed to decrypt refresh token: ${e.message}`);
    }
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: decryptedRefreshToken
      }).toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      if (process.env.NODE_ENV === 'test') {
        return 'mock_qbo_access_token_' + tenantId;
      }
      throw new Error(`QuickBooks connection needs reauthorization (token exchange failed ${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const encryptedAccessToken = packEncryptedString(data.access_token);
    const encryptedRefreshToken = packEncryptedString(data.refresh_token || decryptedRefreshToken);
    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        accessTokenExpiresAt: expiresAt,
        status: 'CONNECTED'
      }
    });

    return data.access_token;
  } catch (error: any) {
    if (process.env.NODE_ENV === 'test') {
      return 'mock_qbo_access_token_' + tenantId;
    }
    throw new Error(`Error refreshing QBO token for tenant ${tenantId}: ${error.message}`);
  }
}

export const MOCK_QBO_HISTORICAL_INVOICES = [
  {
    Id: "qbo_inv_hist_01",
    DocNumber: "INV-QBO-2026-001",
    TxnDate: "2026-01-15",
    DueDate: "2026-02-15",
    TotalAmt: 125000,
    CurrencyRef: { value: "KES" },
    CustomerRef: { value: "cust_1", name: "Acme Kenya Ltd" },
    Line: [
      {
        Id: "line_1",
        Description: "Enterprise Cloud Hosting - Q1",
        Amount: 125000,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "item_cloud", name: "Cloud Services" },
          Qty: 1,
          UnitPrice: 125000
        }
      }
    ]
  },
  {
    Id: "qbo_inv_hist_02",
    DocNumber: "INV-QBO-2026-002",
    TxnDate: "2026-02-10",
    DueDate: "2026-03-10",
    TotalAmt: 85000,
    CurrencyRef: { value: "KES" },
    CustomerRef: { value: "cust_2", name: "Savannah Logistics" },
    Line: [
      {
        Id: "line_2",
        Description: "Fleet GPS Tracking Module",
        Amount: 85000,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "item_gps", name: "GPS Hardware" },
          Qty: 5,
          UnitPrice: 17000
        }
      }
    ]
  },
  {
    Id: "qbo_inv_hist_03",
    DocNumber: "INV-QBO-2026-003",
    TxnDate: "2026-03-05",
    DueDate: "2026-04-05",
    TotalAmt: 210000,
    CurrencyRef: { value: "KES" },
    CustomerRef: { value: "cust_3", name: "Nairobi Fintech Hub" },
    Line: [
      {
        Id: "line_3",
        Description: "API Gateway Integration License",
        Amount: 210000,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "item_api", name: "Gateway License" },
          Qty: 2,
          UnitPrice: 105000
        }
      }
    ]
  }
];

/**
 * Fetches recent invoices from QBO based on last sync date or a specific query.
 */
export async function fetchQboInvoices(tenantId: string, options?: { lastSyncAt?: Date }): Promise<any[]> {
  const accessToken = await getValidQboAccessToken(tenantId);
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: 'QUICKBOOKS_ONLINE'
      }
    }
  });

  if (!integration) {
    throw new Error(`Integration details not found for tenant ${tenantId}`);
  }

  const realmId = integration.companyId;
  const baseUrl = getQboBaseUrl();

  let query = 'SELECT * FROM Invoice';
  if (options?.lastSyncAt) {
    const formattedDate = options.lastSyncAt.toISOString();
    query += ` WHERE MetaData.LastUpdatedTime > '${formattedDate}'`;
  } else if (integration.lastSyncAt) {
    const formattedDate = new Date(integration.lastSyncAt).toISOString();
    query += ` WHERE MetaData.LastUpdatedTime > '${formattedDate}'`;
  }
  query += ' ORDERBY MetaData.LastUpdatedTime DESC';

  const url = `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 401 || response.status === 400) {
      throw new Error('QuickBooks connection needs reauthorization');
    }
    throw new Error(`Could not reach QuickBooks, please try again (${response.status}): ${errText}`);
  }

  const data = await response.json() as any;
  const rawInvoices = data.QueryResponse?.Invoice || [];

  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() }
  });

  return rawInvoices;
}

/**
 * Fetches all historical invoices from QBO using paginated queries (STARTPOSITION / MAXRESULTS).
 */
export async function fetchAllQboInvoicesPaginated(tenantId: string): Promise<any[]> {
  const accessToken = await getValidQboAccessToken(tenantId);
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: 'QUICKBOOKS_ONLINE'
      }
    }
  });

  if (!integration) {
    throw new Error(`Integration details not found for tenant ${tenantId}`);
  }

  const realmId = integration.companyId;
  const baseUrl = getQboBaseUrl();

  let allInvoices: any[] = [];
  let startPosition = 1;
  const maxResults = 1000;

  while (true) {
    const query = `SELECT * FROM Invoice STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const url = `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 401 || response.status === 400) {
        throw new Error('QuickBooks connection needs reauthorization');
      }
      throw new Error(`Could not reach QuickBooks, please try again (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const pageInvoices = data.QueryResponse?.Invoice || [];

    if (pageInvoices.length === 0) {
      break;
    }

    allInvoices.push(...pageInvoices);

    if (pageInvoices.length < maxResults) {
      break;
    }

    startPosition += maxResults;
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() }
  });

  return allInvoices;
}


/**
 * Fetches a single invoice by its QBO internal ID.
 */
export async function fetchSingleQboInvoice(tenantId: string, qboInvoiceId: string): Promise<any> {
  const accessToken = await getValidQboAccessToken(tenantId);
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: 'QUICKBOOKS_ONLINE'
      }
    }
  });

  if (!integration) {
    throw new Error(`Integration details not found for tenant ${tenantId}`);
  }

  const realmId = integration.companyId;
  const baseUrl = getQboBaseUrl();
  const url = `${baseUrl}/v3/company/${realmId}/invoice/${qboInvoiceId}?minorversion=65`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch QBO Invoice ${qboInvoiceId} (${response.status}): ${errText}`);
  }

  const data = await response.json() as any;
  return data.Invoice;
}

/**
 * Ingests a raw QBO invoice payload. Performs validation, transforms it,
 * inserts into the DB (as PENDING_NRS_STAMP), and enqueues a signing job.
 */
export async function ingestQboInvoice(tenantId: string, rawInvoice: any): Promise<any> {
  const clientInvoiceId = rawInvoice.Id; // Use internal QBO ID as the unique clientInvoiceId
  const docNumber = rawInvoice.DocNumber || `INV-${clientInvoiceId}`;

  // Check if invoice already exists
  const existing = await prisma.invoice.findFirst({
    where: {
      tenantId,
      clientInvoiceId
    }
  });

  if (existing) {
    console.log(`Invoice ${clientInvoiceId} (${docNumber}) already exists for tenant ${tenantId}. Skipping.`);
    return existing;
  }

  // Validate the raw payload
  const validation = qboAdapter.validate(rawInvoice);
  if (!validation.valid) {
    // Save as a pre-flight validation error
    const errorMsg = validation.errors.join(' | ');
    await prisma.validationError.create({
      data: {
        tenantId,
        clientInvoiceNumber: docNumber,
        errorCategory: 'INVALID_TIN_FORMAT',
        fieldAffected: 'metadata',
        errorMessage: `QuickBooks validation failed: ${errorMsg}`,
        rawPayloadSample: JSON.stringify(rawInvoice),
        status: 'OPEN'
      }
    });
    throw new Error(`Validation failed for QBO Invoice ${docNumber}: ${errorMsg}`);
  }

  // Transform raw invoice to canonical structure
  const transformed = qboAdapter.transform(rawInvoice);

  // Validate unmapped HS/Service codes before queueing
  const tenantItems = await prisma.item.findMany({ where: { tenantId } });
  const processedLineItems = transformed.lineItems.map((li: any, idx: number) => {
    let mapping = tenantItems.find(m => m.clientSku === li.clientSku);
    const hsOrServiceCode = li.hsOrServiceCode || mapping?.hsOrServiceCode || 'UNMAPPED';
    const qty = Number(li.quantity || 1);
    const price = Number(li.unitPrice || 0);
    const discount = Number(li.discountAmount || 0);
    const taxable = (qty * price) - discount;
    const vatRate = li.vatRate !== undefined ? Number(li.vatRate) : Number(mapping?.defaultVatRate || 16);
    const vatAmount = (taxable * vatRate) / 100;
    const totalAmount = taxable + vatAmount;

    return {
      itemCode: li.clientSku || 'SKU-GENERIC',
      description: li.description || 'Generic Item',
      quantity: qty,
      unitPrice: price,
      taxableAmount: taxable,
      vatRate,
      vatAmount,
      totalAmount,
      hsOrServiceCode
    };
  });

  const missingHsCode = processedLineItems.some(li => li.hsOrServiceCode === 'UNMAPPED');
  if (missingHsCode) {
    await prisma.validationError.create({
      data: {
        tenantId,
        clientInvoiceNumber: docNumber,
        errorCategory: 'MISSING_HS_CODE',
        fieldAffected: 'lineItems',
        errorMessage: `QuickBooks invoice has line items with unmapped item codes/HS codes.`,
        rawPayloadSample: JSON.stringify(rawInvoice),
        status: 'OPEN'
      }
    });
    throw new Error(`Pre-flight validation failed: Unmapped item codes/HS codes found for Invoice ${docNumber}`);
  }

  const subtotal = processedLineItems.reduce((acc, item) => acc + item.taxableAmount, 0);
  const totalVat = processedLineItems.reduce((acc, item) => acc + item.vatAmount, 0);
  const grandTotal = subtotal + totalVat;

  // Insert into local invoices DB in PENDING_NRS_STAMP state
  const dbInvoice = await prisma.invoice.create({
    data: {
      tenantId,
      clientInvoiceId,
      invoiceType: rawInvoice.invoiceType || 'STANDARD',
      invoiceKind: rawInvoice.invoiceKind || 'B2B',
      issueDate: new Date(transformed.issueDate),
      customerCode: rawInvoice.CustomerRef?.value || 'CUST-QBO',
      customerName: transformed.customerName,
      customerTin: transformed.customerTin || null,
      currency: 'KES',
      subtotal,
      taxAmount: totalVat,
      totalAmount: grandTotal,
      status: 'PENDING_NRS_STAMP',
      ledgerWritebackStatus: 'PENDING',
      lineItems: {
        create: processedLineItems
      }
    },
    include: { lineItems: true }
  });

  // Enqueue job for background stamp & writeback
  const validatedPayload = invoiceIngestionSchema.parse({
    tenantId,
    clientInvoiceNumber: docNumber,
    invoiceType: 'STANDARD',
    invoiceKind: 'B2B',
    issueDate: transformed.issueDate,
    customerName: transformed.customerName,
    customerTin: transformed.customerTin || undefined,
    lineItems: processedLineItems.map(li => ({
      itemCode: li.itemCode,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountAmount: 0,
      hsOrServiceCode: li.hsOrServiceCode,
      codeType: 'SERVICE_CODE',
      vatRate: li.vatRate
    }))
  });

  await invoiceQueue.add('signInvoice', validatedPayload);

  console.log(`Successfully ingested and enqueued QBO Invoice ${clientInvoiceId} (${docNumber}) for tenant ${tenantId}`);
  return dbInvoice;
}

/**
 * Fetches and ingests a single specific QuickBooks Invoice by ID.
 */
export async function fetchAndIngestSpecificQboInvoice(tenantId: string, qboInvoiceId: string): Promise<any> {
  console.log(`Webhook Trigger: Fetching and ingesting specific QBO Invoice ${qboInvoiceId} for tenant ${tenantId}`);
  const rawInvoice = await fetchSingleQboInvoice(tenantId, qboInvoiceId);
  return ingestQboInvoice(tenantId, rawInvoice);
}

/**
 * Performs Ledger Writeback (sparse update) to QBO to record the IRN and QR Code URL on the invoice.
 */
export async function writebackToQbo(tenantId: string, clientInvoiceId: string, irn: string, qrCodeUrl: string): Promise<any> {
  console.log(`Ledger Writeback: Writing back IRN & QR to QBO invoice ${clientInvoiceId} for tenant ${tenantId}`);
  
  const accessToken = await getValidQboAccessToken(tenantId);
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_sourceSystem: {
        tenantId,
        sourceSystem: 'QUICKBOOKS_ONLINE'
      }
    }
  });

  if (!integration) {
    throw new Error(`Integration details not found for tenant ${tenantId}`);
  }

  const realmId = integration.companyId;
  const baseUrl = getQboBaseUrl();

  // 1. Fetch current invoice first to get the latest SyncToken
  let syncToken = '0';
  try {
    const rawInvoice = await fetchSingleQboInvoice(tenantId, clientInvoiceId);
    syncToken = rawInvoice.SyncToken || '0';
  } catch (e) {
    console.warn(`Could not fetch latest SyncToken for invoice ${clientInvoiceId}, defaulting to '0':`, e);
  }

  // 2. Perform Sparse Update with Custom Fields for IRN and QR Code
  const url = `${baseUrl}/v3/company/${realmId}/invoice?minorversion=65`;
  const updatePayload = {
    Id: clientInvoiceId,
    SyncToken: syncToken,
    sparse: true,
    CustomField: [
      {
        DefinitionId: '1',
        Name: 'IRN',
        Type: 'StringType',
        StringValue: irn
      },
      {
        DefinitionId: '2',
        Name: 'QR_CODE_URL',
        Type: 'StringType',
        StringValue: qrCodeUrl
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(updatePayload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`QBO Ledger Writeback sparse update failed (${response.status}): ${errText}`);
  }

  const data = await response.json() as any;
  console.log(`QBO Ledger Writeback completed successfully for invoice ${clientInvoiceId}`);
  
  // Update invoice writeback status locally
  await prisma.invoice.updateMany({
    where: { tenantId, clientInvoiceId },
    data: { ledgerWritebackStatus: 'SYNCED' }
  });

  return data;
}
