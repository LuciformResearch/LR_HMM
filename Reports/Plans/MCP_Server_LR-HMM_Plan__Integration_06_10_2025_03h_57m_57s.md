title: "MCP Server LR-HMM: Plan & Integration"

# MCP Server LR-HMM: Plan & Integration

Date: 2025-10-06T03:57:57+02:00
Category: Plans
Tags: mcp,rag,memory,lr_hmm,lr_chat,integration

## Contexte

- Objectif: transformer LR Hierarchical Memory Manager (compression L1→Lk + RAG pgvector) en serveur MCP Node.js spécialisé mémoire long terme pour agents conversationnels.
- Stack: TypeScript, `@modelcontextprotocol/sdk` (serveur), `pg`, `zod`, logs fichier (compatibles `xmlEngine`/`unified`), mêmes variables d’environnement (Vertex/Studio, DB).
- Positionnement: pas d’UI web au départ. Focus sur outils/ressources MCP pour ingestion incrémentale, résumés dynamiques, et RAG budget-aware sur gros contextes.
- Usage de référence: intégration avec `~/lr_chat` (agent chat temps réel) qui alimente la mémoire et consomme le contexte via MCP.
## Objectifs

- Exposer des tools MCP pour: ingestion incrémentale de messages, génération/MAJ de résumés L1→Lk, embeddings, et réponses RAG avec export de prompt.
- Exposer des resources MCP paginables pour gros contextes: bundle de contexte hiérarchique et prompts composés, consultables par l’agent.
- Garantir la cohérence temporelle (ranges) et l’alignement DB (messages.idx, summaries.range_*, created_at) lors des mises à jour.
- Offrir des “recettes” (planner JSON) pour budgets small/medium/large et différents intents (synthesis/detail), avec triggers d’expansion contrôlables.
- Sécurité: scrubbing d’artefacts, quotas (maxHigh/maxLow/pageSize), logging traçable.
## Changements / Analyses

- Architecture MCP (Node)
  - Server: `src/mcp/server.ts` utilisant `@modelcontextprotocol/sdk`.
  - Adapters: `src/mcp/adapters/pg.ts` (PgRagIndex wrapper), `src/mcp/adapters/embedder.ts` (Vertex/Studio), `src/mcp/schemas.ts` (zod I/O).
  - Services internes:
    - `src/lib/rag/service.ts`: extraction depuis `scripts/rag_answer.ts` de la logique: buildRagBundle(), composePrompt().
    - `src/lib/ingest/service.ts`: helpers pour upsert message, régénérer résumés affectés, et embeddings différés.

- Outils MCP (tools)
  - `db.ensure()`: applique le SQL généré (reprend `schema_codegen.ts` + `db_sync ensure`).
  - `messages.append({ slug, role, text, ts? })`: insère un message dans `messages` (crée la conversation si nécessaire, gère `idx`/`ts`).
  - `summaries.update({ slug, strategy, windowChars, ratioOnly, concurrency, batchDelayMs })`:
    - Stratégie par défaut: L1 incrémental (fenêtres glissantes) sur nouveaux messages; L2/L3 “dirty region” si L1 impacte des groupes.
    - Respecte les politiques `unified.ts` (compressionLevel, wiggle, ratio-only).
  - `db.embed({ slug, whereLevel, limit, useVertex, embedModel })`: embeddings manquants.
  - `rag.answer({ slug, query, intent, filters, planPath?, composePrompt?, exportPrompt? })`: renvoie bundle RAG + prompt (ou URI ressource).
  - `rag.search({ slug?, levels[], text, filters })`: recherche brute pour debug/tooling.
  - `secrets.scan|scrub(paths[])`: proxies vers `scripts/git_scrub_secrets.sh`.

- Ressources MCP (resources)
  - `mcp://lr-hmm/context/<slug>?q=...&intent=...&budget=...&plan=...&page=1&pageSize=...` → JSON paginé du bundle: { picks:{high[],low[]}, quotes[], diagnostics }.
  - `mcp://lr-hmm/prompt/<slug>?...` → prompt final formaté, chunkable (sections) si nécessaire.
  - `mcp://lr-hmm/artefact/<slug>/<level>` → accès lecture aux artefacts L1/L2/L3.
  - `mcp://lr-hmm/logs/<slug>?type=rag|summarize` → extraits de logs.

