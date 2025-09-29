import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';

type L1File = {
  slug: string;
  windowChars: number;
  ensureAssistant: boolean;
  produced: number;
  summaries: Array<{
    level: number;
    covers: number[];
    charCount: number;
    summary: string;
    summaryChars: number;
    compressionRatio: number;
    qualityScore: number;
    durationMs: number;
    tags?: string[];
    artifacts?: any[];
  }>;
};

function parseDirSlug(slug: string): { date: string | null; title: string } {
  const m = slug.match(/^(\d{4}-\d{2}-\d{2})__(.+)$/);
  if (!m) return { date: null, title: slug.replace(/_/g, ' ') };
  return { date: m[1], title: m[2].replace(/_/g, ' ') };
}

function vecToPgvectorString(vec: number[]): string {
  return '[' + vec.map(v => (Number.isFinite(v) ? v : 0).toFixed(6)).join(',') + ']';
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
  };

  const slug = getArg('--slug', '2025-06-25__orage_codé_textuel')!;
  const l1Path = getArg('--in', path.resolve(process.cwd(), 'artefacts/HMM/compressed', `${slug}.l1.json`))!;

  const dbHost = getArg('--db-host', process.env.PGHOST || 'localhost');
  const dbPort = Number(getArg('--db-port', process.env.PGPORT || '6432'));
  const dbUser = getArg('--db-user', process.env.PGUSER || 'shadeos');
  const dbPass = getArg('--db-pass', process.env.PGPASSWORD || 'shadeos');
  const dbName = getArg('--db-name', process.env.PGDATABASE || 'shadeos_local');

  const geminiKey = process.env.GEMINI_API_KEY;
  const embeddingModelName = process.env.EMBEDDING_MODEL || 'text-embedding-004';
  const useVertex = (getArg('--vertexai', 'false') || 'false').toLowerCase() === 'true';
  const project = getArg('--project', process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID);
  const location = getArg('--location', process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1');
  const vertexEmbedModel = getArg('--vertex-embed-model', process.env.VERTEX_EMBED_MODEL || embeddingModelName);

  const raw = await fs.readFile(l1Path, 'utf8');
  const l1: L1File & { summaries: Array<L1File['summaries'][number] & { tags?: string[]; artifacts?: any[] }> } = JSON.parse(raw);
  if (!l1.summaries || l1.summaries.length === 0) {
    throw new Error('No summaries found in L1 file');
  }

  const { date, title } = parseDirSlug(slug);

  const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPass, database: dbName });
  await client.connect();
  try {
    await client.query('BEGIN');

    // Upsert conversation
    const convRes = await client.query(
      `INSERT INTO conversations (slug, title, created_date, total_chars, total_lines)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      [slug, title, date, null, null]
    );
    const conversationId = convRes.rows[0].id as number;

    // Prepare embedding providers
    let embedModel: any = null;
    let vertexToken: string | null = null;
    if (useVertex) {
      if (!project) throw new Error('PROJECT_ID/GOOGLE_CLOUD_PROJECT required for --vertexai');
      const auth = new GoogleAuth({
        scopes: [
          'https://www.googleapis.com/auth/cloud-platform',
          'https://www.googleapis.com/auth/generative-language.retriever'
        ]
      });
      const clientAuth = await auth.getClient();
      const token = await clientAuth.getAccessToken();
      if (!token || !token.token) throw new Error('Failed to obtain Vertex access token');
      vertexToken = token.token;
    } else {
      if (!geminiKey) throw new Error('GEMINI_API_KEY is required for embeddings (or use --vertexai)');
      const genAI = new GoogleGenerativeAI(geminiKey);
      embedModel = genAI.getGenerativeModel({ model: embeddingModelName });
    }

    let inserted = 0;
    for (const s of l1.summaries) {
      // Insert summary row
      const topics = (s as any).tags && Array.isArray((s as any).tags) && (s as any).tags.length > 0 ? (s as any).tags : null;
      // Try to find existing summary by content + level
      let summaryId: number | null = null;
      const findRes = await client.query(
        `SELECT id FROM summaries WHERE conversation_id = $1 AND level = $2 AND content = $3 LIMIT 1`,
        [conversationId, s.level || 1, s.summary]
      );
      if (findRes.rowCount && findRes.rows[0]?.id) {
        summaryId = findRes.rows[0].id as number;
        await client.query(
          `UPDATE summaries SET covers = $1::jsonb, char_count = $2, topics = $3, meta = COALESCE($4::jsonb, meta)
           WHERE id = $5`,
          [JSON.stringify(s.covers || []), s.summaryChars, topics, s.artifacts ? JSON.stringify({ artifacts: s.artifacts }) : null, summaryId]
        );
      } else {
        const sumRes = await client.query(
          `INSERT INTO summaries (conversation_id, level, covers, content, char_count, topics, meta)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
           RETURNING id`,
          [conversationId, s.level || 1, JSON.stringify(s.covers || []), s.summary, s.summaryChars, topics, s.artifacts ? JSON.stringify({ artifacts: s.artifacts }) : null]
        );
        summaryId = sumRes.rows[0].id as number;
      }

      // Generate embedding (strict)
      let values: number[];
      if (useVertex) {
        const embUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(vertexEmbedModel)}:embedContent`;
        const embRes = await fetch(embUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${vertexToken}`!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: { parts: [{ text: s.summary }] } })
        });
        const embJson: any = await embRes.json();
        if (!embRes.ok) throw new Error(`Vertex embedContent failed: ${embRes.status} ${JSON.stringify(embJson).slice(0,200)}`);
        values = embJson?.embedding?.values || embJson?.data?.embedding || embJson?.data?.[0]?.embedding;
      } else {
        const embResp: any = await embedModel.embedContent({ content: { parts: [{ text: s.summary }] } });
        values = embResp?.embedding?.values || embResp?.data?.embedding || embResp?.data?.[0]?.embedding;
      }
      if (!values || !Array.isArray(values)) {
        throw new Error('Embedding response invalid');
      }
      const vec = vecToPgvectorString(values);

      // Insert embedding
      await client.query(
        `INSERT INTO embeddings (conversation_id, ref_type, ref_id, model, dim, vector)
         VALUES ($1, 'summary', $2, $3, $4, $5::vector)`,
        [conversationId, summaryId, embeddingModelName, values.length, vec]
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`Inserted ${inserted} L1 summaries + embeddings for ${slug} (conversation_id=${conversationId})`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
