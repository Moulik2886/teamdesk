import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const { Pool } = pg;
const isLocalPGlite = process.env.DATABASE_URL?.includes('127.0.0.1:5432');
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_SIZE || (isLocalPGlite ? 1 : 10)) });
const here = path.dirname(fileURLToPath(import.meta.url));

export async function initializeDatabase() {
  await pool.query(await fs.readFile(path.join(here, '../sql/schema.sql'), 'utf8'));
  const existing = await pool.query('SELECT id FROM workspaces LIMIT 1');
  if (existing.rowCount) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const workspace = (await client.query("INSERT INTO workspaces(name) VALUES ('Northstar Support') RETURNING id")).rows[0];
    const demoUsers = [
      { name:'Maya Chen', email:'admin@teamdesk.local', role:'admin', password:'Teamdesk!2026' },
      { name:'Jordan Lee', email:'agent@teamdesk.local', role:'agent', password:'Teamdesk!2026' },
      { name:'Taylor Morgan', email:'requester@teamdesk.local', role:'requester', password:'Teamdesk!2026' }
    ];
    const ids = {};
    for (const user of demoUsers) {
      const hash = await bcrypt.hash(user.password, 10);
      ids[user.role] = (await client.query(
        'INSERT INTO users(workspace_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [workspace.id,user.name,user.email,hash,user.role]
      )).rows[0].id;
    }
    const seeds = [
      ['New starter cannot access design tools','A new teammate starts Monday and needs access to Figma and the shared design workspace.','Access','High','Open','agent'],
      ['Laptop battery draining quickly','Battery drops from full to empty in about two hours, even with only email open.','Hardware','Medium','In Progress','agent'],
      ['Request access to analytics dashboard','Please add me to the weekly product metrics dashboard.','Access','Low','Waiting','requester'],
      ['VPN disconnects during video calls','The VPN reconnects several times during customer calls from home.','Network','Urgent','Open','agent'],
      ['Install approved font family','Need the Atlas font family installed for the spring campaign files.','Software','Low','Resolved','requester'],
      ['Shared printer is offline','The third-floor printer is not visible to anyone on the team.','Hardware','Medium','Open','agent']
    ];
    for (const [subject,description,category,priority,status,assigneeRole] of seeds) {
      const ticket = (await client.query(
        'INSERT INTO tickets(workspace_id,requester_id,assignee_id,subject,description,category,priority,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [workspace.id,ids.requester,ids[assigneeRole],subject,description,category,priority,status]
      )).rows[0];
      await client.query('INSERT INTO ticket_activity(ticket_id,actor_id,action,details) VALUES($1,$2,$3,$4)',
        [ticket.id,ids.admin,'created',`Ticket created in ${category}`]);
    }
    await client.query('COMMIT');
    console.log('Seeded demo workspace and accounts.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