- Intégration cible `~/lr_chat` (exemple d’usage)
  - Flux “message entrant” (temps réel):
    1) `messages.append` pour chaque message (user/assistant), avec `roleMap` (user, assistant) et `ts`.
    2) Bufferisation par fenêtre: maintient une fenêtre glissante (p.ex. 4–8k chars) pour L1.
    3) `summaries.update(strategy='incremental')`:
       - Regénère/ajoute L1 pour les nouvelles fenêtres; corrige `idx` globaux si lot/batch.
       - Marque les groupes L2/L3 impactés (par budget de groupage) et les régénère à bas débit.
    4) `db.embed(whereLevel=1)` pour nouveaux L1 (lot petit mais fréquent), L2/L3 en tâche de fond.
  - Flux “répondre à une question”:
    1) `rag.answer` avec `slug` et filtres (tags/entities/from/to via UI/agent), charge via embeddings récents.
    2) Si `composePrompt`, renvoie `promptURI` (`mcp://lr-hmm/prompt/...`) + sauvegarde `latest.txt`.
    3) L’agent consomme le prompt ou le bundle paginé; peut demander des pages additionnelles si budget le permet.
  - Primitives utiles côté `lr_chat`:
    - `list.conversations`, `list.summaries(level, filters)` pour QA, et `rag.dryrun` (diagnostics sans content) pour afficher métriques.

- Ingestion incrémentale: détails
  - Messages: table `messages(idx, ts, role, content, conversation_id)`; `idx` auto-incrément par conversation.
  - Fenêtre L1: concatène par tranche de chars (windowChars ~4–8k), crée un `RawDataBlock` avec `covers` indices message.
  - L2/L3: regroupe par budget de chars (p.ex. 10k) les L1; dirty-mark s’il y a ajout/modif dans l’intervalle couvert.
  - Alignement: `db_sync` aligne `range_*` et `created_at` selon covers/messages.

- RAG gros contextes
  - Plan JSON (budgets, triggers): contrôle acceptation, drill covers-only, MMR diversité, quotes L1.
  - Pagination ressource: ne retourne jamais un prompt ou bundle trop volumineux dans un seul message MCP; les clients demandent page 2/3 si besoin.
  - Diagnostics exportés pour pilotage (meanHighSim, didDrill, expandedTimeWindow, counts).

- Sécurité & quotas
  - Scrubbing artefacts avant commit/push (secrets potentiels dans exports ChatGPT).
  - Quotas par défaut: `compose.maxHigh`, `compose.maxLow`, `quotes.max`, `resources.pageSizeMax`.
  - Logs: réutilise `logFile`/`logStartMs` dans `xmlEngine/unified` par requête; expose via ressource.

- MVP vs Étapes suivantes
  - MVP (Semaine 1–2): tools `db.ensure`, `messages.append`, `summaries.update (L1 only)`, `db.embed(L1)`, `rag.answer` (bundle + promptURI), resources `context://`, `prompt://`.
  - Étape 2: dirty L2/L3 + backpressure, `rag.search`, `secrets.scan/scrub`, pagination fine/chunking prompt.
  - Étape 3: monitoring (compteurs, latences), policies par conversation, caching embeddings récents.

- Multi‑tenant & Scope (Intégration Auth)
  - Identity model: `namespace` (isolement logique), `userId` (string), `userIdentityId` (UUID), `orgId?`.
  - Tous les tools acceptent `scope` facultatif: `{ namespace, userId?, userIdentityId?, orgId?, conversationIds?[] }`.
  - DB: colonnes proposées sur `conversations` (optionnelles): `namespace TEXT`, `user_id TEXT`, `user_identity_id UUID`, `org_id TEXT`.
  - RAG/Index: toutes les requêtes joignent `conversations` et filtrent par `namespace` + identifiants du scope.
  - Modes: MCP local (trusted) avec `scope` passé par appel; shim HTTP (optionnel) avec resolver JWT→scope; RLS activable plus tard.

