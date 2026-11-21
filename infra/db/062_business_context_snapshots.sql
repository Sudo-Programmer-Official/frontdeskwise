-- Compact, deterministic summaries of the canonical business model. The
-- source facts remain authoritative; this table is a reusable cache/snapshot
-- for prompt construction and owner-facing context.
create table if not exists business_context_snapshots (
  business_id uuid primary key references businesses(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  material_fingerprint text not null,
  summary text not null,
  model jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  status text not null default 'current' check (status in ('current', 'stale')),
  updated_at timestamptz not null default now()
);

create index if not exists business_context_snapshots_fingerprint_idx
  on business_context_snapshots (material_fingerprint);
