-- Demo operations and access audit.
-- Public demo generation remains frictionless, while every request, link, open,
-- claim, reset, revoke, and validation is visible to a super administrator.

create table if not exists demo_requests (
  id uuid primary key default gen_random_uuid(),
  requester_name text,
  requester_email text,
  business_name text,
  website_url text not null,
  template_key text not null default 'local_business',
  source text not null default 'landing',
  status text not null default 'received',
  business_id uuid references businesses(id) on delete set null,
  organization_id uuid references organizations(id) on delete set null,
  latest_session_id uuid,
  requested_at timestamptz not null default now(),
  last_opened_at timestamptz,
  last_claimed_at timestamptz,
  access_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table demo_requests
  drop constraint if exists demo_requests_status_check,
  add constraint demo_requests_status_check
    check (status in ('received', 'failed', 'ready', 'sent', 'opened', 'claimed', 'converted', 'expired', 'revoked', 'closed'));

create index if not exists demo_requests_status_requested_idx
  on demo_requests (status, requested_at desc);

create index if not exists demo_requests_requester_email_idx
  on demo_requests (lower(requester_email), requested_at desc);

create index if not exists demo_requests_business_idx
  on demo_requests (business_id, requested_at desc);

alter table demo_access_sessions
  add column if not exists demo_request_id uuid references demo_requests(id) on delete set null,
  add column if not exists created_by_user_id uuid references app_users(id) on delete set null,
  add column if not exists access_type text not null default 'public',
  add column if not exists access_label text;

alter table demo_access_sessions
  drop constraint if exists demo_access_sessions_access_type_check,
  add constraint demo_access_sessions_access_type_check
    check (access_type in ('public', 'admin', 'internal', 'claim'));

create index if not exists demo_access_sessions_request_idx
  on demo_access_sessions (demo_request_id, created_at desc);

create table if not exists demo_access_audit (
  id uuid primary key default gen_random_uuid(),
  demo_request_id uuid references demo_requests(id) on delete set null,
  session_id uuid references demo_access_sessions(id) on delete set null,
  business_id uuid references businesses(id) on delete set null,
  event_type text not null,
  actor_type text not null default 'system',
  actor_user_id uuid references app_users(id) on delete set null,
  actor_email text,
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table demo_access_audit
  drop constraint if exists demo_access_audit_event_type_check,
  add constraint demo_access_audit_event_type_check
    check (event_type in (
      'requested', 'created', 'sent', 'opened', 'exchanged', 'claimed',
      'expired', 'revoked', 'reset', 'extended', 'validation_started',
      'validation_passed', 'validation_failed', 'converted'
    ));

alter table demo_access_audit
  drop constraint if exists demo_access_audit_actor_type_check,
  add constraint demo_access_audit_actor_type_check
    check (actor_type in ('anonymous', 'requester', 'user', 'admin', 'system'));

create index if not exists demo_access_audit_request_created_idx
  on demo_access_audit (demo_request_id, created_at desc);

create index if not exists demo_access_audit_business_created_idx
  on demo_access_audit (business_id, created_at desc);
