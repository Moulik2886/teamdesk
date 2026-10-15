import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, initializeDatabase } from './db.js';
import { clearSession, issueSession, requireAuth, requireStaff } from './auth.js';
import { addConnection, keepAlive, publish } from './events.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const statusValues = ['Open','In Progress','Waiting','Resolved','Closed'];
const priorityValues = ['Low','Medium','High','Urgent'];
const loginSchema = z.object({ email:z.string().email().max(180), password:z.string().min(8).max(128) });
const registerSchema = z.object({
  name:z.string().trim().min(2).max(80), workspaceName:z.string().trim().min(2).max(100),
  email:z.string().email().max(180), password:z.string().min(12).max(128)
});
const ticketSchema = z.object({
  subject:z.string().trim().min(4).max(160), description:z.string().trim().max(6000).default(''),
  category:z.enum(['Access','Hardware','Software','Network','People','General']).default('General'),
  priority:z.enum(priorityValues).default('Medium'), dueAt:z.string().datetime().nullable().optional()
});
const updateSchema = z.object({
  status:z.enum(statusValues).optional(), priority:z.enum(priorityValues).optional(),
  assigneeId:z.string().uuid().nullable().optional(), category:z.enum(['Access','Hardware','Software','Network','People','General']).optional(),
  dueAt:z.string().datetime().nullable().optional()
}).refine(value=>Object.keys(value).length>0,'Provide at least one field to update.');
const commentSchema = z.object({ body:z.string().trim().min(1).max(4000) });

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy:false }));
app.use(express.json({ limit:'1mb' }));
app.use(cookieParser());

function publicUser(user) { return { id:user.id, name:user.name, email:user.email, role:user.role, workspaceId:user.workspace_id, workspaceName:user.workspace_name }; }
function validationError(response, error) {
  return response.status(400).json({ error:'Please check the submitted fields.', details:error.issues?.map(issue=>({ field:issue.path.join('.'), message:issue.message })) });
}
function canViewTicket(user, ticket) { return ['admin','agent'].includes(user.role) || ticket.requester_id === user.id; }
async function logActivity(client, ticketId, actorId, action, details) {
  await client.query('INSERT INTO ticket_activity(ticket_id,actor_id,action,details) VALUES($1,$2,$3,$4)', [ticketId,actorId,action,details]);
}
const ticketSelect = `SELECT t.id,t.subject,t.description,t.category,t.priority,t.status,t.due_at,t.created_at,t.updated_at,
  t.requester_id, requester.name AS requester_name, requester.email AS requester_email,
  t.assignee_id, assignee.name AS assignee_name
  FROM tickets t JOIN users requester ON requester.id=t.requester_id
  LEFT JOIN users assignee ON assignee.id=t.assignee_id`;

app.get('/api/health', async (_request,response) => {
  try { await pool.query('SELECT 1'); response.json({ status:'ok', service:'teamdesk-api' }); }
  catch { response.status(503).json({ status:'unavailable' }); }
});
app.post('/api/auth/login', async (request,response) => {
  const parsed=loginSchema.safeParse(request.body); if(!parsed.success) return validationError(response,parsed.error);
  const result=await pool.query('SELECT u.*,w.name AS workspace_name FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE lower(u.email)=lower($1)',[parsed.data.email]);
  const user=result.rows[0];
  if(!user || !(await bcrypt.compare(parsed.data.password,user.password_hash))) return response.status(401).json({error:'Email or password is incorrect.'});
  issueSession(response,user); response.json({user:publicUser(user)});
});
app.post('/api/auth/register', async (request,response) => {
  const parsed=registerSchema.safeParse(request.body);if(!parsed.success)return validationError(response,parsed.error);
  const {name,workspaceName,password}=parsed.data,email=parsed.data.email.toLowerCase();
  if((await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)',[email])).rowCount)return response.status(409).json({error:'An account with this email already exists.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const workspace=(await client.query('INSERT INTO workspaces(name) VALUES($1) RETURNING id,name',[workspaceName])).rows[0];
    const passwordHash=await bcrypt.hash(password,12);
    const user=(await client.query(`INSERT INTO users(workspace_id,name,email,password_hash,role)
      VALUES($1,$2,$3,$4,'admin') RETURNING id,workspace_id,name,email,role`,[workspace.id,name,email,passwordHash])).rows[0];
    await client.query('COMMIT');user.workspace_name=workspace.name;issueSession(response,user);
    response.status(201).json({user:publicUser(user)});
  }catch(error){await client.query('ROLLBACK');if(error.code==='23505')return response.status(409).json({error:'An account with this email already exists.'});throw error;}
  finally{client.release();}
});
app.post('/api/auth/logout',(request,response)=>{clearSession(response);response.status(204).end();});
app.get('/api/auth/me',requireAuth,async(request,response)=>{
  const result=await pool.query('SELECT u.id,u.workspace_id,u.name,u.email,u.role,w.name AS workspace_name FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=$1',[request.user.id]);
  response.json({user:publicUser(result.rows[0])});
});

