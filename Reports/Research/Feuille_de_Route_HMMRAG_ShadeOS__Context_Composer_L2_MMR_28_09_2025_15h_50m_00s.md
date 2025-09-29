title: "Feuille de Route — HMM/RAG ShadeOS: Context Composer, L2, MMR/Dedup"

# Feuille de Route — HMM/RAG ShadeOS: Context Composer, L2, MMR/Dedup

Date: 2025-09-28T15:50:00+02:00
Category: Research
Tags: roadmap,hmm,rag,shadeos,context-composer,vertexai,embeddings,mmr,dedup,rerank,l2

## Objectif
Construire une boucle de conversation « ShadeOS qui se souvient de tout » en assemblant dynamiquement un contexte compact mais fidèle: derniers échanges + résumés L1 (sélectionnés) + expansions ciblées (« covers ») + RAG sémantique multi‑niveaux (L1/L2), reranké, dédoublonné et diversifié (MMR), sous un budget strict.

## État Actuel (validé)
- Parsing ShadeOS → JSON; L1 strict avec timeouts et contrôle de longueur.
- Embeddings 768 (text‑embedding‑004) en DB locale; index IVFFlat cosine.
- RAG minimal + rerank LLM (AI Studio) et Vertex AI (ADC/SA) via `--vertexai`.
- Export de contexte reranké + `--expand` pour recharger les messages originaux depuis les `covers`.
- Logging + timeouts dans `rag_query.ts` (batching, métriques de latence).

## Propositions Clés
- Context Composer canonique: assemble le contexte final sous budget avec politique explicite.
- L2 (méta‑résumés): fusionne plusieurs L1 (par session/période/thème) + embeddings dédiés.
- Rerank+MMR: ajouter diversité et dédoublonnage par similarité inter‑candidats.
- Décompression ciblée: expansion des `covers` avec voisinage (±k messages) et dedup.
- Évaluation: traces de contexte et métriques (rappel/recouvrement, longueur, latence, coût).
- Orchestration légère (sans “framework prison”): scripts ciblés + hooks UI.

## Context Composer — Algorithme
Budget d’input paramétré (ex: 6k–12k tokens). Étapes:
1) Fenêtre récente: derniers N tours (ex: 6–12) → 30–40% du budget.
2) L1 candidats: requête RAG (cosine) sur embeddings L1 (et L2 si dispo) → topN.
3) Rerank LLM (Vertex conseillé: gemini‑2.5‑flash‑lite) → topK.
4) MMR Diversité: re‑sélectionne K en maximisant pertinence − λ·similarité_interne.
5) Dedup inter‑docs: filtre paires à cos_sim ≥ τ (ex: 0.92) + garde le meilleur.
6) Expansion ciblée: pour K’ sélectionnés, remonter `covers` + voisinage (±1..2) sous budget.
7) Compression opportuniste: si budget encore libre, inclure 1–2 L2 méta‑résumés transverses.
8) Assemblage: structure JSON (sections, sources, méta, tailles) + export.

Sortie JSON standardisée:
```json
{
  "query": "...",
  "turns": [...],          // derniers échanges
  "l2_summaries": [...],   // optionnel
  "l1_selected": [...],    // items rerankés (id, score, sim, covers)
  "expanded": {            // messages d’origine (+ voisinage)
    "totalMessages": 42,
    "messages": [{"index": 123, "role": "assistant", "content": "..."}]
  },
  "budget": {"inputTokens": 8000, "used": 7421},
  "metrics": {"latencyMs": 1260, "mmrLambda": 0.3}
}
```

## L2 — Méta‑résumés
- Cibles: (a) par conversation longue (regroupe X fenêtres L1), (b) par période (hebdo/mensuel), (c) par thème (cluster sémantique).
- Script proposé: `scripts/compress_memory_l2.ts` (fenêtrage L1 → L2); export `artefacts/HMM/compressed/<slug>.l2.json`.
- Insertion DB: `scripts/db_embed_l2.ts` (table `summaries` partagée via `level=2` + embeddings).
- RAG: interroger L1+L2, pondérer L2 pour rappel global puis raffiner avec L1.

