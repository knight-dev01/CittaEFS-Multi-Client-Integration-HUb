/**
 * CittaEFS Webhook Handler
 * 
 * Handles incoming webhooks from CittaEFS Gateway with HMAC-SHA256 signature verification.
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../config/dbConfig';

// ================================================
// HMAC SIGNATURE VERIFICATION
// ================================================

export interface WebhookSignature {
  algorithm: string;
  signature: string;
}

/**
 * Parse webhook signature header (format: sha256=xxxxx)
 */
export function parseWebhookSignature(header: string | undefined): WebhookSignature | null {
  if (!header) return null;
  
  const parts = header.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return null;
  }
  
  return {
    algorithm: parts[0],
    signature: parts[1]
  };
}

/**
 * Verify HMAC-SHA256 signature using timing-safe comparison
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody, 'utf8');
    const computedHash = hmac.digest('base64');
    
    // Use timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, 'base64');
    const computedBuffer = Buffer.from(computedHash, 'base64');
    
    if (sigBuffer.length !== computedBuffer.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(sigBuffer, computedBuffer);
  } catch {
    return false;
  }
}

/**
 * Generate HMAC signature for testing purposes
 */
export function generateWebhookSignature(
  rawBody: string,
  secret: string
): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody, 'utf8');
  return `sha256=${hmac.digest('base64')}`;
}

// ================================================
// WEBHOOK EVENT TYPES
// ================================================

export type CittaWebhookEvent = 
  | 'invoice.signed'
  | 'invoice.payment.updated'
  | 'invoice.cancelled'
  | 'invoice.rejected'
  | 'validation.failed'
  | 'transmission.failed';

export interface CittaWebhookPayload {
  event: CittaWebhookEvent;
  timestamp: string;
  tenantId: string;
  data: {
    irn?: string;
    csid?: string;
    qrCodeUrl?: string;
    invoiceNumber?: string;
    clientInvoiceNumber?: string;
    payment_status?: string;
    reference?: string;
    error_message?: string;
    error_details?: any;
  };
}

// ================================================
// WEBHOOK PROCESSOR
// ================================================

export interface WebhookHandlerResult {
  success: boolean;
  statusCode: number;
  message: string;
  processedEvents?: string[];
}

export interface WebhookHandlerOptions {
  prisma: PrismaClient;
  webhookSecret: string;
  onInvoiceSigned?: (irn: string, qrCodeUrl: string, data: any) => Promise<void>;
  onPaymentUpdated?: (irn: string, paymentStatus: string, reference?: string) => Promise<void>;
  onInvoiceRejected?: (irn: string, errorMessage: string) => Promise<void>;
  onError?: (error: Error, event: CittaWebhookPayload) => Promise<void>;
}

/**
 * Process incoming CittaEFS webhook
 */
export async function handleCittaWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
  payload: CittaWebhookPayload,
  options: WebhookHandlerOptions
): Promise<WebhookHandlerResult> {
  const { webhookSecret, onInvoiceSigned, onPaymentUpdated, onInvoiceRejected, onError } = options;
  const processedEvents: string[] = [];

  // Verify signature
  const signature = parseWebhookSignature(signatureHeader);
  if (!signature) {
    return {
      success: false,
      statusCode: 401,
      message: 'Missing or invalid signature header'
    };
  }

  if (!verifyWebhookSignature(rawBody, signature.signature, webhookSecret)) {
    return {
      success: false,
      statusCode: 401,
      message: 'Invalid webhook signature'
    };
  }

  try {
    // Process based on event type
    switch (payload.event) {
      case 'invoice.signed':
        if (payload.data.irn && payload.data.qrCodeUrl) {
          await onInvoiceSigned?.(payload.data.irn, payload.data.qrCodeUrl, payload.data);
          processedEvents.push(`Signed invoice: ${payload.data.irn}`);
        }
        break;

      case 'invoice.payment.updated':
        if (payload.data.irn && payload.data.payment_status) {
          await onPaymentUpdated?.(
            payload.data.irn,
            payload.data.payment_status,
            payload.data.reference
          );
          processedEvents.push(`Updated payment status for: ${payload.data.irn}`);
        }
        break;

      case 'invoice.rejected':
      case 'validation.failed':
      case 'transmission.failed':
        if (payload.data.irn && payload.data.error_message) {
          await onInvoiceRejected?.(payload.data.irn, payload.data.error_message);
          processedEvents.push(`Invoice rejected: ${payload.data.irn}`);
        }
        break;

      default:
        processedEvents.push(`Unknown event: ${payload.event}`);
    }

    return {
      success: true,
      statusCode: 200,
      message: 'Webhook processed successfully',
      processedEvents
    };

  } catch (error) {
    await onError?.(error as Error, payload);
    return {
      success: false,
      statusCode: 500,
      message: `Error processing webhook: ${(error as Error).message}`
    };
  }
}

