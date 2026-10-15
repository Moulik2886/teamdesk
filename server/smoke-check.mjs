import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:4000/api';
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/postgres' });
const checks = [];
const createdTicketIds = [];
const createdWorkspaceIds = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  checks.push({ name, actual, expected, ok });
  if (!ok) throw new Error(`${name}: expected ${expected}, got ${actual}`);
}
async function api(path, { method = 'GET', cookie, body, signal } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, signal,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let data = null;
  if (response.status !== 204) data = await response.json();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

try {
  let r = await api('/health'); check('API health', r.data.status, 'ok');
  r = await api('/auth/login', { method:'POST', body:{ email:'admin@teamdesk.local', password:'Teamdesk!2026' } });
  check('Admin login', r.response.status, 200); const admin = r.cookie;
  r = await api('/auth/me', { cookie:admin }); check('Session identity', r.data.user.role, 'admin');
  r = await api('/dashboard', { cookie:admin }); check('Dashboard total', Number.isFinite(Number(r.data.total)), true);
  r = await api('/members', { cookie:admin }); check('Workspace members', r.data.length >= 3, true); const agentId=r.data.find(member=>member.role==='agent')?.id;
  const parallel = await Promise.all(['/tickets','/dashboard','/members'].map(path => api(path,{cookie:admin})));
  if(!parallel.every(item=>item.response.status===200))console.error('Concurrent responses:',parallel.map(item=>({status:item.response.status,data:item.data})));
  check('Concurrent dashboard requests', parallel.every(item=>item.response.status===200), true);
  r = await api('/tickets?limit=5&q=starter', { cookie:admin }); check('Ticket search', r.data.tickets.some(t => t.subject.includes('starter')), true);
  r = await api('/tickets', { method:'POST', cookie:admin, body:{ subject:`Automated QA ${randomUUID().slice(0,8)}`, description:'CRUD workflow validation', category:'Software', priority:'High' } });
  if (r.response.status !== 201) console.error('Create ticket response:', r.data);
  check('Create ticket', r.response.status, 201); const ticketId = r.data.id; createdTicketIds.push(ticketId);
  r = await api(`/tickets/${ticketId}`, { cookie:admin }); if(r.response.status!==200)console.error('Ticket detail response:',r.data); check('Ticket detail status', r.response.status, 200); check('Ticket detail comments', r.data.comments.length, 0);
  r = await api(`/tickets/${ticketId}`, { method:'PATCH', cookie:admin, body:{ status:'In Progress', priority:'Urgent' } });
  check('Update ticket status', r.data.status, 'In Progress'); check('Update ticket priority', r.data.priority, 'Urgent');
  r = await api(`/tickets/${ticketId}`, { method:'PATCH', cookie:admin, body:{ assigneeId:agentId } }); check('Assign ticket', r.data.assignee_id, agentId);

  const controller = new AbortController();
  const eventResponse = await fetch(`${base}/events`, { headers:{ Cookie:admin }, signal:controller.signal });
  check('SSE connection', eventResponse.status, 200);
  const reader = eventResponse.body.getReader();
  let eventPromise = (async () => {
    let text = '';
    while (text.length < 4000) {
      const { value, done } = await reader.read(); if (done) break;
      text += new TextDecoder().decode(value);
      if (text.includes('tickets.changed')) return text;
    }
    return text;
  })();
  r = await api(`/tickets/${ticketId}/comments`, { method:'POST', cookie:admin, body:{ body:'Automated QA comment' } });
  check('Add comment', r.response.status, 201);
  const eventText = await Promise.race([eventPromise, new Promise(resolve => setTimeout(() => resolve('TIMEOUT'), 2500))]);
  check('Realtime ticket event', eventText.includes('tickets.changed'), true);
  controller.abort(); reader.cancel().catch(()=>{});
  r = await api(`/tickets/${ticketId}`, { cookie:admin }); check('Persisted comment', r.data.comments[0].body, 'Automated QA comment');

  r = await api('/auth/login', { method:'POST', body:{ email:'requester@teamdesk.local', password:'Teamdesk!2026' } });
  check('Requester login', r.response.status, 200); const requester = r.cookie;
  r = await api('/tickets', { cookie:requester }); check('Requester ticket visibility', r.data.tickets.every(t => t.requester_id === r.data.tickets[0]?.requester_id), true);
  r = await api(`/tickets/${ticketId}`, { method:'PATCH', cookie:requester, body:{ status:'Closed' } }); check('Requester cannot update ticket', r.response.status, 403);
  r = await api('/tickets', { method:'POST', cookie:admin, body:{ subject:'bad', priority:'Huge' } }); check('Input validation', r.response.status, 400);

  const signupEmail = `qa-${randomUUID()}@example.test`;
  r = await api('/auth/register', { method:'POST', body:{ name:'QA Tester', workspaceName:'QA Workspace', email:signupEmail, password:'QA-Password-2026!' } });
  check('Workspace registration', r.response.status, 201);
  const workspaceId = r.data.user.workspaceId; createdWorkspaceIds.push(workspaceId);
  r = await api('/tickets', { cookie:r.cookie }); check('New workspace starts empty', r.data.tickets.length, 0);
  r = await api('/auth/register', { method:'POST', body:{ name:'QA Tester', workspaceName:'QA Workspace', email:signupEmail, password:'QA-Password-2026!' } });
  check('Duplicate registration rejected', r.response.status, 409);
  r = await api('/auth/logout', { method:'POST', cookie:admin }); check('Logout', r.response.status, 204);
  r = await api('/dashboard', { cookie:null }); check('Unauthenticated request rejected', r.response.status, 401);
} finally {
  for (const id of createdTicketIds) await pool.query('DELETE FROM tickets WHERE id=$1', [id]).catch(()=>{});
  for (const id of createdWorkspaceIds) await pool.query('DELETE FROM workspaces WHERE id=$1', [id]).catch(()=>{});
  await pool.end();
}
console.log(JSON.stringify(checks, null, 2));
