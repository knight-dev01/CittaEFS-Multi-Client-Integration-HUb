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
import validationRouter from "./src/routes/validation";
import qboRouter from "./src/routes/qbo";
import webhooksRouter from "./src/routes/webhooks";
import systemRouter from "./src/routes/system";

const { JWT_SECRET } = getAuthConfig();

async function startServer() {
  const app = express();
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
    if (LOG_VERBOSE) logger.info(`→ ${req.method} ${req.originalUrl}`, { ip:(req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()||req.ip, query:req.query, body:sanitizeBody(req.body)}, { tenantId: tenantHint||undefined, requestId:reqId});
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
    const ip=(req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()||req.ip||(req.socket as any)?.remoteAddress||"unknown";
    const isAuth=req.path.startsWith("/api/auth/");
    const limit=isAuth?30:300;
    const key=`${ip}:${isAuth?"auth":"api"}`;
    if (isRateLimited(key,limit,60000)) return res.status(429).json({ success:false, error:"Too many requests, please try again later."});
    next();
  });

  const allowedOrigins=(process.env.ALLOWED_ORIGINS||process.env.APP_URL||"").split(",").map(s=>s.trim()).filter(Boolean);
  const defaultAllow=["http://localhost:3000","http://localhost:5173","https://cittaefs-multi-client-integration-hub.onrender.com"];
  const corsAllowList=allowedOrigins.length>0?allowedOrigins:defaultAllow;
  function isOriginAllowed(origin?:string):boolean{ if(!origin) return true; if(corsAllowList.includes(origin)) return true; if(origin.endsWith(".vercel.app")) return true; if(process.env.NODE_ENV!=="production") return true; return false; }
  app.use((req,res,next)=>{
    const origin=req.headers.origin as string|undefined;
    if (origin && isOriginAllowed(origin)){ res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary","Origin"); } else if (!origin){ res.setHeader("Access-Control-Allow-Origin", corsAllowList[0]||"*"); }
    res.setHeader("Access-Control-Allow-Methods","GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, X-Requested-With");
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

  app.use("/api/*", (req,res,next)=>{
    const p=req.baseUrl||req.path;
    if (req.method==="OPTIONS"||p.startsWith("/api/auth/login")||p.startsWith("/api/auth/refresh")||p.startsWith("/api/auth/register")||p.startsWith("/api/health")||p.startsWith("/api/webhooks")||p.startsWith("/pay2/einvoicehookweb")||p.startsWith("/api/events")||p.startsWith("/api/integrations/qbo/callback")||p.startsWith("/api/connectors")||p.startsWith("/api/cron")) return next();
    const bearerToken=req.headers.authorization?.startsWith("Bearer ")? req.headers.authorization.split(" ")[1]:null;
    const token=bearerToken||req.cookies?.token||null;
    if (!token){ (req as any).tenantId=(req.query.tenantId as string)||"tenant_qbo_smb"; if(req.method==="GET") return next(); return res.status(401).json({ success:false, error:"Authentication token required"}); }
    try{ const decoded:any=jwt.verify(token,JWT_SECRET); (req as any).user=decoded; (req as any).tenantId=decoded.tenantId||(req.query.tenantId as string)||"tenant_qbo_smb"; next(); } catch(err){ if(req.method==="GET"){ (req as any).tenantId=(req.query.tenantId as string)||"tenant_qbo_smb"; return next(); } return res.clearCookie("token").status(401).json({ success:false, error:"Invalid or expired session token"}); }
  });

  app.use(authRouter);
  app.use(tenantsRouter);
  app.use(invoicesRouter);
  app.use(customersRouter);
  app.use(itemsRouter);
  app.use(validationRouter);
  app.use(qboRouter);
  app.use(webhooksRouter);
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
