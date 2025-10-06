import { promises as fs } from 'fs';
import * as path from 'path';
import { PgRagIndex } from '@/lib/rag/indexPg';
import { IRagQuery, RagPolicy, Candidate } from '@/lib/rag/types';
import { VertexEmbedder, StudioEmbedder } from '@/lib/rag/embedder';

export type RagAnswerOptions = {
  slug: string;
  query: IRagQuery;
  planPath?: string;
  useVertex?: boolean;
  composePrompt?: boolean;
  exportPrompt?: boolean;
};

export async function ragAnswer(opts: RagAnswerOptions): Promise<{ picks: { high: Candidate[]; low: Candidate[] }; diagnostics: any; quotes?: any[]; promptURI?: string; } > {
  const planJson = await loadPlan(opts.planPath);
  const embedder = (planJson?.useVertex != null ? !!planJson.useVertex : !!opts.useVertex)
    ? new VertexEmbedder(process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID)
    : new StudioEmbedder(process.env.GEMINI_API_KEY);
  const [vec] = await embedder.embed([opts.query.text]);

  const policy = defaultPolicy(opts.query.intent || 'auto');
  const effectivePolicy: RagPolicy = mergePolicy(policy, planJson?.policy);

  const index = new PgRagIndex();
  await index.connect();
  try {
    const levels = Object.keys(effectivePolicy.levelQuotas).map(n => Number(n)).sort((a,b)=>b-a);
    const convId = await index.getConversationIdBySlug(opts.slug);
    const initial = await index.search(levels, vec, {
      topk: effectivePolicy.topkInitial,
      conversationId: convId ?? undefined,
      tagsAny: opts.query.hints?.tags,
      entitiesAny: opts.query.hints?.entities,
      timeWindow: opts.query.timeWindow ? { from: opts.query.timeWindow.from?.toISOString(), to: opts.query.timeWindow.to?.toISOString() } : undefined
    });

    const withSim = (initial as any[]).map(c => ({ ...c, sim: c.score || 0 }));
    let scored = scoreAndDiversify(withSim as any, effectivePolicy);

    const budget = (planJson?.budget?.tokens || opts.query.budget?.tokens || 'medium') as ('small'|'medium'|'large');
    if (planJson?.acceptance?.minSimBase != null) {
      const minSimBase = planJson.acceptance.minSimBase;
      const scarcity = budget === 'small' ? 1 : budget === 'medium' ? 0.5 : 0;
      const minSim = Math.max(0, Math.min(1, minSimBase - (planJson.acceptance.scarcityBoost ?? 0.08) * scarcity));
      const explSlots = Math.max(0, Math.floor(planJson.acceptance.explorationSlots ?? (budget === 'small' ? 2 : 1)));
      const passed = (scored as any[]).filter(c => (c.sim ?? 0) >= minSim);
      const rejected = (scored as any[]).filter(c => (c.sim ?? 0) < minSim);
      scored = [...passed, ...rejected.slice(0, explSlots)] as any;
    }

    const topHigh = pickHighLevel(scored, effectivePolicy);
    const covers = unionCovers(topHigh);
    const meanHighSim = topHigh.length ? (topHigh as any[]).reduce((a, x) => a + (x.sim ?? 0), 0) / topHigh.length : 0;
    const shouldDrill = (
      (planJson?.decompression?.enableLkToL1 ?? effectivePolicy.expand.coversOnly) &&
      covers.length &&
      (meanHighSim < (planJson?.decompression?.triggers?.meanSimLt ?? 1.0))
    );
    let didDrill = false;
    let expanded: Candidate[] = [];
    if (shouldDrill) {
      const low = await index.search([1], vec, {
        topk: effectivePolicy.topkDrill,
        scopeCovers: covers,
        conversationId: convId ?? undefined,
        tagsAny: opts.query.hints?.tags,
        entitiesAny: opts.query.hints?.entities,
        timeWindow: opts.query.timeWindow ? { from: opts.query.timeWindow.from?.toISOString(), to: opts.query.timeWindow.to?.toISOString() } : undefined
      });
      expanded = mergeUnique(scored, low);
      didDrill = true;
    } else {
      expanded = scored;
    }

    let reranked = expanded;
    if (effectivePolicy.rerank.stage1) reranked = simpleStage1Rerank(reranked, effectivePolicy);
    if (effectivePolicy.rerank.stage2) reranked = await stage2RerankMMR(reranked, effectivePolicy, embedder, opts.query.text);

    const bundle = composeContext(reranked, effectivePolicy);

    let quotes: Array<{ level: number; index: number|null; excerpt: string; sim?: number }> = [];
    if (planJson?.expandPolicy?.quotesFromL1) {
      const maxQ = Math.max(0, Math.floor(planJson.expandPolicy.quotesMax || 20));
      const unique: any[] = [];
      const seen = new Set<number>();
      for (const h of bundle.low || []) {
        if (h.index != null && !seen.has(h.index)) { seen.add(h.index); unique.push(h); }
        if (unique.length >= maxQ) break;
      }
      quotes = unique.map(u => ({ level: 1, index: u.index ?? null, excerpt: (u.content || '').slice(0, 320), sim: (u as any).sim }));
    }

    let promptURI: string | undefined;
    if (opts.composePrompt || opts.exportPrompt || planJson?.composePrompt) {
      const prompt = composeFinalPrompt({ picks: bundle, quotes }, opts.query);
      // Export prompt to artefacts like scripts/rag_answer.ts
      try {
        const dir = path.resolve(process.cwd(), `artefacts/HMM/composed_prompt/${opts.slug}`);
        await fs.mkdir(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:]/g, '-');
        const file = path.join(dir, `prompt_${ts}.txt`);
        await fs.writeFile(file, prompt, 'utf8');
        await fs.writeFile(path.join(dir, 'latest.txt'), prompt, 'utf8');
        promptURI = file;
      } catch {}
    }

    const diagnostics = { budget: budget, meanHighSim, didDrill, expandedTimeWindow: false, counts: { high: bundle.high.length, low: bundle.low.length } };
    return { picks: bundle as any, diagnostics, quotes, promptURI };
  } finally {
    await index.close();
  }
}

