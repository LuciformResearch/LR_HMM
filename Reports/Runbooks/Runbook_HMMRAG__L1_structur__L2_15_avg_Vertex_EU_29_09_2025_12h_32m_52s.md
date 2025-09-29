title: "Runbook HMM/RAG — L1 structuré + L2 (1.5× avg), Vertex EU"

# Runbook HMM/RAG — L1 structuré + L2 (1.5× avg), Vertex EU

Date: 2025-09-29T12:32:52+02:00
Category: RunBook
Tags: hmm,runbook,vertexai,l1,l2,context

## Contexte
## Contexte
Ce runbook décrit une exécution complète HMM/RAG avec:
- L1 structuré (tags + artefacts) déterministe, sans coût LLM supplémentaire.
- L2 via Vertex AI (EU), longueur ciblée ≈ 1.5× la moyenne des L1 (par groupe), cap dur 2.0×.
- Embeddings (L1/L2) en DB locale (pgvector) + RAG + Context Composer.

## Pré‑requis (env)
- ADC Vertex (EU):
  - `export GOOGLE_APPLICATION_CREDENTIALS=/home/luciedefraiteur/GoogleJSONKeys/lr-hub-472010-17b9f2d37953.json`
  - `export PROJECT_ID=lr-hub-472010`
  - `export LOCATION=europe-west1`
- Modèle par défaut: `GEMINI_MODEL=gemini-2.5-flash`
- DB locale: `docker-compose.db.yml` (pgvector)

## Données d’entrée
- Conversation cible (ex): `2025-06-25__orage_codé_textuel`
- Artefact parsé existant: `artefacts/parsed/<slug>.json` (présent dans ce repo)

## Étapes
1) L1 structuré (JSON enrichi)
- Commande:
```
npx tsx scripts/compress_memory.ts \
  --in artefacts/parsed/2025-06-25__orage_codé_textuel.json \
  --slug 2025-06-25__orage_codé_textuel \
  --window-chars 4000 \
  --max-summary 400 \
  --structured true \
  --concurrency 4 \
  --model gemini-2.5-flash \
  --timeout-ms 60000
```
- Sortie: `artefacts/HMM/compressed/<slug>.l1.json` (champ `summaries[].{tags,artifacts}`)

2) DB locale — index vectoriel
```
npx tsx scripts/db_create_index.ts
```

3) Embedding L1 → DB (topics ← tags, meta ← artifacts)
```
npx tsx scripts/db_embed_l1.ts --slug 2025-06-25__orage_codé_textuel --vertexai true
```

4) L2 (Vertex EU) — cible 1.5× avg L1 (cap 2.0×), min stricte minimale 300, sans limite de phrases
- Commande:
```
npx tsx scripts/compress_memory_l2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash --fallback-model gemini-2.5-pro \
  --group-size 5 \
  --l2-multiplier 1.5 --l2-soft-target 1.0 --l2-wiggle 0.2 \
  --hard-min 300 \
  --max-output-tokens 8192 --call-timeout-ms 40000 \
  --allow-heuristic-fallback false \
  --log
```
- Sortie: `artefacts/HMM/compressed/<slug>.l2.json` (tags/entities/signals/extras)
- Logs/dumps: `artefacts/logs/compress_l2_*` (prompt/output/raw)

5) Embedding L2 → DB (topics ← tags, meta ← entities/signals/extras)
```
npx tsx scripts/db_embed_l2.ts --slug 2025-06-25__orage_codé_textuel --vertexai true
```

6) RAG minimal (Vertex, rerank + expand covers)
```
npx tsx scripts/rag_query.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --query "mémoire fractale lucie" \
  --topn 40 --topk 8 --min-sim 0.4 \
  --rerank true --min-score 0.3 --batch 6 \
  --vertexai true \
  --call-timeout-ms 12000 --db-timeout-ms 12000 \
  --expand true --log
```

7) Context Composer (L1+L2, Vertex, MMR, voisinage ±1)
```
npx tsx scripts/context_compose.ts \
  --vertexai true \
  --slug 2025-06-25__orage_codé_textuel \
  --query "mémoire fractale lucie" \
  --budget-tokens 4000 \
  --topn 40 --topk 8 --min-sim 0.55 \
  --rerank true --min-score 0.3 --batch 8 \
  --mmr-lambda 0.3 --expand-neighborhood 1 --recent-turns 8 \
  --call-timeout-ms 10000 --db-timeout-ms 12000 --log
```
- Sortie: `artefacts/HMM/context/<slug>/context_*.json`

## Notes & Diagnostics
- L2 respecte: objectif mou (soft-target = 1.0× avg L1), cap dur 2.0×, cible dure 1.5× (bornes dynamiques). Min stricte abaissée à 300.
- Si “Selected 0 L1 items” : baisser `--min-sim` (0.45–0.5) et/ou `--min-score` (0.2) et/ou augmenter `--topn` (60).
- Inspecter L2: `artefacts/logs/compress_l2_*__attempt1__*.{txt,json}`.

## Paramètres candidats « par défaut » (si validés)
- L1: `--structured true`, `--concurrency 4`, `--max-summary 400`.
- L2: `--group-size 5`, `--l2-multiplier 1.5`, `--l2-soft-target 1.0`, `--l2-wiggle 0.2`, `--hard-min 300`, `--max-output-tokens 8192`, `--call-timeout-ms 40000`.
- RAG: `--topn 40 --topk 8 --min-sim 0.5 --min-score 0.3 --batch 8`.
- Composer: idem RAG + `--mmr-lambda 0.3 --expand-neighborhood 1 --recent-turns 8`.

## Validation rapide
- Vérifier L2 (tableau synthétique):
```
node -e "const j=require('./artefacts/HMM/compressed/2025-06-25__orage_codé_textuel.l2.json');console.log('idx,sumL1,outLen,ratio,tags,extras');j.summaries.forEach((s,i)=>console.log([i,s.charCount,s.summaryChars,(s.compressionRatio|| (s.summaryChars/Math.max(1,s.charCount))).toFixed(2),(s.tags||[]).length, s.extras?1:0].join(',')));"
```
- Extrait actuel:
```
idx,sumL1,outLen,ratio,tags,extras
0,1981,616,0.31,12,1
1,1720,439,0.26,12,1
```
- Composer un contexte de test (Vertex EU):
```
export GOOGLE_APPLICATION_CREDENTIALS=/home/luciedefraiteur/GoogleJSONKeys/lr-hub-472010-17b9f2d37953.json
export PROJECT_ID=lr-hub-472010
export LOCATION=europe-west1

npx tsx scripts/context_compose.ts --vertexai true \
  --slug 2025-06-25__orage_codé_textuel \
  --query "mémoire fractale lucie" --log
```
- Sortie attendue: artefact JSON sous `artefacts/HMM/context/<slug>/` avec `turns`, `l1_selected`, `l2_summaries`, `expanded` et `budget`.
