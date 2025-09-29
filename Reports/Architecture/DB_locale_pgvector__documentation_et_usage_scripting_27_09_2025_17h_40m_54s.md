















## Contexte
Valider une stack locale (Docker Postgres + pgvector) pour les expérimentations HMM/RAG en mode scripting, sans impacter la prod (Neon). Objectifs: ingérer des résumés L1, générer leurs embeddings (Google GenAI), et préparer un RAG minimal via similarité vectorielle.

## Objectifs
1. Déployer Postgres+pgvector en local via Docker.
2. Définir un schéma minimal conversations/messages/summaries/embeddings.
3. Fournir les commandes pour initialiser, insérer L1 et stocker embeddings.
4. Donner un squelette de requête RAG (similarité vectorielle) et bonnes pratiques (index).

## Changements / Analyses
Fichiers ajoutés et structure:
- `docker-compose.db.yml`: service `db` (pg16 + pgvector), port `6432`, volume `./data/pgdata`, init SQL auto.
- `sql/init_local.sql`: `CREATE EXTENSION vector;` + tables
  - `conversations(id, slug unique, title, created_date, total_chars, total_lines)`
  - `messages(id, conversation_id→conversations, role, ts, content)`
  - `summaries(id, conversation_id, level, covers jsonb, content, char_count, topics text[])`
  - `embeddings(id, conversation_id, ref_type('message'|'summary'), ref_id, model, dim, vector vector)`
- Scripts utiles:
  - `scripts/parse_conversation.ts`: parse ShadeOS en JSON structuré
  - `scripts/compress_memory.ts`: post-pass L1 (strict, timeout, longueur ciblée)
  - `scripts/db_embed_l1.ts`: upsert L1 + embeddings Google GenAI dans la DB locale

Démarrage base locale:
- `docker compose -f docker-compose.db.yml up -d`
- Adminer: http://localhost:8081 (user: `shadeos`, pass: `shadeos`, db: `shadeos_local`)

Variables/ports par défaut (overrides possibles via flags/ENV):
- Host: `localhost`, Port: `6432`, User: `shadeos`, Pass: `shadeos`, DB: `shadeos_local`
- `GEMINI_API_KEY` requis, `EMBEDDING_MODEL` par défaut: `text-embedding-004`

Pipeline minimal:
1) Générer L1: `npx tsx scripts/compress_memory.ts --slug <slug> --max-l1 5 --strict true --timeout-ms 20000 --max-summary 500`
2) Ingestion+embeddings: `npx tsx scripts/db_embed_l1.ts --slug <slug>`

Requêtes RAG (exemples):
- Créer un IVFFlat pour accélérer (optionnel, nécessite `maintenance_work_mem` suffisant):
```
CREATE INDEX IF NOT EXISTS embeddings_vec_idx
  ON embeddings USING ivfflat (vector vector_l2_ops) WITH (lists = 100);
```
- Similarité (L2) sur un vecteur de requête passé en paramètre `$1::vector`:
```
SELECT e.ref_id, s.level, s.content, e.model,
       (e.vector <-> $1::vector) AS distance
FROM embeddings e
JOIN summaries s ON s.id = e.ref_id AND e.ref_type = 'summary'
WHERE e.conversation_id = $2
ORDER BY e.vector <-> $1::vector
LIMIT 10;
```
Note: calculer l’embedding de requête côté script avec `text-embedding-004`, dimension identique à `dim` stocké.

## Résultats / Prochaines étapes
Ce qui est validé:
- Déploiement local Postgres+pgvector (docker-compose), schéma minimal, artefacts L1, script d’insertion + embeddings Google.

Prochaines étapes:
- Ajouter l’index IVFFlat et un script `rag_query.ts` (embedding de la requête + SELECT trié par `<->`).
- Étendre l’ingestion (messages bruts + L1 multiples) et évaluer taille/performances.
- Normaliser `topics`/métadonnées et ajouter un filtre sémantique ou temporel.

*Rapport généré par new_report*
