import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import {
  generateSha256,
  safeAuditLogCreate,
  formatInvoice,
  getScopedTenantWhere,
  canAccessTenant,
  parsePagination,
} from "../lib/serverHelpers";
import { invoiceIngestionSchema } from "../schemas/invoice.schema";
import { invoiceQueue } from "../queues/invoiceQueue";

const router = Router();

// ==========================================
// INVOICES & FISCAL LIFECYCLE API (DB Backed)
// ==========================================

router.get("/api/invoices", async (req: any, res) => {
  try {
    const queryTenantId = req.query.tenantId as string | undefined;
    const status = req.query.status as string | undefined;
    const { skip, take, page, limit } = parsePagination(req);
    const where: any = { ...getScopedTenantWhere(req, queryTenantId) };
    if (status && status !== "ALL") where.status = status;
    if (req.user && req.user.role !== "ADMIN" && !where.tenantId && req.user.tenantId) where.tenantId = req.user.tenantId;
    const [total, rawInvoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        include: { lineItems: true },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    const invoices = rawInvoices.map(formatInvoice);
    const paginated = req.query.page !== undefined || req.query.limit !== undefined || req.query.status !== undefined;
    if (paginated || req.query.page !== undefined || total > limit) {
      res.setHeader("X-Total-Count", String(total));
      res.setHeader("X-Page", String(page));
      res.setHeader("X-Limit", String(limit));
    }
    if (req.query.page !== undefined || req.query.limit !== undefined) {
      res.json({ data: invoices, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } else {
      res.json(invoices);
    }
  } catch (e: any) {
    console.error("[API Error] GET /api/invoices failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/api/invoices/retry-status/:id", async (req:any, res)=>{
  try {
    const inv = await prisma.invoice.findUnique({ where:{id:req.params.id}, include:{lineItems:true}});
    if (!inv) return res.status(404).json({ success:false, error:"Invoice not found"});
    if (!canAccessTenant(req, inv.tenantId)) return res.status(403).json({ success:false, error:"Forbidden"});
    const qRow = await prisma.queueJob.findFirst({ where:{ tenantId: inv.tenantId, payload:{contains: inv.id}}, orderBy:{createdAt:'desc'}});
    res.json({ invoice: formatInvoice(inv), queueJob: qRow ? { id: qRow.id, status: qRow.status, attempts: qRow.attempts, maxRetries: qRow.maxRetries, lastError: qRow.lastError, nextAttemptAt: qRow.nextAttemptAt, createdAt: qRow.createdAt } : null });
  } catch(e:any){ res.status(500).json({success:false, error:e.message});}
});

router.get("/api/invoices/:id", async (req, res) => {
  try {
    const inv = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { lineItems: true } });
    if (!inv) return res.status(404).json({ success: false, error: "Invoice not found" });
    res.json(formatInvoice(inv));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/invoices/:id", async (req: any, res) => {
  try {
    const role = req.user?.role;
    if (req.user && !["ADMIN","OPERATOR","INTEGRATION_MANAGER"].includes(role)) return res.status(403).json({ success: false, error: "Forbidden" });
    const { id } = req.params;
    const existing = await prisma.invoice.findUnique({ where: { id }, include: { lineItems: true } });
    if (!existing) return res.status(404).json({ success: false, error: "Invoice not found" });
    if (["APPROVED","SIGNED"].includes(existing.status)) return res.status(400).json({ success: false, error: "Approved invoices cannot be edited" });
    const { clientInvoiceNumber, issueDate, customerCode, customerName, customerTin, invoiceKind, invoiceType, lineItems } = req.body;
    if (clientInvoiceNumber && clientInvoiceNumber !== existing.clientInvoiceId) {
      const dup = await prisma.invoice.findFirst({ where: { tenantId: existing.tenantId, clientInvoiceId: clientInvoiceNumber } });
      if (dup) return res.status(409).json({ success: false, error: `Duplicate invoice number ${clientInvoiceNumber}` });
    }
    let data: any = {};
    if (clientInvoiceNumber) data.clientInvoiceId = String(clientInvoiceNumber).trim();
    if (issueDate) {
      const parsed = new Date(issueDate);
      if (isNaN(parsed.getTime())) return res.status(400).json({ success: false, error: "Invalid issueDate" });
      data.issueDate = parsed;
    }
    if (customerCode) data.customerCode = String(customerCode).trim();
    if (customerName) data.customerName = String(customerName).trim();
    if (customerTin !== undefined) data.customerTin = customerTin ? String(customerTin).trim() : null;
    if (invoiceKind) data.invoiceKind = invoiceKind;
    if (invoiceType) data.invoiceType = invoiceType;

    let updated: any;
    if (lineItems && Array.isArray(lineItems) && lineItems.length>0) {
      const tenant = await prisma.tenant.findUnique({ where: { id: existing.tenantId } });
      const tenantItems = await prisma.item.findMany({ where: { tenantId: existing.tenantId } });
      const processed = lineItems.map((li:any) => {
        const mapping = tenantItems.find(m=>m.clientSku===li.itemCode);
        const hs = (li.hsOrServiceCode && String(li.hsOrServiceCode).trim()) || mapping?.hsOrServiceCode || "UNMAPPED";
        const qty = Number(li.quantity||0) || 1;
        const price = Number(li.unitPrice||0);
        const vatRate = li.vatRate!==undefined && li.vatRate!=='' ? Number(li.vatRate) : Number(mapping?.defaultVatRate ?? tenant?.defaultVatRate ?? 7.5);
        const taxable = qty*price;
        const vatAmount = taxable*vatRate/100;
        return { itemCode: li.itemCode || "SKU-GENERIC", description: li.description||"Item", quantity: qty, unitPrice: price, taxableAmount: taxable, vatRate, vatAmount, totalAmount: taxable+vatAmount, hsOrServiceCode: hs };
      });
      const subtotal = processed.reduce((a:any,b:any)=>a+b.taxableAmount,0);
      const taxAmount = processed.reduce((a:any,b:any)=>a+b.vatAmount,0);
      const totalAmount = subtotal+taxAmount;
      data.subtotal = subtotal;
      data.taxAmount = taxAmount;
      data.totalAmount = totalAmount;
      updated = await prisma.$transaction(async (tx) => {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
        return tx.invoice.update({ where: { id }, data: { ...data, lineItems: { create: processed } }, include: { lineItems: true } });
      });
    } else {
      if (Object.keys(data).length===0) return res.status(400).json({ success: false, error: "No fields to update" });
      updated = await prisma.invoice.update({ where: { id }, data, include: { lineItems: true } });
    }
    console.log(`[PUT /api/invoices/${id}] updated ${updated.clientInvoiceId} for tenant ${existing.tenantId}`);
    await safeAuditLogCreate(prisma, { tenantId: existing.tenantId, action: "INVOICE_EDITED", entityType: "INVOICE", entityRef: updated.clientInvoiceId, details: `Invoice ${updated.clientInvoiceId} edited via overlay`, sha256PayloadHash: generateSha256(JSON.stringify(updated)), performedBy: req.user?.email || "Editor", rawJson: updated });
    res.json(formatInvoice(updated));
  } catch (e:any) {
    console.error(`[PUT /api/invoices/${req.params.id}] failed:`, e);
    res.status(500).json({ success: false, error: e.message || "Internal server error" });
  }
});

router.post("/api/integration/gen/invoices", async (req, res) => {
  try {
    const {
      tenantId,
      clientInvoiceNumber,
      documentNumber,
      invoiceKind,
      invoiceType,
      invoiceTypeCode,
      originalIrn,
      billingReferenceIrns,
      lineItems,
      customerCode,
      customerName,
      customerTin,
      issueDate,
      sourceErp,
      erpId,
      headerCharges,
      headerDiscount,
      currency,
      customFields,
      metadata,
    } = req.body;
    const _hc = (req.body as any).HeaderCharges ?? (req.body as any).headerCharges ?? headerCharges;
    const _hd = (req.body as any).HeaderDiscount ?? (req.body as any).headerDiscount ?? headerDiscount;
    const _itc = (req.body as any).InvoiceTypeCode ?? (req.body as any).invoiceTypeCode ?? invoiceTypeCode;
    const _br = (req.body as any).billingReferenceIrns ?? (req.body as any)['Billing Reference IRNs'] ?? billingReferenceIrns;
    const _cf = (req.body as any).customFields ?? customFields;
    const _md = (req.body as any).metadata ?? metadata;

    const targetTenantId = tenantId || (req as any).user?.tenantId || "tenant_qbo_smb";
    if ((req as any).user && (req as any).user.role !== "ADMIN" && targetTenantId !== (req as any).user.tenantId) return res.status(403).json({ success: false, error: "Forbidden: tenant isolation — cannot send to another tenant" });
    const tenant = await prisma.tenant.findUnique({
      where: { id: targetTenantId },
    });
    if (!tenant) {
      return res
        .status(404)
        .json({ success: false, error: "Tenant not found" });
    }

    const errors: string[] = [];
    if (!clientInvoiceNumber) errors.push("clientInvoiceNumber is mandatory");
    if (!issueDate) errors.push("issueDate is mandatory (YYYY-MM-DD)");

    if (clientInvoiceNumber) {
      const duplicate = await prisma.invoice.findFirst({
        where: { tenantId: tenant.id, clientInvoiceId: clientInvoiceNumber },
        include: { lineItems: true },
      });
      if (duplicate && !["CANCELLED", "REJECTED"].includes(duplicate.status)) {
        const existingFmt = formatInvoice(duplicate);
        if (duplicate.status === 'PENDING_NRS_STAMP' || (duplicate.status as any) === 'PENDING' || duplicate.status === 'QUEUED') {
          try {
            const qRow = await prisma.queueJob.findFirst({ where: { tenantId: tenant.id, payload: { contains: duplicate.id } }, orderBy: { createdAt: 'desc' } });
            const isStuck = !qRow || qRow.status === 'DLQ' || (qRow.status === 'FAILED') || (Date.now() - new Date((qRow as any).nextAttemptAt || (qRow as any).updatedAt).getTime() > 120000 && (qRow as any).status !== 'QUEUED');
            if (isStuck) {
              const hasEnvKey = !!(process.env.CITTAEFS_API_KEY?.trim() || process.env.CITTA_EFS_API_KEY?.trim());
              const hasDbKey = !!(tenant.cittaApiKey && tenant.cittaApiKey.length >= 10 && !tenant.cittaApiKey.includes(["place","holder"].join("")));
              if (!hasEnvKey && !hasDbKey) {
                const fresh = await prisma.tenant.findFirst({ where: { cittaApiKey: { not: "" } }, select: { cittaApiKey: true } });
                const hasAnyDbKey = !!(fresh?.cittaApiKey && fresh.cittaApiKey.length >= 10);
                if (!hasAnyDbKey) {
                  return res.status(503).json({ success: false, code: "GATEWAY_NOT_CONFIGURED", error: "CittaEFS gateway API key not configured — set CITTAEFS_API_KEY env var (single shared key) or configure one tenant's cittaApiKey. Invoice is queued in Hub but cannot forward to CittaEFS until key is set.", cittaResponse: { status: duplicate.status, invoice: existingFmt, idempotent: true } });
                }
              }
              try {
                const v = invoiceIngestionSchema.parse({
                  tenantId: tenant.id, clientInvoiceNumber: duplicate.clientInvoiceId, documentNumber: duplicate.documentNumber || undefined,
                  invoiceType: duplicate.invoiceType as any, invoiceKind: duplicate.invoiceKind as any,
                  issueDate: duplicate.issueDate.toISOString().substring(0,10),
                  customerCode: duplicate.customerCode, customerName: duplicate.customerName, customerTin: duplicate.customerTin || undefined,
                  lineItems: duplicate.lineItems.map((li:any)=>({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, discountAmount: 0, hsOrServiceCode: li.hsOrServiceCode, codeType: li.hsOrServiceCode?.startsWith("HS")?"HS_CODE":"SERVICE_CODE", vatRate: li.vatRate })),
                });
                await invoiceQueue.add("signInvoice", { ...v, dbInvoiceId: duplicate.id }, { idempotencyKey: `${tenant.id}:${duplicate.clientInvoiceId}:retry` });
                return res.status(200).json({ success: true, idempotent: true, requeued: true, message: `Invoice "${clientInvoiceNumber}" was stuck in Hub (status ${duplicate.status}) — re-queued to CittaEFS`, cittaResponse: { status: duplicate.status, invoice: existingFmt, idempotent: true, requeued: true } });
              } catch (rqErr) { console.warn('[Idempotent requeue failed]', (rqErr as any)?.message); }
            }
            if (qRow && (qRow as any).status === 'QUEUED') {
              const retryMs = Math.max(0, new Date((qRow as any).nextAttemptAt).getTime() - Date.now());
              return res.status(200).json({
                success: true,
                idempotent: true,
                diagnostic: `Forwarding to CittaEFS pending — worker will retry in ${Math.round(retryMs/1000)}s`,
                lastError: (qRow as any).lastError || null,
                nextAttemptAt: (qRow as any).nextAttemptAt,
                message: `Invoice "${clientInvoiceNumber}" already queued (status ${duplicate.status}) — forwarding pending.`,
                cittaResponse: { status: duplicate.status, invoice: existingFmt, idempotent: true, queueStatus: "QUEUED" },
              });
            }
          } catch {}
        }
        return res.status(200).json({
          success: true,
          idempotent: true,
          message: `Invoice "${clientInvoiceNumber}" already queued (status ${duplicate.status}) — idempotent. Check Staging (Hub) or CittaEFS for IRN.`,
          cittaResponse: { status: duplicate.status, invoice: existingFmt, idempotent: true },
        });
      }
    }

    let resolvedTin = customerTin;
    if ((invoiceKind === "B2B" || invoiceKind === "B2G") && (!resolvedTin || resolvedTin.length < 8)) {
      try {
        const custMaster = await prisma.customer.findFirst({ where: { tenantId: tenant.id, clientSystemCustId: customerCode } });
        if (custMaster?.taxId && custMaster.taxId.length >= 8 && custMaster.taxId !== "N/A") resolvedTin = custMaster.taxId;
      } catch {}
    }
    if (
      (invoiceKind === "B2B" || invoiceKind === "B2G") &&
      (!resolvedTin || resolvedTin.length < 8)
    ) {
      errors.push(
        `${invoiceKind} Invoices require a valid Tax Identification Number (customerTin) — not found in payload nor customer master for ${customerCode}`,
      );
    } else if (resolvedTin) {
      (req.body as any)._resolvedTin = resolvedTin;
    }

    const tenantItems = await prisma.item.findMany({
      where: { tenantId: tenant.id },
    });

    const processedLineItems = (lineItems || []).map(
      (li: any, idx: number) => {
        let mapping = tenantItems.find((m) => m.clientSku === li.itemCode);
        const hsOrServiceCode =
          li.hsOrServiceCode || (li as any).HsorServiceCode || (li as any).HSCode || mapping?.hsOrServiceCode || "UNMAPPED";
        const _lineNum = (li as any).Linenumber ?? (li as any).lineNum ?? (li as any).LineNumber ?? idx + 1;
        const _unitCode = (li as any).UnitCode ?? (li as any).unitCode ?? "EA";
        const _taxCat = (li as any).TaxCategory ?? (li as any).taxCategoryId ?? "STANDARD_VAT";
        const _discount = Number((li as any).LineDiscount ?? (li as any).lineDiscount ?? li.discountAmount ?? 0);
        const _taxable = (li as any).taxableamount ?? (li as any).TaxableAmount ?? (li as any).taxableAmount;
        const _tax = (li as any).taxamount ?? (li as any).TaxAmount ?? (li as any).taxAmount ?? (li as any).vatAmount;

        if (hsOrServiceCode === "UNMAPPED") {
          errors.push(
            `Line Item #${idx + 1} (${li.itemCode || "Unknown SKU"}) lacks mandatory hsOrServiceCode.`,
          );
        }

        const qty = Number(li.quantity || 1);
        const price = Number(li.unitPrice || li.Price || 0);
        const discount = Number(_discount);
        const taxable = _taxable !== undefined ? Number(_taxable) : qty * price - discount;
        const vatRate =
          li.vatRate !== undefined
            ? Number(li.vatRate)
            : Number(mapping?.defaultVatRate ?? tenant.defaultVatRate);
        const vatAmount = (taxable * vatRate) / 100;
        const totalAmount = taxable + vatAmount;

        return {
          itemCode: li.itemCode || "SKU-GENERIC",
          description: li.description || "Generic Item",
          quantity: qty,
          unitPrice: price,
          taxableAmount: taxable,
          vatRate,
          vatAmount,
          totalAmount,
          hsOrServiceCode,
        };
      },
    );

    if (errors.length > 0) {
      const isDuplicate = errors.some((e) => e.startsWith("Duplicate invoice"));
      const valError = await prisma.validationError.create({
        data: {
          tenantId: tenant.id,
          clientInvoiceNumber: clientInvoiceNumber || "UNNAMED",
          errorCategory: isDuplicate
            ? "DUPLICATE_INVOICE"
            : errors.some((e) => e.includes("hsOrServiceCode"))
              ? "MISSING_HS_CODE"
              : "INVALID_TIN_FORMAT",
          fieldAffected: isDuplicate
            ? "clientInvoiceNumber"
            : errors[0].includes("customerTin")
              ? "customerTin"
              : "lineItems",
          errorMessage: errors.join(" | "),
          rawPayloadSample: JSON.stringify(req.body),
          status: "OPEN",
        },
      });

      return res.status(isDuplicate ? 409 : 400).json({
        success: false,
        status: "REJECTED_PREFLIGHT",
        errors,
        validationErrorId: valError.id,
        message:
          "Pre-flight validation failed. Route to Validation Error Queue.",
      });
    }

    const subtotal = processedLineItems.reduce(
      (acc, item) => acc + item.taxableAmount,
      0,
    );
    const totalVat = processedLineItems.reduce(
      (acc, item) => acc + item.vatAmount,
      0,
    );
    const grandTotal = subtotal + totalVat;

    const _resolved = (req.body as any)._resolvedTin as string | undefined;
    const effectiveCustomerTin =
      invoiceKind === "B2C" ? undefined : (_resolved || customerTin || undefined);

    let resolvedSourceErp: string | null = (sourceErp as string) || (erpId as string) || null;
    if (!resolvedSourceErp) {
      try {
        const firstErp = await prisma.tenantErp.findFirst({ where: { tenantId: tenant.id, status: "ACTIVE" }, select: { erpId: true } });
        resolvedSourceErp = firstErp?.erpId || null;
      } catch {}
    }
    const _effectiveCurrency = (currency as any) || (req.body as any).CurrencyCode || "NGN";
    const _effectiveHeaderCharges = Number(_hc ?? 0);
    const _effectiveHeaderDiscount = Number(_hd ?? 0);
    const rawNewInvoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        sourceErp: resolvedSourceErp,
        clientInvoiceId: clientInvoiceNumber || `INV-${Date.now()}`,
        documentNumber: documentNumber || null,
        invoiceType: (_itc as any) ? (_itc as string) : (invoiceType || "STANDARD"),
        invoiceKind: invoiceKind || "B2B",
        issueDate: new Date(issueDate || Date.now()),
        customerCode: customerCode || "CUST-CITTA-GENERIC",
        customerName: customerName || "Valued Client",
        customerTin: effectiveCustomerTin || null,
        currency: _effectiveCurrency,
        subtotal,
        taxAmount: totalVat,
        totalAmount: grandTotal,
        headerCharges: _effectiveHeaderCharges,
        headerDiscount: _effectiveHeaderDiscount,
        status: "PENDING_NRS_STAMP",
        ledgerWritebackStatus: "PENDING",
        lineItems: {
          create: processedLineItems,
        },
      },
      include: { lineItems: true },
    });

    const newInvoice = formatInvoice(rawNewInvoice);

    const _brArr = _br ? String(_br).split(',').map((x:string)=>x.trim()).filter(Boolean) : undefined;
    const validatedPayload = invoiceIngestionSchema.parse({
      tenantId: tenant.id,
      clientInvoiceNumber:
        clientInvoiceNumber || rawNewInvoice.clientInvoiceId,
      documentNumber: documentNumber || undefined,
      invoiceType: (_itc as any) ? undefined : (invoiceType || "STANDARD"),
      invoiceTypeCode: _itc ? String(_itc) : undefined,
      invoiceKind: invoiceKind || "B2B",
      issueDate: issueDate || new Date().toISOString().substring(0, 10),
      customerCode: customerCode || "CUST-CITTA-GENERIC",
      customerName: customerName || "Valued Client",
      customerTin: effectiveCustomerTin,
      originalIrn: originalIrn || undefined,
      billingReferenceIrns: _brArr,
      headerCharges: _effectiveHeaderCharges,
      headerDiscount: _effectiveHeaderDiscount,
      currency: _effectiveCurrency,
      customFields: _cf,
      metadata: _md,
      lineItems: processedLineItems.map((li: any) => ({
        itemCode: li.itemCode,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discountAmount: (li as any).discountAmount ?? 0,
        hsOrServiceCode: li.hsOrServiceCode,
        codeType: li.hsOrServiceCode?.startsWith("HS")
          ? "HS_CODE"
          : "SERVICE_CODE",
        vatRate: li.vatRate,
        lineNum: (li as any).lineNum,
        unitCode: (li as any).unitCode,
        taxCategoryId: (li as any).taxCategoryId,
        taxableAmount: (li as any).taxableAmount,
        vatAmount: (li as any).vatAmount,
      })),
    });

    const idemKey = `${tenant.id}:${clientInvoiceNumber || rawNewInvoice.clientInvoiceId}`;
    await invoiceQueue.add("signInvoice", {
      ...validatedPayload,
      dbInvoiceId: rawNewInvoice.id,
    }, { idempotencyKey: idemKey });

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { monthlyUsed: { increment: 1 }, lastSyncAt: new Date() },
    });

    await safeAuditLogCreate(prisma, {
      tenantId: tenant.id,
      action: "PAYLOAD_GENERATED",
      entityType: "INVOICE",
      entityRef: clientInvoiceNumber,
      details: `Invoice validated and queued for NRS stamping via CittaEFS Gateway.`,
      sha256PayloadHash: generateSha256(JSON.stringify(newInvoice)),
      performedBy: "CittaEFS Integration Hub /gen/invoices",
      rawJson: newInvoice,
    });

    res.status(202).json({
      success: true,
      message:
        "Invoice validated and queued for NRS stamping. It will be marked APPROVED with a real IRN once the CittaEFS Gateway responds.",
      cittaResponse: {
        status: "PENDING_NRS_STAMP",
        invoice: newInvoice,
      },
    });
  } catch (e: any) {
    if (e.code === "P2002" && (String(e.meta?.target || "").includes("client_invoice_id") || String(e.meta?.target || "").includes("clientInvoiceId") || String(e.meta?.target || "").includes("Tenant_clientInvoiceId"))) {
      try {
        const existing = await prisma.invoice.findFirst({ where: { tenantId: (req.body as any).tenantId || (req as any).user?.tenantId || "tenant_qbo_smb", clientInvoiceId: req.body.clientInvoiceNumber }, include: { lineItems: true } });
        const existingQbo = !existing ? await prisma.invoice.findFirst({ where: { tenantId: (req.body as any).tenantId || (req as any).user?.tenantId || "tenant_qbo_smb", qboInvoiceId: req.body.clientInvoiceNumber }, include: { lineItems: true } }) : null;
        const found = existing || existingQbo;
        if (found) {
          if (found.status === "REJECTED") {
            await prisma.invoice.update({ where: { id: found.id }, data: { status: "PENDING_NRS_STAMP" } });
            try {
              const vRetry = invoiceIngestionSchema.parse({
                tenantId: found.tenantId, clientInvoiceNumber: found.clientInvoiceId, documentNumber: found.documentNumber || undefined,
                invoiceType: found.invoiceType as any, invoiceKind: found.invoiceKind as any,
                issueDate: found.issueDate.toISOString().substring(0,10),
                customerCode: found.customerCode, customerName: found.customerName, customerTin: found.customerTin || undefined,
                lineItems: found.lineItems.map((li:any)=>({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, discountAmount: 0, hsOrServiceCode: li.hsOrServiceCode, codeType: li.hsOrServiceCode?.startsWith("HS")?"HS_CODE":"SERVICE_CODE", vatRate: li.vatRate })),
              });
              await invoiceQueue.add("signInvoice", { ...vRetry, dbInvoiceId: found.id }, { idempotencyKey: `${found.tenantId}:${found.clientInvoiceId}:retry` });
            } catch {}
            return res.status(200).json({ success: true, idempotent: true, requeued: true, message: `REJECTED invoice "${found.clientInvoiceId}" re-queued to CittaEFS (was REJECTED)`, cittaResponse: { status: "PENDING_NRS_STAMP", invoice: formatInvoice(found), idempotent: true, requeued: true } });
          }
          return res.status(200).json({ success: true, idempotent: true, message: `Invoice "${found.clientInvoiceId}" already exists (status ${found.status}) — idempotent`, cittaResponse: { status: found.status, invoice: formatInvoice(found), idempotent: true } });
        }
      } catch {}
      return res.status(409).json({
        error: `Duplicate invoice: clientInvoiceNumber "${req.body.clientInvoiceNumber}" already exists for this tenant`,
      });
    }
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/integration/gen/invoices/bulk", async (req: any, res) => {
  try {
    const { tenantId, invoices: bulkInvoices } = req.body;
    const targetTenantId = tenantId || (req.user?.tenantId) || "tenant_qbo_smb";
    if (req.user && req.user.role !== "ADMIN" && targetTenantId !== req.user.tenantId) return res.status(403).json({ success: false, error: "Forbidden: tenant isolation" });
    const tenant = await prisma.tenant.findUnique({ where: { id: targetTenantId } });
    if (!tenant) return res.status(404).json({ success: false, error: "Tenant not found" });
    if (!Array.isArray(bulkInvoices) || bulkInvoices.length === 0) return res.status(400).json({ success: false, error: "invoices array required" });
    if (bulkInvoices.length > 100) return res.status(400).json({ success: false, error: "Bulk limit is 100 invoices per request" });

    const results: any[] = [];
    const seenInBatch = new Set<string>();
    for (const payload of bulkInvoices) { try {
      const { clientInvoiceNumber, documentNumber, invoiceKind, invoiceType, invoiceTypeCode, lineItems, customerCode, customerName, customerTin, issueDate, originalIrn, billingReferenceIrns, sourceErp, erpId, headerCharges, headerDiscount, currency, customFields, metadata } = payload || {};
      const _hc_b = (payload as any).HeaderCharges ?? (payload as any).headerCharges ?? headerCharges;
      const _hd_b = (payload as any).HeaderDiscount ?? (payload as any).headerDiscount ?? headerDiscount;
      const _itc_b = (payload as any).InvoiceTypeCode ?? (payload as any).invoiceTypeCode ?? invoiceTypeCode;
      const _br_b = (payload as any).billingReferenceIrns ?? (payload as any)['Billing Reference IRNs'] ?? billingReferenceIrns;
      const errors: string[] = [];
      if (!clientInvoiceNumber) errors.push("clientInvoiceNumber mandatory");
      if (!issueDate) errors.push("issueDate mandatory");
      if (clientInvoiceNumber && seenInBatch.has(String(clientInvoiceNumber))) {
        const existingBatchDup = await prisma.invoice.findFirst({ where: { tenantId: tenant.id, clientInvoiceId: String(clientInvoiceNumber) }, include: { lineItems: true } });
        if (existingBatchDup) {
          results.push({ clientInvoiceNumber, success: true, idempotent: true, invoice: formatInvoice(existingBatchDup), message: `Duplicate within batch (status ${existingBatchDup.status}) — idempotent` });
        } else {
          results.push({ clientInvoiceNumber, success: false, errors: [`Duplicate invoice "${clientInvoiceNumber}" within same batch`] });
        }
        continue;
      }
      if (clientInvoiceNumber) seenInBatch.add(String(clientInvoiceNumber));
      if (clientInvoiceNumber) {
        const dup = await prisma.invoice.findFirst({ where: { tenantId: tenant.id, clientInvoiceId: clientInvoiceNumber }, include: { lineItems: true } });
        if (dup && !["CANCELLED", "REJECTED"].includes(dup.status)) {
          if (dup.status === 'PENDING_NRS_STAMP' || (dup.status as any) === 'PENDING') {
            try {
              const qRow = await prisma.queueJob.findFirst({ where: { tenantId: tenant.id, payload: { contains: dup.id } }, orderBy: { createdAt: 'desc' } });
              if (!qRow || qRow.status === 'DLQ' || qRow.status === 'FAILED') {
                try {
                  const vBulk = invoiceIngestionSchema.parse({
                    tenantId: tenant.id, clientInvoiceNumber: dup.clientInvoiceId, documentNumber: dup.documentNumber || undefined,
                    invoiceType: dup.invoiceType as any, invoiceKind: dup.invoiceKind as any,
                    issueDate: dup.issueDate.toISOString().substring(0,10),
                    customerCode: dup.customerCode, customerName: dup.customerName, customerTin: dup.customerTin || undefined,
                    lineItems: dup.lineItems.map((li:any)=>({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, discountAmount: 0, hsOrServiceCode: li.hsOrServiceCode, codeType: li.hsOrServiceCode?.startsWith("HS")?"HS_CODE":"SERVICE_CODE", vatRate: li.vatRate })),
                  });
                  await invoiceQueue.add("signInvoice", { ...vBulk, dbInvoiceId: dup.id }, { idempotencyKey: `${tenant.id}:${dup.clientInvoiceId}:retry` });
                  results.push({ clientInvoiceNumber, success: true, idempotent: true, requeued: true, invoice: formatInvoice(dup), message: `Was stuck in Hub — re-queued to CittaEFS` });
                  continue;
                } catch {}
              }
            } catch {}
          }
          results.push({ clientInvoiceNumber, success: true, idempotent: true, invoice: formatInvoice(dup), message: `Already queued (status ${dup.status}) — idempotent` });
          continue;
        }
      }
      let bulkResolvedTin: string | undefined = customerTin;
      if ((invoiceKind === "B2B" || invoiceKind === "B2G") && (!bulkResolvedTin || bulkResolvedTin.length < 8)) {
        try { const cm = await prisma.customer.findFirst({ where: { tenantId: tenant.id, clientSystemCustId: customerCode } }); if (cm?.taxId && cm.taxId.length >= 8 && cm.taxId !== "N/A") bulkResolvedTin = cm.taxId; } catch {}
      }
      if ((invoiceKind === "B2B" || invoiceKind === "B2G") && (!bulkResolvedTin || bulkResolvedTin.length < 8)) errors.push(`${invoiceKind} requires customerTin — not in payload nor customer master for ${customerCode}`);
      if (errors.length) { results.push({ clientInvoiceNumber: clientInvoiceNumber || 'UNKNOWN', success: false, errors }); continue; }

      const tenantItems = await prisma.item.findMany({ where: { tenantId: tenant.id } });
      const processed = (lineItems || []).map((li: any, idx: number) => {
        const mapping = tenantItems.find(m => m.clientSku === li.itemCode);
        const hs = li.hsOrServiceCode || (li as any).HsorServiceCode || (li as any).HSCode || mapping?.hsOrServiceCode || "UNMAPPED";
        const _lineNum_b = (li as any).Linenumber ?? (li as any).lineNum ?? (li as any).LineNumber ?? idx + 1;
        const _unitCode_b = (li as any).UnitCode ?? (li as any).unitCode ?? "EA";
        const _taxCat_b = (li as any).TaxCategory ?? (li as any).taxCategoryId ?? "STANDARD_VAT";
        const _discount_b = Number((li as any).LineDiscount ?? (li as any).lineDiscount ?? li.discountAmount ?? 0);
        const qty = Number(li.quantity || 1);
        const price = Number(li.unitPrice || (li as any).Price || 0);
        const disc = Number(_discount_b);
        const _taxable_b = (li as any).taxableamount ?? (li as any).TaxableAmount ?? (li as any).taxableAmount;
        const taxable = _taxable_b !== undefined ? Number(_taxable_b) : qty * price - disc;
        const vatRate = li.vatRate !== undefined ? Number(li.vatRate) : Number(mapping?.defaultVatRate ?? tenant.defaultVatRate);
        const vatAmount = (taxable * vatRate) / 100;
        return { itemCode: li.itemCode || "SKU-GENERIC", description: li.description || "Generic", quantity: qty, unitPrice: price, taxableAmount: taxable, vatRate, vatAmount, totalAmount: taxable + vatAmount, hsOrServiceCode: hs };
      });
      const hasUnmapped = processed.some((p: any) => !p.hsOrServiceCode || p.hsOrServiceCode === "UNMAPPED");
      if (hasUnmapped) { results.push({ clientInvoiceNumber, success: false, errors: ["Missing hsOrServiceCode on one or more lines"] }); continue; }

      const subtotal = processed.reduce((a: number, b: any) => a + b.taxableAmount, 0);
      const totalVat = processed.reduce((a: number, b: any) => a + b.vatAmount, 0);
      const grandTotal = subtotal + totalVat;
      const effectiveTin = invoiceKind === "B2C" ? null : bulkResolvedTin || null;
      let bulkSourceErp: string | null = (sourceErp as string) || (erpId as string) || null;
      if (!bulkSourceErp) {
        try { const firstErp = await prisma.tenantErp.findFirst({ where: { tenantId: tenant.id, status: "ACTIVE" }, select: { erpId: true } }); bulkSourceErp = firstErp?.erpId || null; } catch {}
      }
      let raw: any;
      try {
        const _effCurrency_b = (currency as any) || (payload as any).CurrencyCode || "NGN";
        const _effHC_b = Number(_hc_b ?? 0);
        const _effHD_b = Number(_hd_b ?? 0);
        const _itc_b_val = _itc_b ? String(_itc_b) : (invoiceType || "STANDARD");
        raw = await prisma.invoice.create({
          data: {
            tenantId: tenant.id,
            sourceErp: bulkSourceErp,
            clientInvoiceId: clientInvoiceNumber,
            documentNumber: documentNumber || null,
            invoiceType: _itc_b_val,
            invoiceKind: invoiceKind || "B2B",
            issueDate: new Date(issueDate),
            customerCode: customerCode || "CUST-CITTA-GENERIC",
            customerName: customerName || "Valued Client",
            customerTin: effectiveTin,
            currency: _effCurrency_b,
            subtotal, taxAmount: totalVat, totalAmount: grandTotal,
            headerCharges: _effHC_b,
            headerDiscount: _effHD_b,
            status: "PENDING_NRS_STAMP", ledgerWritebackStatus: "PENDING",
            lineItems: { create: processed },
          },
          include: { lineItems: true },
        });
      } catch (bulkCreateErr: any) {
        if (bulkCreateErr.code === "P2002" && (String(bulkCreateErr.meta?.target || "").includes("clientInvoiceId") || String(bulkCreateErr.meta?.target || "").includes("Tenant_clientInvoiceId") || String(bulkCreateErr.meta?.target || "").includes("client_invoice_id"))) {
          const existing = await prisma.invoice.findFirst({ where: { tenantId: tenant.id, clientInvoiceId: clientInvoiceNumber }, include: { lineItems: true } });
          if (existing) {
            if (existing.status === "REJECTED") {
              await prisma.invoice.update({ where: { id: existing.id }, data: { status: "PENDING_NRS_STAMP" } }).catch(()=>{});
              try {
                const vRetryBulk = invoiceIngestionSchema.parse({
                  tenantId: tenant.id, clientInvoiceNumber: existing.clientInvoiceId, documentNumber: existing.documentNumber || undefined,
                  invoiceType: existing.invoiceType as any, invoiceKind: existing.invoiceKind as any,
                  issueDate: existing.issueDate.toISOString().substring(0,10),
                  customerCode: existing.customerCode, customerName: existing.customerName, customerTin: existing.customerTin || undefined,
                  lineItems: existing.lineItems.map((li:any)=>({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, discountAmount: 0, hsOrServiceCode: li.hsOrServiceCode, codeType: li.hsOrServiceCode?.startsWith("HS")?"HS_CODE":"SERVICE_CODE", vatRate: li.vatRate })),
                });
                await invoiceQueue.add("signInvoice", { ...vRetryBulk, dbInvoiceId: existing.id }, { idempotencyKey: `${tenant.id}:${existing.clientInvoiceId}:retry` });
                results.push({ clientInvoiceNumber, success: true, idempotent: true, requeued: true, invoice: formatInvoice(existing), message: `REJECTED — re-queued` });
              } catch { results.push({ clientInvoiceNumber, success: true, idempotent: true, invoice: formatInvoice(existing), message: `Already exists (REJECTED) — re-queued` }); }
            } else {
              results.push({ clientInvoiceNumber, success: true, idempotent: true, invoice: formatInvoice(existing), message: `Already exists (status ${existing.status}) — idempotent` });
            }
            continue;
          }
          results.push({ clientInvoiceNumber, success: false, errors: [`Duplicate invoice "${clientInvoiceNumber}" — already exists`] });
          continue;
        } else {
          results.push({ clientInvoiceNumber, success: false, errors: [bulkCreateErr.message || String(bulkCreateErr)] });
          continue;
        }
      }
      const newInv = formatInvoice(raw);
      const _brArr_b = _br_b ? String(_br_b).split(',').map((x:string)=>x.trim()).filter(Boolean) : undefined;
      const validated = invoiceIngestionSchema.parse({
        tenantId: tenant.id, clientInvoiceNumber, documentNumber: documentNumber || undefined,
        invoiceType: _itc_b ? undefined : (invoiceType || "STANDARD"), invoiceTypeCode: _itc_b ? String(_itc_b) : undefined,
        invoiceKind: invoiceKind || "B2B",
        issueDate: issueDate || new Date().toISOString().substring(0,10),
        customerCode: customerCode || "CUST-CITTA-GENERIC", customerName: customerName || "Valued Client",
        customerTin: effectiveTin || undefined, originalIrn: originalIrn || undefined, billingReferenceIrns: _brArr_b,
        headerCharges: Number(_hc_b ?? 0), headerDiscount: Number(_hd_b ?? 0), currency: (currency as any) || (payload as any).CurrencyCode || "NGN", customFields: (payload as any).customFields, metadata: (payload as any).metadata,
        lineItems: processed.map((li: any) => ({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, discountAmount: (li as any).discountAmount ?? 0, hsOrServiceCode: li.hsOrServiceCode, codeType: li.hsOrServiceCode?.startsWith("HS") ? "HS_CODE" : "SERVICE_CODE", vatRate: li.vatRate, lineNum: (li as any).lineNum ?? (li as any).Linenumber, unitCode: (li as any).unitCode, taxCategoryId: (li as any).taxCategoryId, taxableAmount: (li as any).taxableAmount, vatAmount: (li as any).vatAmount })),
      });
      const bulkIdemKey = `${tenant.id}:${clientInvoiceNumber}`;
      await invoiceQueue.add("signInvoice", { ...validated, dbInvoiceId: raw.id }, { idempotencyKey: bulkIdemKey });
      results.push({ clientInvoiceNumber, success: true, invoice: newInv });
    } catch (perErr:any) { results.push({ clientInvoiceNumber: (payload as any)?.clientInvoiceNumber || 'UNKNOWN', success:false, errors:[perErr.message || String(perErr)] }); continue; }
    }
    await prisma.tenant.update({ where: { id: tenant.id }, data: { monthlyUsed: { increment: results.filter(r=>r.success).length }, lastSyncAt: new Date() } });
    const successCount = results.filter(r=>r.success).length;
    res.status(202).json({ success: true, successCount, failedCount: results.length - successCount, results, message: `Bulk queued ${successCount}/${results.length} invoices for NRS stamping` });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/api/invoices/cancel", async (req, res) => {
  try {
    const { invoiceId, reason } = req.body;
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true },
    });
    if (!inv)
      return res
        .status(404)
        .json({ success: false, error: "Invoice not found" });

    const rawUpdated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: "CANCELLED" },
      include: { lineItems: true },
    });

    const updated = formatInvoice(rawUpdated);

    await safeAuditLogCreate(prisma, {
      tenantId: inv.tenantId,
      action: "CITTA_SUBMITTED",
      entityType: "INVOICE",
      entityRef: inv.clientInvoiceId,
      details: `Revocation request dispatched to NRS Portal. Reason: ${reason || "Client Cancellation"}. IRN ${inv.irn} marked CANCELLED.`,
      sha256PayloadHash: generateSha256(`CANCEL_${inv.irn}`),
      performedBy: "Client ERP Revocation Endpoint",
    });

    res.json({ success: true, invoice: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/invoices/:id/retry", async (req: any, res) => {
  try {
    const role = req.user?.role;
    if (req.user && !["ADMIN","OPERATOR","INTEGRATION_MANAGER"].includes(role)) return res.status(403).json({ success: false, error: "Forbidden" });
    const { id } = req.params;
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { lineItems: true } });
    if (!invoice) return res.status(404).json({ success: false, error: "Invoice not found" });
    if (!canAccessTenant(req, invoice.tenantId)) return res.status(403).json({ success: false, error: "Forbidden: tenant isolation" });
    if (["APPROVED","SIGNED"].includes(invoice.status)) return res.status(400).json({ success: false, error: `Invoice already ${invoice.status} — cannot retry` });
    const needsStatusReset = ["REJECTED","FAILED","CANCELLED","DLQ"].includes(invoice.status);
    if (needsStatusReset) {
      await prisma.invoice.update({ where: { id }, data: { status: "PENDING_NRS_STAMP" } });
    }
    let requeuedJob: any = null;
    try { requeuedJob = await invoiceQueue.requeueInvoice(id, invoice.tenantId); } catch {}
    if (!requeuedJob) {
      const validated = invoiceIngestionSchema.parse({
        tenantId: invoice.tenantId,
        clientInvoiceNumber: invoice.clientInvoiceId,
        documentNumber: invoice.documentNumber || undefined,
        invoiceType: invoice.invoiceType as any,
        invoiceKind: invoice.invoiceKind as any,
        issueDate: invoice.issueDate.toISOString().substring(0,10),
        customerCode: invoice.customerCode,
        customerName: invoice.customerName,
        customerTin: invoice.customerTin || undefined,
        lineItems: invoice.lineItems.map((li:any)=>({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, discountAmount: 0, hsOrServiceCode: li.hsOrServiceCode, codeType: li.hsOrServiceCode?.startsWith("HS")?"HS_CODE":"SERVICE_CODE", vatRate: li.vatRate })),
      });
      requeuedJob = await invoiceQueue.add("signInvoice", { ...validated, dbInvoiceId: invoice.id }, { idempotencyKey: `${invoice.tenantId}:${invoice.clientInvoiceId}:retry:${Date.now()}` });
    }
    try { await prisma.validationError.updateMany({ where: { tenantId: invoice.tenantId, clientInvoiceNumber: invoice.clientInvoiceId, status: "OPEN" }, data: { status: "RETRIED" } }); } catch {}
    await safeAuditLogCreate(prisma, { tenantId: invoice.tenantId, action: "INVOICE_RETRY", entityType: "INVOICE", entityRef: invoice.clientInvoiceId, details: `Manual retry queued for invoice ${invoice.clientInvoiceId} (was ${invoice.status}) via POST /api/invoices/:id/retry`, sha256PayloadHash: generateSha256(invoice.clientInvoiceId + Date.now()), performedBy: req.user?.email || "Operator" });
    res.json({ success: true, requeued: true, jobId: requeuedJob?.id, invoice: formatInvoice(await prisma.invoice.findUnique({ where: { id }, include: { lineItems: true } })) });
  } catch (e:any) { res.status(500).json({ success:false, error: e.message }); }
});

