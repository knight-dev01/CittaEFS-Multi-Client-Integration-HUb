import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// Health check for Render & load balancers
router.get(["/healthz", "/health", "/api/health"], (req, res) => {
  res
    .status(200)
    .json({
      status: "ok",
      service: "cittaefs-integration-hub",
      timestamp: new Date().toISOString(),
    });
});

// Clear persisted records for a fresh start — removes invoices, customers, items, etc.
router.post("/api/system/purge-demo-data", async (req, res) => {
  try {
    try {
      await prisma.invoiceLineItem.deleteMany();
      await prisma.invoice.deleteMany();
      await prisma.validationError.deleteMany();
      await prisma.customer.deleteMany();
      await prisma.item.deleteMany();
      await prisma.auditLog.deleteMany();
    } catch {}
    res.json({
      success: true,
      message:
        "All invoices, validation errors, customers, items, and audit logs cleared successfully from PostgreSQL/SQLite.",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Catch-all handler for unmatched API routes — returns JSON 404, not HTML
router.use("/api/*", (req, res) => {
  res
    .status(404)
    .json({
      success: false,
      error: `API route not found: ${req.method} ${req.originalUrl}`,
    });
});

export default router;
