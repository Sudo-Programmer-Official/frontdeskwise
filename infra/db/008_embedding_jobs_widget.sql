-- Retryable embedding lifecycle and public widget identity.

alter table businesses
  add column if not exists public_site_key text,
  add column if not exists widget_enabled boolean not null default true,
  add column if not exists widget_last_loaded_at timestamptz,
  add column if not exists widget_load_count integer not null default 0;

update businesses
set public_site_key = 'fdw_' || encode(gen_random_bytes(18), 'hex')
where public_site_key is null;

alter table businesses
  alter column public_site_key set not null;

create unique index if not exists businesses_public_site_key_idx
  on businesses (public_site_key);

create table if not exists embedding_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  status text not null default 'queued',
  model text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  total_chunks integer not null default 0,
  embedded_chunks integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table embedding_jobs
  drop constraint if exists embedding_jobs_status_check,
  add constraint embedding_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped'));

create unique index if not exists embedding_jobs_active_business_idx
  on embedding_jobs (business_id)
  where status in ('queued', 'running');

create index if not exists embedding_jobs_ready_idx
  on embedding_jobs (status, next_attempt_at);
