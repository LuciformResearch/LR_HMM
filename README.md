# LR HMM Scripts

Projet expérimental en évolution rapide — API/flags et prompts peuvent changer. Beaucoup reste à faire (unification complète L1/L2, normalisations entités, intégration DB/RAG renforcée). Consultez les Runbooks dans `Reports/Runbooks` pour l’état le plus à jour.

## Prérequis

### Variables d'environnement
```bash
# Recommandé: .env.local (ignoré par git)
GOOGLE_APPLICATION_CREDENTIALS=secrets/lr-hub-472010-17b9f2d37953.json
PROJECT_ID=lr-hub-472010
GOOGLE_CLOUD_PROJECT=lr-hub-472010
VERTEX_LOCATION=europe-west1
LOCATION=europe-west1
```

### Base de données locale
```bash
docker compose -f docker-compose.db.yml up -d
```

## Scripts principaux

### Vérification de l'accès Vertex AI
```bash
npx tsx scripts/check_vertexai_access.ts
```

### Compression mémoire L1 — Nouvelle façade unifiée (v2)
Le script `compress_memoryv2.ts` utilise l’API unifiée (`summarize`/`summarizeBatched`) et le moteur XML refactoré.

Exemple “batch complet” (profil chat assistant, persona ShadeOS), sortie structurée (summary + tags + entities{persons, orgs, artifacts, places, times, other} + signals + extras):
```bash
npx tsx scripts/compress_memoryv2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash \
  --level 1 \
  --profile chat_assistant_fp --persona-name ShadeOS \
  --role-map "assistant=ShadeOS,user=Lucie" \
  --window-chars 4000 \
  --min-summary 250 --max-summary 400 --short-mode regenerate \
  --concurrency 20 \
  --batch-delay-ms 3000 \
  --max-output-tokens 1024 \
  --allow-heuristic-fallback true \
  --engine-retry-attempts 3 --engine-retry-base-ms 600 --engine-retry-jitter-ms 300
```

Variante “ratio-only” (pas de cap dur; objectif de longueur appliqué à <summary> uniquement; utile pour explorer la dérive naturelle):
```bash
npx tsx scripts/compress_memoryv2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash \
  --level 1 \
  --ratio-only true --target-ratio 0.10 \
  --short-mode accept --overflow-mode accept \
  --concurrency 20 --batch-delay-ms 1500 \
  --engine-retry-attempts 1
  --profile chat_assistant_fp --persona-name ShadeOS \
  --role-map "assistant=ShadeOS,user=Lucie" \
  --window-chars 4000 \
  --min-summary 250 --max-summary 400 --short-mode regenerate \
  --concurrency 20 \
  --batch-delay-ms 3000 \
  --max-output-tokens 1024 \
  --allow-heuristic-fallback true \
  --engine-retry-attempts 3 --engine-retry-base-ms 600 --engine-retry-jitter-ms 300
```

Régénération partielle de quelques index (ne traite que les indices demandés):
```bash
# Exemple: régénérer les indices 34, 39, et la plage 43–49
npx tsx scripts/compress_memoryv2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash \
  --level 1 \
  --profile chat_assistant_fp --persona-name ShadeOS \
  --role-map "assistant=ShadeOS,user=Lucie" \
  --window-chars 4000 \
  --min-summary 250 --max-summary 400 --short-mode regenerate \
  --concurrency 6 \
  --max-output-tokens 1024 \
  --allow-heuristic-fallback true \
  --only-indices "34,39,43-49"
```

Notes:
- Chaque entrée L1 contient un champ `index` qui correspond à sa position dans `summaries[]` (utile pour la régénération ciblée).
- Le remap des rôles vers `ShadeOS:`/`Lucie:` est contrôlé par `--role-map` et peut être adapté à d’autres canaux (emails, org voice, etc.) via `--profile`/`--persona-name`.
- L1 structuré inclut désormais `tags`, `entities` (persons, orgs, artifacts, places, times), `signals` (JSON CDATA) et `extras` (omissions/texte). DirectOutput reste minimal et peut être enrichi via extracteurs.
- Lissage charge API: utilisez `--concurrency` (taille de lot) + `--batch-delay-ms` (pause entre lots) côté script, et les options `--engine-retry-*` pour le backoff interne de l’xmlEngine.

### Compression mémoire L2 (v2, via `--level`)
Le script v2 accepte `--level`. Pour L2, fournissez les L1 via `--from-l1` (par défaut: artefacts/HMM/compressed/<slug>.l1.v2.json). Grouping via `--group-size`.
```bash
npx tsx scripts/compress_memoryv2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash \
  --level 2 --group-size 5 --concurrency 8 \
  --from-l1 artefacts/HMM/compressed/2025-06-25__orage_codé_textuel.l1.v2.json \
  --target-ratio 0.15 --wiggle 0.2 \
  --overflow-mode regenerate --underflow-mode regenerate \
  --max-output-tokens 4096 --call-timeout-ms 35000 \
  --engine-retry-attempts 2 --engine-retry-base-ms 600 --engine-retry-jitter-ms 300 --log
```

### Debug & Logs
Prompt debug (capture le prompt exact et n’appelle pas l’API):
```bash
npx tsx scripts/compress_memoryv2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --level 1 --only-indices 0 \
  --debug-prompt true \
  --profile chat_assistant_fp --persona-name ShadeOS --role-map "assistant=ShadeOS,user=Lucie"
# Prompts: artefacts/prompts/<slug>.<timestamp>.prompts.txt
# Logs:    artefacts/logs/<slug>.<timestamp>.run.log
```

### Embeddings vers DB
```bash
# Créer l'index vectoriel
npx tsx scripts/db_create_index.ts

# Embeddings L1
npx tsx scripts/db_embed_l1.ts --slug 2025-06-25__orage_codé_textuel --vertexai true

# Embeddings L2
npx tsx scripts/db_embed_l2.ts --slug 2025-06-25__orage_codé_textuel --vertexai true
```

### RAG Query
```bash
npx tsx scripts/rag_query.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --query "mémoire fractale lucie" \
  --topn 40 --topk 8 --min-sim 0.4 \
  --rerank true --min-score 0.3 --batch 6 \
  --vertexai true \
  --call-timeout-ms 12000 --db-timeout-ms 12000 \
  --expand true --log
```

### Context Composer
```bash
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

## Outils

### Dual push (GitLab + GitHub)
```bash
./dual_push.sh --message "votre message" [--branch master]
# Remotes:
#   origin  -> git@gitlab.com:luciformresearch/lr_hmm.git
#   github  -> https://github.com/LuciformResearch/LR_HMM.git
```

## Structure des données

- `artefacts/parsed/` : Conversations parsées
- `artefacts/HMM/compressed/` : Mémoires L1 et L2 compressées
- `artefacts/HMM/context/` : Contextes composés
- `artefacts/logs/` : Logs d'exécution
- `data/pgdata/` : Données PostgreSQL locale

## Documentation

Voir `Reports/Runbooks/` pour la documentation détaillée des processus HMM.

## Licence

Ce projet est distribué sous une variante MIT avec clause d'attribution renforcée, identique à celle utilisée dans LR Hub™.

- Fichier: `LICENSE`
- Attribution requise: "Basé sur LR Hub™ par Lucie Defraiteur"
- Projet d'origine: https://gitlab.com/luciformresearch/lr_chat

En résumé: vous pouvez utiliser, modifier et distribuer, y compris commercialement, à condition de conserver la mention de copyright et
d’ajouter une attribution claire au projet d’origine. Voir le fichier `LICENSE` pour les termes complets.
