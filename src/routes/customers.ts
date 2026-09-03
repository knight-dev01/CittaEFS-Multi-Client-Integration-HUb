import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  formatCustomer,
  getScopedTenantWhere,
  parsePagination,
} from "../lib/serverHelpers";

const router = Router();

// ==========================================
// 5. CUSTOMERS API (DB Backed)
// ==========================================
router.get("/api/customers", async (req: any, res) => {
  try {
    const queryTenantId = req.query.tenantId as string | undefined;
    const { skip, take, page, limit } = parsePagination(req);
    const where: any = { ...getScopedTenantWhere(req, queryTenantId) };
    const [total, rawCustomers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
    ]);
    const customers = rawCustomers.map(formatCustomer);
    if (req.query.page !== undefined || req.query.limit !== undefined) {
      res.json({ data: customers, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } else {
      res.setHeader("X-Total-Count", String(total));
      res.json(customers);
    }
  } catch (e: any) {
    console.error("[API Error] GET /api/customers failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/api/customers", async (req, res) => {
  try {
    const {
      tenantId,
      clientCustomerCode,
      name,
      tin,
      isB2B,
      street,
      city,
      country,
      email,
    } = req.body;
    const tId = tenantId || "tenant_qbo_smb";
    const custCode =
      clientCustomerCode || `CUST-${Math.floor(1000 + Math.random() * 9000)}`;

    // Spec: TIN is 10-14 alphanumeric characters, no spaces/hyphens; mandatory
    // for B2B, optional for B2C.
    const trimmedTin = typeof tin === "string" ? tin.trim() : "";
    const tinFormatValid = /^[A-Za-z0-9]{10,14}$/.test(trimmedTin);

    const errors: string[] = [];
    if (isB2B && !trimmedTin) {
      errors.push("TIN is mandatory for B2B customers.");
    } else if (trimmedTin && !tinFormatValid) {
      errors.push(
        "TIN must be 10 to 14 alphanumeric characters, with no spaces or hyphens.",
      );
    }
    if (isB2B && !(req.body.postcode || "").trim()) {
      errors.push("Postcode is required for B2B customers.");
    }
    const ccEmailVal = (req.body.ccEmail as string) || "";
    if (ccEmailVal.trim()) {
      const parts = ccEmailVal.split(";").map((s: string) => s.trim()).filter(Boolean);
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const bad = parts.filter((p: string) => !emailRe.test(p));
      if (bad.length > 0) errors.push(`CCEmail contains invalid emails: ${bad.join(", ")} (semicolon-separated).`);
    }
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    let rawCustomer: any;
    const ccEmail = (req.body as any).ccEmail as string | undefined;
    const postcode = (req.body as any).postcode as string | undefined;
    rawCustomer = await prisma.customer.create({
      data: {
        tenantId: tId,
        clientSystemCustId: custCode,
        companyName: name || "New Customer",
        email: email || "contact@client.com",
        ccEmail: ccEmail || null,
        postcode: postcode || null,
        taxId: trimmedTin || "N/A",
        taxClassification: isB2B ? "B2B" : "B2C",
        street: street || "Nairobi Business District",
        city: city || "Nairobi",
        country: country || "NG",
      },
    });

    const customer = formatCustomer(rawCustomer);
    res.status(201).json(customer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/customers/:id", async (req: any, res) => {
  try {
    const { id } = req.params;
    const { name, tin, isB2B, street, city, country, email, ccEmail, postcode } = req.body;
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: "Customer not found" });
    if (tin !== undefined) {
      const trimmed = String(tin).trim();
      const valid = /^[A-Za-z0-9]{10,14}$/.test(trimmed);
      if (existing.taxClassification === "B2B" && !trimmed) return res.status(400).json({ success: false, errors: ["TIN is mandatory for B2B customers."] });
      if (trimmed && !valid) return res.status(400).json({ success: false, errors: ["TIN must be 10 to 14 alphanumeric characters."] });
    }
    const updated = await prisma.customer.update({
      where: { id },
      data: {
        companyName: name ?? existing.companyName,
        taxId: tin !== undefined ? (String(tin).trim() || "N/A") : existing.taxId,
        taxClassification: isB2B !== undefined ? (isB2B ? "B2B" : "B2C") : existing.taxClassification,
        street: street ?? existing.street,
        city: city ?? existing.city,
        country: country ?? existing.country,
        email: email ?? existing.email,
        ccEmail: ccEmail ?? (existing as any).ccEmail,
        postcode: postcode ?? (existing as any).postcode,
      },
    });
    res.json(formatCustomer(updated));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/customers/:id", async (req: any, res) => {
  try {
    await prisma.customer.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ success: false, error: "Customer not found" });
    res.status(500).json({ error: e.message });
  }
});

export default router;
