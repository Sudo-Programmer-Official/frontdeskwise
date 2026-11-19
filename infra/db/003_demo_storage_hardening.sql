alter table businesses
  add column if not exists location text not null default 'Demo workspace';

alter table knowledge_chunks
  drop constraint if exists knowledge_chunks_content_not_blank;

alter table knowledge_chunks
  add constraint knowledge_chunks_content_not_blank check (length(trim(content)) > 0);

alter table leads
  add constraint leads_contact_present check (nullif(trim(coalesce(email, '')), '') is not null or nullif(trim(coalesce(phone, '')), '') is not null);

create index if not exists knowledge_chunks_embedding_cosine_idx
  on knowledge_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists conversations_business_updated_idx
  on conversations (business_id, updated_at desc);
