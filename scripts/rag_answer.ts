import 'dotenv/config';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import * as path from 'path';
try { dotenv.config({ path: '.env.local' }); } catch {}
import { PgRagIndex } from '@/lib/rag/indexPg';
import { IRagQuery, RagPolicy, Candidate } from '@/lib/rag/types';
import { StudioEmbedder, VertexEmbedder } from '@/lib/rag/embedder';

function getArg(args: string[], name: string, def?: string) { const i = args.indexOf(name); return i !== -1 && i + 1 < args.length ? args[i + 1] : def; }

async function main() {
  const args = process.argv.slice(2);
  const slug = getArg(args, '--slug');
  const text = getArg(args, '--query', '');
  const intent = (getArg(args, '--intent', 'auto') || 'auto') as IRagQuery['intent'];
  const useVertex = (getArg(args, '--vertexai', 'false') || 'false').toLowerCase() === 'true';
  const exportFlag = args.includes('--export');
  const exportArg = getArg(args, '--export');

  const query: IRagQuery = { text, intent, budget: { tokens: 'medium' } };
  const policy: RagPolicy = intent === 'synthesis'
    ? { levelQuotas: { 3: 6, 2: 4, 1: 2 }, weights: { similarity: 1, level: 0.2, recency: 0.1, diversity: 0.3 }, expand: { coversOnly: true, perGroupTopM: 3 }, rerank: { stage1: true, stage2: true, topnFinal: 12 }, compose: { maxHigh: 4, maxLow: 8 }, topkInitial: 32, topkDrill: 24 }
    : intent === 'detail'
      ? { levelQuotas: { 1: 8, 2: 3, 3: 1 }, weights: { similarity: 1, level: -0.1, recency: 0.2, diversity: 0.2 }, expand: { coversOnly: true, perGroupTopM: 4 }, rerank: { stage1: true, stage2: true, topnFinal: 16 }, compose: { maxHigh: 3, maxLow: 10, maxRaw: 3 }, topkInitial: 40, topkDrill: 40 }
      : { levelQuotas: { 2: 4, 1: 8 }, weights: { similarity: 1, level: 0, recency: 0.4, diversity: 0.2 }, expand: { coversOnly: true, perGroupTopM: 3 }, rerank: { stage1: true, stage2: false, topnFinal: 12 }, compose: { maxHigh: 3, maxLow: 8 }, topkInitial: 32, topkDrill: 32 };

  const embedder = useVertex ? new VertexEmbedder(process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID) : new StudioEmbedder(process.env.GEMINI_API_KEY);
  const [vec] = await embedder.embed([query.text]);

  const index = new PgRagIndex();
  await index.connect();
  try {
    const levels = Object.keys(policy.levelQuotas).map(n => Number(n)).sort((a,b)=>b-a);
    const convId = slug ? await index.getConversationIdBySlug(slug) : null;
    const initial = await index.search(levels, vec, { topk: policy.topkInitial, conversationId: convId ?? undefined });

    // Stage A: score combination and diversity (light)
    const scored = scoreAndDiversify(initial, policy);

    // Stage B: drill-down covers-only from high-level winners
    const topHigh = pickHighLevel(scored, policy);
    const covers = unionCovers(topHigh);
    let expanded: Candidate[] = [];
    if (policy.expand.coversOnly && covers.length) {
      const low = await index.search([1], vec, { topk: policy.topkDrill, scopeCovers: covers, conversationId: convId ?? undefined });
      expanded = mergeUnique(scored, low);
    } else {
      expanded = scored;
    }

    // Stage C: reranking stage1/2
    let reranked = expanded;
    if (policy.rerank.stage1) reranked = simpleStage1Rerank(reranked, policy);
    if (policy.rerank.stage2) reranked = await stage2RerankMMR(reranked, policy, embedder, query.text);

    // Stage D: compose context
    const bundle = composeContext(reranked, policy);
    const output = {
      ts: new Date().toISOString(),
      plan: { slug, intent, levels, policy },
      picks: {
        high: bundle.high.map(p => ({ id: p.id, level: p.level, index: p.index, score: p.score, charCount: p.charCount, covers: p.covers || [], content: p.content })),
        low: bundle.low.map(p => ({ id: p.id, level: p.level, index: p.index, score: p.score, charCount: p.charCount, covers: p.covers || [], content: p.content }))
      },
      coversUnion: covers
    };
    if (exportFlag) {
      const baseDir = path.resolve(process.cwd(), 'artefacts/HMM/rag_context', slug || 'default');
      await fs.mkdir(baseDir, { recursive: true });
      const outPath = exportArg && exportArg !== 'true' && exportArg !== '1'
        ? path.resolve(process.cwd(), exportArg)
        : path.join(baseDir, `rerank_${Date.now()}.json`);
      await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf8');
      console.log(`Exported RAG bundle → ${outPath}`);
    } else {
      console.log(JSON.stringify({ plan: output.plan, picks: {
        high: output.picks.high.map(p => ({ id: p.id, level: p.level, score: p.score })),
        low: output.picks.low.map(p => ({ id: p.id, level: p.level, score: p.score }))
      } }, null, 2));
    }
  } finally {
    await index.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

// ===== Helpers =====

function scoreAndDiversify(cands: Candidate[], policy: RagPolicy): Candidate[] {
  const now = Date.now();
  const withScores = cands.map(c => ({ ...c, score: combineScore(c, policy, now) }));
  // light diversity: stable sort by score then prefer different levels if same score
  return withScores.sort((a,b) => (b.score! - a.score!) || (b.level - a.level));
}

function combineScore(c: Candidate, policy: RagPolicy, nowMs: number): number {
  const sim = Math.max(0, Math.min(1, c.score ?? 0));
  const levelPrior = c.level >= 2 ? 1 : 0; // simple prior: high-level gets +weight when relevant
  const recency = 0; // placeholder without timestamps
  return policy.weights.similarity * sim + policy.weights.level * levelPrior + policy.weights.recency * recency;
}

function pickHighLevel(cands: Candidate[], policy: RagPolicy): Candidate[] {
  const quota = Object.entries(policy.levelQuotas).reduce((acc,[lvl,q]) => { const L=Number(lvl); if (L>=2) acc+= (q||0); return acc; }, 0);
  const highs = cands.filter(c => c.level >= 2).slice(0, Math.max(0, quota));
  return highs;
}

function unionCovers(items: Candidate[]): number[] {
  const set = new Set<number>();
  for (const it of items) {
    for (const n of (it.covers || [])) set.add(n);
  }
  return Array.from(set).sort((a,b)=>a-b);
}

function mergeUnique(base: Candidate[], extra: Candidate[]): Candidate[] {
  const map = new Map<number, Candidate>();
  for (const c of base) map.set(c.id, c);
  for (const e of extra) {
    const cur = map.get(e.id);
    if (!cur || (e.score || 0) > (cur.score || 0)) map.set(e.id, e);
  }
  return Array.from(map.values()).sort((a,b)=> (b.score||0) - (a.score||0));
}

function simpleStage1Rerank(cands: Candidate[], policy: RagPolicy): Candidate[] {
  // keep top by existing score; ensure level quotas roughly respected
  const quotas = new Map<number, number>(Object.entries(policy.levelQuotas).map(([k,v])=>[Number(k), v as number]));
  const chosen: Candidate[] = [];
  for (const c of cands) {
    const q = quotas.get(c.level) ?? 0;
    const used = chosen.filter(x => x.level === c.level).length;
    if (used < q) chosen.push(c);
  }
  // fill remaining with best others
  const remaining = cands.filter(c => !chosen.find(x => x.id === c.id));
  const capacity = Object.values(policy.levelQuotas).reduce((a,b)=>a+(b||0),0);
  const extra = remaining.slice(0, Math.max(0, capacity - chosen.length));
  return [...chosen, ...extra];
}

async function stage2RerankMMR(cands: Candidate[], policy: RagPolicy, embedder: any, queryText: string): Promise<Candidate[]> {
  const top = cands.slice(0, policy.rerank.topnFinal);
  const texts = top.map(t => t.content.slice(0, 1200));
  const embs = await embedder.embed(texts);
  // MMR selection
  const lambda = Math.max(0, Math.min(1, policy.weights.diversity || 0.3));
  const order = mmr(embs, Math.min(embs.length, policy.rerank.topnFinal), lambda);
  const reordered = order.map(i => top[i]);
  // keep rest as is
  return [...reordered, ...cands.slice(policy.rerank.topnFinal)];
}

function cosine(a: number[], b: number[]): number {
  let s=0, na=0, nb=0; for (let i=0;i<a.length;i++){ const x=a[i]||0, y=b[i]||0; s+=x*y; na+=x*x; nb+=y*y; } return s / (Math.sqrt(na||1)*Math.sqrt(nb||1));
}

function mmr(embs: number[][], k: number, lambda: number): number[] {
  const n = embs.length; if (!n) return [];
  const sims: number[][] = Array.from({length:n}, ()=>Array(n).fill(0));
  for (let i=0;i<n;i++) for (let j=i+1;j<n;j++){ const c=cosine(embs[i], embs[j]); sims[i][j]=c; sims[j][i]=c; }
  const selected: number[] = [];
  const remaining = new Set<number>(Array.from({length:n}, (_,i)=>i));
  // seed by max average similarity
  let best = 0, bestVal = -Infinity;
  for (let i=0;i<n;i++){ let v=0; for (let j=0;j<n;j++) v+= sims[i][j]; if (v>bestVal){bestVal=v; best=i;} }
  selected.push(best); remaining.delete(best);
  while (selected.length < Math.min(k, n) && remaining.size) {
    let pick = -1; let score=-Infinity;
    for (const i of remaining) {
      const relevance = 1; // fallback; stage1 accounted for sim already
      let maxRedundancy = 0; for (const s of selected) maxRedundancy = Math.max(maxRedundancy, sims[i][s]);
      const mmrScore = lambda*relevance - (1-lambda)*maxRedundancy;
      if (mmrScore > score) { score=mmrScore; pick=i; }
    }
    selected.push(pick); remaining.delete(pick);
  }
  return selected;
}

function composeContext(cands: Candidate[], policy: RagPolicy): { high: Candidate[]; low: Candidate[] } {
  const high = cands.filter(c => c.level >= 2).slice(0, policy.compose.maxHigh);
  const low = cands.filter(c => c.level === 1).slice(0, policy.compose.maxLow);
  return { high, low };
}
