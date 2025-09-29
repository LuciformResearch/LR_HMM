import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';

function vecToPgvectorString(vec: number[]): string {
  return '[' + vec.map(v => (Number.isFinite(v) ? v : 0).toFixed(6)).join(',') + ']';
}

async function getVertexToken(): Promise<string> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/generative-language.retriever'] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token || !token.token) throw new Error('Failed to obtain Vertex token');
  return token.token;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; };
  const slug = getArg('--slug');
  if (!slug) throw new Error('--slug required');
  const inPath = getArg('--in');
  const l2Path = inPath || path.resolve(process.cwd(), 'artefacts/HMM/compressed', `${slug}.l2.json`);

  const useVertex = (getArg('--vertexai', 'true') || 'true').toLowerCase() === 'true';
  const embeddingModelName = getArg('--vertex-embed-model', process.env.VERTEX_EMBED_MODEL || process.env.EMBEDDING_MODEL || 'text-embedding-004');
  const geminiKey = process.env.GEMINI_API_KEY;
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;

  const dbHost = getArg('--db-host', process.env.PGHOST || 'localhost');
  const dbPort = Number(getArg('--db-port', process.env.PGPORT || '6432'));
  const dbUser = getArg('--db-user', process.env.PGUSER || 'shadeos');
  const dbPass = getArg('--db-pass', process.env.PGPASSWORD || 'shadeos');
  const dbName = getArg('--db-name', process.env.PGDATABASE || 'shadeos_local');

  const raw = await fs.readFile(l2Path, 'utf8');
  const l2 = JSON.parse(raw) as { slug: string; summaries: Array<{ level:number; covers:number[]; summary:string; summaryChars:number; charCount:number; tags?: string[]; entities?: any; signals?: any; extras?: any }>; };
  if (!l2.summaries?.length) throw new Error('No L2 summaries found');

  const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPass, database: dbName });
  await client.connect();
  try {
    await client.query('BEGIN');
    const convRes = await client.query('SELECT id FROM conversations WHERE slug = $1', [slug]);
    if (convRes.rowCount === 0) throw new Error(`Conversation not found for slug: ${slug}`);
    const conversationId = convRes.rows[0].id as number;

    let token: string | null = null;
    let embedModel: any = null;
    if (useVertex) {
      token = await getVertexToken();
    } else {
      if (!geminiKey) throw new Error('GEMINI_API_KEY required (or use --vertexai)');
      const genAI = new GoogleGenerativeAI(geminiKey);
      embedModel = genAI.getGenerativeModel({ model: embeddingModelName });
    }

    let inserted = 0;
    for (const s of l2.summaries) {
      const topics = s.tags && Array.isArray(s.tags) && s.tags.length > 0 ? s.tags : null;
      const meta = { entities: s.entities ?? null, signals: s.signals ?? null, extras: s.extras ?? null };
      const sumRes = await client.query(
        `INSERT INTO summaries (conversation_id, level, covers, content, char_count, topics, meta)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
         RETURNING id`,
        [conversationId, 2, JSON.stringify(s.covers || []), s.summary, s.summaryChars, topics, JSON.stringify(meta)]
      );
      const summaryId = sumRes.rows[0].id as number;

      let values: number[];
      if (useVertex) {
        const embUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(embeddingModelName)}:embedContent`;
        const embRes = await fetch(embUrl, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`!, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text: s.summary }] } }) });
        const embJson: any = await embRes.json();
        if (!embRes.ok) throw new Error(`Vertex embedContent failed: ${embRes.status} ${JSON.stringify(embJson).slice(0,200)}`);
        values = embJson?.embedding?.values || embJson?.data?.embedding || embJson?.data?.[0]?.embedding;
      } else {
        const embResp: any = await embedModel.embedContent({ content: { parts: [{ text: s.summary }] } });
        values = embResp?.embedding?.values || embResp?.data?.embedding || embResp?.data?.[0]?.embedding;
      }
      const vec = vecToPgvectorString(values);
      await client.query(`INSERT INTO embeddings (conversation_id, ref_type, ref_id, model, dim, vector) VALUES ($1, 'summary', $2, $3, $4, $5::vector)`, [conversationId, summaryId, embeddingModelName, values.length, vec]);
      inserted++;
    }
    await client.query('COMMIT');
    console.log(`Inserted ${inserted} L2 summaries + embeddings for ${slug} (conversation_id=${conversationId})`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { await client.end(); }
}

main().catch(err => { console.error(err); process.exit(1); });
