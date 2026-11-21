-- Track owner-answer indexing separately from answer approval so a saved
-- answer cannot silently look ready while its searchable chunk is missing.
alter table knowledge_gaps
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists indexed_at timestamptz,
  add column if not exists index_status text not null default 'not_indexed',
  add column if not exists index_error text;

alter table knowledge_gaps
  drop constraint if exists knowledge_gaps_index_status_check,
  add constraint knowledge_gaps_index_status_check
    check (index_status in ('not_indexed', 'pending', 'ready', 'failed'));

create index if not exists knowledge_gaps_index_status_idx
  on knowledge_gaps (business_id, index_status);
