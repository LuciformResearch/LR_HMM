import 'dotenv/config';
import dotenv from 'dotenv';
try { dotenv.config({ path: '.env.local' }); } catch {}
import { promises as fs } from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { Client } from 'pg';
import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAuth } from 'google-auth-library';

type Artefact = {
  slug: string;
  summaries: Array<{
    level: number;
    index?: number;
    covers?: number[];
    summary: string;
    summaryChars: number;
    tags?: string[];
    entities?: any;
    signals?: any;
    extras?: any;
  }>;
};

function getArg(args: string[], name: string, def?: string) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
}

async function ensureSchema(client: Client) {
  const ensurePath = path.resolve(process.cwd(), 'sql/generated/ensure.sql');
  const sql = await fs.readFile(ensurePath, 'utf8').catch(() => '');
  if (!sql) throw new Error('sql/generated/ensure.sql not found. Run: npx tsx scripts/schema_codegen.ts');
  await client.query(sql);
}

async function upsertFromArtefact(client: Client, artefactPath: string) {
  const raw = await fs.readFile(artefactPath, 'utf8');
  const data = JSON.parse(raw) as Artefact;
  if (!data.slug) throw new Error('artefact.slug missing');
  const slug = data.slug;
  const title = slug.replace(/_/g, ' ');
  await client.query('BEGIN');
  try {
    // Ensure optional idx column on messages for recency alignment
    await client.query(`DO $$ BEGIN BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS idx INT; EXCEPTION WHEN others THEN NULL; END; END $$;`);
    // conversation
    const convRes = await client.query(
      `INSERT INTO conversations (slug, title) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`, [slug, title]
    );
    const conversationId = convRes.rows[0].id as number;

    for (const s of data.summaries || []) {
      const level = Math.max(1, Math.floor(s.level || 1));
      const indexVal = (typeof s.index === 'number' && isFinite(s.index)) ? Math.floor(s.index) : null;
      const covers = JSON.stringify(s.covers || []);
      const topics = (s.tags && s.tags.length) ? s.tags : null;
      const meta = { entities: s.entities ?? null, signals: s.signals ?? null, extras: s.extras ?? null, artefactVersion: 'v2' };
      const content = s.summary || '';
      const charCount = s.summaryChars || content.length;
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');

      if (indexVal != null) {
        // Try UPDATE by (conversation_id, level, index)
        const r = await client.query(
          `SELECT id FROM summaries WHERE conversation_id=$1 AND level=$2 AND idx=$3 LIMIT 1`,
          [conversationId, level, indexVal]
        );
        if (r.rowCount && r.rows[0]?.id) {
          const id = r.rows[0].id as number;
          await client.query(
            `UPDATE summaries SET covers=$1::jsonb, content=$2, content_hash=$3, char_count=$4, topics=$5, meta=$6::jsonb WHERE id=$7`,
            [covers, content, contentHash, charCount, topics, JSON.stringify(meta), id]
          );
          // Align time range and created_at depending on level
          if (level === 1) {
            await client.query(
              `UPDATE summaries s SET 
                 range_start_ts = COALESCE((
                   SELECT MIN(m.ts::timestamptz)
                   FROM messages m
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE m.conversation_id = s.conversation_id AND m.idx = (j.val)::int
                 ), s.range_start_ts),
                 range_end_ts = COALESCE((
                   SELECT MAX(m.ts::timestamptz)
                   FROM messages m
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE m.conversation_id = s.conversation_id AND m.idx = (j.val)::int
                 ), s.range_end_ts),
                 created_at = COALESCE((
                   SELECT MAX(m.ts::timestamptz)
                   FROM messages m
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE m.conversation_id = s.conversation_id AND m.idx = (j.val)::int
                 ), s.created_at)
               WHERE s.id = $1`, [id]
            );
          } else {
            await client.query(
              `UPDATE summaries s SET 
                 range_start_ts = COALESCE((
                   SELECT MIN(s1.range_start_ts)
                   FROM summaries s1
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE s1.conversation_id = s.conversation_id AND s1.level = 1 AND s1.idx = (j.val)::int
                 ), s.range_start_ts),
                 range_end_ts = COALESCE((
                   SELECT MAX(s1.range_end_ts)
                   FROM summaries s1
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE s1.conversation_id = s.conversation_id AND s1.level = 1 AND s1.idx = (j.val)::int
                 ), s.range_end_ts),
                 created_at = COALESCE((
                   SELECT MAX(s1.created_at)
                   FROM summaries s1
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE s1.conversation_id = s.conversation_id AND s1.level = 1 AND s1.idx = (j.val)::int
                 ), s.created_at)
               WHERE s.id = $1`, [id]
            );
          }
        } else {
          const ins = await client.query(
            `INSERT INTO summaries (conversation_id, level, idx, covers, content, content_hash, char_count, topics, meta)
             VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb) RETURNING id`,
            [conversationId, level, indexVal, covers, content, contentHash, charCount, topics, JSON.stringify(meta)]
          );
          const id = ins.rows[0].id as number;
          if (level === 1) {
            await client.query(
              `UPDATE summaries s SET 
                 range_start_ts = COALESCE((
                   SELECT MIN(m.ts::timestamptz)
                   FROM messages m
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE m.conversation_id = s.conversation_id AND m.idx = (j.val)::int
                 ), s.range_start_ts),
                 range_end_ts = COALESCE((
                   SELECT MAX(m.ts::timestamptz)
                   FROM messages m
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE m.conversation_id = s.conversation_id AND m.idx = (j.val)::int
                 ), s.range_end_ts),
                 created_at = COALESCE((
                   SELECT MAX(m.ts::timestamptz)
                   FROM messages m
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE m.conversation_id = s.conversation_id AND m.idx = (j.val)::int
                 ), s.created_at)
               WHERE s.id = $1`, [id]
            );
          } else {
            await client.query(
              `UPDATE summaries s SET 
                 range_start_ts = COALESCE((
                   SELECT MIN(s1.range_start_ts)
                   FROM summaries s1
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE s1.conversation_id = s.conversation_id AND s1.level = 1 AND s1.idx = (j.val)::int
                 ), s.range_start_ts),
                 range_end_ts = COALESCE((
                   SELECT MAX(s1.range_end_ts)
                   FROM summaries s1
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE s1.conversation_id = s.conversation_id AND s1.level = 1 AND s1.idx = (j.val)::int
                 ), s.range_end_ts),
                 created_at = COALESCE((
                   SELECT MAX(s1.created_at)
                   FROM summaries s1
                   JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                   WHERE s1.conversation_id = s.conversation_id AND s1.level = 1 AND s1.idx = (j.val)::int
                 ), s.created_at)
               WHERE s.id = $1`, [id]
            );
          }
        }
      } else {
        // Upsert by (conversation_id, level, content_hash)
        const up = await client.query(
          `INSERT INTO summaries (conversation_id, level, covers, content, content_hash, char_count, topics, meta)
           VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb)
           ON CONFLICT (conversation_id, level, content_hash)
           DO UPDATE SET covers=EXCLUDED.covers, content=EXCLUDED.content, char_count=EXCLUDED.char_count, topics=EXCLUDED.topics, meta=EXCLUDED.meta
           RETURNING id`,
          [conversationId, level, covers, content, contentHash, charCount, topics, JSON.stringify(meta)]
        );
        const id = up.rows[0].id as number;
        if (level === 1) {
          await client.query(
            `UPDATE summaries s SET 
               range_start_ts = COALESCE((
                 SELECT MIN(m.ts::timestamptz)
                 FROM messages m
                 JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                 WHERE m.conversation_id = s.conversation_id AND m.idx = (j.val)::int
               ), s.range_start_ts),
               range_end_ts = COALESCE((
                 SELECT MAX(m.ts::timestamptz)
                 FROM messages m
                 JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                 WHERE m.conversation_id = s.conversation_id AND m.idx = (j.val)::int
               ), s.range_end_ts),
               created_at = COALESCE((
                 SELECT MAX(m.ts::timestamptz)
                 FROM messages m
                 JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                 WHERE m.conversation_id = s.conversation_id AND m.idx = (j.val)::int
               ), s.created_at)
             WHERE s.id = $1`, [id]
          );
        } else {
          await client.query(
            `UPDATE summaries s SET 
               range_start_ts = COALESCE((
                 SELECT MIN(s1.range_start_ts)
                 FROM summaries s1
                 JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                 WHERE s1.conversation_id = s.conversation_id AND s1.level = 1 AND s1.idx = (j.val)::int
               ), s.range_start_ts),
               range_end_ts = COALESCE((
                 SELECT MAX(s1.range_end_ts)
                 FROM summaries s1
                 JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                 WHERE s1.conversation_id = s.conversation_id AND s1.level = 1 AND s1.idx = (j.val)::int
               ), s.range_end_ts),
               created_at = COALESCE((
                 SELECT MAX(s1.created_at)
                 FROM summaries s1
                 JOIN LATERAL jsonb_array_elements_text(COALESCE(s.covers, '[]')) AS j(val) ON true
                 WHERE s1.conversation_id = s.conversation_id AND s1.level = 1 AND s1.idx = (j.val)::int
               ), s.created_at)
             WHERE s.id = $1`, [id]
          );
        }
      }
    }

    await client.query('COMMIT');
    console.log(`Upserted ${data.summaries?.length || 0} summaries from ${path.basename(artefactPath)} (slug=${slug})`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const get = (n: string, d?: string) => getArg(args, n, d);

  const dbHost = get('--db-host', process.env.PGHOST || 'localhost')!;
  const dbPort = Number(get('--db-port', process.env.PGPORT || '6432'));
  const dbUser = get('--db-user', process.env.PGUSER || 'shadeos')!;
  const dbPass = get('--db-pass', process.env.PGPASSWORD || 'shadeos')!;
  const dbName = get('--db-name', process.env.PGDATABASE || 'shadeos_local')!;
  const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPass, database: dbName });
  await client.connect();
  try {
    if (cmd === 'ensure') {
      await ensureSchema(client);
      console.log('DB ensure completed');
      return;
    }
    if (cmd === 'upsert') {
      const inArg = get('--in');
      if (!inArg) throw new Error('--in path/to/artefact.json required');
      const inPaths = inArg.includes('*') ? (await (await import('glob')).glob(inArg)) : [inArg];
      for (const p of inPaths) {
        const abs = path.resolve(process.cwd(), p);
        await upsertFromArtefact(client, abs);
      }
      return;
    }
    if (cmd === 'embed') {
      const slug = get('--slug');
      const whereLevel = get('--where-level');
      const limit = Number(get('--limit', '0'));
      const useVertex = (get('--vertexai', 'false') || 'false').toLowerCase() === 'true';
      const embedModel = get('--embed-model', process.env.EMBEDDING_MODEL || 'text-embedding-004')!;
      const vertexModel = get('--vertex-embed-model', process.env.VERTEX_EMBED_MODEL || embedModel)!;

      // Resolve conversation scope
      let conversationId: number | null = null;
      if (slug) {
        const r = await client.query('SELECT id FROM conversations WHERE slug = $1', [slug]);
        if (r.rowCount === 0) throw new Error(`Conversation not found for slug: ${slug}`);
        conversationId = r.rows[0].id as number;
      }

      const conds: string[] = [];
      const params: any[] = [];
      if (conversationId != null) { params.push(conversationId); conds.push(`s.conversation_id = $${params.length}`); }
      if (whereLevel) { params.push(Number(whereLevel)); conds.push(`s.level = $${params.length}`); }
      const where = conds.length ? ('WHERE ' + conds.join(' AND ')) : '';
      const lim = limit > 0 ? `LIMIT ${Math.floor(limit)}` : '';

      // Select summaries without embeddings
      const sql = `
        SELECT s.id, s.conversation_id, s.level, s.content
        FROM summaries s
        LEFT JOIN embeddings e ON e.ref_type = 'summary' AND e.ref_id = s.id
        ${where} ${where ? 'AND' : 'WHERE'} e.id IS NULL
        ORDER BY s.id ASC
        ${lim}
      `;
      const res = await client.query(sql, params);
      const rows = res.rows as Array<{ id:number; conversation_id:number; level:number; content:string }>;
      if (rows.length === 0) { console.log('No summaries without embeddings found.'); return; }

      // Prepare provider
      let token: string | null = null;
      let studio: GoogleGenerativeAI | null = null;
      if (useVertex) {
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/generative-language.retriever'] });
        const c = await auth.getClient();
        const t = await c.getAccessToken();
        if (!t || !t.token) throw new Error('Failed to obtain Vertex token');
        token = t.token;
      } else {
        const key = process.env.GEMINI_API_KEY;
        if (!key) throw new Error('GEMINI_API_KEY required (or use --vertexai)');
        studio = new GoogleGenerativeAI(key);
      }

      let inserted = 0;
      for (const r of rows) {
        const text = (r.content || '').slice(0, 8192);
        let values: number[] | undefined;
        if (useVertex) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(vertexModel)}:embedContent`;
          const resp = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`!, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text }] } }) });
          const json: any = await resp.json();
          if (!resp.ok) throw new Error(`Vertex embedContent failed: ${resp.status} ${JSON.stringify(json).slice(0,200)}`);
          values = json?.embedding?.values || json?.data?.embedding || json?.data?.[0]?.embedding;
        } else {
          const model = studio!.getGenerativeModel({ model: embedModel });
          const out: any = await model.embedContent({ content: { parts: [{ text }] } });
          values = out?.embedding?.values || out?.data?.embedding || out?.data?.[0]?.embedding;
        }
        if (!values || !Array.isArray(values)) throw new Error('Invalid embedding response');

        const dim = values.length;
        const vec = '[' + values.map(v => (Number.isFinite(v) ? v : 0).toFixed(6)).join(',') + ']';
        await client.query(
          `INSERT INTO embeddings (conversation_id, ref_type, ref_id, provider, model, dim, vector)
           VALUES ($1,'summary',$2,$3,$4,$5,$6::vector)`,
          [r.conversation_id, r.id, useVertex ? 'vertex' : 'studio', useVertex ? vertexModel : embedModel, dim, vec]
        );
        inserted++;
      }
      console.log(`Inserted ${inserted} embeddings.`);
      return;
    }
    console.log('Usage: npx tsx scripts/db_sync.ts <ensure|upsert|embed> [--in path|glob]');
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
