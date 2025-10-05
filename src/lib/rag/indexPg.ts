import 'dotenv/config';
import { Client } from 'pg';
import { Candidate, IRagIndex } from './types';

export class PgRagIndex implements IRagIndex {
  private client: Client;
  constructor(cfg?: { connectionString?: string; host?: string; port?: number; user?: string; password?: string; database?: string }) {
    const cs = cfg?.connectionString;
    this.client = new Client(cs ? { connectionString: cs } : {
      host: cfg?.host || process.env.PGHOST || 'localhost',
      port: cfg?.port ? Number(cfg.port) : Number(process.env.PGPORT || 6432),
      user: cfg?.user || process.env.PGUSER || 'shadeos',
      password: cfg?.password || process.env.PGPASSWORD || 'shadeos',
      database: cfg?.database || process.env.PGDATABASE || 'shadeos_local',
    });
  }
  async connect() { await this.client.connect(); }
  async close() { await this.client.end(); }

  async search(levels: number[], queryEmbedding: number[], opts: { topk: number; scopeCovers?: number[]; conversationId?: number }): Promise<Candidate[]> {
    // Minimal baseline: cosine distance over summaries embeddings; optional scope by covers via where clause after joining summaries
    const qp = '[' + queryEmbedding.map(v => (Number.isFinite(v) ? v : 0).toFixed(6)).join(',') + ']';
    const topk = Math.max(1, Math.floor(opts.topk || 8));
    const lv = (levels && levels.length) ? levels : [1];
    const scope = opts.scopeCovers && opts.scopeCovers.length ? opts.scopeCovers : null;

    const params: any[] = [qp];
    let where = `s.level = ANY($${params.push(lv)})`;
    if (scope) {
      if (lv.length === 1 && lv[0] === 1) {
        // Drill-down to L1: filter by L1 idx in covers
        where += ` AND s.idx = ANY($${params.push(scope)})`;
      } else {
        // Generic JSON covers overlap
        where += ` AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(s.covers,'[]'::jsonb)) AS j(val) WHERE (j.val)::int = ANY($${params.push(scope)}) )`;
      }
    }
    if (opts.conversationId != null) {
      where += ` AND s.conversation_id = $${params.push(opts.conversationId)}`;
    }
    const sql = `
      SELECT s.id, s.conversation_id, s.level, s.idx AS index, s.char_count, s.content, s.covers,
             (e.vector <=> $1::vector) AS distance
      FROM embeddings e
      JOIN summaries s ON s.id = e.ref_id AND e.ref_type = 'summary'
      WHERE ${where}
      ORDER BY e.vector <=> $1::vector
      LIMIT ${topk}
    `;
    const r = await this.client.query(sql, params);
    return r.rows.map(row => ({
      id: row.id, conversationId: row.conversation_id, level: row.level, index: row.index ?? null,
      charCount: row.char_count ?? null, content: row.content, covers: row.covers || [], score: 1 - Number(row.distance || 0)
    }));
  }

  async fetchByIds(ids: number[]): Promise<Candidate[]> {
    if (!ids || !ids.length) return [];
    const sql = `SELECT id, conversation_id, level, index, char_count, content, covers FROM summaries WHERE id = ANY($1)`;
    const r = await this.client.query(sql, [ids]);
    return r.rows.map(row => ({ id: row.id, conversationId: row.conversation_id, level: row.level, index: row.index ?? null, charCount: row.char_count ?? null, content: row.content, covers: row.covers || [] }));
  }

  async fetchCovers(level: number, ids: number[]): Promise<{ level: number; id: number; covers: number[] }[]> {
    if (!ids || !ids.length) return [];
    const sql = `SELECT id, covers FROM summaries WHERE level = $1 AND id = ANY($2)`;
    const r = await this.client.query(sql, [level, ids]);
    return r.rows.map((row: any) => ({ level, id: row.id, covers: row.covers || [] }));
  }

  async getConversationIdBySlug(slug: string): Promise<number | null> {
    const r = await this.client.query('SELECT id FROM conversations WHERE slug = $1', [slug]);
    return r.rowCount ? (r.rows[0].id as number) : null;
  }
}
