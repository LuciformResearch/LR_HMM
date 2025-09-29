-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Conversations catalog
CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,      -- e.g. 2025-06-25__orage_codé_textuel
  title TEXT NOT NULL,
  created_date DATE,
  total_chars INT,
  total_lines INT
);

-- Raw messages
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user','assistant')),
  ts TEXT,
  content TEXT
);

-- Summaries (L1/L2/L3)
CREATE TABLE IF NOT EXISTS summaries (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  level INT CHECK (level >= 1),
  covers JSONB,                -- list of covered message IDs
  content TEXT,
  char_count INT,
  topics TEXT[]
);

-- Embeddings for semantic search
-- Adjust dim according to actual model used (e.g., 384 or 768)
CREATE TABLE IF NOT EXISTS embeddings (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  ref_type TEXT CHECK (ref_type IN ('message','summary')),
  ref_id BIGINT NOT NULL,
  model TEXT NOT NULL,
  dim INT NOT NULL,
  vector vector NOT NULL
);

CREATE INDEX IF NOT EXISTS embeddings_conversation_idx ON embeddings (conversation_id);
CREATE INDEX IF NOT EXISTS embeddings_ref_idx ON embeddings (ref_type, ref_id);

