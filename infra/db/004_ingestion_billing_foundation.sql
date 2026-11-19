-- Forward-only foundation for durable crawling metadata, demo access, and billing.
-- Live subscription provider integration is intentionally deferred; these fields
-- let the application model sandbox/demo/trial/active states without a rewrite.

alter table business_sources
  add column if not exists canonical_url text;

update business_sources
set canonical_url = source_url
where canonical_url is null;

alter table business_sources
  alter column canonical_url set not null,
  add column if not exists page_type text not null default 'web_page',
  add column if not exists crawl_status text not null default 'ready',
  add column if not exists http_status integer,
  add column if not exists error_message text;

alter table business_sources
  drop constraint if exists business_sources_page_type_check,
  add constraint business_sources_page_type_check
    check (page_type in ('web_page', 'service', 'pricing', 'faq', 'policy', 'location')),
  drop constraint if exists business_sources_crawl_status_check,
  add constraint business_sources_crawl_status_check
    check (crawl_status in ('queued', 'crawling', 'ready', 'failed'));

create index if not exists business_sources_business_status_idx
  on business_sources (business_id, crawl_status, created_at);

alter table businesses
  add column if not exists billing_mode text not null default 'sandbox',
  add column if not exists is_demo boolean not null default true,
  add column if not exists billing_status text not null default 'trial',
  add column if not exists plan_key text not null default 'demo',
  add column if not exists billing_interval text,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists current_period_ends_at timestamptz,
  add column if not exists grace_ends_at timestamptz,
  add column if not exists billing_provider text,
  add column if not exists provider_customer_id text,
  add column if not exists provider_subscription_id text;

alter table businesses
  drop constraint if exists businesses_billing_mode_check,
  add constraint businesses_billing_mode_check
    check (billing_mode in ('sandbox', 'live')),
  drop constraint if exists businesses_billing_status_check,
  add constraint businesses_billing_status_check
    check (billing_status in ('trial', 'active', 'grace', 'paused', 'cancelled')),
  drop constraint if exists businesses_billing_interval_check,
  add constraint businesses_billing_interval_check
    check (billing_interval is null or billing_interval in ('month', 'year'));

create index if not exists businesses_billing_status_idx
  on businesses (billing_status, is_demo);

create table if not exists workspace_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  identity_subject text,
  email text not null,
  name text not null,
  role text not null default 'owner',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, email)
);

create unique index if not exists workspace_users_identity_subject_idx
  on workspace_users (identity_subject)
  where identity_subject is not null;

alter table workspace_users
  drop constraint if exists workspace_users_role_check,
  add constraint workspace_users_role_check check (role in ('owner', 'admin', 'viewer')),
  drop constraint if exists workspace_users_status_check,
  add constraint workspace_users_status_check check (status in ('active', 'invited', 'disabled'));

create table if not exists demo_access_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references workspace_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  open_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demo_access_sessions_business_idx
  on demo_access_sessions (business_id, expires_at desc);

create index if not exists demo_access_sessions_active_token_idx
  on demo_access_sessions (token_hash, expires_at)
  where revoked_at is null;

create table if not exists billing_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete set null,
  provider text not null,
  event_id text not null,
  event_type text not null,
  livemode boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists billing_events_business_created_idx
  on billing_events (business_id, created_at desc);
