alter table knowledge_gaps
  add column if not exists intent text,
  add column if not exists reason text;
