title: "Reranking — stratégie et intégration HMM/RAG"

# Reranking — stratégie et intégration HMM/RAG

Date: 2025-09-27T18:23:17+02:00
Category: Research
Tags: reranking,rag,trimming,cross-encoder,gemini

## Contexte
Le SQL actuel fait un top-k vectoriel (trim) sur `embeddings.vector` puis passe les résultats au LLM. L'insight Reranking rappelle que le rerank doit intervenir après un topN large (ex: 50–200), via un modèle qui juge la pertinence requête↔chunk, pour améliorer la qualité et couper les doublons avant de former le contexte.

## Objectifs
1. Ajouter un rerank léger après la recherche vectorielle (cosine) pour améliorer la précision topK.
2. Conserver le pipeline HMM (L1/L2) et la décompression ciblée (covers) en option après rerank.
3. Minimiser coût/latence: topN vectoriel réduit (N=50), rerank LLM compact, seuils/stop early.

## Changements / Analyses
Comparaison trim vs rerank:
- Trim (actuel): on trie par distance vectorielle et on coupe à K. Avantage: simple/rapide. Limite: sensibilité au bruit/duplicates; ordre pas toujours sémantiquement optimal.
- Rerank: on prend N>K (ex: 50), on évalue chaque candidat avec la requête (cross-encoding), on ressort K finals. Avantage: pertinence perçue meilleure; on peut imposer diversité, seuils de similarité, et "novelty".

Options d'implémentation:
- LLM‑reranker (Gemini via SDK): prompt de scoring simple (note 0..1 + justification courte), batch limité (5–10 docs/appel). Portable et sans service externe dédié.
- Vertex AI Ranking API: service Google dédié au reranking (latence/coût supplémentaires, mais spécialisé). À évaluer plus tard.

Pseudo‑pipeline (canonique):
1) Vector search (cosine): récup topN (N=50).. avec seuil `--min-sim`.
2) Rerank LLM: groupage en lots, prompt: "Score 0..1 pertinence requête↔chunk"; on garde topK (K=5–10), éventuel filtre de similarité inter‑docs pour diversité.
3) Restore: option assembleur de contexte (concat L1 choisis); si confiance faible, décompression ciblée des `covers`.
4) (Option) L2: méta‑résumé des L1 retenus pour un contexte compact.

Points d'attention:
- Budget: limiter la taille des chunks rerankés (longueur ~500–800 chars) pour ne pas exploser le coût.
- Seuils: `min-sim` (cosine), `min-score` (rerank) et `max-dupe-sim` (diversité) pour pruner intelligemment.
- Logs/Metrics: durée, coût estimé, taux de rejet, corrélation sim vs score.

## Résultats / Prochaines étapes
Court terme:
- Ajouter un script `scripts/rerank.ts` (optionnel) ou intégrer un mode `--rerank` dans `rag_query.ts` pour scorer les topN vectoriels via Gemini, avec flags: `--topn`, `--topk`, `--min-sim`, `--min-score`, `--batch`.
- Exporter le résultat reranké + contexte construit vers `artefacts/HMM/rag_context/...` pour inspection.

Moyen terme:
- Définir L2 (fenêtres sur L1, ratio/longueur strict, mêmes garanties d'erreurs/fallback=off) puis embeddings L2 et RAG multi‑niveaux.
- Étudier un signal de diversité (MMR ou sim inter‑candidats) et la déduplication.

Long terme:
- Évaluer Vertex AI Ranking API vs LLM‑reranker custom pour coût/fonction.
- Ajouter UMAP/cluster pour visu/organisation des mémoires.

*Rapport généré par new_report*