## Reranking — MMR & Dedup
- MMR: sélectionner S ⊆ candidats, max Σ relevance(i) − λ·max_j sim(i,j). Impl: glouton, calcul sim via embeddings (cosine sur 768).
- Dedup: seuil τ (ex: 0.92) sur sim inter‑candidats; prioriser score rerank puis compacité.
- Modèles: Vertex `gemini-2.5-flash-lite` pour scoring rapide; batch=8–16; timeouts 5–8s.

## Décompression Ciblée (covers)
- Heuristique: sélectionner p premiers éléments rerankés, toujours 1 par thème distinct quand possible.
- Voisinage: inclure ±k messages (k=1..2) autour des indices `covers` pour conserver le fil.
- Dedup contenu: éviter doublons exacts/fortement similaires dans l’assemblage final.

## Stockage & Schéma
- `summaries.level`: 1/2/3 pour L1/L2/L3; `covers` (array d’indices de messages) déjà présent.
- `contexts` (nouvelle table suggérée):
  - id, created_at, slug, query, params_json, items_json, expanded_json, budget, metrics.
- Index: conserver IVFFlat cosine (lists=100). Envisager HNSW plus tard si nécessaire.

## Scripts à Ajouter
- `scripts/context_compose.ts` — Implémente l’algorithme ci‑dessus; export JSON; flags: `--vertexai`, `--budget-tokens`, `--mmr-lambda`, `--expand-neighborhood`, `--log`, `--timeout`.
- `scripts/compress_memory_l2.ts` — L2 depuis L1 (fenêtrage/ratio/longueur/strict/timeout).
- `scripts/db_embed_l2.ts` — Insertion des L2 + embeddings (004, 768).

## Intégration UI/Agent
- Hook côté chat: avant réponse, appeler `context_compose.ts` → charger JSON → composer le prompt final (sections claires + sources).
- Archivist Agent+: expose outils: `compose_context`, `rag_query`, `expand_covers`, `score_diversity`.

## Évaluation & Observabilité
- Traces: enregistrer chaque contexte utilisé (fichier + DB `contexts`).
- Métriques: latence totale, coût estimé, longueur input/output, taux de recouvrement (heuristique) vs réponses attendues.
- Jeux d’évaluation internes: paires question↔attendus (extraits de ShadeOS) pour comparer transformations des réglages (λ, τ, budgets).

## Sécurité & Scalabilité (entreprise)
- ACL: attacher `owner`, `org`, `visibility` aux messages/chunks; filtrage au moment de la requête.
- Ingestion massive: connecteurs (Drive, Confluence, Slack, Jira, Git, bases SQL) → chunking + L1 + embeddings; tâches batch et reprise.
- Multi‑tenant: espace logique par client (schémas séparés ou clés de partition) + chiffrage si nécessaire.

## LangChain — Position
- Utile pour du prototypage (routage/outils), mais on garde l’orchestration maison pour HMM (contrôle fin des budgets/expansions/MMR).
- Optionnel: intégrer sélectivement des utilitaires (re-rankers, retrievers multi-vecteurs) sans coupler la logique HMM.

## Roadmap (proposée)
1) Context Composer (script + format JSON + hook UI) — priorité haute.
2) L2 (compress + embed + RAG multi‑niveaux) — priorité haute.
3) MMR + dedup dans `rag_query.ts` (ou intégré dans Context Composer) — haute.
4) Table `contexts` + exporter systématique — moyenne.
5) Outils Archivist+ (exposition MCP) — moyenne.

## Prochaines Actions Immédiates
- Implémenter `scripts/context_compose.ts` avec budget manager + MMR + expand voisinage.
- Ajouter `scripts/compress_memory_l2.ts` et `scripts/db_embed_l2.ts` (réutiliser patterns L1).
- Intégrer l’appel au Context Composer avant chaque génération de réponse dans le chat.

*Rédigé pour cadrer la suite des travaux ShadeOS/HMM.*

