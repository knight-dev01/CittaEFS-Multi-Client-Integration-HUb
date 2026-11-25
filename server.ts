import "dotenv/config";
import express from "express";
import crypto from "crypto";
import path from "path";
import { createServer as createViteServer } from "vite";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { WebSocketServer, WebSocket } from "ws";
import { prisma } from "./src/lib/prisma";
import { logger, sanitizeHeaders, sanitizeBody } from "./src/lib/logger";
import { getAuthConfig } from "./src/lib/serverHelpers";
import { broadcastEvent, setSseClients, setWsClients } from "./src/lib/eventBus";
import { invoiceQueue } from "./src/queues/invoiceQueue";
import { runWorkerBatch } from "./src/workers/invoiceWorker";

import authRouter from "./src/routes/auth";
import tenantsRouter from "./src/routes/tenants";
import invoicesRouter from "./src/routes/invoices";
import customersRouter from "./src/routes/customers";
import itemsRouter from "./src/routes/items";
import codesRouter from "./src/routes/codes";
import validationRouter from "./src/routes/validation";
import bootstrapRouter from "./src/routes/bootstrap";
import qboRouter from "./src/routes/qbo";
import odooRouter from "./src/routes/odoo";
import webhooksRouter from "./src/routes/webhooks";
import systemRouter from "./src/routes/system";
import entityMappingsRouter from "./src/routes/entityMappings";
import gatewayRouter from "./src/routes/gateway";
import auditLogsRouter from "./src/routes/auditLogs";

const { JWT_SECRET } = getAuthConfig();

