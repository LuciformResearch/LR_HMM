import { Client } from 'pg';
import crypto from 'crypto';
import { prepareBlocksChat } from '@/lib/hmm/unified';
import { summarizeBatched, SummarizeEngineOptions, LengthPolicies, RawDataBlock, LSummary } from '@/lib/hmm/unified';

type DbMessage = { id: number; idx: number | null; role: 'user'|'assistant'|string; ts: string | null; content: string };

export async function fetchConversationId(client: Client, slug: string): Promise<number> {
  const title = slug.replace(/_/g, ' ');
  const r = await client.query(
    `INSERT INTO conversations (slug, title) VALUES ($1,$2)
     ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title
     RETURNING id`, [slug, title]
  );
  return r.rows[0].id as number;
}

export async function fetchMessages(client: Client, conversationId: number): Promise<DbMessage[]> {
  // Prefer idx if present; fallback to created order by id
  const hasIdx = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='idx' LIMIT 1");
  const sql = hasIdx.rowCount
    ? `SELECT id, idx, role, ts, content FROM messages WHERE conversation_id=$1 ORDER BY COALESCE(idx, 0), id`
    : `SELECT id, NULL::int as idx, role, ts, content FROM messages WHERE conversation_id=$1 ORDER BY id`;
  const r = await client.query(sql, [conversationId]);
  return r.rows as DbMessage[];
}

export async function buildChatBlocksFromDb(
  client: Client,
  conversationId: number,
  opts: { windowChars: number; ensureAssistant?: boolean; interlocutor?: string; roleMap?: Record<string,string>; maxBlocks?: number|'infinity' }
): Promise<RawDataBlock[]> {
  const rows = await fetchMessages(client, conversationId);
  const turns = rows.map((m, i) => ({
    role: (m.role === 'assistant' || m.role === 'user') ? (m.role as any) : 'unknown',
    content: m.content || '',
    index: (m.idx != null ? m.idx : i),
    charCount: (m.content || '').length,
  }));
  const prepared = prepareBlocksChat(turns as any, {
    windowChars: Math.max(1000, opts.windowChars),
    ensureAssistant: opts.ensureAssistant !== false,
    interlocutor: opts.interlocutor || 'User',
    roleMap: opts.roleMap || {},
    maxBlocks: opts.maxBlocks ?? 'infinity',
  } as any);
  return prepared.blocks;
}

export async function summarizeAndUpsert(
  client: Client,
  conversationId: number,
  level: 1|2|3,
  input: RawDataBlock[] | LSummary[][],
  engine: SummarizeEngineOptions,
  policies: LengthPolicies,
  opts: { concurrency?: number; batchDelayMs?: number; onlyIndices?: number[]; sourceHashesByIndex?: Map<number,string> }
): Promise<LSummary[]> {
  const res = await summarizeBatched(input as any, engine, policies, { concurrency: Math.max(1, opts.concurrency || 3), batchDelayMs: Math.max(0, opts.batchDelayMs || 0), onlyIndices: opts.onlyIndices });
  for (const s of res) {
    const idx = typeof (s as any).index === 'number' && isFinite((s as any).index) ? Math.floor((s as any).index) : null;
    const covers = JSON.stringify(s.covers || []);
    const topics = (s.tags && s.tags.length) ? s.tags : null;
    const sourceHash = idx != null ? opts.sourceHashesByIndex?.get(idx) : undefined;
    const meta = { entities: s.entities ?? null, signals: s.signals ?? null, extras: s.extras ?? null, artefactVersion: 'v2', sourceHash: sourceHash || null };
    const content = s.summary || '';
    const charCount = s.summaryChars || content.length;
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    if (idx != null) {
      const r = await client.query('SELECT id FROM summaries WHERE conversation_id=$1 AND level=$2 AND idx=$3 LIMIT 1', [conversationId, level, idx]);
      if (r.rowCount) {
        const id = r.rows[0].id as number;
        await client.query(
          `UPDATE summaries SET covers=$1::jsonb, content=$2, content_hash=$3, char_count=$4, topics=$5, meta=$6::jsonb WHERE id=$7`,
          [covers, content, contentHash, charCount, topics, JSON.stringify(meta), id]
        );
      } else {
        await client.query(
          `INSERT INTO summaries (conversation_id, level, idx, covers, content, content_hash, char_count, topics, meta)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)`,
          [conversationId, level, idx, covers, content, contentHash, charCount, topics, JSON.stringify(meta)]
        );
      }
    } else {
      await client.query(
        `INSERT INTO summaries (conversation_id, level, covers, content, content_hash, char_count, topics, meta)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (conversation_id, level, content_hash)
         DO UPDATE SET covers=EXCLUDED.covers, content=EXCLUDED.content, char_count=EXCLUDED.char_count, topics=EXCLUDED.topics, meta=EXCLUDED.meta`,
        [conversationId, level, covers, content, contentHash, charCount, topics, JSON.stringify(meta)]
      );
    }
  }
  return res;
}