function defaultPolicy(intent: IRagQuery['intent']): RagPolicy {
  return intent === 'synthesis'
    ? { levelQuotas: { 3: 6, 2: 4, 1: 2 }, weights: { similarity: 1, level: 0.2, recency: 0.1, diversity: 0.3 }, expand: { coversOnly: true, perGroupTopM: 3 }, rerank: { stage1: true, stage2: true, topnFinal: 12 }, compose: { maxHigh: 4, maxLow: 8 }, topkInitial: 32, topkDrill: 24 }
    : intent === 'detail'
      ? { levelQuotas: { 1: 8, 2: 3, 3: 1 }, weights: { similarity: 1, level: -0.1, recency: 0.2, diversity: 0.2 }, expand: { coversOnly: true, perGroupTopM: 4 }, rerank: { stage1: true, stage2: true, topnFinal: 16 }, compose: { maxHigh: 3, maxLow: 10, maxRaw: 3 }, topkInitial: 40, topkDrill: 40 }
      : { levelQuotas: { 2: 4, 1: 8 }, weights: { similarity: 1, level: 0, recency: 0.4, diversity: 0.2 }, expand: { coversOnly: true, perGroupTopM: 3 }, rerank: { stage1: true, stage2: false, topnFinal: 12 }, compose: { maxHigh: 3, maxLow: 8 }, topkInitial: 32, topkDrill: 32 };
}

function mergePolicy(base: RagPolicy, patch?: Partial<RagPolicy>): RagPolicy { if (!patch) return base; return { levelQuotas: patch.levelQuotas || base.levelQuotas, weights: patch.weights ? { ...base.weights, ...patch.weights } : base.weights, expand: patch.expand ? { ...base.expand, ...patch.expand } : base.expand, rerank: patch.rerank ? { ...base.rerank, ...patch.rerank } : base.rerank, compose: patch.compose ? { ...base.compose, ...patch.compose } : base.compose, topkInitial: patch.topkInitial != null ? patch.topkInitial : base.topkInitial, topkDrill: patch.topkDrill != null ? patch.topkDrill : base.topkDrill }; }

async function loadPlan(planPath?: string): Promise<any | null> { if (!planPath) return null; try { const abs = path.resolve(process.cwd(), planPath); const raw = await fs.readFile(abs, 'utf8'); return JSON.parse(raw); } catch { return null; } }

