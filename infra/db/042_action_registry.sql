-- Structured action destinations are separate from knowledge chunks. They are
-- tenant-scoped, lifecycle-aware, and may be synced from a provider such as
-- Jackrabbit or maintained manually by an owner.

create table if not exists business_action_resources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  resource_type text not null check (resource_type in ('registration', 'booking', 'job_application', 'payment', 'application', 'quote', 'contact', 'custom')),
  name text not null,
  provider text not null default 'manual',
  provider_object_id text,
  location text,
  program text,
  day text,
  start_time text,
  end_time text,
  role text,
  department text,
  service text,
  price text,
  availability integer,
  metadata jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  destination jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'EXPIRED', 'FULL', 'WAITLIST', 'DRAFT', 'ERROR')),
  valid_from timestamptz,
  valid_until timestamptz,
  source text not null default 'manual',
  last_synced_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_action_resources_lookup_idx
  on business_action_resources (business_id, resource_type, status, updated_at desc);

create index if not exists business_action_resources_provider_idx
  on business_action_resources (business_id, provider, provider_object_id)
  where provider_object_id is not null;

create unique index if not exists business_action_resources_provider_object_idx
  on business_action_resources (business_id, provider, provider_object_id)
  where provider_object_id is not null;