export function groupForL2(blocks: LSummary[], groupChars: number): LSummary[][] {
  // Prepare contiguous groups from whole summaries (no split within an item)
  const groups: LSummary[][] = [];
  let cur: LSummary[] = [];
  let chars = 0;
  for (const b of blocks) {
    const c = b.summaryChars || (b.summary || '').length;
    if (cur.length && (chars + c) > groupChars) {
      groups.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(b);
    chars += c;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export async function fetchSummaries(client: Client, conversationId: number, level: 1|2|3): Promise<Array<{ index: number|null; summary: string; summaryChars: number; covers: number[] }>> {
  const r = await client.query('SELECT idx AS index, content AS summary, char_count AS summaryChars, COALESCE(covers, \"[]\"::jsonb) AS covers, meta FROM summaries WHERE conversation_id=$1 AND level=$2 ORDER BY COALESCE(idx,0), id', [conversationId, level]);
  return r.rows.map((row: any) => ({ index: row.index, summary: row.summary || '', summaryChars: row.summarychars || (row.summary||'').length, covers: Array.isArray(row.covers) ? row.covers : [] }));
}

export function hashText(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }

export async function selectDirtyL1Indices(client: Client, conversationId: number, blocks: RawDataBlock[]): Promise<{ dirty: number[]; sourceHashes: Map<number,string> }>{
  const r = await client.query('SELECT idx, (meta->>\'sourceHash\') AS source_hash FROM summaries WHERE conversation_id=$1 AND level=1', [conversationId]);
  const existing = new Map<number, string | null>();
  for (const row of r.rows) { if (row.idx != null) existing.set(Number(row.idx), row.source_hash || null); }
  const dirty: number[] = [];
  const sourceHashes = new Map<number,string>();
  for (let i=0;i<blocks.length;i++) {
    const h = hashText(blocks[i].text || '');
    sourceHashes.set(i, h);
    const cur = existing.get(i);
    if (!cur || cur !== h) dirty.push(i);
  }
  return { dirty, sourceHashes };
}

export function prepareGroups(items: LSummary[], groupChars: number): LSummary[][] {
  const groups: LSummary[][] = [];
  let cur: LSummary[] = [];
  let chars = 0;
  for (const it of items) {
    const c = it.summaryChars || (it.summary || '').length;
    if (cur.length && (chars + c) > groupChars) { groups.push(cur); cur = []; chars = 0; }
    cur.push(it); chars += c;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export function selectDirtyGroupIndices(grouped: LSummary[][], dirtyChildIndices: Set<number>): number[] {
  const dirty: number[] = [];
  for (let gi=0; gi<grouped.length; gi++) {
    const g = grouped[gi];
    const hasDirty = g.some(item => item.index != null && dirtyChildIndices.has(item.index!));
    if (hasDirty) dirty.push(gi);
  }
  return dirty;
}
