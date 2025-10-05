title: "DB Infra Options: Drizzle ORM End-to-End Plan"

# DB Infra Options: Drizzle ORM End-to-End Plan

Date: 2025-10-04T10:25:32+02:00
Category: Research
Tags: db,orm,drizzle,prisma,kysely,rag

## Contexte
Le projet produit désormais des artefacts unifiés v2 (L1/Lk) riches (tags, entities.others, signals, extras, index). L’infrastructure DB actuelle mélange SQL ad‑hoc (sql/*.sql), scripts PG (scripts/db_*), et migrations Drizzle existantes sans schéma TypeScript (drizzle.config.ts pointe vers src/lib/db/schema.ts inexistant). Objectif: éliminer le SQL en dur, centraliser le schéma, fiabiliser l’ingestion + embeddings + RAG, et simplifier l’exploitation.

## Objectifs
- Éviter le SQL en dur: schéma + requêtes via un ORM/Query Builder.
- Unifier le flux ensure → upsert artefacts → embeddings → RAG.
- Maintenabilité: typage TS, migrations reproductibles, conventions uniques/indices.
- Compatibilité: stocker la structure des artefacts v2 (incl. entities.others, signals/extras).

## Changements / Analyses
Options ORM/Query Builder
- Drizzle ORM (+ drizzle-kit):
  - Points forts: typage TS, migrations générées, requêtes simples et lisibles, support `pgvector` via SQL fragment. Bon compromis pour scripts/CLI.
  - Fit actuel: config déjà présente (drizzle.config.ts). Il manque seulement `schema.ts` et packages.
- Prisma:
  - Points forts: modèle déclaratif, générateur de client, migrations solides. Facile d’usage.
  - Moins adapté aux types Postgres avancés (vector) sans SQL brut additionnel; overhead client.
- Kysely:
  - Points forts: excellent query builder typé, extensible. Nécessite gestion des migrations séparée (kysely-migration, umzug, etc.).

Recommandation: Drizzle end‑to‑end (schema + migrations + client). Compléter par `postgres` (db client) ou `pg` selon préférence.

Packages à ajouter
- runtime: `drizzle-orm`, `postgres` (ou `pg` + `drizzle-orm/pg`), `zod` (validation artefacts optionnelle).
- dev: `drizzle-kit`.

Schéma proposé (src/lib/db/schema.ts)
- Tables principales:
  - `conversations(id, slug unique, title, created_date, total_chars, total_lines)`
  - `summaries(id, conversation_id→conversations, level>=1, index int null, covers jsonb, content text, char_count int, topics text[], meta jsonb, created_at timestamptz default now())`
    - Unicité: préférer `unique(conversation_id, level, index)` si `index` présent; fallback `unique(conversation_id, level, md5(content))` via colonne générée.
  - `embeddings(id, conversation_id, ref_type enum('message','summary'), ref_id, provider enum('vertex','studio'), model text, dim int, vector vector(dim), created_at)`
    - Index ivfflat cosine: `USING ivfflat (vector vector_cosine_ops) WITH (lists=100)`
  - `contexts(id, slug, query, params_json, items_json, expanded_json, budget_json, metrics_json, created_at)`

Client DB (src/lib/db/client.ts)
- Connexion poolée via `postgres` + `drizzle`.
- Export des instances drizzle pour usage dans scripts.

Sync CLI (scripts/db_sync.ts)
- `ensure`: crée/altère extensions, tables, colonnes, uniques, index; détecte `dim` depuis `process.env.EMBEDDING_DIM` (défaut 768) et aligne la colonne `vector(dim)`; crée ivfflat si absent.
- `upsert --in <artefact.json>`: charge L1..Lk v2, détecte le niveau, insère/UPSERT `summaries` avec `topics=tags` et `meta={ entities, signals, extras }`; idempotent via contrainte unique.
- `embed --slug <slug> [--where-level N] [--limit K] [--vertexai --embed-model text-embedding-004]`: sélectionne les `summaries` sans embedding, génère embeddings en batch (timeouts/retry), insère avec `provider, model, dim, vector`.

RAG
- Porter `scripts/rag_query.ts` en Drizzle (ou conserver SQL pour la partie ANN si plus simple). Ajouter une vue matérialisée `summary_search` (content + topics + niveau) pour debug/export.

Garde‑fous
- Version d’artefact: stocker `artefactVersion: 'v2'` dans `summaries.meta` (utile pour futures migrations automatiques).
- Migration `dim`: si le modèle d’embedding change, alter table vector(dim) et rebuild index ivfflat.
- Tests rapides: check counts vs artefact, check embeddings manquants.

## Résultats / Prochaines étapes
- Installer dépendances: `drizzle-orm`, `drizzle-kit`, `postgres` (ou `pg`).
- Écrire `src/lib/db/schema.ts` et `src/lib/db/client.ts`; générer migrations avec drizzle‑kit; migrer.
- Implémenter `scripts/db_sync.ts` (ensure/upsert/embed) en s’appuyant sur le client Drizzle.
- Optionnel: porter `rag_query.ts` vers Drizzle et ajouter vue matérialisée.
- Ajouter un runbook d’exploitation (ensure → upsert → embed → rag).

*Rapport généré par new_report*
