import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { generateSha256, safeAuditLogCreate, getAuthConfig } from '../lib/serverHelpers';

const router = Router();
const { JWT_SECRET, JWT_REFRESH_SECRET, ACCESS_TOKEN_MAX_AGE_MS, REFRESH_TOKEN_MAX_AGE_MS } = getAuthConfig();

router.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required' });
    const normalizedEmail = email.toLowerCase().trim();
    const user: any = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return res.status(401).json({ success: false, error: 'Invalid email or password' });
    const isValid = user.passwordHash ? bcrypt.compareSync(password, user.passwordHash) : false;
    if (!isValid) return res.status(401).json({ success: false, error: 'Invalid email or password' });
    const tokenPayload = { userId: user.id, id: user.id, email: user.email, name: user.name, role: user.role, organization: user.organization, tenantId: user.tenantId };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
    const refreshToken = jwt.sign({ userId: user.id, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: ACCESS_TOKEN_MAX_AGE_MS });
    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: REFRESH_TOKEN_MAX_AGE_MS });
    try { await safeAuditLogCreate(prisma, { tenantId: user.tenantId || 'tenant_qbo_smb', action: 'USER_LOGIN', entityType: 'USER', entityRef: user.email, details: `User authenticated securely. Role: ${user.role}, Org: ${user.organization}. Signed JWT issued.`, sha256PayloadHash: generateSha256(user.email + Date.now()), performedBy: user.email }); } catch {}
    res.json({ success: true, token, refreshToken, user: tokenPayload });
  } catch (e:any) { res.status(500).json({ success:false, error:e.message }); }
});

router.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
    if (!refreshToken) return res.status(401).json({ success:false, error:'Refresh token required'});
    let decoded:any;
    try { decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET); } catch { return res.clearCookie('token').clearCookie('refreshToken').status(401).json({ success:false, error:'Invalid or expired refresh token'}); }
    if (decoded.type !== 'refresh' || !decoded.userId) return res.status(401).json({ success:false, error:'Invalid refresh token'});
    const user:any = await prisma.user.findUnique({ where:{ id: decoded.userId }});
    if (!user) return res.clearCookie('token').clearCookie('refreshToken').status(401).json({ success:false, error:'User record not found'});
    const tokenPayload = { userId: user.id, id:user.id, email:user.email, name:user.name, role:user.role, organization:user.organization, tenantId:user.tenantId };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn:'8h'});
    const nextRefreshToken = jwt.sign({ userId:user.id, type:'refresh'}, JWT_REFRESH_SECRET, { expiresIn:'7d'});
    res.cookie('token', token, { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'lax', maxAge:ACCESS_TOKEN_MAX_AGE_MS });
    res.cookie('refreshToken', nextRefreshToken, { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'lax', maxAge:REFRESH_TOKEN_MAX_AGE_MS });
    res.json({ success:true, token, refreshToken: nextRefreshToken, user: tokenPayload });
  } catch(e:any){ res.status(500).json({ success:false, error:e.message }); }
});

router.post('/api/auth/logout', (req,res)=>{ res.clearCookie('token'); res.clearCookie('refreshToken'); res.json({ success:true, message:'Logged out successfully'}); });

router.get('/api/auth/me', async (req,res)=>{
  try {
    const userPayload = (req as any).user;
    if (!userPayload) return res.status(401).json({ success:false, error:'Not authenticated'});
    const user:any = await prisma.user.findUnique({ where:{ id: userPayload.userId || userPayload.id }});
    if (!user) return res.status(401).json({ success:false, error:'User record not found'});
    res.json({ success:true, user:{ id:user.id, userId:user.id, email:user.email, name:user.name, role:user.role, organization:user.organization, tenantId:user.tenantId }});
  } catch(e:any){ res.status(401).json({ success:false, error:e.message}); }
});

router.get('/api/users', async (req:any,res)=>{
  try {
    const userRole = req.user?.role || 'ADMIN';
    if (req.user && userRole !== 'ADMIN') return res.status(403).json({ success:false, error:'Forbidden: Admin access required'});
    const tenantId = req.tenantId || (req.query.tenantId as string) || 'tenant_qbo_smb';
    const users = await prisma.user.findMany({ where:{ tenantId }, select:{ id:true, email:true, name:true, role:true, organization:true, tenantId:true, createdAt:true }});
    res.json(users);
  } catch(e:any){ res.status(500).json({ success:false, error:e.message});}
});

router.post('/api/users', async (req:any,res)=>{
  try {
    const userRole = req.user?.role || 'ADMIN';
    if (req.user && userRole !== 'ADMIN') return res.status(403).json({ success:false, error:'Forbidden: Admin access required'});
    const { email, password, name, role, organization, tenantId } = req.body;
    if (!email || !password || !name) return res.status(400).json({ success:false, error:'Email, password, and name are required'});
    const validRoles = ['ADMIN','INTEGRATION_MANAGER','OPERATOR','AUDITOR'];
    const assignedRole = role || 'OPERATOR';
    if (!validRoles.includes(assignedRole)) return res.status(400).json({ success:false, error:`Invalid role. Must be one of: ${validRoles.join(', ')}`});
    const assignedTenantId = tenantId || req.tenantId || 'tenant_qbo_smb';
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await prisma.user.findUnique({ where:{ email: normalizedEmail }});
    if (existingUser) return res.status(400).json({ success:false, error:'Email is already in use by another user'});
    const passwordHash = bcrypt.hashSync(password,10);
    const userId = `usr_${Math.random().toString(36).substring(2,9)}`;
    const newUser = await prisma.user.create({ data:{ id:userId, email:normalizedEmail, passwordHash, name, role:assignedRole, organization: organization || 'CittaEFS Enterprise', tenantId: assignedTenantId }});
    try { await safeAuditLogCreate(prisma, { tenantId: assignedTenantId, action:'USER_CREATED', entityType:'USER', entityRef:newUser.email, details:`Admin created new user account: ${newUser.name} (${newUser.email}), Role: ${newUser.role}`, sha256PayloadHash: generateSha256(JSON.stringify(newUser)), performedBy: req.user?.email || 'Admin'}); } catch {}
    const { passwordHash: _, ...userWithoutHash } = newUser;
    res.status(201).json({ success:true, user: userWithoutHash });
  } catch(e:any){ res.status(500).json({ success:false, error:e.message });}
});

export default router;