/**
 * Update invoice with IRN after signing
 */
export async function updateInvoiceWithIRN(
  prisma: PrismaClient,
  tenantId: string,
  clientInvoiceNumber: string,
  irn: string,
  qrCodeUrl: string
): Promise<void> {
  await prisma.invoice.updateMany({
    where: {
      tenantId,
      OR: [
        { clientInvoiceId: clientInvoiceNumber },
        { irn: clientInvoiceNumber }
      ]
    },
    data: {
      irn,
      qrCodeUrl,
      status: 'SIGNED',
      ledgerWritebackStatus: 'PENDING'
    }
  });
}

/**
 * Update invoice payment status from webhook
 */
export async function updateInvoicePaymentStatus(
  prisma: PrismaClient,
  tenantId: string,
  irn: string,
  paymentStatus: string,
  reference?: string
): Promise<void> {
  await prisma.invoice.updateMany({
    where: {
      tenantId,
      irn
    },
    data: {
      paymentStatus: paymentStatus as any,
      bankReferenceId: reference
    }
  });
}

/**
 * Record webhook error in validation errors table
 */
export async function recordWebhookError(
  prisma: PrismaClient,
  tenantId: string,
  clientInvoiceNumber: string,
  errorMessage: string,
  errorDetails?: any
): Promise<void> {
  await prisma.validationError.create({
    data: {
      tenantId,
      clientInvoiceNumber: clientInvoiceNumber || 'UNKNOWN',
      errorCategory: 'WEBHOOK_REJECTION',
      fieldAffected: 'NRS_SUBMISSION',
      errorMessage,
      rawPayloadSample: JSON.stringify(errorDetails || {}),
      status: 'OPEN'
    }
  });
}

// ================================================
// EXPRESS ROUTE HANDLER
// ================================================

import { Request, Response } from 'express';

export function createWebhookHandler(options: WebhookHandlerOptions) {
  return async (req: Request, res: Response) => {
    const rawBody = (req as any).rawBody as string;
    const signatureHeader = req.headers['x-webhook-signature'] as string | undefined;

    if (!rawBody) {
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    const payload = req.body as CittaWebhookPayload;
    
    const result = await handleCittaWebhook(rawBody, signatureHeader, payload, {
      ...options,
      onInvoiceSigned: async (irn, qrCodeUrl, data) => {
        await updateInvoiceWithIRN(
          options.prisma,
          payload.tenantId,
          data.clientInvoiceNumber || data.invoiceNumber || irn,
          irn,
          qrCodeUrl
        );
      },
      onPaymentUpdated: async (irn, paymentStatus, reference) => {
        await updateInvoicePaymentStatus(
          options.prisma,
          payload.tenantId,
          irn,
          paymentStatus,
          reference
        );
      },
      onInvoiceRejected: async (irn, errorMessage) => {
        await recordWebhookError(
          options.prisma,
          payload.tenantId,
          irn,
          errorMessage
        );
      },
      onError: options.onError
    });

    res.status(result.statusCode).json(result);
  };
}
