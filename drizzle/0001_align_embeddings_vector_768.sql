-- Ensure pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Align messages.embedding to vector(768)
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns 
   WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'embedding' AND udt_name = 'vector';
  IF FOUND THEN
    -- Already a vector, still enforce 768 dims where possible
    ALTER TABLE messages
      ALTER COLUMN embedding TYPE vector(768)
      USING CASE WHEN embedding IS NULL THEN NULL ELSE embedding::vector END;
  ELSE
    -- If it was text, convert
    ALTER TABLE messages
      ALTER COLUMN embedding TYPE vector(768)
      USING CASE WHEN embedding IS NULL OR trim(embedding) = '' THEN NULL ELSE embedding::vector END;
  END IF;
END$$;

-- Align archivist_memories.embedding to vector(768)
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns 
   WHERE table_schema = 'public' AND table_name = 'archivist_memories' AND column_name = 'embedding' AND udt_name = 'vector';
  IF FOUND THEN
    ALTER TABLE archivist_memories
      ALTER COLUMN embedding TYPE vector(768)
      USING CASE WHEN embedding IS NULL THEN NULL ELSE embedding::vector END;
  ELSE
    ALTER TABLE archivist_memories
      ALTER COLUMN embedding TYPE vector(768)
      USING CASE WHEN embedding IS NULL OR trim(embedding) = '' THEN NULL ELSE embedding::vector END;
  END IF;
END$$;

-- Indexes for similarity search
CREATE INDEX IF NOT EXISTS idx_messages_embedding_cosine 
  ON messages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_archivist_memories_embedding_cosine 
  ON archivist_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