- Migration Batch (Sessions complètes)
  - Outils: `ingest.messages.bulk`, `summaries.bulk`, `db.embed.bulk`, `migrate.sessions` (pipeline orchestrée, `jobId`, reprise).
  - Formats: NDJSON par message ou JSON par session `{ slug|sessionId, role, content, ts, meta?, userId?, userIdentityId? }`.
  - Concurrence/backpressure: `concurrency`, `batchDelayMs`; retries exponentiels; quotas par `namespace`.
  - Idempotence: clés (messages: idx|ts|content_hash; summaries: (conv, level, content_hash) + idx si présent).
  - Dry‑run/validation: stats sans écritures; `verify.integrity` (comptages, échantillons collisions hash).

## Optional SQL Migrations (Multi‑tenant & Scope)

Objectif: permettre un scoping par client/utilisateur sans imposer une auth spécifique. Ces migrations sont optionnelles et peuvent être adaptées.

Proposition (conversations):

```sql
-- Conversations: ajouter colonnes de scope (optionnel)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS namespace TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_identity_id UUID;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS org_id TEXT;

-- Index utiles pour le filtrage
CREATE INDEX IF NOT EXISTS conversations_namespace_idx ON conversations (namespace);
CREATE INDEX IF NOT EXISTS conversations_namespace_user_idx ON conversations (namespace, user_id);
CREATE INDEX IF NOT EXISTS conversations_namespace_identity_idx ON conversations (namespace, user_identity_id);
CREATE INDEX IF NOT EXISTS conversations_namespace_org_idx ON conversations (namespace, org_id);

-- (Optionnel) Contraintes de base
ALTER TABLE conversations
  ALTER COLUMN namespace SET DEFAULT 'default',
  ALTER COLUMN namespace DROP NOT NULL; -- laissez NULL possible si besoin
```

Notes d’implémentation:
- `messages`, `summaries`, `embeddings` restent rattachées à `conversation_id`; les requêtes RAG joignent `conversations` et filtrent par `namespace`/`user*`.
- Backfill: lors d’un import, renseigner `namespace` et l’un de `user_id` ou `user_identity_id`.

RLS (Row‑Level Security) — optionnel, à activer seulement si vous exposez le DB directement:

```sql
-- Exemple indicatif: protéger la table conversations par namespace
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_namespace_policy ON conversations
  USING (namespace = current_setting('lr.namespace', true));

-- Côté session:
--   SET lr.namespace = 'acme-prod';
-- Les tables filles héritent via JOIN sur conversations + WHERE conversation_id IN (...)
```

Migrations “per‑namespace” (avancé):
- Non nécessaire en MVP. Si besoin d’isoler physiquement, utiliser des schémas p.ex. `tenant_acme.conversations`, gérés par un orchestrateur externe.
## Résultats / Prochaines étapes

- [ ] Valider ce plan d’API MCP (tools/ressources, paramètres) et l’intégration `~/lr_chat` (flux incrémental + RAG).
- [ ] Extraire `scripts/rag_answer.ts` en `src/lib/rag/service.ts` (buildRagBundle + composePrompt) sans modifier le CLI existant.
- [ ] Scaffolder `src/mcp/server.ts` (déclaration MCP, zod schemas, routing vers services).
- [ ] Implémenter `messages.append` et `summaries.update(strategy='incremental', level=1)` avec fenêtre glissante et logs.
- [ ] Implémenter `rag.answer` minimal (bundle + promptURI) et `context://`/`prompt://`.
- [ ] Ajouter recette(s) planner JSON par défaut (small/medium/large + intents) et quotas sûrs.
- [ ] Tester avec un mini script côté `~/lr_chat` (mock) qui: append 5–10 messages, update L1, embed L1, puis `rag.answer`.

- [ ] Multi‑tenant: ajouter `namespace` partout + support `scope` (propagation dans index RAG); documentation des migrations SQL optionnelles (conversations: namespace/user_id/user_identity_id/org_id) et RLS (facultatif).
- [ ] Batch migration: spécifier tools `ingest.messages.bulk`, `summaries.bulk`, `db.embed.bulk`, `migrate.sessions` (jobId, reprise, dry‑run), avec `concurrency`/`batchDelayMs` et idempotence.

*Rapport généré par new_report*
