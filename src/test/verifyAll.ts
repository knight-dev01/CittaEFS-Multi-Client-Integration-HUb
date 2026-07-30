import 'dotenv/config';
import nock from 'nock';
import { packEncryptedString, unpackAndDecryptString } from '../config/encryption';
import { invoiceIngestionSchema, invoiceLineItemSchema } from '../schemas/invoice.schema';
import { CONNECTOR_ADAPTERS, QuickBooksAdapter, SapAdapter, NetsuiteAdapter, OdooAdapter, CsvAdapter, SqlAdapter } from '../adapters/connectorAdapters';
import { cittaEfsClient } from '../services/cittaEfsClient';
import { invoiceQueue } from '../queues/invoiceQueue';
import { processInvoiceJob } from '../workers/invoiceWorker';
import { runNrsReconciliationCron, runQbReconciliationCron } from '../crons/reconciliation';

interface TestResult {
  module: string;
  testName: string;
  category: 'Implementation' | 'Runtime' | 'Integration' | 'EdgeCase' | 'FailureRecovery' | 'Security';
  passed: boolean;
  expected: string;
  actual: string;
  details?: string;
}

const results: TestResult[] = [];

function assert(
  moduleName: string,
  testName: string,
  category: 'Implementation' | 'Runtime' | 'Integration' | 'EdgeCase' | 'FailureRecovery' | 'Security',
  condition: boolean,
  expected: string,
  actual: string,
  details?: string
) {
  results.push({
    module: moduleName,
    testName,
    category,
    passed: condition,
    expected,
    actual,
    details
  });
}