async function startServer() {
  const app = express();
  // Behind Render/Vercel: trust exactly one proxy hop so req.ip is the real client
  // and a forged X-Forwarded-For can't dodge the rate limiter.
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
  const PORT = Number(process.env.PORT || 10000);

  app.use(express.json({ limit: "10mb", verify: (req:any,res,buf)=>{ req.rawBody = buf; }}));
  app.use(cookieParser());

  app.use((req,res,next)=>{
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("X-Frame-Options","DENY");
    res.setHeader("X-XSS-Protection","0");
    res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV==="production") res.setHeader("Strict-Transport-Security","max-age=31536000; includeSubDomains");
    next();
  });

  const LOG_VERBOSE = process.env.LOG_VERBOSE==='1' || process.env.LOG_LEVEL==='debug';
  app.use((req:any,res,next)=>{
    const start=Date.now();
    const reqId=crypto.randomUUID().slice(0,8);
    req.requestId=reqId;
    const tenantHint=(req.query.tenantId as string) || req.headers['x-tenant-id'] as string || '';
    if (LOG_VERBOSE) logger.info(`→ ${req.method} ${req.originalUrl}`, { ip:req.ip, query:req.query, body:sanitizeBody(req.body)}, { tenantId: tenantHint||undefined, requestId:reqId});
    res.on('finish',()=>{
      const duration=Date.now()-start;
      const status=res.statusCode;
      const summary=`${req.method} ${req.originalUrl} ${status} ${duration}ms`;
      const ctx:any={ status, duration, tenantId:(req as any).tenantId||tenantHint||undefined};
      if (status>=500) logger.error(`← ${summary}`, ctx, { tenantId:ctx.tenantId, requestId:reqId});
      else if (status>=400) logger.warn(`← ${summary}`, ctx, { tenantId:ctx.tenantId, requestId:reqId});
      else if (LOG_VERBOSE || status!==304) logger.info(`← ${summary}`, status===304?undefined:ctx, { tenantId:ctx.tenantId, requestId:reqId});
      if (status>=400) logger.anomaly(`Anomaly ${req.method} ${req.originalUrl} → ${status}`, { status,duration,query:req.query,body:sanitizeBody(req.body),tenantId:ctx.tenantId}, { tenantId:ctx.tenantId, requestId:reqId});
    });
    next();
  });

  const rateBuckets=new Map<string,number[]>();
  function isRateLimited(key:string,limit:number,windowMs:number):boolean{ const now=Date.now(); const arr=rateBuckets.get(key)||[]; const recent=arr.filter(t=>now-t<windowMs); recent.push(now); rateBuckets.set(key,recent); return recent.length>limit; }
  setInterval(()=>{ const cutoff=Date.now()-60000; for(const [k,v] of rateBuckets){ const f=v.filter(t=>t>cutoff); if(f.length===0) rateBuckets.delete(k); else rateBuckets.set(k,f);} },60000).unref();
  app.use((req,res,next)=>{
    if (req.method==="OPTIONS" || req.path.startsWith("/health") || req.path==="/api/health") return next();
    const ip=req.ip||(req.socket as any)?.remoteAddress||"unknown";
    const isAuth=req.path.startsWith("/api/auth/");
    const limit=isAuth?30:300;
    const key=`${ip}:${isAuth?"auth":"api"}`;
    if (isRateLimited(key,limit,60000)) return res.status(429).json({ success:false, error:"Too many requests, please try again later."});
    next();
  });

  // Exact-match allow-list only. Set ALLOWED_ORIGINS to the production frontend
  // origin(s), e.g. "https://citta-hub.vercel.app". A blanket *.vercel.app match
  // would let any Vercel-hosted site make credentialed calls.
  const configuredOrigins=[process.env.ALLOWED_ORIGINS||"", process.env.APP_URL||""].join(",").split(",").map(s=>s.trim().replace(/\/$/,"")).filter(Boolean);
  const defaultAllow=["https://cittaefs-multi-client-integration-hub.onrender.com", "https://citta-efs-multi-client-integration.vercel.app",...(process.env.NODE_ENV!=="production"?["http://localhost:3000","http://localhost:5173"]:[])];
  const corsAllowList=Array.from(new Set([...configuredOrigins, ...defaultAllow]));
  if (process.env.NODE_ENV==="production" && !process.env.ALLOWED_ORIGINS) console.warn("[CORS] ALLOWED_ORIGINS not set — only", corsAllowList.join(", "), "may call the API cross-origin");
  function isOriginAllowed(origin?:string):boolean{ if(!origin) return true; if(corsAllowList.includes(origin)) return true; if(process.env.NODE_ENV!=="production") return true; return false; }
  app.use((req,res,next)=>{
    const origin=req.headers.origin as string|undefined;
    if (origin && isOriginAllowed(origin)){ res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary","Origin"); } else if (!origin){ res.setHeader("Access-Control-Allow-Origin", corsAllowList[0]||"*"); }
    res.setHeader("Access-Control-Allow-Methods","GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Expose-Headers","Content-Disposition, X-Export-Rows, X-Export-Invoices, X-Export-Skipped");
    res.setHeader("Access-Control-Allow-Credentials","true");
    if (req.method==="OPTIONS") return res.sendStatus(204);
    next();
  });

  let sseClients:any[]=[];
  let wsClients:WebSocket[]=[];
  setSseClients(sseClients); setWsClients(wsClients);
  app.get("/api/events", (req,res)=>{
    res.setHeader("Content-Type","text/event-stream"); res.setHeader("Cache-Control","no-cache"); res.setHeader("Connection","keep-alive"); res.setHeader("Access-Control-Allow-Origin","*"); res.flushHeaders();
    const clientId=Date.now(); const newClient={id:clientId,res}; sseClients.push(newClient); setSseClients(sseClients);
    res.write(`data: ${JSON.stringify({ type:"connected", clientId })}\n\n`);
    req.on("close",()=>{ sseClients=sseClients.filter(c=>c.id!==clientId); setSseClients(sseClients); });
  });

  app.use((req,res,next)=>{
    if (["POST","PUT","DELETE","PATCH"].includes(req.method)) res.on("finish",()=>{ if(res.statusCode>=200&&res.statusCode<300) broadcastEvent({ type:"update", method:req.method, path:req.path});});
    next();
  });

  // Routes reachable without a dashboard session. Everything else under /api
  // requires a valid JWT — for EVERY method, reads included.
  //  - webhooks verify their own HMAC; /api/v1 and /api/hub/v1 verify API keys
  //  - QBO connect/callback are browser navigations (no Bearer header); the
  //    callback is protected by the signed 15-minute OAuth state token.
  const PUBLIC_API_PREFIXES=["/api/auth/login","/api/auth/refresh","/api/auth/logout","/api/health","/api/webhooks","/pay2/einvoicehookweb","/api/events","/api/integrations/qbo/connect","/api/integrations/qbo/callback","/api/v1/","/api/hub/v1/"];
  app.use("/api/*", (req,res,next)=>{
    const p=req.baseUrl||req.path;
    if (req.method==="OPTIONS"||PUBLIC_API_PREFIXES.some(prefix=>p.startsWith(prefix))) return next();
    const bearerToken=req.headers.authorization?.startsWith("Bearer ")? req.headers.authorization.split(" ")[1]:null;
    const token=bearerToken||req.cookies?.token||null;
    if (!token) return res.status(401).json({ success:false, error:"Authentication token required"});
    try{
      const decoded:any=jwt.verify(token,JWT_SECRET);
      if (decoded?.type==="refresh"||decoded?.type==="merchant_access") return res.status(401).json({ success:false, error:"Invalid session token"});
      (req as any).user=decoded;
      // Non-admins are pinned to their own tenant; admins may target one via ?tenantId=.
      (req as any).tenantId = decoded.role==="ADMIN" ? (decoded.tenantId||(req.query.tenantId as string)) : decoded.tenantId;
      next();
    } catch(err){ return res.clearCookie("token").status(401).json({ success:false, error:"Invalid or expired session token"}); }
  });

  app.use(authRouter);
  app.use(tenantsRouter);
  app.use(invoicesRouter);
  app.use(customersRouter);
  app.use(itemsRouter);
  app.use(codesRouter);
  app.use(validationRouter);
  // Single round-trip for the store's initial load — must be before systemRouter's catch-all
  app.use(bootstrapRouter);
  app.use(qboRouter);
  app.use(odooRouter);
  app.use(webhooksRouter);
  app.use(entityMappingsRouter);
  // Gateway BEFORE systemRouter — system's JSON 404 catch-all (router.use "/api/*")
  // would otherwise shadow every /api/v1/* route the gateway registers.
  app.use(gatewayRouter);
  // Same reason: must be mounted before systemRouter's catch-all.
  app.use(auditLogsRouter);
  app.use(systemRouter);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server:{ middlewareMode:true}, appType:"custom"});
    app.use(vite.middlewares);
    app.use("*", async (req,res,next)=>{
      try{ const url=req.originalUrl; const template=await vite.transformIndexHtml(url, await import("fs").then(m=>m.readFileSync(path.resolve("index.html"),"utf-8"))); res.status(200).set({ "Content-Type":"text/html"}).end(template);} catch(e:any){ vite.ssrFixStacktrace(e); next(e);}
    });
  } else {
    const distPath=path.resolve("dist");
    app.use(express.static(distPath));
    app.get("*", (req,res)=>{ res.sendFile(path.join(distPath,"index.html")); });
  }

  setInterval(()=>{ runWorkerBatch().then(results=>{ if(results.length>0) broadcastEvent({ type:"update", method:"WORKER", path:"/queue/drain"});}).catch(err=>console.error("[Worker] Queue drain error:",err));},5000);
  // Continuous ERP sync + NRS archive verification (hub listens, not center of edits; pending until verified)
  // NRS archive check: picks up stamps whose CittaEFS webhook never arrived.
  // Only invoices still awaiting a stamp are looked up, so an idle hub makes
  // no gateway calls. Runs once shortly after start, then every minute.
  let nrsReconcileRunning = false;
  const nrsReconcile = async ()=>{
    if (nrsReconcileRunning) return;
    nrsReconcileRunning = true;
    try {
      const { runNrsReconciliationCron } = await import("./src/crons/reconciliation");
      const res = await runNrsReconciliationCron();
      if (res.recoveredCount>0 || res.orphansFixedCount>0) broadcastEvent({ type:"update", method:"CRON", path:"/nrs/reconcile"});
    } catch(e:any){ console.warn("[Cron] NRS reconcile error:", e.message); }
    finally { nrsReconcileRunning = false; }
  };
  setTimeout(nrsReconcile, 15000).unref();
  setInterval(nrsReconcile, 60000).unref();
  setInterval(async ()=>{
    try {
      const { runQbReconciliationCron } = await import("./src/crons/reconciliation");
      const res = await runQbReconciliationCron();
      if (res.recoveredCount>0) broadcastEvent({ type:"update", method:"CRON", path:"/qbo/reconcile"});
    } catch(e:any){ console.warn("[Cron] QBO reconcile error:", e.message); }
  }, 60000).unref(); // 60s QBO continuous sync
  // Odoo continuous poll — every second by default (ODOO_POLL_INTERVAL_MS).
  // A tick is skipped while the previous one is still running, and a tenant
  // whose Odoo is unreachable is paused for 30s instead of erroring every tick.
  // Newly ingested invoices are sent to the worker straight away.
  let odooPollRunning = false;
  const odooPausedUntil = new Map<string, number>();
  setInterval(async ()=>{
    if (odooPollRunning) return;
    odooPollRunning = true;
    try {
      const { fetchOdooInvoicesSince, ingestOdooInvoice } = await import("./src/services/odooService");
      const prisma = (await import("./src/lib/prisma")).prisma;
      const odooIntegrations = await prisma.integration.findMany({ where: { sourceSystem: "ODOO", status: "CONNECTED" } });
      let ingested = 0;
      await Promise.all(odooIntegrations.map(async (ig)=>{
        if ((odooPausedUntil.get(ig.tenantId) || 0) > Date.now()) return;
        try {
          const rows = await fetchOdooInvoicesSince(ig.tenantId, ig.lastSyncAt || undefined);
          odooPausedUntil.delete(ig.tenantId);
          for (const r of rows) { try { await ingestOdooInvoice(ig.tenantId, r); ingested++; } catch(err:any){ console.error(`[Cron] Odoo ingest failed for tenant ${ig.tenantId} invoice ${r?.name ?? r?.id}:`, err?.message); } }
        } catch(e:any){
          odooPausedUntil.set(ig.tenantId, Date.now() + 30000);
          console.warn(`[Cron] Odoo poll error for tenant ${ig.tenantId} (retrying in 30s):`, e.message);
        }
      }));
      if (ingested>0) {
        broadcastEvent({ type:"update", method:"CRON", path:"/odoo/reconcile"});
        runWorkerBatch().then(results=>{ if(results.length>0) broadcastEvent({ type:"update", method:"WORKER", path:"/queue/drain"}); }).catch(err=>console.error("[Worker] Queue drain error:",err));
      }
    } catch(e:any){ console.warn("[Cron] Odoo reconcile error:", e.message); }
    finally { odooPollRunning = false; }
  }, Number(process.env.ODOO_POLL_INTERVAL_MS || 1000)).unref();
  // Connectivity probe — live, every 60s by default (ERP_HEALTH_INTERVAL_MS): each
  // live ERP connection plus the CittaEFS gateway. Updates TenantErp health and
  // records ConnectivityProbe rows; clients refresh the uptime card on each round.
  let connectivityProbeRunning = false;
  const runConnectivityProbe = async ()=>{
    if (connectivityProbeRunning) return; // a slow round never overlaps the next
    connectivityProbeRunning = true;
    try {
      const { runErpHealthCron } = await import("./src/crons/erpHealth");
      const report = await runErpHealthCron();
      broadcastEvent({ type:"connectivity", method:"CRON", path:"/erp/health" });
      // Full dashboard refresh only when a connection status changed (reauth needed).
      if (report.needsReauth>0) broadcastEvent({ type:"update", method:"CRON", path:"/erp/health"});
    } catch(e:any){ console.warn("[Cron] connectivity probe error:", e.message); }
    finally { connectivityProbeRunning = false; }
  };
  setTimeout(runConnectivityProbe, 15000).unref(); // first reading shortly after boot
  setInterval(runConnectivityProbe, Number(process.env.ERP_HEALTH_INTERVAL_MS || 60000)).unref();
  // EFS feedback emails — one packaged email per tenant, sent to the ERP's company email.
  // Errors go out promptly (every 2 min batches a bulk sync into one email);
  // approvals (IRN issued) are bundled hourly.
  const runFeedbackCron = (kind: "error" | "approval") => async () => {
    try {
      const m = await import("./src/crons/errorDigest");
      const r = kind === "error" ? await m.runErrorDigestCron() : await m.runApprovalDigestCron();
      if (r.tenantsWithoutRecipients.length) console.warn(`[Cron] ${kind} feedback email: no recipients for ${r.tenantsWithoutRecipients.join(", ")} — no ERP company email found; set a notification email in Settings`);
    } catch(e:any){ console.warn(`[Cron] ${kind} feedback email error:`, e.message); }
  };
  setInterval(runFeedbackCron("error"), Number(process.env.ERROR_DIGEST_INTERVAL_MS || 120000)).unref();
  setInterval(runFeedbackCron("approval"), Number(process.env.APPROVAL_DIGEST_INTERVAL_MS || 3600000)).unref();
  // Code intelligence: suggest HS / service codes for every open MISSING_HS_CODE
  // error in the background (local search, plus the configured model if any).
  let suggestionSweepRunning = false;
  setInterval(async ()=>{
    if (suggestionSweepRunning) return;
    suggestionSweepRunning = true;
    try {
      const { runSuggestionSweep } = await import("./src/services/codeIntelligence");
      const { computed } = await runSuggestionSweep();
      if (computed>0) broadcastEvent({ type:"update", method:"CRON", path:"/code-intelligence/suggestions"});
    } catch(e:any){ console.warn("[Cron] code suggestion sweep error:", e.message); }
    finally { suggestionSweepRunning = false; }
  }, Number(process.env.CODE_SUGGESTION_INTERVAL_MS || 60000)).unref();

  (async()=>{
    const redisUrl=process.env.REDIS_URL?.trim()||process.env.REDIS_HOST?.trim();
    if(!redisUrl){ console.log("[BullMQ] REDIS_URL not set — using DB-memory queue"); return; }
    try{
      const { Worker } = await import("bullmq");
      const IORedis=(await import("ioredis")).default as any;
      const redisConnUrl=process.env.REDIS_URL?.trim() || `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT||6379}`;
      const connection=new IORedis(redisConnUrl,{ maxRetriesPerRequest:null});
      const worker=new Worker('citta-invoice-queue', async (job:any)=>{
        const payload=job.data;
        const qJob:any={ id:job.id||payload.dbInvoiceId, tenantId:payload.tenantId, data:payload, attempts:job.attemptsMade||0, maxRetries:5, backoffMs:[5000,30000,120000,600000,1800000], status:'PROCESSING', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), nextAttemptAt:new Date().toISOString()};
        const { processInvoiceJob } = await import("./src/workers/invoiceWorker");
        const result=await processInvoiceJob(qJob);
        if(!result.success && !result.movedToDLQ) throw new Error(result.error||'BullMQ job failed, will retry');
        if(result.movedToDLQ) console.warn(`[BullMQ] Job ${qJob.id} moved to DLQ: ${result.error}`);
        try{ const { invoiceQueue: iq }=await import("./src/queues/invoiceQueue"); if(result.success) await iq.removeJob(qJob.id); }catch{}
        broadcastEvent({ type:"update", method:"WORKER", path:"/queue/bullmq"});
        return result;
      }, { connection, concurrency:Number(process.env.BULLMQ_CONCURRENCY||'5'), limiter:{max:20,duration:1000}});
      worker.on('failed',(job,err)=>console.error(`[BullMQ] Job ${job?.id} failed:`,err.message));
      console.log(`[BullMQ] Worker started — concurrency ${process.env.BULLMQ_CONCURRENCY||'5'} — queue citta-invoice-queue`);
    } catch(e:any){ console.warn('[BullMQ] Worker init skipped (DB queue remains):',e.message); }
  })();

  const server=app.listen(PORT, ()=>{ console.log(`[Server] CittaEFS Hub listening on :${PORT} — ${process.env.NODE_ENV||'development'}`); });
  const wss=new WebSocketServer({ server, path:"/api/ws-events"});
  wss.on("connection",(ws)=>{ wsClients.push(ws); setWsClients(wsClients); ws.on("close",()=>{ wsClients=wsClients.filter(c=>c!==ws); setWsClients(wsClients);}); ws.on("error",()=>{ wsClients=wsClients.filter(c=>c!==ws); setWsClients(wsClients);}); ws.send(JSON.stringify({ type:"connected"}));});
  return { app, server };
}

startServer().catch(e=>{ console.error("[Fatal] Failed to start server:",e); process.exit(1); });
