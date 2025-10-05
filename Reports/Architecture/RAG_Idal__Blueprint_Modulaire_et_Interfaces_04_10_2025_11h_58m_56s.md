title: "RAG Idéal — Blueprint Modulaire et Interfaces"

# RAG Idéal — Blueprint Modulaire et Interfaces

Date: 2025-10-04T11:58:56+02:00
Category: Architecture
Tags: rag,architecture,blueprint,modules,interfaces

## Contexte
Le moteur de compression hiérarchique produit des artefacts v2 (L1..Lk) structurés et traçables. Nous voulons un RAG “level‑aware”, pilotable, avec drill‑down sélectif et reranking, construit en briques modulaires pour itérer rapidement.

## Objectifs
- Définir des interfaces claires pour chaque brique (retrieval, filters, expansion, rerank, compose).
- Permettre des politiques différentes (synthèse, détail, récent) sans changer le code cœur.
- Garantir la traçabilité (niveaux, covers, scores) et la mesurabilité (metrics).

## Blueprint (Modules)
- `IRagQuery` (entrée):
  - `text: string`, `intent?: 'synthesis'|'detail'|'recent'|'auto'`, `timeWindow?: {from?:Date; to?:Date}`
  - `hints?: {entities?: string[]; tags?: string[]; levels?: number[]}`
  - `budget?: {tokens: 'small'|'medium'|'large'}`
- `RagPolicy` (config):
  - `levelQuotas: Record<Level, number>` (ex.: L3:6, L2:4, L1:2)
  - `weights: { similarity: number; level: number; recency: number; diversity: number }`
  - `expand: { coversOnly: boolean; perGroupTopM: number }`
  - `rerank: { stage1: boolean; stage2: boolean }`
  - `compose: { maxItemsPerSection: { high: number; low: number } }`
- `IRagIndex` (lecture):
  - `search(levels: number[], queryEmbedding: number[], opts): Promise<Candidate[]>`
  - `fetchByIds(ids: number[]): Promise<Row[]>`
  - `fetchCovers(level: number, ids: number[]): Promise<{ level: number; covers: number[] }[]>`
- `IEmbedder`:
  - `embed(texts: string[], opts): Promise<number[][]>` (Vertex/Studio/Local)
- `Scorers`:
  - `combineScores(c: Candidate, policy: RagPolicy, now: Date): number` (sim + α·level + β·recency + γ·diversité)
  - `mmr(candidates: Candidate[], k: number): Candidate[]`
- `Filters`:
  - `byEntities/Tags/Time/coversOnly`
- `Expander` (drill‑down):
  - À partir des winners Lk, restreint la seconde recherche aux covers (Lk→L1, L1→messages)
- `Reranker`:
  - Stage1 (léger) et Stage2 (plus coûteux), interfaçables (LLM ou cross‑encoder)
- `Composer` (assemblage du contexte hiérarchique):
  - Section High‑level (Lk), section Details (L1), citations brutes optionnelles; annotations source
- `Metrics/Logs`:
  - `tracePipeline(...)` + mesures (hit‑rate, MRR, coût tokens, coverage)

## Flux de haut niveau (pseudo‑code)
```
function answer(query: IRagQuery) {
  const policy = choosePolicy(query.intent);
  const e = embedder.embed([query.text])[0];
  const levels = chooseLevels(policy);
  let cands = index.search(levels, e, { topk: policy.topkInitial });
  cands = scoreAndDiversify(cands, policy);
  if (policy.expand.coversOnly) {
    const topHigh = pickHighLevel(cands, policy);
    const covers = unionCovers(topHigh);
    const candsLow = index.search([1], e, { scope: covers, topk: policy.topkDrill });
    cands = mergeAndRescore(topHigh, candsLow, policy);
  }
  if (policy.rerank.stage1) cands = reranker.stage1(query.text, cands);
  if (policy.rerank.stage2) cands = reranker.stage2(query.text, take(cands, policy.topnFinal));
  const bundle = composeContext(cands, policy, query.budget);
  return generateAnswer(bundle, query, policy);
}
```

## Prochaines étapes
- Définir `RagPolicy` par profils (synthèse/détail/récent) et conventions d’annotation d’extraits.
- Implémenter un prototype minimal `IRagIndex` sur Postgres/pgvector + `IEmbedder` (Vertex/Studio).
- Ajouter `tracePipeline()` et une page de métriques.

*Blueprint modulaire — base pour implémentation incrémentale*
