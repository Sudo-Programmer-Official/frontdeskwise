-- Provider-neutral business API connections and reviewable capabilities.
-- Native adapters and imported OpenAPI operations share this registry. The
-- workflow engine may only execute capabilities that an owner approved.

create table if not exists business_api_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider_key text not null default 'custom_api',
  display_name text not null,
  base_url text not null,
  source_type text not null default 'custom_rest',
  spec_url text,
  auth_type text not null default 'none',
  encrypted_credentials text,
  credential_hint text,
  connection_status text not null default 'pending',
  config jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_api_connections_source_check check (source_type in ('native', 'openapi', 'custom_rest')),
  constraint business_api_connections_auth_check check (auth_type in ('none', 'bearer_token', 'api_key', 'basic', 'oauth2')),
  constraint business_api_connections_status_check check (connection_status in ('pending', 'active', 'error', 'disabled'))
);

create unique index if not exists business_api_connections_business_name_idx
  on business_api_connections (business_id, lower(display_name));
create index if not exists business_api_connections_business_status_idx
  on business_api_connections (business_id, connection_status, updated_at desc);

create table if not exists business_api_capabilities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  connection_id uuid not null references business_api_connections(id) on delete cascade,
  capability_key text not null,
  name text not null,
  description text,
  operation_id text,
  capability_type text not null,
  method text not null,
  path text not null,
  auth_scope text,
  allowed_methods text[] not null default '{}',
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  rate_limit jsonb not null default '{}'::jsonb,
  timeout_ms integer not null default 8000,
  retry_policy jsonb not null default '{}'::jsonb,
  pii_classification text not null default 'unknown',
  confirmation_required boolean not null default false,
  lifecycle_status text not null default 'discovered',
  enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_api_capabilities_type_check check (capability_type in ('READ', 'WRITE')),
  constraint business_api_capabilities_method_check check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')),
  constraint business_api_capabilities_pii_check check (pii_classification in ('none', 'unknown', 'low', 'high', 'restricted')),
  constraint business_api_capabilities_lifecycle_check check (lifecycle_status in ('discovered', 'approved', 'disabled')),
  constraint business_api_capabilities_timeout_check check (timeout_ms between 1000 and 30000),
  unique (connection_id, capability_key)
);

create index if not exists business_api_capabilities_business_status_idx
  on business_api_capabilities (business_id, lifecycle_status, enabled, updated_at desc);
create index if not exists business_api_capabilities_connection_idx
  on business_api_capabilities (connection_id, capability_type, updated_at desc);

create table if not exists business_api_capability_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  connection_id uuid references business_api_connections(id) on delete set null,
  capability_id uuid references business_api_capabilities(id) on delete set null,
  actor_user_id uuid references app_users(id) on delete set null,
  actor_type text not null check (actor_type in ('owner', 'admin', 'system')),
  event_type text not null check (event_type in ('connection_created', 'connection_tested', 'capabilities_imported', 'capability_approved', 'capability_disabled', 'capability_tested')),
  previous_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists business_api_capability_audit_business_idx
  on business_api_capability_audit (business_id, created_at desc);
create index if not exists business_api_capability_audit_capability_idx
  on business_api_capability_audit (capability_id, created_at desc);
