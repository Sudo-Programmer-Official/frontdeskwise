-- CRM integration foundation. FrontDeskWise remains the source of truth;
-- provider delivery is represented as durable, retryable projections.

alter table leads
  add column if not exists source text not null default 'widget',
  add column if not exists page_url text,
  add column if not exists referrer text,
  add column if not exists consent_at timestamptz,
  add column if not exists idempotency_key text;

create unique index if not exists leads_business_idempotency_idx
  on leads (business_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists lead_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_events_lead_created_idx
  on lead_events (lead_id, created_at desc);

create table if not exists crm_integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider text not null,
  display_name text not null,
  connection_status text not null default 'pending',
  encrypted_credentials text,
  config jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider)
);

alter table crm_integrations
  drop constraint if exists crm_integrations_status_check,
  add constraint crm_integrations_status_check
    check (connection_status in ('pending', 'active', 'error', 'disabled'));

create index if not exists crm_integrations_business_status_idx
  on crm_integrations (business_id, connection_status);

create table if not exists integration_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  integration_id uuid not null references crm_integrations(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, idempotency_key)
);

alter table integration_outbox
  drop constraint if exists integration_outbox_status_check,
  add constraint integration_outbox_status_check
    check (status in ('queued', 'running', 'succeeded', 'retrying', 'failed'));

create index if not exists integration_outbox_ready_idx
  on integration_outbox (status, next_attempt_at);

create table if not exists crm_sync_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  integration_id uuid not null references crm_integrations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  remote_object_type text not null default 'contact',
  remote_object_id text,
  remote_url text,
  sync_status text not null default 'pending',
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, lead_id)
);

alter table crm_sync_records
  drop constraint if exists crm_sync_records_status_check,
  add constraint crm_sync_records_status_check
    check (sync_status in ('pending', 'synced', 'retrying', 'failed'));

create index if not exists crm_sync_records_business_status_idx
  on crm_sync_records (business_id, sync_status, updated_at desc);