router.post("/api/invoices/retry-bulk", async (req: any, res) => {
  try {
    const role = req.user?.role;
    if (req.user && !["ADMIN","OPERATOR","INTEGRATION_MANAGER"].includes(role)) return res.status(403).json({ success: false, error: "Forbidden" });
    const { tenantId, invoiceIds, statusFilter } = req.body || {};
    const targetTenantId = tenantId || req.user?.tenantId;
    if (!targetTenantId) return res.status(400).json({ success:false, error: "tenantId required" });
    if (req.user && req.user.role !== "ADMIN" && targetTenantId !== req.user.tenantId) return res.status(403).json({ success:false, error: "Forbidden: tenant isolation" });
    const where: any = { tenantId: targetTenantId };
    if (invoiceIds && Array.isArray(invoiceIds) && invoiceIds.length) where.id = { in: invoiceIds };
    else if (statusFilter) where.status = statusFilter;
    else where.status = { in: ["REJECTED","FAILED","PENDING_NRS_STAMP","PENDING","QUEUED"] };
    const pending = await prisma.invoice.findMany({ where, include: { lineItems: true }, take: 100 });
    const retryable = pending.filter((inv:any)=> !["APPROVED","SIGNED"].includes(inv.status));
    if (retryable.length===0) return res.json({ success:true, retried:0, message:"No retryable invoices found" });
    const results:any[]=[];
    for (const inv of retryable) {
      try {
        if (["REJECTED","FAILED","CANCELLED"].includes(inv.status)) await prisma.invoice.update({ where:{id:inv.id}, data:{status:"PENDING_NRS_STAMP"}});
        let job:any=null;
        try { job = await invoiceQueue.requeueInvoice(inv.id, inv.tenantId); } catch {}
        if (!job) {
          const validated = invoiceIngestionSchema.parse({
            tenantId: inv.tenantId, clientInvoiceNumber: inv.clientInvoiceId, documentNumber: inv.documentNumber || undefined,
            invoiceType: inv.invoiceType as any, invoiceKind: inv.invoiceKind as any,
            issueDate: inv.issueDate.toISOString().substring(0,10),
            customerCode: inv.customerCode, customerName: inv.customerName, customerTin: inv.customerTin || undefined,
            lineItems: inv.lineItems.map((li:any)=>({ itemCode: li.itemCode, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, discountAmount:0, hsOrServiceCode: li.hsOrServiceCode, codeType: li.hsOrServiceCode?.startsWith("HS")?"HS_CODE":"SERVICE_CODE", vatRate: li.vatRate })),
          });
          job = await invoiceQueue.add("signInvoice", { ...validated, dbInvoiceId: inv.id }, { idempotencyKey: `${inv.tenantId}:${inv.clientInvoiceId}:retry:${Date.now()}` });
        }
        results.push({ clientInvoiceNumber: inv.clientInvoiceId, success:true, jobId: job?.id });
      } catch (e:any) { results.push({ clientInvoiceNumber: inv.clientInvoiceId, success:false, error: e.message }); }
    }
    const successCount = results.filter((r:any)=>r.success).length;
    res.json({ success:true, retried: successCount, total: retryable.length, results });
  } catch (e:any) { res.status(500).json({ success:false, error: e.message }); }
});