app.get('/api/events',requireAuth,(request,response)=>{
  response.writeHead(200,{ 'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no' });
  response.write('retry: 2500\n\n');
  const remove=addConnection(response,request.user.workspace_id);
  response.on('close',remove);
});
app.get('/api/members',requireAuth,async(request,response)=>{
  const result=await pool.query('SELECT id,name,email,role FROM users WHERE workspace_id=$1 ORDER BY name',[request.user.workspace_id]);
  response.json(result.rows);
});
app.get('/api/dashboard',requireAuth,async(request,response)=>{
  const conditions=[request.user.workspace_id];
  const own=request.user.role==='requester'?' AND requester_id=$2':'';
  if(own)conditions.push(request.user.id);
  const result=await pool.query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE status='Open')::int AS open,
    count(*) FILTER(WHERE status='In Progress')::int AS in_progress,
    count(*) FILTER(WHERE status='Waiting')::int AS waiting,
    count(*) FILTER(WHERE status='Resolved')::int AS resolved,
    count(*) FILTER(WHERE priority='Urgent' AND status NOT IN ('Resolved','Closed'))::int AS urgent,
    count(*) FILTER(WHERE due_at < now() AND status NOT IN ('Resolved','Closed'))::int AS overdue
    FROM tickets WHERE workspace_id=$1${own}`,conditions);
  response.json(result.rows[0]);
});
app.get('/api/tickets',requireAuth,async(request,response)=>{
  const filters=['t.workspace_id=$1'],values=[request.user.workspace_id];
  if(request.user.role==='requester'){values.push(request.user.id);filters.push(`t.requester_id=$${values.length}`);}
  if(request.query.status && statusValues.includes(request.query.status)){values.push(request.query.status);filters.push(`t.status=$${values.length}`);}
  if(request.query.priority && priorityValues.includes(request.query.priority)){values.push(request.query.priority);filters.push(`t.priority=$${values.length}`);}
  if(request.query.q){values.push(`%${String(request.query.q).slice(0,100)}%`);filters.push(`(t.subject ILIKE $${values.length} OR t.description ILIKE $${values.length} OR requester.name ILIKE $${values.length})`);}
  const limit=Math.min(Math.max(Number(request.query.limit)||30,1),100),offset=Math.max(Number(request.query.offset)||0,0);
  values.push(limit,offset);
  const rows=await pool.query(`${ticketSelect} WHERE ${filters.join(' AND ')} ORDER BY CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,t.updated_at DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values);
  response.json({tickets:rows.rows,limit,offset});
});
app.post('/api/tickets',requireAuth,async(request,response)=>{
  const parsed=ticketSchema.safeParse(request.body);if(!parsed.success)return validationError(response,parsed.error);
  const data=parsed.data;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await client.query(`INSERT INTO tickets(workspace_id,requester_id,subject,description,category,priority,due_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[request.user.workspace_id,request.user.id,data.subject,data.description,data.category,data.priority,data.dueAt||null]);
    const ticketId=result.rows[0].id;
    await logActivity(client,ticketId,request.user.id,'created',`Ticket created · ${data.category}`);
    await client.query('COMMIT');
    const ticket=(await client.query(`${ticketSelect} WHERE t.id=$1`,[ticketId])).rows[0];
    publish(request.user.workspace_id,'tickets.changed',{ticketId,action:'created'});
    response.status(201).json(ticket);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});
app.get('/api/tickets/:id',requireAuth,async(request,response)=>{
  const ticketResult=await pool.query(`${ticketSelect} WHERE t.id=$1 AND t.workspace_id=$2`,[request.params.id,request.user.workspace_id]);
  const ticket=ticketResult.rows[0];if(!ticket)return response.status(404).json({error:'Ticket not found.'});
  if(!canViewTicket(request.user,ticket))return response.status(403).json({error:'You cannot access this ticket.'});
  const comments=await pool.query(`SELECT c.id,c.body,c.created_at,u.id AS author_id,u.name AS author_name,u.role AS author_role FROM ticket_comments c JOIN users u ON u.id=c.author_id WHERE c.ticket_id=$1 ORDER BY c.created_at`,[ticket.id]);
  const activity=await pool.query(`SELECT a.id,a.action,a.details,a.created_at,u.name AS actor_name FROM ticket_activity a JOIN users u ON u.id=a.actor_id WHERE a.ticket_id=$1 ORDER BY a.created_at DESC LIMIT 30`,[ticket.id]);
  response.json({...ticket,comments:comments.rows,activity:activity.rows});
});
app.patch('/api/tickets/:id',requireAuth,requireStaff,async(request,response)=>{
  const parsed=updateSchema.safeParse(request.body);if(!parsed.success)return validationError(response,parsed.error);
  const beforeResult=await pool.query('SELECT id,workspace_id,status,priority,assignee_id FROM tickets WHERE id=$1 AND workspace_id=$2',[request.params.id,request.user.workspace_id]);
  const before=beforeResult.rows[0];if(!before)return response.status(404).json({error:'Ticket not found.'});
  const data=parsed.data;
  if(data.assigneeId){const member=await pool.query("SELECT id FROM users WHERE id=$1 AND workspace_id=$2 AND role IN ('admin','agent')",[data.assigneeId,request.user.workspace_id]);if(!member.rowCount)return response.status(400).json({error:'Assignee must be an agent in this workspace.'});}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await client.query(`UPDATE tickets SET status=COALESCE($3,status),priority=COALESCE($4,priority),
      assignee_id=CASE WHEN $5 THEN $6::uuid ELSE assignee_id END,category=COALESCE($7,category),
      due_at=CASE WHEN $8 THEN $9::timestamptz ELSE due_at END,updated_at=now()
      WHERE id=$1 AND workspace_id=$2 RETURNING id`,[request.params.id,request.user.workspace_id,data.status||null,data.priority||null,
        Object.hasOwn(data,'assigneeId'),data.assigneeId||null,data.category||null,Object.hasOwn(data,'dueAt'),data.dueAt||null]);
    for(const key of ['status','priority','assigneeId','category','dueAt'])if(Object.hasOwn(data,key)&&String(data[key])!==String(before[key==='assigneeId'?'assignee_id':key==='dueAt'?'due_at':key]))
      await logActivity(client,before.id,request.user.id,'updated',`${key} changed`);
    await client.query('COMMIT');
    const ticket=(await client.query(`${ticketSelect} WHERE t.id=$1`,[result.rows[0].id])).rows[0];
    publish(request.user.workspace_id,'tickets.changed',{ticketId:ticket.id,action:'updated'});response.json(ticket);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});
app.post('/api/tickets/:id/comments',requireAuth,async(request,response)=>{
  const parsed=commentSchema.safeParse(request.body);if(!parsed.success)return validationError(response,parsed.error);
  const ticket=(await pool.query('SELECT id,requester_id FROM tickets WHERE id=$1 AND workspace_id=$2',[request.params.id,request.user.workspace_id])).rows[0];
  if(!ticket)return response.status(404).json({error:'Ticket not found.'});
  if(request.user.role==='requester'&&ticket.requester_id!==request.user.id)return response.status(403).json({error:'You cannot comment on this ticket.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const comment=(await client.query('INSERT INTO ticket_comments(ticket_id,author_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[ticket.id,request.user.id,parsed.data.body])).rows[0];
    await client.query('UPDATE tickets SET updated_at=now() WHERE id=$1',[ticket.id]);
    await logActivity(client,ticket.id,request.user.id,'commented','Added a comment');
    await client.query('COMMIT');
    const result={...comment,author_id:request.user.id,author_name:request.user.name,author_role:request.user.role};
    publish(request.user.workspace_id,'tickets.changed',{ticketId:ticket.id,action:'commented'});response.status(201).json(result);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});

app.use((error,_request,response,_next)=>{
  console.error(error);
  if(response.headersSent)return;
  response.status(500).json({error:'Something went wrong. Please try again.'});
});

async function start(){
  if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)throw new Error('Set JWT_SECRET to a random secret with at least 32 characters in .env');
  await initializeDatabase();
  app.listen(PORT,'127.0.0.1',()=>console.log(`TeamDesk API listening on http://127.0.0.1:${PORT}`));
  setInterval(keepAlive,20000).unref();
}
start().catch(error=>{console.error(error);process.exitCode=1;});
