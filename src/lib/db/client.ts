import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const connectionString = process.env.DATABASE_URL || `postgres://shadeos:shadeos@localhost:6432/shadeos_local`;

export const pool = new Pool({ connectionString });
export const db = drizzle(pool);

export async function closeDb() {
  await pool.end();
}

