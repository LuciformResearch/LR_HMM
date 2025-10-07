import 'dotenv/config';
import { Client } from 'pg';
import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAuth } from 'google-auth-library';

export async function embedMissingSummaries(opts: { slug: string; whereLevels: number[]; limitPerLevel?: number; useVertex?: boolean; embedModel?: string; vertexModel?: string }): Promise<{ total: number; perLevel: Record<number, number> }> {
  const client = new Client({ host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT || 6432), user: process.env.PGUSER || 'shadeos', password: process.env.PGPASSWORD || 'shadeos', database: process.env.PGDATABASE || 'shadeos_local' });
  await client.connect();
  try {
    const r = await client.query('SELECT id FROM conversations WHERE slug=$1', [opts.slug]);
    if (r.rowCount === 0) return 0;
    const conversationId = r.rows[0].id as number;
    let total = 0;
    const perLevel: Record<number, number> = {};
    for (const lvl of opts.whereLevels) {
      const lim = Math.max(0, opts.limitPerLevel || 100);
      const sql = `
        SELECT s.id, s.conversation_id, s.level, s.content
        FROM summaries s
        LEFT JOIN embeddings e ON e.ref_type = 'summary' AND e.ref_id = s.id
        WHERE s.conversation_id = $1 AND s.level = $2 AND e.id IS NULL
        ORDER BY s.id ASC
        ${lim>0?`LIMIT ${lim}`:''}
      `;
      const rows = (await client.query(sql, [conversationId, lvl])).rows as Array<{ id:number; conversation_id:number; content:string }>;
      if (!rows.length) { perLevel[lvl] = 0; continue; }

      // Provider init
      const useVertex = !!opts.useVertex;
      const embedModel = opts.embedModel || process.env.EMBEDDING_MODEL || 'text-embedding-004';
      const vertexModel = opts.vertexModel || process.env.VERTEX_EMBED_MODEL || embedModel;
      let token: string | null = null; let studio: GoogleGenerativeAI | null = null;
      if (useVertex) {
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/generative-language.retriever'] });
        const c = await auth.getClient(); const t = await c.getAccessToken(); if (!t || !t.token) throw new Error('Vertex token failure'); token = t.token;
      } else {
        const key = process.env.GEMINI_API_KEY; if (!key) throw new Error('GEMINI_API_KEY required for studio embedding'); studio = new GoogleGenerativeAI(key);
      }
      let insertedLevel = 0;
      for (const row of rows) {
        const text = (row.content || '').slice(0, 8192);
        let values: number[] | undefined;
        if (useVertex) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(vertexModel)}:embedContent`;
          const resp = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text }] } }) });
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
          [row.conversation_id, row.id, useVertex ? 'vertex' : 'studio', useVertex ? vertexModel : embedModel, dim, vec]
        );
        total++; insertedLevel++;
      }
      perLevel[lvl] = insertedLevel;
    }
    return { total, perLevel };
  } finally { await client.end(); }
}
