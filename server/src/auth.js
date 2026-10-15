import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const cookieOptions = () => ({ httpOnly:true, sameSite:'lax', secure:process.env.COOKIE_SECURE === 'true', path:'/', maxAge:1000*60*60*24*7 });
export function issueSession(response, user) {
  const token = jwt.sign({ sub:user.id, workspaceId:user.workspace_id, role:user.role }, process.env.JWT_SECRET, { expiresIn:'7d' });
  response.cookie('teamdesk_session', token, cookieOptions());
}
export function clearSession(response) { response.clearCookie('teamdesk_session', { ...cookieOptions(), maxAge:undefined }); }
export async function requireAuth(request, response, next) {
  try {
    const token = request.cookies.teamdesk_session;
    if (!token) return response.status(401).json({ error:'Please sign in to continue.' });
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT id,workspace_id,name,email,role FROM users WHERE id=$1 AND workspace_id=$2', [claims.sub,claims.workspaceId]);
    if (!result.rowCount) return response.status(401).json({ error:'Session account no longer exists.' });
    request.user = result.rows[0];
    next();
  } catch { response.status(401).json({ error:'Your session expired. Please sign in again.' }); }
}
export function requireStaff(request, response, next) {
  if (!['admin','agent'].includes(request.user?.role)) return response.status(403).json({ error:'Agent or admin access required.' });
  next();
}
