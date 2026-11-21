-- Canonical structured facts shared by manual business details and connected
-- systems. Website/document chunks remain semantic evidence; this table is
-- the source-aware read model for facts that need deterministic resolution.
create table if not exists business_facts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('identity', 'hours', 'location', 'service', 'pricing', 'contact', 'policy', 'faq', 'schedule', 'availability', 'custom')),
  subject text not null,
  predicate text not null,
  value jsonb not null,
  value_text text not null,
  source_type text not null check (source_type in ('live_system', 'owner_structured', 'owner_knowledge', 'document', 'website', 'inferred')),
  authority text not null default 'owner_verified' check (authority in ('system_of_record', 'owner_verified', 'owner_knowledge', 'document', 'website', 'inferred')),
  source_id text,
  source_label text,
  confidence numeric(4,3) not null default 1.0 check (confidence >= 0 and confidence <= 1),
  freshness_policy text not null default 'until_replaced' check (freshness_policy in ('realtime', 'hourly', 'daily', 'until_replaced', 'never')),
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_facts_business_kind_idx
  on business_facts (business_id, kind, active, updated_at desc);

create index if not exists business_facts_business_subject_idx
  on business_facts (business_id, subject, predicate, active);

create index if not exists business_facts_freshness_idx
  on business_facts (business_id, source_type, observed_at desc);

create unique index if not exists business_facts_source_key_idx
  on business_facts (business_id, kind, subject, predicate, source_type, coalesce(source_id, ''));
