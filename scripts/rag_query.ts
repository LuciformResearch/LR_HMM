import 'dotenv/config';
import { Client } from 'pg';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';

type Logger = {
  info: (msg: string) => void;
  close: () => Promise<void>;
};

async function createLogger(prefix: string, logPathArg?: string): Promise<Logger> {
  const fs = await import('fs');
  const path = await import('path');
  const dir = logPathArg && !logPathArg.endsWith('.log')
    ? logPathArg
    : path.resolve(process.cwd(), 'artefacts/logs');
  await fs.promises.mkdir(dir, { recursive: true });
  const file = logPathArg && logPathArg.endsWith('.log')
    ? logPathArg
    : path.join(dir, `${prefix}_${Date.now()}.log`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  const write = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    stream.write(line + '\n');
  };
  write(`Log ouvert: ${file}`);
  return {
    info: write,
    close: async () => new Promise(res => stream.end(res))
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout ${ms}ms @ ${tag}`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
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

  const slug = getArg('--slug');
  const query = getArg('--query');
  const topk = Number(getArg('--topk', '8'));
  const distance = (getArg('--distance', 'cosine') || 'cosine').toLowerCase(); // cosine|l2
  const minSimArg = getArg('--min-sim'); // only for cosine: 0..1
  const maxDistArg = getArg('--max-distance'); // only for l2
  const doRerank = (getArg('--rerank', 'false') || 'false').toLowerCase() === 'true';
  const topn = Number(getArg('--topn', '40'));
  const minScoreArg = getArg('--min-score', '0.3');
  const batchSize = Number(getArg('--batch', '8'));
  const exportPath = getArg('--export');
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-004';
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!query) throw new Error('--query required');

  // Logging and timeouts
  const logPath = getArg('--log'); // can be dir or file; if omitted, default dir used
  const callTimeoutMs = Number(getArg('--call-timeout-ms', process.env.RAG_CALL_TIMEOUT_MS || '12000'));
  const dbTimeoutMs = Number(getArg('--db-timeout-ms', process.env.RAG_DB_TIMEOUT_MS || '10000'));
  const logger = await createLogger('rag_query', logPath);
  logger.info(`Args: slug=${slug ?? '(all)'} topk=${topk} topn=${topn} rerank=${doRerank} distance=${distance}`);

  // Vertex AI options
  const useVertex = (getArg('--vertexai', 'false') || 'false').toLowerCase() === 'true';
  const project = getArg('--project', process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID);
  const location = getArg('--location', process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1');
  const vertexModel = getArg('--vertex-model', process.env.VERTEX_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  const vertexEmbedModel = getArg('--vertex-embed-model', process.env.VERTEX_EMBED_MODEL || model);
  const doExpand = (getArg('--expand', 'false') || 'false').toLowerCase() === 'true';

  const dbHost = getArg('--db-host', process.env.PGHOST || 'localhost');
  const dbPort = Number(getArg('--db-port', process.env.PGPORT || '6432'));
  const dbUser = getArg('--db-user', process.env.PGUSER || 'shadeos');
  const dbPass = getArg('--db-pass', process.env.PGPASSWORD || 'shadeos');
  const dbName = getArg('--db-name', process.env.PGDATABASE || 'shadeos_local');

  // Helper: get Vertex access token
  async function getAccessToken(): Promise<string> {
    const auth = new GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/generative-language.retriever'
      ]
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token || !token.token) throw new Error('Failed to obtain Vertex access token');
    return token.token;
  }

  // Get query embedding (AI Studio or Vertex)
  let values: number[];
  if (useVertex) {
    if (!project) throw new Error('PROJECT_ID/GOOGLE_CLOUD_PROJECT required for --vertexai');
    const token = await getAccessToken();
    const embUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(vertexEmbedModel)}:embedContent`;
    logger.info(`Embedding query via Vertex: model=${vertexEmbedModel}`);
    const embRes = await withTimeout(fetch(embUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: query }] } })
    }), callTimeoutMs, 'embedContent');
    const embJson: any = await embRes.json();
    if (!embRes.ok) throw new Error(`Vertex embedContent failed: ${embRes.status} ${JSON.stringify(embJson).slice(0,200)}`);
    values = embJson?.embedding?.values || embJson?.data?.embedding || embJson?.data?.[0]?.embedding;
  } else {
    if (!geminiKey) throw new Error('GEMINI_API_KEY required (or use --vertexai)');
    logger.info(`Embedding query via AI Studio: model=${model}`);
    const genAI = new GoogleGenerativeAI(geminiKey);
    const embedModel = genAI.getGenerativeModel({ model });
    const embResp: any = await withTimeout(embedModel.embedContent({ content: { parts: [{ text: query }] } }), callTimeoutMs, 'embedContent');
    values = embResp?.embedding?.values || embResp?.data?.embedding || embResp?.data?.[0]?.embedding;
  }
  if (!values || !Array.isArray(values)) throw new Error('Invalid embedding response for query');
  logger.info(`Embedding OK: dim=${values.length}`);

  const qp = vecToPgvectorString(values);

  const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPass, database: dbName });
  await client.connect();
  try {
    // DB statement timeout
    try { await client.query(`SET statement_timeout = ${dbTimeoutMs}`); } catch {}
    // Resolve conversation id if slug provided; else search all
    let convIdCond = '';
    let params: any[] = [qp];
    if (slug) {
      const r = await client.query('SELECT id FROM conversations WHERE slug = $1', [slug]);
      if (r.rowCount === 0) throw new Error(`Conversation not found for slug: ${slug}`);
      params.push(r.rows[0].id);
      convIdCond = 'AND e.conversation_id = $2';
    }

    const orderOp = distance === 'l2' ? '<->' : '<=>'; // l2 distance or cosine distance

    // Optional threshold conditions
  let threshCond = '';
  if (distance === 'cosine' && (minSimArg ?? '')) {
      const minSim = Math.max(0, Math.min(1, Number(minSimArg)));
      const maxDistance = 1 - minSim; // cosine distance threshold
      params.push(maxDistance);
      const pIdx = params.length;
      threshCond = `AND (e.vector ${orderOp} $1::vector) <= $${pIdx}`;
    }
    if (distance === 'l2' && maxDistArg) {
      const maxDist = Math.max(0, Number(maxDistArg));
      params.push(maxDist);
      const pIdx = params.length;
      threshCond = `AND (e.vector ${orderOp} $1::vector) <= $${pIdx}`;
    }

    const limitN = doRerank ? topn : topk;
    const sql = `
      SELECT s.id as summary_id, s.level, s.char_count, s.content, s.covers,
             e.model, e.dim, (e.vector ${orderOp} $1::vector) AS distance
      FROM embeddings e
      JOIN summaries s ON s.id = e.ref_id AND e.ref_type = 'summary'
      WHERE 1=1 ${convIdCond} ${threshCond}
      ORDER BY e.vector ${orderOp} $1::vector
      LIMIT ${limitN}
    `;
    logger.info(`DB query candidates: topN=${limitN} distance=${distance} slug=${slug ?? 'ALL'}`);
    const t0 = Date.now();
    const res = await client.query(sql, params);
    logger.info(`DB returned ${res.rowCount} candidates in ${Date.now()-t0}ms`);
    let rows = res.rows as Array<{summary_id:number, level:number, char_count:number, content:string, covers:number[], model:string, dim:number, distance:number}>;

    if (doRerank) {
      const rerankModelName = useVertex ? (vertexModel) : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');
      let rerankModel: any = null;
      let vertexToken: string | null = null;
      if (useVertex) {
        vertexToken = await getAccessToken();
      } else {
        if (!geminiKey) throw new Error('GEMINI_API_KEY required for rerank (or use --vertexai)');
        const genAI = new GoogleGenerativeAI(geminiKey);
        rerankModel = genAI.getGenerativeModel({ model: rerankModelName });
      }
      const minScore = minScoreArg ? Math.max(0, Math.min(1, Number(minScoreArg))) : 0;
      // Score candidates in small batches
      logger.info(`Rerank start: model=${rerankModelName} batches of ${batchSize}, callTimeoutMs=${callTimeoutMs}`);
      async function scoreOne(q: string, c: { summary_id:number, content:string }) {
        const prompt = `Tu es un reranker. Évalue la pertinence entre la requête et le texte.
 Requête: "${q}"
 Texte:
 """
 ${c.content.slice(0, 1200)}
 """
 Donne uniquement un nombre entre 0 et 1 (format décimal, ex: 0.73) sans texte additionnel.`;
        if (useVertex) {
          const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${encodeURIComponent(rerankModelName)}:generateContent`;
          const payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 16 } };
          const res = await withTimeout(fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${vertexToken}`!, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), callTimeoutMs, 'rerank.generateContent');
          const json: any = await res.json();
          const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
          const m = String(text).match(/\d+(?:\.\d+)?/);
          const score = m ? Math.max(0, Math.min(1, parseFloat(m[0]))) : 0;
          return { id: c.summary_id, score };
        } else {
          const resp = await withTimeout(rerankModel.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }), callTimeoutMs, 'rerank.generateContent');
          const txt = resp?.response?.text?.() || '';
          const m = String(typeof txt === 'function' ? resp.response.text() : txt).match(/\d+(?:\.\d+)?/);
          const score = m ? Math.max(0, Math.min(1, parseFloat(m[0]))) : 0;
          return { id: c.summary_id, score };
        }
      }
      const scored: Array<{id:number, score:number}> = [];
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const started = Date.now();
        await Promise.all(batch.map(async (r) => {
          try {
            const res = await scoreOne(query, { summary_id: r.summary_id, content: r.content });
            scored.push(res);
          } catch (e: any) {
            logger.info(`Rerank error on summary_id=${r.summary_id}: ${e?.message || e}`);
          }
        }));
        logger.info(`Batch scored: ${batch.length} items in ${Date.now()-started}ms (scored so far=${scored.length})`);
      }
      const scoreMap = new Map(scored.map(s => [s.id, s.score] as const));
      rows = rows
        .map(r => ({ ...r, score: scoreMap.get(r.summary_id) ?? 0 }))
        .filter(r => r.score >= minScore)
        .sort((a, b) => (b.score as number) - (a.score as number))
        .slice(0, topk);

      // Export (with optional expansion of covers)
      const fs = await import('fs');
      const path = await import('path');
      const baseExport = exportPath || (doExpand ? 'artefacts/HMM/rag_context' : '');
      if (baseExport) {
        const outDir = baseExport.endsWith('.json') ? path.dirname(baseExport) : baseExport;
        await fs.promises.mkdir(outDir, { recursive: true });
        const outFile = baseExport.endsWith('.json') ? baseExport : path.join(outDir, `rerank_${Date.now()}.json`);

        let expanded: any = undefined;
        if (doExpand) {
          try {
            if (!slug) throw new Error('Cannot expand without --slug');
            const l1Path = path.resolve(process.cwd(), 'artefacts/HMM/compressed', `${slug}.l1.json`);
            const parsedPath = path.resolve(process.cwd(), 'artefacts/HMM/parsed', `${slug}.json`);
            const [l1Raw, parsedRaw] = await Promise.all([
              fs.promises.readFile(l1Path, 'utf8'),
              fs.promises.readFile(parsedPath, 'utf8'),
            ]);
            const parsed = JSON.parse(parsedRaw);
            const itemsById = new Map<number, any>();
            for (const it of parsed.items) itemsById.set(it.index, it);
            const coverSet = new Set<number>();
            for (const it of rows as any) {
              const covers = (it.covers || []) as number[];
              for (const idx of covers) coverSet.add(idx);
            }
            const messages = Array.from(coverSet).sort((a, b) => a - b).map(i => {
              const m = itemsById.get(i);
              return m ? { index: m.index, role: m.role, charCount: m.charCount, content: m.content } : null;
            }).filter(Boolean);
            expanded = { totalMessages: messages.length, messages };
          } catch (e) {
            expanded = { error: String(e) };
          }
        }

        await fs.promises.writeFile(outFile, JSON.stringify({ query, distance, minSimArg, minScore, topk, topn, vertexai: useVertex, items: rows, expanded }, null, 2), 'utf8');
        console.log(`Export rerank: ${outFile}`);
        logger.info(`Exported rerank to ${outFile}`);
      }
    }

    for (const row of rows) {
      const dist = Number(row.distance);
      const extra = distance === 'cosine' ? ` sim=${(1 - dist).toFixed(4)}` : '';
      const scoreStr = (row as any).score != null ? ` score=${(row as any).score.toFixed(3)}` : '';
      console.log(`summary_id=${row.summary_id} L${row.level} dim=${row.dim} dist=${dist.toFixed(4)}${extra}${scoreStr} model=${row.model}`);
      console.log(String(row.content).slice(0, 220).replace(/\s+/g, ' ') + '...');
      console.log('---');
    }
  } finally {
    await client.end();
    await logger.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
