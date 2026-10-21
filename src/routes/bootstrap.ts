import { Router } from "express";
import tenantsRouter from "./tenants";
import invoicesRouter from "./invoices";
import customersRouter from "./customers";
import itemsRouter from "./items";
import entityMappingsRouter from "./entityMappings";
import validationRouter from "./validation";

const router = Router();

// ==========================================
// BOOTSTRAP API — one round-trip for the store's initial load
//
// Replaces the client's 7-way Promise.all (/api/tenants, /api/invoices,
// /api/customers, /api/items/mappings, /api/entity-mappings,
// /api/validation-errors, /api/metrics) with a single GET that invokes the
// existing handlers in-process — no logic duplication, same tenant scoping
// (the caller's JWT middleware has already populated req.user/req.tenantId).
// ==========================================

// Find the GET handler registered on `path` inside an Express router.
function findGetHandler(r: any, path: string): ((req: any, res: any) => any) | null {
  for (const layer of r.stack ?? []) {
    if (layer.route?.path === path && layer.route.methods?.get) {
      return layer.route.stack[0].handle;
    }
  }
  return null;
}

// Invoke an Express handler with a stub response that captures the JSON body
// instead of writing to the socket. Resolves null on timeout/error so the
// caller can fall back to preserving its current state.
function callHandler(handler: any, req: any, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve) => {
    let done = false;
    let statusCode = 200;
    const finish = (body: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(body ?? null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    const stub: any = {
      headersSent: false,
      setHeader: () => stub,
      getHeader: () => undefined,
      removeHeader: () => stub,
      status: (c: number) => { statusCode = c; return stub; },
      json: (b: any) => { finish(statusCode >= 400 ? null : b); return stub; },
      send: (b: any) => { finish(statusCode >= 400 ? null : b); return stub; },
      end: () => { finish(null); return stub; },
      write: () => true,
      cookie: () => stub,
      clearCookie: () => stub,
      redirect: () => finish(null),
      on: () => stub,
    };

    try {
      const out = handler(req, stub, (err?: any) => finish(err ? null : undefined));
      if (out && typeof out.then === "function") out.catch(() => finish(null));
    } catch (e) {
      console.error("[API Error] /api/bootstrap handler threw:", e);
      finish(null);
    }
  });
}

const SOURCES: Array<[key: string, source: any, path: string]> = [
  ["tenants", tenantsRouter, "/api/tenants"],
  ["invoices", invoicesRouter, "/api/invoices"],
  ["customers", customersRouter, "/api/customers"],
  ["itemMappings", itemsRouter, "/api/items/mappings"],
  ["entityMappings", entityMappingsRouter, "/api/entity-mappings"],
  ["validationErrors", validationRouter, "/api/validation-errors"],
  ["metrics", validationRouter, "/api/metrics"],
];

router.get("/api/bootstrap", async (req: any, res) => {
  try {
    const entries = await Promise.all(
      SOURCES.map(async ([key, source, path]) => {
        const handler = findGetHandler(source, path);
        if (!handler) {
          console.error(`[API Error] /api/bootstrap: no GET handler found for ${path}`);
          return [key, null] as const;
        }
        return [key, await callHandler(handler, req)] as const;
      })
    );
    const payload: Record<string, any> = {};
    for (const [key, body] of entries) payload[key] = body;
    res.json(payload);
  } catch (e) {
    console.error("[API Error] GET /api/bootstrap failed:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
