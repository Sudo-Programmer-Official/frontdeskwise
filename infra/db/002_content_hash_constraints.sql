drop index if exists business_sources_business_hash_idx;
create unique index if not exists business_sources_business_hash_idx
  on business_sources (business_id, content_hash);

drop index if exists knowledge_chunks_business_hash_idx;
create unique index if not exists knowledge_chunks_business_hash_idx
  on knowledge_chunks (business_id, content_hash);