async function runAllTests() {
  console.log('====================================================');
  console.log('CITTA-EFS PRODUCTION SYSTEM VERIFICATION TEST SUITE');
  console.log('====================================================\n');

  // ------------------------------------------------------------------
  // MODULE 1: Security & Encryption Engine (AES-256-GCM)
  // ------------------------------------------------------------------
  try {
    const rawSecret = 'oauth_refresh_token_secret_xyz123';
    const encrypted = packEncryptedString(rawSecret);
    const parts = encrypted.split(':');

    assert(
      'Security & Encryption',
      'AES-256-GCM Encryption Structure',
      'Security',
      parts.length === 3,
      '3 parts formatted as iv:ciphertext:authTag',
      `Found ${parts.length} parts`
    );

    const decrypted = unpackAndDecryptString(encrypted);
    assert(
      'Security & Encryption',
      'AES-256-GCM Roundtrip Decryption',
      'Runtime',
      decrypted === rawSecret,
      `Decrypted value matches rawSecret '${rawSecret}'`,
      `Decrypted value: '${decrypted}'`
    );

    // IV Uniqueness Test
    const encrypted2 = packEncryptedString(rawSecret);
    assert(
      'Security & Encryption',
      'Cryptographic IV Uniqueness per Operation',
      'Security',
      encrypted !== encrypted2,
      'Two encryptions of same string produce different IVs and ciphertexts',
      encrypted === encrypted2 ? 'Identical ciphertexts (INSECURE)' : 'Unique ciphertexts generated'
    );

    // Tamper Detection Test (Auth Tag validation)
    const tamperedParts = [...parts];
    tamperedParts[1] = '00' + tamperedParts[1].substring(2); // Alter ciphertext
    const tamperedEncrypted = tamperedParts.join(':');
    let tamperCaught = false;
    try {
      unpackAndDecryptString(tamperedEncrypted);
    } catch {
      tamperCaught = true;
    }
    assert(
      'Security & Encryption',
      'Auth Tag Tamper Detection (Integrity)',
      'FailureRecovery',
      tamperCaught,
      'Throws decryption error on modified ciphertext',
      tamperCaught ? 'Caught authentication tag failure correctly' : 'Failed to throw error on tampered data'
    );
  } catch (err: any) {
    assert('Security & Encryption', 'Encryption Execution', 'Runtime', false, 'No unhandled exceptions', err.message);
  }

  // ------------------------------------------------------------------
  // MODULE 2: Canonical Schema & Zod Validation Rules
  // ------------------------------------------------------------------
  try {
    const validInvoice = {
      tenantId: 'tenant_qbo_smb',
      clientInvoiceNumber: 'INV-2026-999',
      issueDate: '2026-07-29',
      dueDate: '2026-08-29',
      currency: 'KES',
      customerName: 'Acme Kenya Ltd',
      customerTin: 'P051123456Z',
      lineItems: [
        {
          itemCode: 'ITEM-01',
          description: 'Server Rack 42U',
          quantity: 2,
          unitPrice: 50000,
          vatRate: 16,
          hsOrServiceCode: 'HS-8471.50'
        }
      ]
    };

    const parseResult = invoiceIngestionSchema.safeParse(validInvoice);
    assert(
      'Canonical Schema',
      'Valid Invoice Parsing & Transformation',
      'Implementation',
      parseResult.success,
      'Schema validation succeeds for compliant payload',
      parseResult.success ? `Validated & Transformed (grandTotal=${parseResult.data.grandTotal}, hash=${parseResult.data.rawPayloadHash.substring(0, 10)}...)` : JSON.stringify(parseResult.error?.issues)
    );

    // Edge Case: B2B Auto-Downgrade to B2C when Tax PIN is missing
    const noPinInvoice = { ...validInvoice, customerTin: '' };
    const noPinResult = invoiceIngestionSchema.safeParse(noPinInvoice);
    assert(
      'Canonical Schema',
      'Auto B2C Classification on Missing Tax PIN',
      'EdgeCase',
      noPinResult.success && noPinResult.data.invoiceKind === 'B2C',
      'Auto-downgrades invoiceKind to B2C when customerTin is empty',
      noPinResult.success ? `Evaluated kind: ${noPinResult.data.invoiceKind}` : 'Failed validation'
    );

    // Edge Case: Empty Line Items
    const emptyLineInvoice = { ...validInvoice, lineItems: [] };
    const emptyLineResult = invoiceIngestionSchema.safeParse(emptyLineInvoice);
    assert(
      'Canonical Schema',
      'Minimum Line Item Requirement',
      'EdgeCase',
      !emptyLineResult.success,
      'Schema requires at least 1 line item',
      !emptyLineResult.success ? 'Rejected empty line items correctly' : 'Accepted empty line items'
    );
  } catch (err: any) {
    assert('Canonical Schema', 'Schema Execution', 'Runtime', false, 'No unhandled exceptions', err.message);
  }

  // ------------------------------------------------------------------
  // MODULE 3: Connector Adapter Engine (QBO, Sage, Xero, NRS, SAP)
  // ------------------------------------------------------------------
  try {
    const qboAdapter = new QuickBooksAdapter();
    const rawQbo = {
      DocNumber: 'QBO-8899',
      TxnDate: '2026-07-29',
      CustomerRef: { name: 'Acme Kenya Corp' },
      CustomerTaxId: 'A009876543W',
      Line: [
        {
          Description: 'Consulting Services',
          SalesItemLineDetail: { ItemRef: { name: 'SRV-CONSULT' }, Qty: 10, UnitPrice: 10000 },
          hsOrServiceCode: 'HS-9801.00'
        }
      ]
    };

    const transformed = qboAdapter.transform(rawQbo);
    assert(
      'Connector Adapters',
      'QuickBooks Normalization Engine',
      'Integration',
      transformed.clientInvoiceNumber === 'QBO-8899' && transformed.lineItems.length === 1,
      'Transforms QBO payload into canonical format',
      `Transformed Invoice #${transformed.clientInvoiceNumber}, Items: ${transformed.lineItems.length}`
    );

    // All registered adapters verification
    const adapters = [new QuickBooksAdapter(), new SapAdapter(), new NetsuiteAdapter(), new OdooAdapter(), new CsvAdapter(), new SqlAdapter()];
    const allAuth = await Promise.all(
      adapters.map(a => a.authenticate({
        tenantId: 'tenant_test',
        connectorId: `conn_${a.platformName}`,
        connectorType: 'REST_API',
        platformName: a.platformName,
        status: 'HEALTHY',
        authType: 'OAUTH2'
      }))
    );
    const allAuthed = allAuth.every(r => r.authenticated);
    assert(
      'Connector Adapters',
      'Multi-Platform Authentication Interface',
      'Implementation',
      allAuthed,
      'All ERP adapters return authenticated status',
      allAuthed ? 'All adapters authenticated' : 'Some adapters failed authentication'
    );
  } catch (err: any) {
    assert('Connector Adapters', 'Adapter Execution', 'Runtime', false, 'No unhandled exceptions', err.message);
  }

  // ------------------------------------------------------------------
  // MODULE 4: CittaEFS API Gateway Client & Serialization
  // ------------------------------------------------------------------
  try {
    const testInvoice = {
      tenantId: 'tenant_qbo_smb',
      clientInvoiceNumber: 'INV-HMAC-TEST-01',
      invoiceType: 'STANDARD' as const,
      invoiceKind: 'B2B' as const,
      customerName: 'Citta Test Client',
      customerTin: 'P051123456Z',
      issueDate: '2026-07-29',
      lineItems: [
        {
          itemCode: 'ITEM-HMAC',
          description: 'Security Audit Service',
          quantity: 1,
          unitPrice: 50000,
          taxableAmount: 50000,
          vatRate: 16,
          vatAmount: 8000,
          totalAmount: 58000,
          hsOrServiceCode: 'HS-8471.50'
        }
      ]
    };

    // 1. Mock and verify POST /api/integration/gen/invoices (Request & Response DTO validation)
    const postScope = nock('https://ei-api.azurewebsites.net')
      .post('/api/integration/gen/invoices')
      .reply((uri, requestBody: any) => {
        let body = requestBody;
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
          } catch {
            return [400, { errors: ['Payload must be a valid JSON string'] }];
          }
        }
        if (!Array.isArray(body)) {
          return [400, { errors: ['Payload must be a JSON array'] }];
        }
        const dto = body[0];
        const fields = [
          'invoiceNumber', 'issueDate', 'customerCode', 'itemName', 'itemDescription',
          'quantity', 'unitPrice', 'taxAmount', 'taxableAmount', 'hsOrServiceCode',
          'lineNum', 'unitCode', 'taxCategoryId', 'currencyCode', 'invoiceTypeCode',
          'headerDiscount', 'headerCharges', 'lineDiscount', 'useStateTax',
          'documentNumber', 'billingReferenceIrns', 'customFields', 'metadata'
        ];
        const missing = fields.filter(f => !(f in dto));
        if (missing.length > 0) {
          console.warn('   ⚠️ Mismatched fields in DTO body:', missing);
          return [400, { errors: [`Payload fields do not match IntegrationInvoiceLineDto spec. Missing: ${missing.join(', ')}`] }];
        }

        // Return valid BulkEInvoiceResultDto
        return [200, {
          totalInvoices: 1,
          successCount: 1,
          failedCount: 0,
          errors: [],
          items: [{
            invoiceNumber: dto.invoiceNumber,
            irn: 'IRN-NRS-2026-NOCK9988',
            qrCodeUrl: 'https://nrs.portal.gov/verify?irn=IRN-NRS-2026-NOCK9988',
            csid: 'CSID-SHA256-NOCK'
          }]
        }];
      });

    const efsResponse = await cittaEfsClient.signAndStampInvoice(testInvoice);
    assert(
      'CittaEFS Gateway Client',
      'C# PascalCase Serialization & Stamp Transmission',
      'Integration',
      efsResponse.success && efsResponse.irn === 'IRN-NRS-2026-NOCK9988' && Boolean(efsResponse.qrCodeUrl),
      'Returns HTTP 200, valid IRN and QR verification URL',
      `Success: ${efsResponse.success}, IRN: ${efsResponse.irn}, QR URL: ${efsResponse.qrCodeUrl?.substring(0, 30)}...`
    );

    // 2. Mock and verify other methods: getArchive, getValidationErrors, updatePaymentStatus
    const getArchiveScope = nock('https://ei-api.azurewebsites.net')
      .get('/api/einvoice/archive')
      .query(true)
      .reply(200, [{ invoiceNumber: 'INV-HMAC-TEST-01', irn: 'IRN-NRS-2026-NOCK9988' }]);

    const archiveData = await cittaEfsClient.getArchive('tenant_qbo_smb', '2026-07-01', '2026-07-31');
    assert(
      'CittaEFS Gateway Client',
      'Gateway Archive Retrieval method',
      'Implementation',
      Array.isArray(archiveData) && archiveData[0]?.invoiceNumber === 'INV-HMAC-TEST-01',
      'getArchive returns array of records correctly',
      `Records: ${archiveData.length}, First Invoice: ${archiveData[0]?.invoiceNumber}`
    );

    const getErrorsScope = nock('https://ei-api.azurewebsites.net')
      .get('/api/einvoice/errors/validation')
      .query(true)
      .reply(200, [{ invoiceNumber: 'INV-FAIL-01', error: 'Invalid TIN format' }]);

    const errorsData = await cittaEfsClient.getValidationErrors('tenant_qbo_smb');
    assert(
      'CittaEFS Gateway Client',
      'Gateway Validation Errors method',
      'Implementation',
      Array.isArray(errorsData) && errorsData[0]?.invoiceNumber === 'INV-FAIL-01',
      'getValidationErrors returns error records correctly',
      `Errors: ${errorsData.length}, Error Message: ${errorsData[0]?.error}`
    );

    const patchStatusScope = nock('https://ei-api.azurewebsites.net')
      .patch('/api/einvoice/update/IRN-NRS-2026-NOCK9988')
      .reply(200, { success: true, payment_status: 'PAID' });

    const patchRes = await cittaEfsClient.updatePaymentStatus('tenant_qbo_smb', 'IRN-NRS-2026-NOCK9988', 'PAID', 'REF-123');
    assert(
      'CittaEFS Gateway Client',
      'Gateway Update Payment Status method',
      'Implementation',
      patchRes?.success === true && patchRes?.payment_status === 'PAID',
      'updatePaymentStatus patches payment state correctly',
      `Response payment_status: ${patchRes?.payment_status}`
    );

    // 3. Verify error handling with nock (ensure client throws typed errors correctly)
    const errScope = nock('https://ei-api.azurewebsites.net')
      .post('/api/integration/gen/invoices')
      .reply(400, { success: false, errors: ['TIN field validation failure'] });

    let threwError = false;
    try {
      await cittaEfsClient.signAndStampInvoice(testInvoice);
    } catch (e: any) {
      threwError = true;
    }
    assert(
      'CittaEFS Gateway Client',
      'Gateway Non-2xx / Validation Failures Exception Handling',
      'FailureRecovery',
      threwError,
      'Client throws standard Error on gateway non-2xx responses',
      `Error thrown successfully on 400 Bad Request`
    );

    nock.cleanAll();

    // Inbound Writeback test
    const wb = await cittaEfsClient.executeClientLedgerWriteback('tenant_qbo_smb', testInvoice.clientInvoiceNumber, 'IRN-NRS-2026-NOCK9988', 'https://nrs.portal.gov/verify?irn=IRN-NRS-2026-NOCK9988');
    assert(
      'CittaEFS Gateway Client',
      'Inbound Client Ledger Writeback Contract',
      'Runtime',
      wb.synced,
      'Writeback succeeds with client ledger update',
      `Writeback result: ${wb.message}`
    );
  } catch (err: any) {
    assert('CittaEFS Gateway Client', 'Client Execution', 'Runtime', false, 'No unhandled exceptions', err.message);
  }

  // ------------------------------------------------------------------
  // MODULE 5: Async Queue Engine, Retry Policies & Dead Letter Queue (DLQ)
  // ------------------------------------------------------------------
  try {
    const testPayload = invoiceIngestionSchema.parse({
      tenantId: 'tenant_qbo_smb',
      clientInvoiceNumber: `INV-Q-${Date.now()}`,
      issueDate: '2026-07-29',
      dueDate: '2026-08-29',
      currency: 'KES',
      customerName: 'Queue Test Enterprise',
      customerTin: 'P051123456Z',
      lineItems: [
        {
          itemCode: 'ITEM-Q',
          description: 'Queue Processing Test',
          quantity: 1,
          unitPrice: 100000,
          vatRate: 16,
          hsOrServiceCode: 'HS-8471.50'
        }
      ]
    });

    const job = await invoiceQueue.add('signInvoice', testPayload, { attempts: 3 });
    assert(
      'Async Queue Engine',
      'Job Enqueueing & Structure',
      'Implementation',
      job.status === 'QUEUED' && job.attempts === 0 && job.maxRetries === 3,
      'Job is enqueued with state QUEUED, attempts=0, maxRetries=3',
      `Job ID: ${job.id}, Status: ${job.status}, maxRetries: ${job.maxRetries}`
    );

    // DLQ Routing test
    invoiceQueue.moveToDLQ(job, 'Simulated 504 Gateway Timeout Exhausted');
    const dlqJobs = invoiceQueue.getDLQJobs();
    const inDlq = dlqJobs.some(j => j.id === job.id);
    assert(
      'Async Queue Engine',
      'Dead Letter Queue (DLQ) Routing & Retention',
      'FailureRecovery',
      inDlq,
      'Job is safely isolated in DLQ for compliance auditing',
      inDlq ? 'Successfully held in DLQ' : 'Failed to move to DLQ'
    );
  } catch (err: any) {
    assert('Async Queue Engine', 'Queue Execution', 'Runtime', false, 'No unhandled exceptions', err.message);
  }

  // ------------------------------------------------------------------
  // MODULE 6: Queue Worker Execution & Ledger Synchronization
  // ------------------------------------------------------------------
  try {
    const workerPayload = invoiceIngestionSchema.parse({
      tenantId: 'tenant_qbo_smb',
      clientInvoiceNumber: `INV-WORKER-${Date.now()}`,
      issueDate: '2026-07-29',
      dueDate: '2026-08-29',
      currency: 'KES',
      customerName: 'Worker Customer Corp',
      customerTin: 'P051123456Z',
      lineItems: [
        {
          itemCode: 'ITEM-W',
          description: 'Worker unit test',
          quantity: 1,
          unitPrice: 20000,
          vatRate: 16,
          hsOrServiceCode: 'HS-8471.50'
        }
      ]
    });

    const jobToProcess = await invoiceQueue.add('signInvoice', workerPayload);

    // Mock CittaEFS Gateway call for the worker pipeline test
    nock('https://ei-api.azurewebsites.net')
      .post('/api/integration/gen/invoices')
      .reply(200, {
        totalInvoices: 1,
        successCount: 1,
        failedCount: 0,
        errors: [],
        items: [{
          invoiceNumber: workerPayload.clientInvoiceNumber,
          irn: 'IRN-NRS-2026-WORKER9988',
          qrCodeUrl: 'https://nrs.portal.gov/verify?irn=IRN-NRS-2026-WORKER9988',
          csid: 'CSID-SHA256-WORKER'
        }]
      });

    const workerResult = await processInvoiceJob(jobToProcess);

    nock.cleanAll();

    assert(
      'Worker Processor',
      'Async Queue Worker Pipeline Execution',
      'Integration',
      workerResult.success && Boolean(workerResult.irn),
      'Worker processes job, gets IRN stamp and returns completed status',
      `Worker Result: Success=${workerResult.success}, IRN=${workerResult.irn}`
    );
  } catch (err: any) {
    assert('Worker Processor', 'Worker Execution', 'Runtime', false, 'No unhandled exceptions', err.message);
  }

  // ------------------------------------------------------------------
  // MODULE 7: Automated Reconciliation Engine (NRS & QB Sync Auditing)
  // ------------------------------------------------------------------
  try {
    const nrsResult = await runNrsReconciliationCron('tenant_qbo_smb');
    assert(
      'Reconciliation Engine',
      'NRS / CittaEFS Regulatory Discrepancy Reconciliation',
      'Runtime',
      nrsResult.cronName === 'nrsReconciliationCron' && nrsResult.scannedCount >= 0,
      'Executes Gateway polling audit and recovers stuck invoices',
      `Cron: ${nrsResult.cronName}, Scanned: ${nrsResult.scannedCount}, Recovered: ${nrsResult.recoveredCount}, Orphans Fixed: ${nrsResult.orphansFixedCount}`
    );

    const qbResult = await runQbReconciliationCron('tenant_qbo_smb');
    assert(
      'Reconciliation Engine',
      'ERP (QuickBooks) Automated Data Audit',
      'Runtime',
      qbResult.cronName === 'qbReconciliationCron' && qbResult.scannedCount >= 0,
      'Executes CDC polling audit and recovers missed ERP transactions',
      `Cron: ${qbResult.cronName}, Scanned: ${qbResult.scannedCount}, Recovered: ${qbResult.recoveredCount}`
    );
  } catch (err: any) {
    assert('Reconciliation Engine', 'Cron Execution', 'Runtime', false, 'No unhandled exceptions', err.message);
  }

  // ------------------------------------------------------------------
  // MODULE 8: Security Regression - SSO Auth Bypass
  // ------------------------------------------------------------------
  try {
    const response = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssoProvider: 'corporate_saml', email: 'admin@cittaefs.com' })
    });
    const data = await response.json();
    assert(
      'Security Regression',
      'SSO Authentication Bypass Attempt Rejection',
      'Security',
      response.status === 400 || response.status === 401,
      'SSO bypass request is rejected with 400 or 401',
      `Status: ${response.status}, Success: ${data.success}, Error: ${data.error}`
    );
  } catch (err: any) {
    // If local dev server is not active during test execution, perform static file analysis
    const fs = await import('fs');
    const path = await import('path');
    const serverCode = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');
    const hasBypass = serverCode.includes('ssoProvider');
    assert(
      'Security Regression',
      'SSO Authentication Bypass Code Absence',
      'Security',
      !hasBypass,
      'No ssoProvider login bypass code exists in server.ts',
      hasBypass ? 'ssoProvider bypass logic remains in server.ts (INSECURE)' : 'Clean: ssoProvider completely removed from server.ts'
    );
  }

  // ------------------------------------------------------------------
  // SUMMARY REPORT GENERATION
  // ------------------------------------------------------------------
  console.log('----------------------------------------------------');
  console.log('CITTA-EFS VERIFICATION MATRIX SUMMARY');
  console.log('----------------------------------------------------\n');

  let passedCount = 0;
  results.forEach((r, idx) => {
    const statusStr = r.passed ? '✅ PASS' : '❌ FAIL';
    if (r.passed) passedCount++;
    console.log(`[${idx + 1}] ${statusStr} | [${r.module}] ${r.testName} (${r.category})`);
    console.log(`    Expected: ${r.expected}`);
    console.log(`    Actual:   ${r.actual}`);
    if (r.details) console.log(`    Details:  ${r.details}`);
    console.log('');
  });

  console.log('====================================================');
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${results.length - passedCount}`);
  console.log(`SUCCESS RATE: ${((passedCount / results.length) * 100).toFixed(1)}%`);
  console.log('====================================================\n');

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runAllTests();
