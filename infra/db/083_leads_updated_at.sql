-- Keep lead metadata updates aligned with the rest of the mutable runtime
-- records. The application also has a rolling-deploy fallback for databases
-- that receive the API before this migration.

alter table leads
  add column if not exists updated_at timestamptz not null default now();

update leads
set updated_at = created_at
where updated_at is null;

create index if not exists leads_business_updated_idx
  on leads (business_id, updated_at desc);