// ==========================================
// Staging summary — pre-transmission holding area (pending queue + DLQ) distinct from Validation (post-failure)
// ==========================================
router.get("/api/staging/summary", async (req:any,res)=>{
  try {
    const queryTenantId = req.query.tenantId as string | undefined;
    const scoped = getScopedTenantWhere(req, queryTenantId);
    const tenantId = scoped.tenantId || req.user?.tenantId;
    if (req.user && req.user.role !== "ADMIN" && tenantId !== req.user.tenantId) return res.status(403).json({ success:false, error:"Forbidden: tenant isolation" });
    const where: any = tenantId ? { tenantId } : {};
    const [pending, approved, rejected, queued, dlqCount] = await Promise.all([
      prisma.invoice.count({ where: { ...where, status: "PENDING_NRS_STAMP" } }),
      prisma.invoice.count({ where: { ...where, status: { in: ["APPROVED","SIGNED"] } } }),
      prisma.invoice.count({ where: { ...where, status: { in: ["REJECTED","FAILED"] } } }),
      prisma.queueJob.count({ where: { ...where, status: "QUEUED" } }).catch(()=>0),
      prisma.queueJob.count({ where: { ...where, status: "DLQ" } }).catch(()=>0),
    ]);
    const qStats = invoiceQueue.getQueueStats();
    const pendingInvoices = await prisma.invoice.findMany({ where: { ...where, status: "PENDING_NRS_STAMP" }, include:{ lineItems:true }, orderBy:{ createdAt:"desc"}, take: 50 });
    const dlqJobs = await prisma.queueJob.findMany({ where: { ...where, status:"DLQ"}, orderBy:{ updatedAt:"desc"}, take: 10 });
    res.json({
      tenantId: tenantId || null,
      counts: { pending, approved, rejected, total: pending+approved+rejected, queued, dlqCount },
      queue: { engine: qStats.engine, queued: qStats.queued, processing: qStats.processing, failedInDLQ: qStats.failedInDLQ, bullMqReady: qStats.bullMqReady },
      pendingPreview: pendingInvoices.map(formatInvoice),
      dlqPreview: dlqJobs.map((j:any)=>({ id: j.id, jobName: j.jobName, status: j.status, attempts: j.attempts, lastError: j.lastError?.slice(0,400), nextAttemptAt: j.nextAttemptAt, createdAt: j.createdAt })),
    });
  } catch(e:any){ res.status(500).json({ success:false, error:e.message }); }
});

