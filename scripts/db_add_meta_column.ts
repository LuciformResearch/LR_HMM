import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; };
  const dbHost = getArg('--db-host', process.env.PGHOST || 'localhost');
  const dbPort = Number(getArg('--db-port', process.env.PGPORT || '6432'));
  const dbUser = getArg('--db-user', process.env.PGUSER || 'shadeos');
  const dbPass = getArg('--db-pass', process.env.PGPASSWORD || 'shadeos');
  const dbName = getArg('--db-name', process.env.PGDATABASE || 'shadeos_local');

  const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPass, database: dbName });
  await client.connect();
  try {
    await client.query("ALTER TABLE summaries ADD COLUMN IF NOT EXISTS meta JSONB;");
    console.log('Added column summaries.meta JSONB (if not exists)');
  } finally { await client.end(); }
}

main().catch(err => { console.error(err); process.exit(1); });

