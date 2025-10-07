# LR Hierarchical Memory Manager

Gestion hiérarchique de mémoire (L1 → L2 → L3) avec ingestion Postgres/pgvector et RAG “level‑aware” (recherche multi‑niveaux, drill‑down covers‑only, reranking, composition de contexte). Pipeline complet: import ChatGPT export → L1/L2/L3 → DB/embeddings → RAG answer + prompt export.

## 1) Prérequis & Environnement

### Variables d’environnement (.env.local recommandé)
```bash
GOOGLE_APPLICATION_CREDENTIALS=secrets/lr-hub-472010-17b9f2d37953.json
PROJECT_ID=lr-hub-472010
GOOGLE_CLOUD_PROJECT=lr-hub-472010
VERTEX_LOCATION=europe-west1
LOCATION=europe-west1
```

### Base de données locale (Postgres 16 + pgvector)
```bash
docker compose -f docker-compose.db.yml up -d
```

## 2) Import d’un export ChatGPT (conversations.json)

Le parseur consomme directement l’export standard ChatGPT (clé `mapping` avec nœuds). Il filtre les rôles non supportés et produit un artefact parsé + ingestion DB (conversations + messages).

```bash
# Lister les conversations disponibles dans l’export
npm run parse:gpt -- --list --in /home/luciedefraiteur/luciform_research/ShadeOSFinal_Extracted/conversations.json

# Extraire par index et ingérer en DB (messages role=user|assistant uniquement)
npm run parse:gpt -- \
  --index 220 \
  --in /home/luciedefraiteur/luciform_research/ShadeOSFinal_Extracted/conversations.json \
  --db true

# Sortie parsée (JSON)
# artefacts/HMM/parsed/<YYYY-MM-DD>__<slug>.json
```

Schéma DB (parties utiles):
- `messages(idx, ts, content)`: `idx` = index d’ordre source; `ts` = ISO.
- `summaries(level, idx, covers, content, topics, meta, created_at, range_start_ts, range_end_ts)`.
  - `range_*` sont recalés à partir des `covers` (L1: min/max messages.ts; L2/L3: min/max des L1 couverts).

## 3) Génération hiérarchique L1 / L2 / L3

Script unifié: `scripts/compress_memoryv2.ts`. L1 prend l’artefact parsé. L2/L3 prennent l’artefact du niveau précédent (auto‑déduit si omis) et supportent le groupage par budget de caractères.

Exemples (paramètres utilisés dans nos runs):

```bash
# L1 — ratio-only (cible 0.10), rôles stricts user/assistant, indices globalement cohérents
npx tsx scripts/compress_memoryv2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --level 1 \
  --vertexai true --model gemini-2.5-flash \
  --ratio-only true --target-ratio 0.10 --wiggle 0.2 \
  --short-mode accept --overflow-mode accept \
  --concurrency 20 --batch-delay-ms 1500 \
  --engine-retry-attempts 1 \
  --profile chat_assistant_fp --persona-name ShadeOS \
  --role-map "assistant=ShadeOS,user=Lucie" \
  --window-chars 4000 --log

# L2 — groupage par budget 10k chars (préserve les items); ratio-only 0.10
npx tsx scripts/compress_memoryv2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --level 2 --group-chars 10000 \
  --vertexai true --model gemini-2.5-flash \
  --ratio-only true --target-ratio 0.10 --wiggle 0.2 \
  --short-mode accept --overflow-mode accept \
  --concurrency 20 --batch-delay-ms 1500 --engine-retry-attempts 1 --log

# L3 — idem L2
npx tsx scripts/compress_memoryv2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --level 3 --group-chars 10000 \
  --vertexai true --model gemini-2.5-flash \
  --ratio-only true --target-ratio 0.10 --wiggle 0.2 \
  --short-mode accept --overflow-mode accept \
  --concurrency 20 --batch-delay-ms 1500 --engine-retry-attempts 1 --log
```

Sorties:
- `artefacts/HMM/compressed/<slug>.l1.v2.json`
- `artefacts/HMM/compressed/<slug>.l2.v2.json`
- `artefacts/HMM/compressed/<slug>.l3.v2.json`

## 4) Schéma SQL & Ingestion des résumés

Générer et appliquer le schéma dynamique (tables/colonnes/idx nécessaires):
```bash
npx tsx scripts/schema_codegen.ts --dim 768
npm run db:ensure
```

Ingestion des artefacts (idempotent; aligne `range_*`/`created_at` selon covers/messages):
```bash
npm run db:upsert -- --in artefacts/HMM/compressed/<slug>.l1.v2.json
npm run db:upsert -- --in artefacts/HMM/compressed/<slug>.l2.v2.json
npm run db:upsert -- --in artefacts/HMM/compressed/<slug>.l3.v2.json
```

## 5) Embeddings (pgvector) & Index

```bash
# Embeddings par niveau (Vertex recommandé; Studio fallback via GEMINI_API_KEY)
npm run db:embed -- --slug <slug> --vertexai true --embed-model text-embedding-004 --where-level 1 --limit 500
npm run db:embed -- --slug <slug> --vertexai true --embed-model text-embedding-004 --where-level 2 --limit 300
npm run db:embed -- --slug <slug> --vertexai true --embed-model text-embedding-004 --where-level 3 --limit 50
```

## 6) RAG Answer (filtres, planner JSON, export de prompt)

Le pipeline RAG exécute: recherche multi‑niveaux → (optionnel) drill‑down covers‑only Lk→L1 → reranking (stage1 quotas + MMR) → composition High/Low → export bundle ou prompt.

Filtres & export prompt:
```bash
npm run rag:answer -- \
  --slug 2025-06-25__orage_codé_textuel \
  --query "résumer l'orage et klymaion" \
  --vertexai true --intent synthesis \
  --tags orage,rituel --entities Lucie,Klymäiôn \
  --from 2025-06-01 --to 2025-07-01 \
  --compose-prompt --export-prompt
# Prompt: artefacts/HMM/composed_prompt/<slug>/prompt_<ts>.txt + latest.txt
```

Planner JSON (budget‑aware, triggers d’expansion, quotes L1) — exemples fournis:
```bash
# Synthesis budget “small” (diversité/recall renforcés)
npm run rag:answer -- --slug 2025-06-25__orage_codé_textuel --plan artefacts/plans/synthesis_small.json --compose-prompt --export-prompt

# Detail budget “large” (focus L1 + récence)
npm run rag:answer -- --slug 2025-06-25__orage_codé_textuel --plan artefacts/plans/detail_large.json --compose-prompt --export-prompt
```

Le plan permet d’ajuster: `policy.weights/quotas`, `topk*`, `acceptance.minSimBase/scarcity`, `decompression.triggers.meanSimLt`, `expandPolicy.quotes*`, etc.

## Outils

### Dual push (GitLab + GitHub)
```bash
./dual_push.sh --message "votre message" [--branch master]
# Remotes:
#   origin  -> git@gitlab.com:luciformresearch/lr_hmm.git
#   github  -> git@github.com:LuciformResearch/LR_HMM.git
```

## Notes & Changements récents
- Parser ChatGPT: `scripts/parse_gpt_export.ts` + `npm run parse:gpt`.
- L1 generator: ignore rôles ≠ `user|assistant`; correction des index globaux entre lots.
- DB: `messages.idx`, `summaries.range_start_ts/range_end_ts` + réalignement `created_at`.
- RAG: filtres (`--tags/--entities/--from/--to`), `--export-prompt` (avec `latest.txt`), `--plan` (budget‑aware, triggers drill, quotes L1 optionnelles).

## Licence
Apache 2.0 (voir `LICENSE`).
