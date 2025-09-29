title: "Setup local DB Postgres+pgvector pour scripting (hors production)"

# Setup local DB Postgres+pgvector pour scripting (hors production)

Date: 2025-09-27T15:23:05+02:00
Category: Architecture
Tags: db,postgres,pgvector,docker,embeddings,scripting

## Contexte
Besoin d’une base locale isolée pour expérimenter l’agentique (embeddings, recherche sémantique, stockage des résumés L1/L2/L3) sans impacter la prod (Neon). L’exécution se fera via scripts Node/TS.

## Objectifs
Objectifs concrets:
- Lancer Postgres + pgvector en Docker, avec volume persistant, utilisateur/mot de passe locaux.
- Définir un schéma minimal pour conversations/messages/résumés/embeddings.
- Préparer des scripts d’ingestion/extraction indépendants du site (no Next.js).
- Autoriser tests offline (modèle d’embedding à préciser; Phase 1: schéma et pipelines, Phase 2: génération effective).

## Changements / Analyses
Proposition docker-compose (à ajouter si validé):
```
version: '3.8'
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: shadeos
      POSTGRES_PASSWORD: shadeos
      POSTGRES_DB: shadeos_local
    ports:
      - '6432:5432'
    volumes:
      - ./data/pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U shadeos']
      interval: 5s
      timeout: 5s
      retries: 10
  adminer:
    image: adminer
    ports:
      - '8081:8080'
    depends_on:
      - db
```

Schéma SQL minimal (drizzle/sql simple):
```
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,      -- e.g. 2025-06-25__orage_codé_textuel
  title TEXT NOT NULL,
  created_date DATE,
  total_chars INT,
  total_lines INT
);

CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user','assistant')),
  ts TEXT,
  content TEXT
);

CREATE TABLE summaries (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  level INT CHECK (level >= 1),
  covers JSONB,                -- liste d'IDs messages couverts
  content TEXT,
  char_count INT,
  topics TEXT[]
);

-- Embeddings pour recherche sémantique
-- Dimension à confirmer (p.ex. 384 MiniLM / 768 BERT)
CREATE TABLE embeddings (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  ref_type TEXT CHECK (ref_type IN ('message','summary')),
  ref_id BIGINT NOT NULL,
  model TEXT NOT NULL,
  dim INT NOT NULL,
  vector vector NOT NULL
);

CREATE INDEX ON embeddings (conversation_id);
CREATE INDEX ON embeddings (ref_type, ref_id);
```

Pipelines scripts:
- scripts/db_init.ts: connexion, création extensions/tables si absent.
- scripts/db_ingest_conversation.ts: ingère un dossier conversation -> conversations + messages.
- scripts/db_ingest_summaries.ts: enregistre L1/L2 générés par HierarchicalMemoryManager.
- scripts/db_embed.ts: génère embeddings pour messages/résumés (Phase 2: modèle à préciser).

## Résultats / Prochaines étapes
Étapes proposées:
- Étape A: Valider docker-compose et chemin des volumes; OK pour création du fichier à la racine du repo ?
- Étape B: Ajouter scripts d’initialisation SQL (extension vector + tables).
- Étape C: Brancher l’ingestion à partir du parser existant (sans dépendre du site).
- Étape D: Choisir la dimension embedding cible (384 recommandé par défaut) et le modèle offline/online.

Questions:
- Ports/credentials te conviennent? (db: 6432, adminer: 8081, user/pass: shadeos)
- Dimension d’embedding souhaitée (384 par défaut) et modèle cible?
- OK pour créer `docker-compose.db.yml` + `sql/init_local.sql` maintenant ?

*Rapport généré par new_report*
