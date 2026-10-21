import { Router } from "express";
import { searchCittaCodes } from "../data/referenceData";

const router = Router();

// GET /api/items/codes/search?q=laptop&limit=30
// Server-side search over the official CittaEFS HS + Service catalogs so the
// ~900KB catalogs never ship in the client bundle. Supports common-term
// aliases (laptop, chair, phone…) via the shared searchCittaCodes helper.
router.get("/api/items/codes/search", (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    if (!q) return res.json([]);
    const matches = searchCittaCodes(q).slice(0, limit);
    res.json(matches);
  } catch (e: any) {
    console.error("[API Error] GET /api/items/codes/search failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
