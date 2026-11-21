-- First-class customer support cases keep self-service, diagnostics, and
-- human follow-up in one tenant-linked record.

create table if not exists support_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  requester_user_id uuid references app_users(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  subject text not null,
  category text not null check (category in ('general', 'installation', 'knowledge', 'actions', 'integration', 'billing', 'verification', 'widget', 'account')),
  provider text,
  connection_id text,
  source_page text,
  source_url text,
  severity text not null default 'normal' check (severity in ('normal', 'urgent')),
  description text not null,
  diagnostics jsonb not null default '{}'::jsonb,
  correlation_id text not null,
  assigned_user_id uuid references app_users(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_cases_queue_idx
  on support_cases (status, created_at desc);
create index if not exists support_cases_business_idx
  on support_cases (business_id, created_at desc);
create index if not exists support_cases_assignee_idx
  on support_cases (assigned_user_id, status, created_at desc);

create table if not exists support_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references support_cases(id) on delete cascade,
  event_type text not null check (event_type in ('case_created', 'status_changed', 'assignment_changed', 'note')),
  actor_user_id uuid references app_users(id) on delete set null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_case_events_case_idx
  on support_case_events (case_id, created_at desc);
