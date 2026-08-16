# CittaEFS Multi-Tenant Integration Hub - Deployment Guide

## 🏗️ Architecture Overview

This application uses a **distributed deployment architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    VERCEL (Frontend)                        │
│  • Vite static assets (React 19 dashboard)                  │
│  • API proxy to Render backend                              │
│  • URL: https://your-vercel-domain.vercel.app               │
└────────────────────────┬────────────────────────────────────┘
                         │ /api/* → proxies to
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  RENDER (Backend API)                       │
│  • Express 4 + TypeScript server                            │
│  • PostgreSQL database                                      │
│  • WebSockets live telemetry                                │
│  • Secret Files for credential storage                      │
│  • URL: https://cittaefs-multi-client-integration-hub.onrender.com │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            RENDER POSTGRES (Database)                       │
│  • Multi-tenant database instance                           │
│  • Encrypted credential storage                             │
│  • Automatic daily backups                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Prerequisites

- **Node.js** v18.0.0 or higher
- **npm** v9.0.0 or higher
- **Git** for version control
- **Render.com** account for backend hosting
- **Vercel** account for frontend hosting
- **PostgreSQL** database (hosted on Render)

---

## 🚀 Deployment Workflow

### Phase 1: Prepare Render Backend

#### Step 1: Configure Render PostgreSQL Database

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **+ New** → **PostgreSQL**
3. Fill in details:
   - **Name**: `cittaefs-postgres`
   - **Database**: `cittaefs_hub`
   - **User**: `cittaefs`
   - **Region**: Choose closest to your users
   - **Plan**: Use appropriate tier (Standard/Premium)
4. Click **Create Database**
5. Note the **Internal Database URL** (you'll need this for Render backend)

#### Step 2: Deploy Express Backend to Render

1. Create a new **Web Service** on Render:
   - Click **+ New** → **Web Service**
   - Connect your GitHub repository
   - **Name**: `cittaefs-multi-client-integration-hub`
   - **Region**: Same as your database
   - **Branch**: `main` (or your production branch)

2. Configure Build & Deployment:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`
   - **Environment**: `Node`
   - **Node Version**: 18

#### Step 3: Add Render Secret Files

⚠️ **IMPORTANT**: Use Render's **Secret Files** feature instead of environment variables for sensitive credentials.

1. On your Render Web Service page, go to **Environment**
2. Scroll to **Secret Files** section
3. Create a `.env` file with your sensitive credentials:

   Click **Add Secret File** and set:
   - **Filename**: `.env`
   - **Contents**: Paste the entire `.env` content from `.env.example` with actual values:

   ```env
   NODE_ENV=production
   PORT=3000
   JWT_SECRET=<generate-a-secure-random-string>
   ENCRYPTION_KEY=<generate-32-byte-hex-string>
   DATABASE_URL=postgresql://cittaefs:password@cittaefs-db.onrender.com:5432/cittaefs_hub
   APP_URL=https://cittaefs-multi-client-integration-hub.onrender.com
   GEMINI_API_KEY=<your-gemini-api-key>
   CITTAEFS_API_KEY=citta_live_placeholder
   CITTAEFS_WEBHOOK_SECRET=whsec_placeholder
   QBO_CLIENT_ID=<your-qbo-client-id>
   QBO_CLIENT_SECRET=<your-qbo-client-secret>
   QBO_REDIRECT_URI=https://cittaefs-multi-client-integration-hub.onrender.com/api/connectors/qbo/callback
   DEFAULT_ADMIN_EMAIL=admin@cittaefs.com
   DEFAULT_ADMIN_PASSWORD=<change-this-secure-password>
   DEFAULT_ADMIN_NAME=System Administrator
   DEFAULT_ADMIN_ORG=CittaEFS Enterprise
   ```

4. Click **Save** (Render stores this securely, NOT in git)
5. The `.env` file will be automatically available at:
   - During builds: `/etc/secrets/.env`
   - At runtime: `/etc/secrets/.env` or accessible via `process.env`

#### Step 4: Verify Secret Files are Loaded

Your app should load the `.env` from `/etc/secrets/.env`. Update your startup script if needed:

```javascript
// In start.cjs or server initialization
require('dotenv').config({ path: '/etc/secrets/.env' });
```

#### Step 5: Initialize Database on Render

1. After service deploys, run migrations via Render Shell:
   ```bash
   npx prisma db push
   npm run seed
   ```

2. Or trigger via a one-off job:
   - Render Dashboard → Your Web Service → Jobs
   - Create a new job with command: `npx prisma db push && npm run seed`

---

### Phase 2: Deploy Frontend to Vercel

#### Step 1: Configure Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Add New** → **Project**
3. Import your GitHub repository
4. Configure:
   - **Project Name**: `cittaefs-hub`
   - **Framework Preset**: **Other** (we use Vite)
   - **Root Directory**: `.` (leave default)

#### Step 2: Set Build Commands

In Vercel project settings:

- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

#### Step 3: Environment Variables for Vercel

Vercel doesn't need most backend credentials. Only set the API URL:

```
VITE_API_URL=https://cittaefs-multi-client-integration-hub.onrender.com
```

(This tells the frontend where to find the API—used in `vite.config.ts`)

#### Step 4: Deploy

1. Click **Deploy**
2. Vercel will build and deploy your frontend
3. Your site will be available at `https://<project-name>.vercel.app`

---

## 🔐 Security Best Practices with Render Secret Files

### Why Secret Files > Environment Variables?

✅ **Render Secret Files advantages:**
- **Never stored in git** — completely isolated from version control
- **Not visible in build logs** — credentials are never exposed in CI/CD logs
- **Automatic injection** — available at `/etc/secrets/<filename>` at runtime
- **Audit trail** — Render tracks all secret file changes
- **No export vulnerability** — can't be accidentally dumped via `env` command

### Credential Management

✅ **DO:**
- Store **ALL sensitive credentials** in Render Secret Files (`.env` file)
- Use `ENCRYPTION_KEY` to encrypt sensitive data at rest
- Rotate `JWT_SECRET` and `ENCRYPTION_KEY` periodically
- Use strong, randomly-generated passwords (min 16 characters)
- Audit secret file access logs regularly

❌ **DON'T:**
- Commit `.env` or actual credentials to Git
- Use environment variables for secrets (use Secret Files instead)
- Share credentials in Slack, email, or Jira tickets
- Use placeholder values in production
- Reuse credentials across environments (dev/staging/prod)

### Database Security

- Use **Render's internal database URL** for backend → database communication
- Enable **IP whitelisting** on Render PostgreSQL (only allow Render backend IPs)
- Enable **SSL/TLS** for all database connections
- Regular backups: Render provides automated daily backups

### API Security

- **HTTPS only**: Both Vercel and Render use HTTPS by default
- **CORS**: Backend only accepts requests from your Vercel domain
- **WebSocket Security**: WSS (secure WebSockets) enabled by default on Render
- **Rate Limiting**: Configure per-endpoint rate limits on Render

---

## 🔄 Updating Credentials

### Update Secret Files on Render

1. Go to your Web Service on Render Dashboard
2. Click **Environment** tab
3. Scroll to **Secret Files**
4. Click the `.env` secret file → **Edit**
5. Update the credentials
6. Click **Save**
7. Service auto-restarts with new secrets

### Update Frontend Config on Vercel

1. Go to your project on Vercel Dashboard
2. **Settings** → **Environment Variables**
3. Edit `VITE_API_URL` if Render URL changes
4. Save (auto-redeploys on next push to your branch)

---

## 🧪 Verify Deployment

### Test Backend API

```bash
curl -H "Content-Type: application/json" \
  https://cittaefs-multi-client-integration-hub.onrender.com/api/health
```

Expected response:
```json
{"status": "ok", "timestamp": "2024-01-15T10:30:00Z"}
```

### Test Frontend

1. Navigate to `https://<project-name>.vercel.app`
2. Login with default admin credentials:
   - **Email**: `admin@cittaefs.com`
   - **Password**: `Admin123!` (or your configured password)
3. Verify all dashboard tabs load correctly
4. Check browser console for any API errors

### Test WebSocket Connection

Open browser DevTools → Console and run:
```javascript
const ws = new WebSocket('wss://cittaefs-multi-client-integration-hub.onrender.com');
ws.onopen = () => console.log('WebSocket connected');
ws.onerror = (e) => console.log('WebSocket error:', e);
```

---

## 📊 Monitoring & Logs

### Render Backend Logs

1. Render Dashboard → Your Web Service
2. Click **Logs** tab
3. Real-time streaming logs available
4. Secret file values are never logged

### Vercel Frontend Logs

1. Vercel Dashboard → Your Project
2. Click **Deployments** tab
3. Click on a deployment → **Logs** → **Build Logs** or **Runtime Logs**

### Database Logs

Render PostgreSQL logs available in database instance dashboard

---

## 🔄 CI/CD & Auto-Deployment

Both Render and Vercel support automatic deployments:

- **Render**: Auto-deploys on push to your branch (no configuration needed)
- **Vercel**: Auto-deploys on push to your connected branch

To deploy a new version:
```bash
git push origin main
# Render and Vercel automatically redeploy
```

---

## 🆘 Troubleshooting

### Frontend Cannot Reach Backend

**Problem**: `ERR_CONNECTION_REFUSED` or `CORS` errors

**Solution**:
1. Verify `VITE_API_URL` is set correctly in Vercel
2. Check Render backend is running: `curl https://<render-url>/api/health`
3. Verify `APP_URL` in Render Secret Files `.env` matches your Render service URL
4. Check CORS configuration in `server.ts`

### Database Connection Failed

**Problem**: `ECONNREFUSED` or `connection timeout`

**Solution**:
1. Verify `DATABASE_URL` is set in Render Secret Files `.env`
2. Confirm Render PostgreSQL instance is running
3. Test connection: `psql <DATABASE_URL>`
4. Check Render service logs for connection errors

### Secret File Not Loading

**Problem**: App starts but env variables are undefined

**Solution**:
1. Verify `.env` secret file is created in Render **Environment** → **Secret Files**
2. Confirm file is named exactly `.env` (case-sensitive)
3. Check `start.cjs` loads from `/etc/secrets/.env`:
   ```javascript
   require('dotenv').config({ path: '/etc/secrets/.env' });
   ```
4. Redeploy service after adding/updating secret files

### WebSocket Connection Fails

**Problem**: WebSocket opens as HTTP instead of HTTPS/WSS

**Solution**:
1. Ensure frontend requests `wss://` (not `ws://`)
2. Verify Render service has WebSocket support enabled
3. Check browser network tab for upgrade failures
4. Review server-side WebSocket handler in `server.ts`

---

## 🚨 Emergency Troubleshooting

### Rollback to Previous Deployment

**Render:**
1. Dashboard → Web Service → Deployments
2. Find previous successful deployment
3. Click **Redeploy** next to it

**Vercel:**
1. Dashboard → Project → Deployments
2. Find previous deployment
3. Click the deployment → **Redeploy**

### Database Recovery

If PostgreSQL becomes corrupted:
1. Render Dashboard → PostgreSQL Instance
2. Click **Backups**
3. Restore from recent backup (automatic backups run daily)

### Recover Lost Secrets

If you lose the `.env` secret file credentials:
1. **Render keeps encrypted backups** — contact Render support for recovery
2. **Local backup**: Keep a secure offline copy of credentials (password manager, vault)
3. **Regenerate**: For API keys/tokens, regenerate via original service providers

---

## 📞 Support & Resources

- **Render Docs**: https://render.com/docs
- **Render Secret Files**: https://render.com/docs/environment-variables#secret-files
- **Vercel Docs**: https://vercel.com/docs
- **Prisma ORM**: https://www.prisma.io/docs
- **Express.js**: https://expressjs.com
- **PostgreSQL**: https://www.postgresql.org/docs

---

## ✅ Deployment Checklist

Before going live to production:

- [ ] Render PostgreSQL database created and running
- [ ] Render Web Service created and connected to GitHub
- [ ] `.env` secret file created in Render with all credentials
- [ ] Database migrations applied (`npx prisma db push`)
- [ ] Seed data loaded (`npm run seed`)
- [ ] Backend health check passing
- [ ] Frontend deployed to Vercel
- [ ] `VITE_API_URL` set correctly in Vercel
- [ ] Frontend can login with admin credentials
- [ ] WebSocket telemetry working
- [ ] API proxy in Vercel (`vercel.json`) correctly routes to Render
- [ ] HTTPS/WSS enabled on both Render and Vercel
- [ ] Default admin password changed to secure value
- [ ] Database backups enabled on Render
- [ ] Monitoring/alerts configured on Render
- [ ] Incident response plan documented
- [ ] No credentials in git history (verify with `git log --all --full-history -- .env`)

---

**Last Updated**: 2024-01-15  
**Maintained by**: CittaEFS Development Team
