-- Security telemetry and privileged audit records. IPs and user agents are
-- stored as one-way hashes; request metadata is bounded and must not contain
-- message bodies, credentials, or provider tokens.

alter table app_users
  add column if not exists email_verified boolean not null default false;

create index if not exists app_users_email_verified_idx
  on app_users (email_verified, status);

create table if not exists security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  risk text not null default 'medium'
    check (risk in ('low', 'medium', 'high', 'critical')),
  organization_id uuid references organizations(id) on delete set null,
  business_id uuid references businesses(id) on delete set null,
  actor_user_id uuid references app_users(id) on delete set null,
  actor_type text,
  request_id text,
  route text,
  method text,
  status_code integer,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_events_created_idx
  on security_events (created_at desc);

create index if not exists security_events_risk_created_idx
  on security_events (risk, created_at desc);

create index if not exists security_events_tenant_created_idx
  on security_events (organization_id, business_id, created_at desc);

create index if not exists security_events_type_created_idx
  on security_events (event_type, created_at desc);

create table if not exists privileged_audit_events (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  resource_type text not null,
  resource_id text,
  organization_id uuid references organizations(id) on delete set null,
  business_id uuid references businesses(id) on delete set null,
  actor_user_id uuid references app_users(id) on delete set null,
  actor_type text,
  request_id text,
  ip_hash text,
  before_value jsonb,
  after_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists privileged_audit_events_created_idx
  on privileged_audit_events (created_at desc);

create index if not exists privileged_audit_events_tenant_created_idx
  on privileged_audit_events (organization_id, business_id, created_at desc);
