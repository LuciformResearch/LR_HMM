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

### Compression mémoire L1 (Vertex + XML Engine)
Exemple “batch complet” (profil chat assistant, persona ShadeOS), en sortie structurée XML (summary + tags + entities):
```bash
npx tsx scripts/compress_memory.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash \
  --structured true --structured-xml true \
  --profile chat_assistant_fp --persona-name ShadeOS \
  --role-map "assistant=ShadeOS,user=Lucie" \
  --window-chars 4000 \
  --min-summary 250 --max-summary 400 --short-mode regenerate \
  --concurrency 33 \
  --max-output-tokens 1024 \
  --allow-heuristic-fallback true
```

Variante “non structurée” mais toujours via l’XML Engine (prompt unifié):
```bash
npx tsx scripts/compress_memory.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash \
  --structured true --structured-xml false \
  --profile chat_assistant_fp --persona-name ShadeOS \
  --role-map "assistant=ShadeOS,user=Lucie" \
  --window-chars 4000 \
  --min-summary 250 --max-summary 400 --short-mode regenerate \
  --concurrency 33 \
  --max-output-tokens 1024 \
  --allow-heuristic-fallback true
```

Régénération partielle de quelques index (réutilise le JSON existant et remplace uniquement les blocs ciblés):
```bash
# Exemple: régénérer les indices 34, 39, et la plage 43–49
npx tsx scripts/compress_memory.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash \
  --structured true --structured-xml true \
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

### Compression mémoire L2 (Vertex AI, XML Engine)
```bash
npx tsx scripts/compress_memory_l2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --vertexai true --model gemini-2.5-flash \
  --group-size 5 --concurrency 6 \
  --use-xml-engine true \
  --l2-multiplier 1.5 --l2-soft-target 1.0 --l2-wiggle 0.2 \
  --overflow-mode regenerate --overflow-max-ratio 2.0 --soft-ratio-step 0.3 \
  --hard-min 300 \
  --max-output-tokens 8192 --call-timeout-ms 35000 \
  --log

# Debug rapide:
#   --test true --max-groups 3  (limiter les groupes)
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
