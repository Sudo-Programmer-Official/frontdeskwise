-- Retrieval foundation: exact-term search is available immediately; vector
-- search becomes active once the embedding worker populates knowledge_chunks.

alter table knowledge_chunks
  add column if not exists embedding_model text,
  add column if not exists embedding_dimensions integer,
  add column if not exists embedding_created_at timestamptz,
  add column if not exists search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(content, ''))
  ) stored;

create index if not exists knowledge_chunks_search_vector_idx
  on knowledge_chunks using gin (search_vector);

create index if not exists knowledge_chunks_embedded_business_idx
  on knowledge_chunks (business_id, embedding_model)
  where embedding is not null;
