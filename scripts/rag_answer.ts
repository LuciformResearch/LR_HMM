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
  const tagsArg = getArg(args, '--tags');
  const entitiesArg = getArg(args, '--entities');
  const fromArg = getArg(args, '--from');
  const toArg = getArg(args, '--to');
  const composePrompt = args.includes('--compose-prompt');
  const exportPromptFlag = args.includes('--export-prompt');
  const exportPromptArg = getArg(args, '--export-prompt');
  const planArg = getArg(args, '--plan');

  const query: IRagQuery = {
    text,
    intent,
    budget: { tokens: 'medium' },
    timeWindow: (fromArg || toArg) ? { from: fromArg ? new Date(fromArg) : undefined, to: toArg ? new Date(toArg) : undefined } : undefined,
    hints: {
      tags: tagsArg ? tagsArg.split(',').map(s=>s.trim()).filter(Boolean) : undefined,
      entities: entitiesArg ? entitiesArg.split(',').map(s=>s.trim()).filter(Boolean) : undefined,
    }
  };
  // Optional plan overrides
  let planJson: any = null;
  if (planArg) {
    const abs = path.resolve(process.cwd(), planArg);
    try {
      const rawPlan = await fs.readFile(abs, 'utf8');
      planJson = JSON.parse(rawPlan);
    } catch (e) {
      console.error(`Failed to read plan file: ${planArg}`, e);
    }
  }
  if (planJson?.query) {
    if (typeof planJson.query.text === 'string') query.text = planJson.query.text;
    if (typeof planJson.query.intent === 'string') query.intent = planJson.query.intent as any;
    if (planJson.query.hints) {
      query.hints = query.hints || {} as any;
      if (Array.isArray(planJson.query.hints.tags)) query.hints!.tags = planJson.query.hints.tags;
      if (Array.isArray(planJson.query.hints.entities)) query.hints!.entities = planJson.query.hints.entities;
    }
    if (planJson.query.timeWindow) {
      query.timeWindow = {
        from: planJson.query.timeWindow.from ? new Date(planJson.query.timeWindow.from) : undefined,
        to: planJson.query.timeWindow.to ? new Date(planJson.query.timeWindow.to) : undefined,
      };
    }
  }

  const policy: RagPolicy = (query.intent || 'auto') === 'synthesis'
    ? { levelQuotas: { 3: 6, 2: 4, 1: 2 }, weights: { similarity: 1, level: 0.2, recency: 0.1, diversity: 0.3 }, expand: { coversOnly: true, perGroupTopM: 3 }, rerank: { stage1: true, stage2: true, topnFinal: 12 }, compose: { maxHigh: 4, maxLow: 8 }, topkInitial: 32, topkDrill: 24 }
    : (query.intent || 'auto') === 'detail'
      ? { levelQuotas: { 1: 8, 2: 3, 3: 1 }, weights: { similarity: 1, level: -0.1, recency: 0.2, diversity: 0.2 }, expand: { coversOnly: true, perGroupTopM: 4 }, rerank: { stage1: true, stage2: true, topnFinal: 16 }, compose: { maxHigh: 3, maxLow: 10, maxRaw: 3 }, topkInitial: 40, topkDrill: 40 }
      : { levelQuotas: { 2: 4, 1: 8 }, weights: { similarity: 1, level: 0, recency: 0.4, diversity: 0.2 }, expand: { coversOnly: true, perGroupTopM: 3 }, rerank: { stage1: true, stage2: false, topnFinal: 12 }, compose: { maxHigh: 3, maxLow: 8 }, topkInitial: 32, topkDrill: 32 };

  // Merge policy overrides from plan if provided
  let effectivePolicy: RagPolicy = policy;
  if (planJson?.policy) {
    const p = planJson.policy;
    effectivePolicy = {
      levelQuotas: p.levelQuotas || policy.levelQuotas,
      weights: p.weights ? { ...policy.weights, ...p.weights } : policy.weights,
      expand: p.expand ? { ...policy.expand, ...p.expand } : policy.expand,
      rerank: p.rerank ? { ...policy.rerank, ...p.rerank } : policy.rerank,
      compose: p.compose ? { ...policy.compose, ...p.compose } : policy.compose,
      topkInitial: p.topkInitial != null ? p.topkInitial : policy.topkInitial,
      topkDrill: p.topkDrill != null ? p.topkDrill : policy.topkDrill,
    } as RagPolicy;
  }

  const embedder = (planJson?.useVertex != null ? !!planJson.useVertex : useVertex)
    ? new VertexEmbedder(process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID)
    : new StudioEmbedder(process.env.GEMINI_API_KEY);
  const [vec] = await embedder.embed([query.text]);

  const index = new PgRagIndex();
  await index.connect();
  try {
    const levels = Object.keys(effectivePolicy.levelQuotas).map(n => Number(n)).sort((a,b)=>b-a);
    const convId = slug ? await index.getConversationIdBySlug(slug) : null;
    const initial = await index.search(levels, vec, {
      topk: effectivePolicy.topkInitial,
      conversationId: convId ?? undefined,
      tagsAny: query.hints?.tags,
      entitiesAny: query.hints?.entities,
      timeWindow: query.timeWindow ? { from: query.timeWindow.from?.toISOString(), to: query.timeWindow.to?.toISOString() } : undefined
    });

    // Stage A: preserve raw sim and score + diversity
    const withSim = (initial as any[]).map(c => ({ ...c, sim: c.score || 0 }));
    let scored = scoreAndDiversify(withSim as any, effectivePolicy);

    // Budget-aware acceptance + exploration (if planner provided)
    const budget = (planJson?.budget?.tokens || query.budget?.tokens || 'medium') as ('small'|'medium'|'large');
    const scarcity = budget === 'small' ? 1 : budget === 'medium' ? 0.5 : 0;
    if (planJson?.acceptance?.minSimBase != null) {
      const minSimBase = planJson.acceptance.minSimBase;
      const scarcityBoost = planJson.acceptance.scarcityBoost ?? 0.08;
      const minSim = Math.max(0, Math.min(1, minSimBase - scarcityBoost * scarcity));
      const explorationSlots = Math.max(0, Math.floor(planJson.acceptance.explorationSlots ?? (budget === 'small' ? 2 : 1)));
      const passed = (scored as any[]).filter(c => (c.sim ?? 0) >= minSim);
      const rejected = (scored as any[]).filter(c => (c.sim ?? 0) < minSim);
      const exploratory = rejected.slice(0, explorationSlots);
      scored = [...passed, ...exploratory] as any;
    }

    // Stage B: drill-down covers-only from high-level winners
    const topHigh = pickHighLevel(scored, effectivePolicy);
    const covers = unionCovers(topHigh);
    let expanded: Candidate[] = [];
    // Decompression triggers: planner can override default coversOnly
    const meanHighSim = topHigh.length ? (topHigh as any[]).reduce((a, x) => a + (x.sim ?? 0), 0) / topHigh.length : 0;
    const shouldDrill = (
      (planJson?.decompression?.enableLkToL1 ?? effectivePolicy.expand.coversOnly) &&
      covers.length &&
      (meanHighSim < (planJson?.decompression?.triggers?.meanSimLt ?? 1.0))
    );
    let didDrill = false;
    if (shouldDrill) {
      const low = await index.search([1], vec, {
        topk: effectivePolicy.topkDrill,
        scopeCovers: covers,
        conversationId: convId ?? undefined,
        tagsAny: query.hints?.tags,
        entitiesAny: query.hints?.entities,
        timeWindow: query.timeWindow ? { from: query.timeWindow.from?.toISOString(), to: query.timeWindow.to?.toISOString() } : undefined
      });
      expanded = mergeUnique(scored, low);
      didDrill = true;
    } else {
      expanded = scored;
    }

    // Optional: expand time window and retry retrieval if saturation is low
    let expandedTimeWindowApplied = false;
    if (planJson?.decompression?.timeWindowExpandHours && meanHighSim < (planJson?.decompression?.triggers?.meanSimLt ?? 0.75) && query.timeWindow?.from && query.timeWindow?.to) {
      try {
        const hours = Math.max(1, Number(planJson.decompression.timeWindowExpandHours || 0));
        const fromTs = new Date(query.timeWindow.from.getTime() - hours*60*60*1000);
        const toTs = new Date(query.timeWindow.to.getTime() + hours*60*60*1000);
        const initialExt = await index.search(levels, vec, {
          topk: effectivePolicy.topkInitial,
          conversationId: convId ?? undefined,
          tagsAny: query.hints?.tags,
          entitiesAny: query.hints?.entities,
          timeWindow: { from: fromTs.toISOString(), to: toTs.toISOString() }
        });
        const withSim2 = (initialExt as any[]).map(c => ({ ...c, sim: c.score || 0 }));
        let rescored = scoreAndDiversify(withSim2 as any, effectivePolicy);
        if (planJson?.acceptance?.minSimBase != null) {
          const minSimBase2 = planJson.acceptance.minSimBase;
          const scarcityBoost2 = planJson.acceptance.scarcityBoost ?? 0.08;
          const minSim2 = Math.max(0, Math.min(1, minSimBase2 - scarcityBoost2 * (budget === 'small' ? 1 : budget === 'medium' ? 0.5 : 0)));
          const exploration2 = Math.max(0, Math.floor(planJson.acceptance.explorationSlots ?? (budget === 'small' ? 2 : 1)));
          const pass2 = (rescored as any[]).filter(c => (c.sim ?? 0) >= minSim2);
          const rej2 = (rescored as any[]).filter(c => (c.sim ?? 0) < minSim2);
          rescored = [...pass2, ...rej2.slice(0, exploration2)] as any;
        }
        // Merge with current expanded list and continue
        expanded = mergeUnique(expanded, rescored as any);
        expandedTimeWindowApplied = true;
      } catch {}
    }

    // Stage C: reranking stage1/2
    let reranked = expanded;
    if (effectivePolicy.rerank.stage1) reranked = simpleStage1Rerank(reranked, effectivePolicy);
    if (effectivePolicy.rerank.stage2) reranked = await stage2RerankMMR(reranked, effectivePolicy, embedder, query.text);

    // Stage D: compose context
    const bundle = composeContext(reranked, effectivePolicy);
    // Optional quotes from L1 covers (deduplicated by index)
    let quotes: Array<{ level: number; index: number|null; excerpt: string; sim?: number }> = [];
    if (planJson?.expandPolicy?.enableCovers) {
      const perHigh = Math.max(0, Math.floor(planJson.expandPolicy.quotesPerHigh ?? 2));
      const maxChars = Math.max(80, Math.floor(planJson.expandPolicy.quoteMaxChars ?? 300));
      const lowL1 = bundle.low.filter(x => x.level === 1);
      const seen = new Set<number>();
      for (const h of bundle.high as any[]) {
        const picks = lowL1.filter(l => (h.covers || []).includes(l.index as any)).slice(0, perHigh);
        for (const p of picks as any[]) {
          const idx = (p.index ?? -1) as number;
          if (idx >= 0 && seen.has(idx)) continue;
          seen.add(idx);
          quotes.push({ level: p.level, index: p.index ?? null, excerpt: (p.content||'').slice(0, maxChars), sim: (p as any).sim });
        }
      }
    }
    const output = {
      ts: new Date().toISOString(),
      plan: { slug, intent, levels, policy: effectivePolicy, planner: planJson || null },
      picks: {
        high: bundle.high.map(p => ({ id: p.id, level: p.level, index: p.index, score: p.score, charCount: p.charCount, covers: p.covers || [], content: p.content })),
        low: bundle.low.map(p => ({ id: p.id, level: p.level, index: p.index, score: p.score, charCount: p.charCount, covers: p.covers || [], content: p.content }))
      },
      quotes,
      coversUnion: covers,
      diagnostics: {
        budget,
        meanHighSim,
        didDrill,
        expandedTimeWindow: expandedTimeWindowApplied,
        quotesCount: quotes.length
      }
    };
    if (composePrompt || exportPromptFlag || (exportPromptArg && exportPromptArg !== 'true' && exportPromptArg !== '1')) {
      const prompt = composeFinalPrompt(output, query);
      // Save prompt if requested
      if (exportPromptFlag || (exportPromptArg && exportPromptArg !== 'true' && exportPromptArg !== '1')) {
        const baseDir = path.resolve(process.cwd(), 'artefacts/HMM/composed_prompt', slug || 'default');
        await fs.mkdir(baseDir, { recursive: true });
        const outPath = exportPromptArg && exportPromptArg !== 'true' && exportPromptArg !== '1'
          ? path.resolve(process.cwd(), exportPromptArg)
          : path.join(baseDir, `prompt_${Date.now()}.txt`);
        await fs.writeFile(outPath, prompt, 'utf8');
        // write latest
        const latestPath = path.join(baseDir, 'latest.txt');
        try { await fs.writeFile(latestPath, prompt, 'utf8'); } catch {}
        console.log(`Exported composed prompt → ${outPath}`);
      }
      // Print prompt to stdout when --compose-prompt provided
      if (composePrompt) {
        console.log(prompt);
      }
    } else if (exportFlag) {
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
  const sim = Math.max(0, Math.min(1, (c as any).sim ?? (c as any).score ?? 0));
  const levelPrior = c.level >= 2 ? 1 : 0; // simple prior: high-level gets +weight when relevant
  // recency scoring (half-life ~30 days)
  let recency = 0;
  if (c.recencyTs) {
    const ts = new Date(c.recencyTs).getTime();
    const days = Math.max(0, (nowMs - ts) / (1000*60*60*24));
    const halflife = 30;
    const decay = Math.pow(0.5, days / halflife);
    recency = decay; // in [0,1]
  }
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

// ===== Prompt composer (simple) =====
function composeFinalPrompt(output: any, query: IRagQuery): string {
  const parts: string[] = [];
  parts.push(`# Contexte Hiérarchique`);
  parts.push(`## High-level (Lk)`);
  for (const h of output.picks.high || []) {
    parts.push(`- [L${h.level} #${h.index ?? '?'} | score=${(h.score||0).toFixed(3)}]`);
    parts.push(limitText(h.content, 800));
  }
  parts.push(`\n## Détails (L1)`);
  for (const l of output.picks.low || []) {
    parts.push(`- [L1 #${l.index ?? '?'} | score=${(l.score||0).toFixed(3)}]`);
    parts.push(limitText(l.content, 800));
  }
  if (output.quotes && Array.isArray(output.quotes) && output.quotes.length) {
    parts.push(`\n## Extraits (L1)`);
    for (const q of output.quotes) {
      const sim = (q.sim != null) ? ` | sim=${Number(q.sim).toFixed(3)}` : '';
      parts.push(`- [L1 #${q.index ?? '?'}${sim}] ${limitText(q.excerpt || '', 320)}`);
    }
  }
  parts.push(`\n## Question`);
  parts.push(query.text || '');
  return parts.join('\n');
}

function limitText(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? (s.slice(0, max) + '…') : s;
}
