import { Client } from 'pg';

export type AppendMessageParams = {
  slug: string;
  role: 'user' | 'assistant';
  text: string;
  ts?: string;
  meta?: Record<string, any>;
};

export async function appendMessage(params: AppendMessageParams): Promise<{ conversationId: number; messageId: number }>{
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 6432),
    user: process.env.PGUSER || 'shadeos',
    password: process.env.PGPASSWORD || 'shadeos',
    database: process.env.PGDATABASE || 'shadeos_local',
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Ensure conversation exists
    const title = params.slug.replace(/_/g, ' ');
    const conv = await client.query(
      `INSERT INTO conversations (slug, title) VALUES ($1,$2)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`, [params.slug, title]
    );
    const conversationId = conv.rows[0].id as number;

    // Ensure optional idx column exists on messages
    await client.query(`DO $$ BEGIN BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS idx INT; EXCEPTION WHEN others THEN NULL; END; END $$;`);

    // Compute next idx if column exists
    let nextIdx: number | null = null;
    try {
      const r = await client.query('SELECT MAX(idx) AS max FROM messages WHERE conversation_id = $1', [conversationId]);
      const max = r.rows[0]?.max as number | null;
      nextIdx = (max == null || isNaN(Number(max))) ? 0 : (Number(max) + 1);
    } catch {}

    const ts = params.ts || new Date().toISOString();
    const ins = await client.query(
      nextIdx != null
        ? `INSERT INTO messages (conversation_id, role, ts, content, idx) VALUES ($1,$2,$3,$4,$5) RETURNING id`
        : `INSERT INTO messages (conversation_id, role, ts, content) VALUES ($1,$2,$3,$4) RETURNING id`,
      nextIdx != null ? [conversationId, params.role, ts, params.text, nextIdx] : [conversationId, params.role, ts, params.text]
    );
    const messageId = ins.rows[0].id as number;
    await client.query('COMMIT');
    return { conversationId, messageId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

