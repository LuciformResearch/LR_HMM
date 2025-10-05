title: "DB Schema + Embeddings Pipeline Harmonization"

# DB Schema + Embeddings Pipeline Harmonization

Date: 2025-10-04T10:07:33+02:00
Category: Research
Tags: db,embeddings,migrations,automation,drizzle,rag

## Contexte
Le flux a évolué vers un moteur unifié L1/Lk produisant des artefacts structurés v2 (tags, entities.others, signals, extras, index). Côté base, divers scripts existent (init_local.sql, db_ensure_contexts_table.ts, db_add_meta_column.ts, db_create_index.ts, db_embed_l1.ts, db_embed_l2.ts, rag_query.ts) ainsi que des migrations Drizzle. La maintenance manuelle (schéma, insertions, embeddings) est coûteuse et fragile face aux changements fréquents du format artefact.
## Objectifs
- Unifier la création/évolution du schéma et l’initialisation (extensions, tables, index).
- Factoriser l’ingestion des artefacts v2 L1..Lk vers les tables `conversations`, `summaries`, `embeddings` avec idempotence.
- Stabiliser le pipeline d’embeddings (Vertex/Studio) avec détection de dimension et index vectoriel.
- Réduire la duplication des scripts et exposer une CLI simple: `db:sync` + `db:embed` + `rag:query`.
## Changements / Analyses
État actuel (extraits)
- Schéma SQL (sql/init_local.sql): tables `conversations`, `messages`, `summaries`, `embeddings` et index de base; `contexts` via `sql/add_contexts_table.sql` (scripts/context_compose.ts).
- Migrations Drizzle (drizzle/*): enum `message_role`, alignement `vector(768)`, tables `sessions/messages/traces` (observabilité). Mélange d’approches SQL ad‑hoc et migrations.
- Embeddings: `scripts/db_embed_l1.ts` et `scripts/db_embed_l2.ts` insèrent dans `summaries` puis `embeddings`, avec providers Vertex/Studio. Dimension prise du retour modèle, index IVFFlat optionnel via `scripts/db_create_index.ts` (colonne `vector(dim)` forcée).
- RAG: `scripts/rag_query.ts` supporte cosine/L2, seuils, rerank via LLM.

Limites observées
- Multiplicité de scripts d’ingestion par niveau; duplication de logique (upsert, embeddings, providers, gestion d’erreurs).
- Idempotence partielle: L1 fait un UPDATE si déjà présent, L2 INSERT toujours; pas d’unicité formelle (clé unique) pour éviter doublons.
- Schéma mouvant: ajout tardif de `summaries.meta`; manque de versionnage d’artefact/compatibilité.
- Indices vectoriels non auto‑reconciliés avec la dimension active; risque d’incohérence si le modèle change.

Proposition d’architecture
- Module unique `src/lib/db/sync.ts` + CLI `scripts/db_sync.ts`:
  - ensureSchema():
    - Active `pgvector` et crée/altère les tables `conversations`, `summaries(meta JSONB)`, `embeddings(vector(dim))`, `contexts` (si RAG local).
    - Crée des index: `summaries (conversation_id, level, index) UNIQUE` si `index` est présent, sinon `UNIQUE (conversation_id, level, md5(content))`.
    - Crée `ivfflat` sur `embeddings.vector` avec `lists` paramétrable; garantit `vector(dim)` = dimension détectée.
  - upsertConversation(slug,title,date?) et upsertSummaries(slug, artefact):
    - Détecte niveau depuis artefact (`l{level}.v2.json`).
    - Pour chaque `LSummary`: calcule `hash = md5(summary)`; effectue UPSERT par `(conversation_id, level, index)` ou fallback `(conversation_id, level, hash)`; stocke `covers`, `char_count`, `topics=tags`, `meta={entities,signals,extras}`.
  - embedPending(slug, provider):
    - Sélectionne les `summaries` sans embedding (LEFT JOIN embeddings) et génère embeddings (Vertex/Studio) en batch, avec timeouts et retry; détecte dimension par longueur du vecteur; aligne `embeddings.vector` si nécessaire; insère et crée index si absent.
  - options: `--vertexai`, `--embed-model`, `--limit`, `--where-level`, `--dry-run`, `--reembed-all`.

Workflow cible
- `npx tsx scripts/db_sync.ts ensure --dim 768` → extension + tables + index créés/ajustés.
- `npx tsx scripts/db_sync.ts upsert --in artefacts/HMM/compressed/<slug>.l1.v2.json` (répété pour l2/l3 ou `--in artefacts/HMM/compressed/<slug>.l*.v2.json`).
- `npx tsx scripts/db_sync.ts embed --slug <slug> --vertexai --embed-model text-embedding-004 --batch 32`.
- `npx tsx scripts/rag_query.ts --slug <slug> --query "..." --topk 8 --rerank true`.

Bénéfices
- Moins de scripts spécialisés; logique centralisée et testable.
- Idempotence stricte via contraintes uniques, évite les doublons lors des itérations.
- Compatibilité artefact v2 (tags, entities.others, signals, extras, index) conservée dans `summaries.meta`.
- Dimension vectorielle auto‑alignée; index IVFFlat garanti.
## Résultats / Prochaines étapes
- Implémenter `src/lib/db/sync.ts` + `scripts/db_sync.ts` avec sous‑commandes: `ensure`, `upsert`, `embed`.
- Ajouter une contrainte unique `UNIQUE (conversation_id, level, index)` et fallback `UNIQUE (conversation_id, level, md5(content))` si `index` absent.
- Déplacer la logique d’embeddings des scripts L1/L2 vers `embedPending()` et déprécier les anciens scripts.
- Ajouter un test rapide d’intégrité: compter `summaries` vs artefact, vérifier `embeddings` manquants.
- Documenter dans README/Runbook l’usage standard de `db_sync` et la matrice modèles/dimensions.
*Rapport généré par new_report*