function scoreAndDiversify(cands: Candidate[], policy: RagPolicy): Candidate[] { const now = Date.now(); const withScores = cands.map(c => ({ ...c, score: combineScore(c, policy, now) })); return withScores.sort((a,b) => (b.score! - a.score!) || (b.level - a.level)); }
function combineScore(c: Candidate, policy: RagPolicy, nowMs: number): number { const sim = Math.max(0, Math.min(1, (c as any).sim ?? (c as any).score ?? 0)); const levelPrior = c.level >= 2 ? 1 : 0; let recency = 0; if (c.recencyTs) { const ts = new Date(c.recencyTs).getTime(); const days = Math.max(0, (nowMs - ts)/(1000*60*60*24)); const halflife = 30; const decay = Math.pow(0.5, days/halflife); recency = decay; } return policy.weights.similarity * sim + policy.weights.level * levelPrior + policy.weights.recency * recency; }
function pickHighLevel(cands: Candidate[], policy: RagPolicy): Candidate[] { const quota = Object.entries(policy.levelQuotas).reduce((a,[lvl,q])=>{const L=Number(lvl); if(L>=2)a+=(q||0); return a;},0); return cands.filter(c=>c.level>=2).slice(0, Math.max(0, quota)); }
function unionCovers(items: Candidate[]): number[] { const set = new Set<number>(); for (const it of items) for (const n of (it.covers || [])) set.add(n); return Array.from(set).sort((a,b)=>a-b); }
function mergeUnique(base: Candidate[], extra: Candidate[]): Candidate[] { const map = new Map<number, Candidate>(); for (const c of base) map.set(c.id, c); for (const e of extra) { const cur = map.get(e.id); if (!cur || (e.score || 0) > (cur.score || 0)) map.set(e.id, e); } return Array.from(map.values()).sort((a,b)=> (b.score||0) - (a.score||0)); }
function simpleStage1Rerank(cands: Candidate[], policy: RagPolicy): Candidate[] { const quotas = new Map<number, number>(Object.entries(policy.levelQuotas).map(([k,v])=>[Number(k), v as number])); const chosen: Candidate[] = []; for (const c of cands) { const q = quotas.get(c.level) ?? 0; const used = chosen.filter(x => x.level === c.level).length; if (used < q) chosen.push(c); } const remaining = cands.filter(c => !chosen.find(x => x.id === c.id)); const capacity = Object.values(policy.levelQuotas).reduce((a,b)=>a+(b||0),0); const extra = remaining.slice(0, Math.max(0, capacity - chosen.length)); return [...chosen, ...extra]; }
async function stage2RerankMMR(cands: Candidate[], policy: RagPolicy, embedder: any, queryText: string): Promise<Candidate[]> { const top = cands.slice(0, policy.rerank.topnFinal); const texts = top.map(t => t.content.slice(0, 1200)); const embs = await embedder.embed(texts); const lambda = Math.max(0, Math.min(1, policy.weights.diversity || 0.3)); const order = mmr(embs, Math.min(embs.length, policy.rerank.topnFinal), lambda); const reordered = order.map(i => top[i]); return [...reordered, ...cands.slice(policy.rerank.topnFinal)]; }
function cosine(a: number[], b: number[]): number { let s=0,na=0,nb=0; for (let i=0;i<a.length;i++){ const x=a[i]||0, y=b[i]||0; s+=x*y; na+=x*x; nb+=y*y; } return s / (Math.sqrt(na||1)*Math.sqrt(nb||1)); }
function mmr(embs: number[][], k: number, lambda: number): number[] { const n = embs.length; if (!n) return []; const sims: number[][] = Array.from({length:n}, ()=>Array(n).fill(0)); for (let i=0;i<n;i++) for (let j=i+1;j<n;j++){ const c=cosine(embs[i], embs[j]); sims[i][j]=c; sims[j][i]=c; } const selected: number[] = []; const remaining = new Set<number>(Array.from({length:n}, (_,i)=>i)); let best=0,bestVal=-Infinity; for (let i=0;i<n;i++){ let v=0; for (let j=0;j<n;j++) v+= sims[i][j]; if (v>bestVal){bestVal=v; best=i;} } selected.push(best); remaining.delete(best); while (selected.length < Math.min(k, n) && remaining.size) { let pick=-1, score=-Infinity; for (const i of remaining) { const relevance = 1; let maxRed=0; for (const s of selected) maxRed = Math.max(maxRed, sims[i][s]); const mmrScore = lambda*relevance - (1-lambda)*maxRed; if (mmrScore > score) { score=mmrScore; pick=i; } } selected.push(pick); remaining.delete(pick); } return selected; }
function composeContext(cands: Candidate[], policy: RagPolicy): { high: Candidate[]; low: Candidate[] } { const high = cands.filter(c => c.level >= 2).slice(0, policy.compose.maxHigh); const low = cands.filter(c => c.level === 1).slice(0, policy.compose.maxLow); return { high, low }; }
function composeFinalPrompt(output: any, query: IRagQuery): string { const parts: string[] = []; parts.push('# Contexte Hiérarchique'); parts.push('## High-level (Lk)'); for (const h of output.picks.high || []) { parts.push(`- [L${h.level} #${h.index ?? '?'} | score=${(h.score||0).toFixed(3)}]`); parts.push(limitText(h.content, 800)); } parts.push('\n## Détails (L1)'); for (const l of output.picks.low || []) { parts.push(`- [L1 #${l.index ?? '?'} | score=${(l.score||0).toFixed(3)}]`); parts.push(limitText(l.content, 800)); } if (output.quotes && Array.isArray(output.quotes) && output.quotes.length) { parts.push('\n## Extraits (L1)'); for (const q of output.quotes) { const sim = (q.sim != null) ? ` | sim=${Number(q.sim).toFixed(3)}` : ''; parts.push(`- [L1 #${q.index ?? '?'}${sim}] ${limitText(q.excerpt || '', 320)}`); } } parts.push('\n## Question'); parts.push(query.text || ''); return parts.join('\n'); }
function limitText(s: string, max: number): string { if (!s) return ''; return s.length > max ? (s.slice(0, max) + '…') : s; }

