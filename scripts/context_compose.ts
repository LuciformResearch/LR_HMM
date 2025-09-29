import 'dotenv/config';
import { Client } from 'pg';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';

type Logger = { info: (msg: string) => void; close: () => Promise<void> };

async function createLogger(prefix: string, logPathArg?: string): Promise<Logger> {
  const fs = await import('fs');
  const path = await import('path');
  const dir = logPathArg && !logPathArg.endsWith('.log') ? logPathArg : path.resolve(process.cwd(), 'artefacts/logs');
  await fs.promises.mkdir(dir, { recursive: true });
  const file = logPathArg && logPathArg.endsWith('.log') ? logPathArg : path.join(dir, `${prefix}_${Date.now()}.log`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  const write = (msg: string) => { const line = `[${new Date().toISOString()}] ${msg}`; console.log(line); stream.write(line + '\n'); };
  write(`Log ouvert: ${file}`);
  return { info: write, close: async () => new Promise(res => stream.end(res)) };
}

function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout ${ms}ms @ ${tag}`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function estTokensFromChars(chars: number): number { return Math.ceil(chars / 4); }

function jaccard(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function mmrSelect<T extends { baseScore:number; covers:number[] }>(cands: T[], k: number, lambda: number): T[] {
  const selected: T[] = [];
  const pool = [...cands];
  while (selected.length < k && pool.length > 0) {
    let bestIdx = 0; let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const maxSim = selected.length === 0 ? 0 : Math.max(...selected.map(s => jaccard(c.covers || [], s.covers || [])));
      const val = (1 - lambda) * c.baseScore - lambda * maxSim;
      if (val > bestVal) { bestVal = val; bestIdx = i; }
    }
    selected.push(pool.splice(bestIdx, 1)[0]);
  }
  return selected;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def?: string) => { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; };
  const hasFlag = (name: string) => args.includes(name);

  const slug = getArg('--slug');
  const query = getArg('--query');
  if (!slug) throw new Error('--slug required');
  if (!query) throw new Error('--query required');

  // Budgets
  const budgetTokens = Number(getArg('--budget-tokens', '4000'));
  const budgetChars = Number(getArg('--budget-chars', String(budgetTokens * 4)));
  const recentTurns = Number(getArg('--recent-turns', '8'));
  const expandNeighborhood = Number(getArg('--expand-neighborhood', '1'));

  // Retrieval
  const topn = Number(getArg('--topn', '40')); // candidates pre-rerank
  const topk = Number(getArg('--topk', '8'));  // final items before expansion
  const minSimArg = getArg('--min-sim', '0.55');
  const mmrLambda = Number(getArg('--mmr-lambda', '0.3'));
  const doRerank = (getArg('--rerank', 'true') || 'true').toLowerCase() === 'true';
  const minScoreArg = getArg('--min-score', '0.3');
  const batchSize = Number(getArg('--batch', '8'));
  const useL2 = (getArg('--use-l2', 'true') || 'true').toLowerCase() === 'true';

  // Logging & timeouts
  const logPath = getArg('--log');
  const callTimeoutMs = Number(getArg('--call-timeout-ms', process.env.RAG_CALL_TIMEOUT_MS || '10000'));
  const dbTimeoutMs = Number(getArg('--db-timeout-ms', process.env.RAG_DB_TIMEOUT_MS || '12000'));
  const logger = await createLogger('context_compose', logPath);
  logger.info(`Compose slug=${slug} query="${query}" budgetChars=${budgetChars} topn=${topn} topk=${topk} rerank=${doRerank}`);

  // Providers
  const useVertex = (getArg('--vertexai', 'false') || 'false').toLowerCase() === 'true';
  const project = getArg('--project', process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID);
  const location = getArg('--location', process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1');
  const rerankModelName = getArg('--vertex-model', process.env.VERTEX_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const embeddingModelName = getArg('--vertex-embed-model', process.env.VERTEX_EMBED_MODEL || process.env.EMBEDDING_MODEL || 'text-embedding-004');
  const geminiKey = process.env.GEMINI_API_KEY;

  async function getAccessToken(): Promise<string> {
    const auth = new GoogleAuth({ scopes: [ 'https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/generative-language.retriever' ] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token || !token.token) throw new Error('Failed to obtain Vertex access token');
    return token.token;
  }

  // Embed query
  logger.info(`Embedding query via ${useVertex ? 'Vertex' : 'AI Studio'} model=${embeddingModelName}`);
  let qEmbedding: number[];
  if (useVertex) {
    if (!project) throw new Error('PROJECT_ID/GOOGLE_CLOUD_PROJECT required for --vertexai');
    const token = await getAccessToken();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(embeddingModelName)}:embedContent`;
    const res = await withTimeout(fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text: query }] } }) }), callTimeoutMs, 'embedContent');
    const js: any = await res.json();
    if (!res.ok) throw new Error(`Vertex embedContent failed: ${res.status} ${JSON.stringify(js).slice(0,200)}`);
    qEmbedding = js?.embedding?.values || js?.data?.embedding || js?.data?.[0]?.embedding;
  } else {
    if (!geminiKey) throw new Error('GEMINI_API_KEY required (or use --vertexai)');
    const genAI = new GoogleGenerativeAI(geminiKey);
    const embedModel = genAI.getGenerativeModel({ model: embeddingModelName });
    const resp: any = await withTimeout(embedModel.embedContent({ content: { parts: [{ text: query }] } }), callTimeoutMs, 'embedContent');
    qEmbedding = resp?.embedding?.values || resp?.data?.embedding || resp?.data?.[0]?.embedding;
  }
  if (!qEmbedding || !Array.isArray(qEmbedding)) throw new Error('Invalid query embedding');
  logger.info(`Query embedding OK: dim=${qEmbedding.length}`);

  // DB retrieval
  const dbHost = getArg('--db-host', process.env.PGHOST || 'localhost');
  const dbPort = Number(getArg('--db-port', process.env.PGPORT || '6432'));
  const dbUser = getArg('--db-user', process.env.PGUSER || 'shadeos');
  const dbPass = getArg('--db-pass', process.env.PGPASSWORD || 'shadeos');
  const dbName = getArg('--db-name', process.env.PGDATABASE || 'shadeos_local');
  const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPass, database: dbName });
  await client.connect();
  try {
    try { await client.query(`SET statement_timeout = ${dbTimeoutMs}`); } catch {}
    const qp = '[' + qEmbedding.map(v => (Number.isFinite(v) ? v : 0).toFixed(6)).join(',') + ']';
    const convRes = await client.query('SELECT id FROM conversations WHERE slug = $1', [slug]);
    if (convRes.rowCount === 0) throw new Error(`Conversation not found for slug: ${slug}`);
    const convId = convRes.rows[0].id as number;

    // Retrieve candidates (topN by cosine); include covers; compute distance and similarity
    const minSim = Math.max(0, Math.min(1, Number(minSimArg)));
    const maxDistance = 1 - minSim;
    const sql = `
      SELECT s.id as summary_id, s.level, s.char_count, s.content, s.covers,
             e.model, e.dim, (e.vector <=> $1::vector) AS distance
      FROM embeddings e
      JOIN summaries s ON s.id = e.ref_id AND e.ref_type = 'summary'
      WHERE e.conversation_id = $2
        AND (e.vector <=> $1::vector) <= $3
        AND (s.level = 1 OR ${useL2 ? 's.level = 2' : 'false'})
      ORDER BY e.vector <=> $1::vector
      LIMIT ${topn}
    `;
    logger.info(`DB retrieving candidates topN=${topn} minSim=${minSim}`);
    const t0 = Date.now();
    const res = await client.query(sql, [qp, convId, maxDistance]);
    logger.info(`DB returned ${res.rowCount} rows in ${Date.now()-t0}ms`);
    let rows = res.rows as Array<{ summary_id:number; level:number; char_count:number; content:string; covers:number[]; model:string; dim:number; distance:number; }>;

    // Optional rerank
    let baseCands = rows.map(r => ({ ...r, sim: 1 - Number(r.distance), score: 0 }));
    if (doRerank && rows.length > 0) {
      let rerankModel: any = null; let token: string | null = null;
      if (useVertex) { token = await getAccessToken(); }
      else {
        if (!geminiKey) throw new Error('GEMINI_API_KEY required for rerank (or use --vertexai)');
        const genAI = new GoogleGenerativeAI(geminiKey);
        rerankModel = genAI.getGenerativeModel({ model: rerankModelName });
      }
      const minScore = Math.max(0, Math.min(1, Number(minScoreArg)));
      logger.info(`Rerank start model=${rerankModelName} batch=${batchSize} timeout=${callTimeoutMs}`);
      async function scoreOne(q: string, text: string): Promise<number> {
        const prompt = `Tu es un reranker. Donne un score 0..1 de pertinence entre la requête et le texte.\nRequête: "${q}"\nTexte:\n"""\n${text.slice(0, 1200)}\n"""\nRéponds uniquement par un nombre 0..1.`;
        if (useVertex) {
          const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${encodeURIComponent(rerankModelName)}:generateContent`;
          const payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 16 } };
          const resp = await withTimeout(fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`!, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), callTimeoutMs, 'rerank.generateContent');
          const js: any = await resp.json();
          const textOut = js?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
          const m = String(textOut).match(/\d+(?:\.\d+)?/);
          return m ? Math.max(0, Math.min(1, parseFloat(m[0]))) : 0;
        } else {
          const resp = await withTimeout(rerankModel.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }), callTimeoutMs, 'rerank.generateContent');
          const tfn = resp?.response?.text; const t = typeof tfn === 'function' ? resp.response.text() : resp?.response?.text; const s = String(t||'');
          const m = s.match(/\d+(?:\.\d+)?/);
          return m ? Math.max(0, Math.min(1, parseFloat(m[0]))) : 0;
        }
      }
      const scored: Array<number> = [];
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const started = Date.now();
        const vals = await Promise.all(batch.map(r => scoreOne(query!, r.content)));
        scored.push(...vals);
        logger.info(`Rerank batch ${i/batchSize+1}: ${batch.length} in ${Date.now()-started}ms`);
      }
      baseCands = baseCands.map((r, idx) => ({ ...r, score: scored[idx] ?? 0 })).filter(r => r.score >= minScore);
    }

    // MMR + dedup (covers jaccard)
    const candsForMMR = baseCands.map(r => ({ ...r, baseScore: (doRerank ? r.score : r.sim) }));
    const selected = mmrSelect(candsForMMR, topk, mmrLambda);

    // Load parsed conversation to expand
    const fs = await import('fs');
    const path = await import('path');
    const parsedPath = path.resolve(process.cwd(), 'artefacts/HMM/parsed', `${slug}.json`);
    const parsed = JSON.parse(await fs.promises.readFile(parsedPath, 'utf8'));
    const itemsById = new Map<number, any>();
    for (const it of parsed.items) itemsById.set(it.index, it);

    // Expand covers + neighborhood until budget is hit
    const messages: any[] = [];
    const seen = new Set<number>();
    let usedChars = 0;
    function pushMsg(i: number) {
      if (i < 0) return; if (seen.has(i)) return; const m = itemsById.get(i); if (!m) return;
      const delta = Array.from(m.content || '').length + 16; // header slack
      if (usedChars + delta > budgetChars) return; // stop adding
      messages.push({ index: m.index, role: m.role, charCount: m.charCount, content: m.content });
      seen.add(i); usedChars += delta;
    }

    for (const r of selected) {
      const covers = Array.isArray(r.covers) ? r.covers as number[] : [];
      for (const idx of covers) {
        // neighborhood
        for (let j = idx - expandNeighborhood; j <= idx + expandNeighborhood; j++) pushMsg(j);
        if (usedChars >= budgetChars) break;
      }
      if (usedChars >= budgetChars) break;
    }

    // Recent turns (ensure they are included, prioritize at the end within budget)
    const all = parsed.items as any[];
    const tail = all.slice(-recentTurns);
    for (const m of tail) pushMsg(m.index);

    // Assemble output JSON
    const artefactsDir = path.resolve(process.cwd(), 'artefacts/HMM/context', slug);
    await fs.promises.mkdir(artefactsDir, { recursive: true });
    const outFile = path.join(artefactsDir, `context_${Date.now()}.json`);
    const out = {
      slug, query,
      params: { budgetTokens, budgetChars, topn, topk, minSimArg, mmrLambda, expandNeighborhood, rerank: doRerank, useL2 },
      turns: tail.map(t => ({ index: t.index, role: t.role, content: t.content })),
      l1_selected: selected.filter(s => s.level === 1).map(r => ({ summary_id: r.summary_id, sim: r.sim, score: r.score, covers: r.covers, char_count: r.char_count })),
      l2_summaries: selected.filter(s => s.level === 2).map(r => ({ summary_id: r.summary_id, sim: r.sim, score: r.score, covers: r.covers, char_count: r.char_count, content: r.content })),
      expanded: { totalMessages: messages.length, messages },
      budget: { inputTokens: budgetTokens, approxUsedTokens: estTokensFromChars(usedChars), usedChars },
      metrics: { candidates: rows.length, selected: selected.length }
    };
    await fs.promises.writeFile(outFile, JSON.stringify(out, null, 2), 'utf8');
    logger.info(`Context exported: ${outFile}`);

    // Optional save to DB
    const saveDb = (getArg('--save-db', 'false') || 'false').toLowerCase() === 'true';
    if (saveDb) {
      try {
        await client.query(
          `INSERT INTO contexts (slug, query, params_json, items_json, expanded_json, budget_json, metrics_json)
           VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb)`,
          [slug, query, JSON.stringify(out.params), JSON.stringify({ l1_selected: out.l1_selected, l2_summaries: out.l2_summaries }), JSON.stringify(out.expanded), JSON.stringify(out.budget), JSON.stringify(out.metrics)]
        );
        logger.info('Saved context to DB (contexts)');
      } catch (e:any) {
        logger.info('Save to DB failed: ' + (e?.message || e));
      }
    }

    // Also print quick summary
    console.log(`Selected ${selected.length} L1 items; expanded messages=${messages.length}; approx tokens=${estTokensFromChars(usedChars)}/${budgetTokens}`);
  } finally {
    await client.end();
    await logger.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
