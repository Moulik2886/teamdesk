import { spawn } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const db = await PGlite.create('./server/data');
const database = new PGLiteSocketServer({ db, port: 5432, host: '127.0.0.1' });
await database.start();
console.log('Persistent local PostgreSQL database ready at 127.0.0.1:5432');

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Start the development stack with npm run dev.');
const app = spawn(process.execPath, [npmCli, 'run', 'dev:stack'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres', DB_POOL_SIZE: '1' },
});

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (app.exitCode === null) app.kill('SIGTERM');
  await database.stop();
  await db.close();
  process.exit(code);
}

app.on('error', (error) => {
  console.error('Could not start the app:', error);
  void shutdown(1);
});
app.on('exit', (code) => void shutdown(code ?? 0));
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