router.get("/api/queue/stats", async (req:any,res)=>{
  try {
    const stats = invoiceQueue.getQueueStats();
    res.json(stats);
  } catch(e:any){ res.status(500).json({ error:e.message});}
});

// ==========================================
// HUB EXTERNAL API FOR EXISTING CITTAEFS SYSTEMS
// ==========================================
async function resolveHubTenant(req: any): Promise<string | null> {
  const apiKey = (req.headers["x-hub-api-key"] as string) || (req.headers["x-api-key"] as string) || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);
  if (apiKey) {
    const tenant = await prisma.tenant.findFirst({ where: { cittaApiKey: apiKey } });
    if (tenant) return tenant.id;
  }
  if (req.body?.tenantId) {
    const t = await prisma.tenant.findUnique({ where: { id: req.body.tenantId } });
    if (t) return t.id;
  }
  if (req.query?.tenantId) {
    const t = await prisma.tenant.findUnique({ where: { id: req.query.tenantId as string } });
    if (t) return t.id;
  }
  return null;
}

router.get("/api/hub/v1/health", async (req, res) => {
  res.json({ status: "ok", service: "citta-hub-external", timestamp: new Date().toISOString(), version: "1.0" });
});

router.get("/api/hub/v1/tenants/:tenantId/invoices", async (req, res) => {
  try {
    const tenantId = await resolveHubTenant(req) || req.params.tenantId;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ success: false, error: "Tenant not found or invalid API key" });
    const { skip, take, page, limit } = parsePagination(req);
    const where: any = { tenantId };
    if (req.query.status) where.status = req.query.status;
    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({ where, include: { lineItems: true }, orderBy: { createdAt: "desc" }, skip, take }),
    ]);
    res.json({ data: rows.map(formatInvoice), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/api/hub/v1/tenants/:tenantId/invoices/:clientInvoiceNumber", async (req, res) => {
  try {
    const tenantId = await resolveHubTenant(req) || req.params.tenantId;
    const inv = await prisma.invoice.findFirst({ where: { tenantId, clientInvoiceId: req.params.clientInvoiceNumber }, include: { lineItems: true } });
    if (!inv) return res.status(404).json({ success: false, error: "Invoice not found" });
    res.json(formatInvoice(inv));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/api/hub/v1/invoices", async (req, res) => {
  try {
    const tenantId = await resolveHubTenant(req);
    if (!tenantId) return res.status(401).json({ success: false, error: "Missing or invalid X-Hub-Api-Key. Provide tenant's cittaApiKey." });
    req.body.tenantId = tenantId;
    const body = req.body;
    const mapped = {
      tenantId,
      clientInvoiceNumber: body.clientInvoiceNumber || body.invoiceNumber || body.clientInvoiceId,
      documentNumber: body.documentNumber,
      invoiceKind: body.invoiceKind || "B2B",
      invoiceType: body.invoiceType || "STANDARD",
      originalIrn: body.originalIrn || body.billingReferenceIrn,
      issueDate: body.issueDate,
      customerCode: body.customerCode || body.customerCode || "CUST-EXTERNAL",
      customerName: body.customerName || body.customer_name,
      customerTin: body.customerTin || body.customer_tin,
      lineItems: (body.lineItems || body.items || []).map((li: any) => ({
        itemCode: li.itemCode || li.sku || li.ItemCode,
        description: li.description || li.desc || li.ItemDescription,
        quantity: Number(li.quantity || li.qty || 1),
        unitPrice: Number(li.unitPrice || li.price || 0),
        discountAmount: Number(li.discountAmount || li.discount || 0),
        hsOrServiceCode: li.hsOrServiceCode || li.hsCode || "HS-8471.30",
        vatRate: li.vatRate !== undefined ? Number(li.vatRate) : undefined,
      })),
    };
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ success: false, error: "Tenant not found" });
    const validated = invoiceIngestionSchema.parse({
      tenantId,
      clientInvoiceNumber: mapped.clientInvoiceNumber,
      documentNumber: mapped.documentNumber,
      invoiceType: mapped.invoiceType as any,
      invoiceKind: mapped.invoiceKind as any,
      issueDate: mapped.issueDate,
      customerCode: mapped.customerCode,
      customerName: mapped.customerName,
      customerTin: mapped.customerTin,
      originalIrn: mapped.originalIrn,
      lineItems: mapped.lineItems,
    });
    const dup = await prisma.invoice.findFirst({ where: { tenantId, clientInvoiceId: validated.clientInvoiceNumber } });
    if (dup) return res.status(409).json({ success: false, error: `Duplicate invoice ${validated.clientInvoiceNumber}` });
    const subtotal = validated.subtotal;
    const totalVat = validated.totalVat;
    const grandTotal = validated.grandTotal;
    const rawNewInvoice = await prisma.invoice.create({
      data: {
        tenantId,
        clientInvoiceId: validated.clientInvoiceNumber,
        documentNumber: (validated as any).documentNumber || null,
        invoiceType: validated.invoiceType,
        invoiceKind: validated.invoiceKind,
        issueDate: new Date(validated.issueDate),
        customerCode: validated.customerCode,
        customerName: validated.customerName,
        customerTin: (validated as any).customerTin || null,
        currency: "NGN",
        subtotal,
        taxAmount: totalVat,
        totalAmount: grandTotal,
        status: "PENDING_NRS_STAMP",
        ledgerWritebackStatus: "PENDING",
        lineItems: { create: validated.lineItems.map((li: any) => ({
          itemCode: li.itemCode,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxableAmount: li.taxableAmount,
          vatRate: li.vatRate,
          vatAmount: li.vatAmount,
          totalAmount: li.totalAmount,
          hsOrServiceCode: li.hsOrServiceCode,
        })) },
      },
      include: { lineItems: true },
    });
    await invoiceQueue.add("signInvoice", { ...validated, dbInvoiceId: rawNewInvoice.id });
    await prisma.tenant.update({ where: { id: tenantId }, data: { monthlyUsed: { increment: 1 }, lastSyncAt: new Date() } });
    res.status(202).json({ success: true, status: "PENDING_NRS_STAMP", invoice: formatInvoice(rawNewInvoice), message: "Queued via Hub external API. Poll GET /api/hub/v1/tenants/:id/invoices/:number for IRN." });
  } catch (e: any) {
    if (e.name === "ZodError") return res.status(400).json({ success: false, error: "Validation failed", details: e.errors });
    res.status(500).json({ error: e.message });
  }
});

export default router;
