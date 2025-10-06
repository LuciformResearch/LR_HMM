import 'dotenv/config';
import dotenv from 'dotenv';
try { dotenv.config({ path: '.env.local' }); } catch {}
import { promises as fs } from 'fs';
import * as path from 'path';
import { Client } from 'pg';

type GPTAuthor = { role?: string | null };
type GPTMessage = {
  id?: string;
  author?: GPTAuthor;
  create_time?: number | null;
  content?: { content_type?: string; parts?: string[] } | null;
};
type GPTNode = { id: string; message: GPTMessage | null; parent: string | null; children?: string[] };
type GPTConversation = {
  id?: string;
  title?: string;
  create_time?: number | null;
  update_time?: number | null;
  mapping: Record<string, GPTNode>;
};

function getArg(args: string[], name: string, def?: string) { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; }
function hasFlag(args: string[], name: string) { return args.includes(name); }

function sanitizeSlug(s: string): string {
  return s.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function toIso(ts: number): string { return new Date(Math.round(ts * 1000)).toISOString(); }

async function readExport(p: string): Promise<GPTConversation[]> {
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data as GPTConversation[];
  if (Array.isArray((data as any).conversations)) return (data as any).conversations as GPTConversation[];
  throw new Error('Unrecognized ChatGPT export schema');
}

function flattenConversation(conv: GPTConversation): { title: string; created: string; messages: Array<{ role: 'user'|'assistant'|'unknown'; text: string; ts: string|null }> } {
  const title = conv.title || 'conversation';
  const convTs = (conv.create_time ? toIso(conv.create_time) : new Date().toISOString());
  const nodes = Object.values(conv.mapping||{});
  const msgs: Array<{ role: 'user'|'assistant'|'unknown'; text: string; ts: string|null; orderKey: number }>=[];
  for (const n of nodes) {
    const m = n.message;
    if (!m) continue;
    const roleRaw = (m.author?.role||'').toLowerCase();
    const role: 'user'|'assistant'|'unknown' = roleRaw==='user'||roleRaw==='assistant'? (roleRaw as any): 'unknown';
    let text = '';
    if (m.content && m.content.parts && Array.isArray(m.content.parts)) text = m.content.parts.join('\n').trim();
    if (!text) continue; // skip empties
    const ts = (typeof m.create_time==='number' && m.create_time>0) ? toIso(m.create_time) : null;
    const orderKey = (typeof m.create_time==='number' && m.create_time>0) ? m.create_time : Number.MAX_SAFE_INTEGER; // missing times go last, will reindex later
    msgs.push({ role, text, ts, orderKey });
  }
  // Fallback order by mapping chain if all missing: keep insertion
  msgs.sort((a,b)=> a.orderKey - b.orderKey);
  // Fill missing timestamps by interpolation from conversation create_time + index minutes
  let base = Date.parse(convTs)/1000;
  let step = 60; // 1 minute per index as fallback
  let idx = 0;
  for (const m of msgs) {
    if (!m.ts) m.ts = toIso(base + (idx*step));
    idx++;
  }
  return { title, created: convTs, messages: msgs.map(({role,text,ts})=>({role, text, ts})) };
}

async function writeParsed(slug: string, convo: ReturnType<typeof flattenConversation>) {
  const outDir = path.resolve(process.cwd(), 'artefacts/HMM/parsed');
  await fs.mkdir(outDir, { recursive: true });
  const items = convo.messages.map((m, i) => ({ index: i, timestamp: m.ts, role: m.role, content: m.text, charCount: m.text.length }));
  const out = { slug, title: convo.title, created: convo.created, totals: { items: items.length }, items };
  const outPath = path.join(outDir, `${slug}.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
  return outPath;
}

async function ingestDb(slug: string, convo: ReturnType<typeof flattenConversation>) {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || '6432'),
    user: process.env.PGUSER || 'shadeos',
    password: process.env.PGPASSWORD || 'shadeos',
    database: process.env.PGDATABASE || 'shadeos_local',
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const title = convo.title || slug;
    const createdDate = new Date(convo.created).toISOString().slice(0,10);
    const convRes = await client.query(
      `INSERT INTO conversations (slug, title, created_date, total_chars, total_lines)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, created_date=EXCLUDED.created_date
       RETURNING id`,
      [slug, title, createdDate, convo.messages.reduce((a,m)=>a+m.text.length,0), convo.messages.length]
    );
    const conversationId = convRes.rows[0].id as number;
    // Ensure idx column exists for ordering
    await client.query(`DO $$ BEGIN BEGIN ALTER TABLE messages ADD COLUMN IF NOT EXISTS idx INT; EXCEPTION WHEN others THEN NULL; END; END $$;`);
    // Clear previous messages for idempotency
    await client.query('DELETE FROM messages WHERE conversation_id=$1', [conversationId]);
    let i = 0;
    for (const m of convo.messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue; // respect CHECK constraint
      await client.query(
        `INSERT INTO messages (conversation_id, role, ts, content, idx) VALUES ($1,$2,$3,$4,$5)`,
        [conversationId, m.role, m.ts, m.text, i]
      );
      i++;
    }
    await client.query('COMMIT');
    console.log(`Ingested ${convo.messages.length} messages for slug=${slug}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const list = hasFlag(args, '--list');
  const inPath = getArg(args, '--in', '/home/luciedefraiteur/luciform_research/ShadeOSFinal_Extracted/conversations.json')!;
  const titleQuery = getArg(args, '--title');
  const indexSel = getArg(args, '--index');
  const slugArg = getArg(args, '--slug');
  const doDb = (getArg(args, '--db', 'false')||'false').toLowerCase()==='true';

  const all = await readExport(inPath);
  const convs = all.map((c, i) => ({ i, title: c.title || `conv_${i}`, create_time: c.create_time, update_time: c.update_time }));
  if (list) {
    for (const c of convs) {
      const t = c.title.replace(/\s+/g,' ').slice(0,140);
      const ct = c.create_time? toIso(c.create_time):'';
      console.log(`${c.i}\t${ct}\t${t}`);
    }
    return;
  }

  let chosenIdx = 0;
  if (indexSel) chosenIdx = Math.max(0, Math.min(convs.length-1, Number(indexSel)));
  else if (titleQuery) {
    const q = titleQuery.toLowerCase();
    const found = convs.findIndex(c => (c.title||'').toLowerCase().includes(q));
    if (found >= 0) chosenIdx = found; else throw new Error(`No conversation title matching: ${titleQuery}`);
  }
  const conv = all[chosenIdx];
  const flat = flattenConversation(conv);
  const datePart = flat.created.slice(0,10);
  const baseSlug = slugArg || `${datePart}__${sanitizeSlug(flat.title)}`;
  const outPath = await writeParsed(baseSlug, flat);
  console.log(`Parsed → ${outPath}`);
  if (doDb) {
    await ingestDb(baseSlug, flat);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
